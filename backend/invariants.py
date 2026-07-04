"""Invariant extraction & verification (SPEC §5 step 2).

Tier 2 territory. In Tier 1 the pipeline runs with invariants disabled, so
`extract()` returns an empty list and no ⟦INV:id⟧ tokenization happens. The
regex Pass A below is written and unit-testable now, but is intentionally not
wired into the rewrite path until Tier 2 so Tier 1 stays strictly "no invariants".
"""
from __future__ import annotations

import re

# Pass A patterns (§5 step 2). Kept here so Tier 2 wiring is a one-line switch.
_PATTERNS: list[tuple[str, str]] = [
    ("pct", r"\d+(?:[.,]\d+)?\s?%"),
    ("amount", r"(?:[€$£]\s?\d[\d\s.,]*|\d[\d\s.,]*\s?(?:€|EUR|USD|euros?))"),
    ("date", r"\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b"),
    ("ref", r"\b(?:Article|Art\.?|§)\s?[\dA-Z][\d.\-]*\b|\bL\.\s?\d[\d\-]*\b"),
]


def extract_regex(text: str) -> list[dict]:
    """Pass A only: deterministic regex facts. Returns [{text, kind}] deduped."""
    found: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for kind, pattern in _PATTERNS:
        for m in re.finditer(pattern, text):
            token = m.group(0).strip()
            key = (kind, token)
            if token and key not in seen:
                seen.add(key)
                found.append({"text": token, "kind": kind})
    return found


def extract(text: str, use_llm: bool = False) -> list[dict]:
    """Tier 1: disabled → []. Tier 2 will union regex (Pass A) with a Gemma
    JSON pass (Pass B) and assign stable ids.
    """
    return []
