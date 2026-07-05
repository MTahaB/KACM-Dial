"""Pipeline (SPEC §5): chunk → invariants → rewrite → audit → assemble.

Generation is pre-computed once at ingest into the SQLite cache and streamed in
paragraph-by-paragraph (§3.3), so the dial reads back instantly. Tier 2 adds:
sealed invariants (§5 step 2), token-preserving rewrite with a corrective retry
(§5 step 3), and a second-model fidelity audit (§5 step 4).
"""
from __future__ import annotations

import json
import re
import threading
import uuid

import cache
import invariants
import llm
import prompts
from config import (
    AUDITOR_MODEL,
    AUDITOR_TEMPERATURE,
    DIFFUSION_MAX_TOKENS,
    DIFFUSION_N,
    USE_AUDIT,
    USE_INVARIANT_LLM,
    USE_INVARIANTS,
    WRITER_BACKEND,
    WRITER_MAX_TOKENS,
    WRITER_MODEL,
    WRITER_TEMPERATURE,
    inv_token,
)
from llm import LLMError, generate, generate_diffusion

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


def _write(tokenized: str, level: str, language: str, corrective: str = "") -> list[str]:
    """One writer call on a tokenized paragraph, dispatched on WRITER_BACKEND.

    Returns candidate rewrites: exactly one from Ollama; up to DIFFUSION_N from
    the diffusion endpoint (best-of-k, brief 1.c). Raises LLMError on failure.
    """
    user = prompts.writer_user(level, tokenized, language=language) + corrective
    if WRITER_BACKEND == "diffusion":
        choices = generate_diffusion(
            prompts.WRITER_SYSTEM,
            user,
            temperature=WRITER_TEMPERATURE,
            max_tokens=min(WRITER_MAX_TOKENS, DIFFUSION_MAX_TOKENS),
            n=DIFFUSION_N,
        )
        return [c.strip() for c in choices if c.strip()]
    out = generate(
        WRITER_MODEL,
        prompts.WRITER_SYSTEM,
        user,
        temperature=WRITER_TEMPERATURE,
        max_tokens=WRITER_MAX_TOKENS,
    )
    return [out.strip()]


def _rewrite_preserving(
    tokenized: str, level: str, expected: dict[str, int], language: str
) -> tuple[str, bool]:
    """Rewrite, then check sealed tokens (§5 step 3). One corrective retry — the
    "auto-regenerate once" of §1.2. Returns (rewrite_with_tokens, tokens_ok).

    With best-of-k candidates, token survival is the selection filter: the first
    candidate whose sealed tokens all verify wins (the regular Nemotron audit
    downstream still judges whichever candidate is chosen).
    """
    candidates = [
        invariants.strip_unknown(c, expected) for c in _write(tokenized, level, language)
    ]
    for out in candidates:
        if not invariants.verify(out, expected):
            return out, True
    bad = invariants.verify(candidates[0], expected)
    corrective = prompts.writer_correction([inv_token(i) for i in bad])
    retries = [
        invariants.strip_unknown(c, expected)
        for c in _write(tokenized, level, language, corrective)
    ]
    for out in retries:
        if not invariants.verify(out, expected):
            return out, True
    return retries[0], False


def _resolve_auditor() -> tuple[str, bool]:
    """Pick the auditor model. Falls back to Gemma self-audit if the Nemotron
    auditor isn't pulled (§3.1). Returns (model, is_second_family)."""
    if not USE_AUDIT:
        return WRITER_MODEL, False
    models = llm.available_models()
    base = AUDITOR_MODEL.split(":")[0]
    for m in models:
        if m == AUDITOR_MODEL or m.split(":")[0] == base:
            return m, True
    return WRITER_MODEL, False


