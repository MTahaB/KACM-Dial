"""Pipeline (SPEC §5): chunk → (invariants) → rewrite → (audit) → assemble.

Tier 1 implements chunk → rewrite → assemble. Invariants and audit are stubbed
(§5 steps 2 & 4 are Tier 2). Generation is pre-computed once at ingest into the
SQLite cache and streamed in paragraph-by-paragraph (§3.3), so the dial reads
back instantly.
"""
from __future__ import annotations

import re
import threading
import uuid

import cache
import prompts
from config import WRITER_MAX_TOKENS, WRITER_MODEL, WRITER_TEMPERATURE
from llm import LLMError, generate

# Chunking parameters (§5 step 1).
MIN_PARAGRAPH_CHARS = 200
MAX_PARAGRAPH_CHARS = 1500
# Fragments shorter than this that could not be merged (e.g. a salutation after a
# heading) are served verbatim rather than rewritten — a 2-word salutation gives a
# small model nothing to preserve and it hallucinates a whole letter.
PASSTHROUGH_MAX_CHARS = 40

_HEADING_NUMBERED = re.compile(r"^\s*(?:\d+(?:\.\d+)*\.?|[IVXLC]+\.)\s+\S")

# Cheap FR/EN detection so the writer prompt can pin the output language (§10 risk:
# "rewrite quality poor in French" — the model drifts to English without this).
_FR_MARKERS = re.compile(
    r"\b(?:le|la|les|de|des|du|une?|vous|nous|dans|être|avez|votre|cette|au|aux|"
    r"délai|caisse|somme|décision)\b",
    re.IGNORECASE,
)


def _detect_language(text: str) -> str:
    fr_hits = len(_FR_MARKERS.findall(text))
    has_accents = bool(re.search(r"[àâçéèêëîïôùûü]", text, re.IGNORECASE))
    if fr_hits >= 2 or (fr_hits >= 1 and has_accents):
        return "French"
    return "English"


def _is_heading(text: str) -> bool:
    """Headings pass through untouched at all levels (§5 step 1)."""
    stripped = text.strip()
    if not stripped or "\n" in stripped:
        return False
    if stripped.startswith("#"):
        return True
    if _HEADING_NUMBERED.match(stripped) and len(stripped) < 120:
        return True
    letters = [c for c in stripped if c.isalpha()]
    if letters and len(stripped) < 80 and all(c.isupper() for c in letters):
        return True
    return False


def _split_long(text: str) -> list[str]:
    """Split an over-long paragraph on sentence boundaries, ~MAX_PARAGRAPH_CHARS."""
    if len(text) <= MAX_PARAGRAPH_CHARS:
        return [text]
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    buf = ""
    for s in sentences:
        if buf and len(buf) + len(s) + 1 > MAX_PARAGRAPH_CHARS:
            chunks.append(buf.strip())
            buf = s
        else:
            buf = f"{buf} {s}".strip()
    if buf.strip():
        chunks.append(buf.strip())
    return chunks


def chunk_document(text: str) -> list[tuple[str, bool]]:
    """Return [(paragraph_text, is_heading)] per §5 step 1.

    Split on blank lines; merge non-heading fragments < 200 chars into the
    previous non-heading paragraph; hard-cap length by sentence splitting.
    Headings are never merged and never split.
    """
    raw = [block.strip() for block in re.split(r"\n\s*\n", text) if block.strip()]

    merged: list[tuple[str, bool]] = []
    for block in raw:
        heading = _is_heading(block)
        if (
            not heading
            and merged
            and not merged[-1][1]
            and len(block) < MIN_PARAGRAPH_CHARS
        ):
            merged[-1] = (f"{merged[-1][0]}\n{block}", False)
        else:
            merged.append((block, heading))

    result: list[tuple[str, bool]] = []
    for block, heading in merged:
        if heading:
            result.append((block, True))
        elif len(block) < PASSTHROUGH_MAX_CHARS:
            # Un-mergeable short fragment → serve verbatim (treated like a heading:
            # no rewrite job, identical at every level).
            result.append((block, True))
        else:
            for piece in _split_long(block):
                result.append((piece, False))
    return result


def _rewrite_paragraph(text: str, level: str) -> str:
    """One writer call. On LLM failure, degrade to original text (never block)."""
    system = prompts.WRITER_SYSTEM
    user = prompts.writer_user(level, text, language=_detect_language(text))
    out = generate(
        WRITER_MODEL,
        system,
        user,
        temperature=WRITER_TEMPERATURE,
        max_tokens=WRITER_MAX_TOKENS,
    )
    return out.strip()


def _run_generation(doc_id: str, paragraphs: list[tuple[int, str, bool]]) -> None:
    """Background worker: fill every rewrite level for every non-heading paragraph."""
    for par_id, text, is_heading in paragraphs:
        if is_heading:
            continue
        for level in prompts.REWRITE_LEVELS:
            try:
                html = _rewrite_paragraph(text, level)
                cache.save_rewrite(doc_id, par_id, level, html, audit="pending")
            except LLMError:
                # Serve original for this level, marked failed (§3.2 / §5 step 3).
                cache.save_rewrite(doc_id, par_id, level, text, audit="failed")


def ingest(text: str, title: str) -> tuple[str, int]:
    """Chunk, persist skeleton, kick off background generation. Returns (doc_id, n)."""
    doc_id = uuid.uuid4().hex[:12]
    chunks = chunk_document(text)
    paragraphs = [(i, t, h) for i, (t, h) in enumerate(chunks)]
    cache.create_document(doc_id, title, [(i, t, h) for i, t, h in paragraphs])

    worker = threading.Thread(
        target=_run_generation, args=(doc_id, paragraphs), daemon=True
    )
    worker.start()
    return doc_id, len(paragraphs)
