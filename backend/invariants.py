"""Invariant extraction, tokenization & verification (SPEC §5 step 2 / §1.2).

A sealed invariant is a hard fact (amount, date, %, proper name, legal ref) whose
alteration would change what the reader owes, is entitled to, or must do by when.
They are extracted once from the original and must appear verbatim at every level.

Flow:
  extract()   → per-paragraph list of {text, kind}     (regex Pass A ∪ Gemma Pass B)
  tokenize()  → replace each fact occurrence with ⟦INV:id⟧, return expected counts
  verify()    → which ids the writer dropped/duplicated
  resolve()   → ⟦INV:id⟧ → raw text  OR  <seal id="..">text</seal>
"""
from __future__ import annotations

import json
import re

import prompts
from config import INV_PREFIX, INV_SUFFIX, inv_token

# Pass A patterns (§5 step 2). Order matters only for readability; dedup is global.
_PATTERNS: list[tuple[str, str]] = [
    ("pct", r"\d+(?:[.,]\d+)?\s?%"),
    ("amount", r"(?:[€$£]\s?\d[\d\s.,]*\d|\d[\d\s.,]*\d\s?(?:€|EUR|USD|euros?))"),
    (
        "date",
        r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b|"
        # written dates (FR + EN months)
        r"\b\d{1,2}\s+(?:janvier|février|mars|avril|mai|juin|juillet|août|"
        r"septembre|octobre|novembre|décembre|January|February|March|April|May|"
        r"June|July|August|September|October|November|December)\s+\d{4}\b|"
        # durations / deadlines
        r"\b\d{1,3}\s?(?:jours?|mois|semaines?|ans?|années?|days?|weeks?|months?|years?)\b",
    ),
    (
        "ref",
        r"\b(?:Article|Art\.?|§)\s?[\dA-Z][\w.\-]*\b|\bL\.\s?\d[\d\-]*\b|"
        r"\bloi\s+n[°o]\s?[\d\-]+\b",
    ),
]

# Marker regex built from the central format (config.INV_STYLE) so switching to
# ascii [[INV:id]] — brief step 1.d — changes tokenize/verify/resolve coherently.
_TOKEN_RE = re.compile(
    re.escape(INV_PREFIX) + r"([A-Za-z0-9_]+)" + re.escape(INV_SUFFIX)
)
_VALID_KINDS = {"amount", "date", "name", "ref", "pct"}
# Pass B facts longer than this are rejected — a sealed fact is an atomic span
# (a name, amount, date, reference), never a whole clause.
MAX_LLM_FACT_CHARS = 40


def extract_regex(text: str) -> list[dict]:
    """Pass A: deterministic regex facts. Returns [{text, kind}] deduped within text."""
    found: list[dict] = []
    seen: set[str] = set()
    for kind, pattern in _PATTERNS:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            token = m.group(0).strip()
            if token and token.lower() not in seen:
                seen.add(token.lower())
                found.append({"text": token, "kind": kind})
    return found


def extract_llm(text: str, model: str) -> list[dict]:
    """Pass B: Gemma JSON pass for proper names + any missed hard facts (§5 step 2)."""
    try:
        raw = prompts_extract(text, model)
        data = json.loads(raw)
        out: list[dict] = []
        for item in data.get("invariants", []):
            t = str(item.get("text", "")).strip()
            kind = str(item.get("kind", "")).strip().lower()
            if t and kind in _VALID_KINDS:
                out.append({"text": t, "kind": kind})
        return out
    except Exception:
        return []  # extraction is best-effort; regex Pass A still stands


def prompts_extract(text: str, model: str) -> str:
    from llm import generate

    return generate(
        model,
        prompts.INVARIANT_SYSTEM,
        f"PARAGRAPH:\n{text}",
        json_schema={"type": "object"},
        temperature=0.0,
        max_tokens=512,
    )