def _audit(original: str, rewrite: str, model: str) -> tuple[str, str | None]:
    """Second-model fidelity check (§5 step 4), temperature 0. Returns
    (verdict, note). If the auditor can't answer, abstain → uncertain (honest)."""
    try:
        raw = generate(
            model,
            prompts.AUDITOR_SYSTEM,
            prompts.auditor_user(original, rewrite),
            json_schema={"type": "object"},
            temperature=AUDITOR_TEMPERATURE,
            max_tokens=256,
        )
        data = json.loads(raw)
        verdict = str(data.get("verdict", "")).strip().lower()
        reason = str(data.get("reason", "")).strip() or None
        # The spec verdict domain is faithful|uncertain, but auditors phrase doubt
        # many ways ("unfaithful", "false", "no"). Only an explicit "faithful"
        # clears the passage; everything else abstains and surfaces the reason.
        if verdict == "faithful":
            return "faithful", None
        return "uncertain", reason or "The auditor flagged a possible shift in meaning."
    except (LLMError, json.JSONDecodeError, ValueError):
        return "uncertain", "Auditor unavailable; this passage was not verified."


def _run_generation(doc_id: str, paragraphs: list[tuple[int, str, bool]]) -> None:
    """Background worker (§5): extract & seal invariants, then rewrite + audit
    every level for every non-heading paragraph, streaming results into cache."""
    auditor_model, _ = _resolve_auditor()

    # --- §5 step 2: invariant extraction with global id assignment -----------
    registry: dict[str, dict] = {}  # lowercased text → {id, text, kind}
    per_par: dict[int, list[dict]] = {}
    if USE_INVARIANTS:
        ext_model = WRITER_MODEL if USE_INVARIANT_LLM else None
        for par_id, text, is_heading in paragraphs:
            if is_heading:
                continue
            resolved: list[dict] = []
            for f in invariants.extract(text, model=ext_model):
                key = f["text"].lower()
                if key not in registry:
                    registry[key] = {"id": f"inv{len(registry)}", "text": f["text"], "kind": f["kind"]}
                resolved.append(registry[key])
            per_par[par_id] = resolved
        cache.save_invariants(doc_id, list(registry.values()))
        # Seal the expert (original) level so chips show there too (§1.2).
        for par_id, text, is_heading in paragraphs:
            if is_heading or not per_par.get(par_id):
                continue
            cache.save_rewrite(
                doc_id, par_id, "expert",
                invariants.strip_tokens_to_seal(text, per_par[par_id]),
                audit="faithful",
            )

    # --- §5 steps 3–5: rewrite, verify, audit, assemble ----------------------
    for par_id, text, is_heading in paragraphs:
        if is_heading:
            continue
        facts = per_par.get(par_id, [])
        tokenized, expected = invariants.tokenize(text, facts) if facts else (text, {})
        id_to_text = {f["id"]: f["text"] for f in facts}
        language = _detect_language(text)

        for level in prompts.REWRITE_LEVELS:
            try:
                rewrite_tok, ok = _rewrite_preserving(tokenized, level, expected, language)
            except LLMError:
                sealed_original = invariants.resolve(tokenized, id_to_text, seal=True)
                cache.save_rewrite(doc_id, par_id, level, sealed_original, audit="failed",
                                   audit_note="Writer failed after retry; original shown.")
                continue

            if not ok:
                # Sealed fact altered/dropped and survived the retry → red (§1.2).
                sealed_original = invariants.resolve(tokenized, id_to_text, seal=True)
                cache.save_rewrite(doc_id, par_id, level, sealed_original, audit="failed",
                                   audit_note="A sealed fact was altered or dropped; original shown for safety.")
                continue

            rewrite_plain = invariants.resolve(rewrite_tok, id_to_text, seal=False)
            rewrite_html = invariants.resolve(rewrite_tok, id_to_text, seal=True)
            if USE_AUDIT:
                verdict, note = _audit(text, rewrite_plain, auditor_model)
            else:
                verdict, note = "pending", None
            cache.save_rewrite(doc_id, par_id, level, rewrite_html, audit=verdict, audit_note=note)


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