def extract(text: str, model: str | None = None) -> list[dict]:
    """Union of Pass A (regex) and Pass B (Gemma), deduped by (lowercased text).

    Only facts actually present as a substring of `text` are kept — the LLM
    sometimes paraphrases; a fact we cannot locate verbatim cannot be sealed.
    """
    facts = extract_regex(text)
    if model:
        for f in extract_llm(text, model):
            ftext = f["text"]
            # Keep only facts that are sealable verbatim AND a short atomic span —
            # small models sometimes return a whole clause, which would freeze the
            # entire sentence and defeat the point of rewriting.
            if ftext not in text or len(ftext) > MAX_LLM_FACT_CHARS:
                continue
            # Drop facts that overlap an already-found one (e.g. "1 240,50" vs the
            # regex "1 240,50 €") — regex facts are authoritative and more complete.
            if any(ftext in g["text"] or g["text"] in ftext for g in facts):
                continue
            facts.append(f)
    # Global dedup by lowercased text, keep first (regex) kind on collision.
    seen: dict[str, dict] = {}
    for f in facts:
        key = f["text"].lower()
        if key not in seen:
            seen[key] = f
    return list(seen.values())


def tokenize(text: str, facts: list[dict]) -> tuple[str, dict[str, int]]:
    """Replace every occurrence of each fact's text with ⟦INV:id⟧.

    `facts` = [{id, text, kind}]. Longest texts first so a longer fact isn't
    clobbered by a shorter substring. Returns (tokenized_text, {id: expected_count}).
    """
    ordered = sorted(facts, key=lambda f: len(f["text"]), reverse=True)
    out = text
    counts: dict[str, int] = {}
    for f in ordered:
        token = inv_token(f["id"])
        n = out.count(f["text"])
        if n:
            out = out.replace(f["text"], token)
            counts[f["id"]] = counts.get(f["id"], 0) + n
    return out, counts


def verify(rewrite: str, expected: dict[str, int]) -> list[str]:
    """Return ids whose token count in `rewrite` differs from expected (§5 step 3)."""
    present: dict[str, int] = {}
    for m in _TOKEN_RE.finditer(rewrite):
        present[m.group(1)] = present.get(m.group(1), 0) + 1
    bad = [i for i, c in expected.items() if present.get(i, 0) != c]
    return bad


def strip_unknown(rewrite: str, expected: dict[str, int]) -> str:
    """Remove hallucinated tokens — ids the paragraph never had.

    The writer system prompt teaches the token syntax, so on seal-less
    paragraphs the model sometimes emits a decorative ⟦INV:x⟧. Those ids are
    fabrications by construction (nothing real to lose): drop them before
    verification instead of wasting a corrective retry, and collapse the
    whitespace left behind.
    """

    def repl(m: re.Match[str]) -> str:
        return m.group(0) if m.group(1) in expected else ""

    out = _TOKEN_RE.sub(repl, rewrite)
    return re.sub(r"[ \t]{2,}", " ", out).strip()


def resolve(text: str, id_to_text: dict[str, str], *, seal: bool) -> str:
    """Turn ⟦INV:id⟧ back into either the raw value (seal=False, for the auditor)
    or <seal id="..">value</seal> markup (seal=True, for storage/frontend)."""

    def repl(m: re.Match[str]) -> str:
        inv_id = m.group(1)
        value = id_to_text.get(inv_id, m.group(0))
        if seal:
            return f'<seal id="{inv_id}">{value}</seal>'
        return value

    return _TOKEN_RE.sub(repl, text)


def strip_tokens_to_seal(text: str, facts: list[dict]) -> str:
    """Build sealed HTML for a paragraph that was never tokenized (e.g. expert
    level): wrap raw fact occurrences directly in <seal> markup."""
    tokenized, _ = tokenize(text, facts)
    id_to_text = {f["id"]: f["text"] for f in facts}
    return resolve(tokenized, id_to_text, seal=True)
