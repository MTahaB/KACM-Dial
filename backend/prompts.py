"""All prompt templates (SPEC §6). Nothing that talks to a model lives elsewhere.

Tier 1 uses only the writer prompts. Invariant/auditor prompts are included so
Tier 2 has a single place to tune, but are not invoked yet.
"""
from __future__ import annotations

# Level definitions — shared constant (§6).
LEVEL_DEFINITIONS: dict[str, str] = {
    "expert": "original text, unchanged",
    "standard": "educated adult, no jargon unless defined, sentences no longer than 25 words",
    "plain": "clear-language standard, common words, active voice, one idea per sentence, sentences no longer than 15 words",
    "simple": "an attentive 14-year-old; short sentences, everyday vocabulary, concrete phrasing; never childish in tone",
}

# Levels that require a rewrite (expert is the original, served verbatim).
REWRITE_LEVELS: tuple[str, ...] = ("standard", "plain", "simple")

WRITER_SYSTEM = (
    "You rewrite one paragraph of a document at a specified reading level. "
    "Preserve ALL meaning, obligations, conditions, and nuances. Never add "
    "information. Never drop a condition or exception. Tokens like ⟦INV:x⟧ are "
    "sealed facts: reproduce each exactly once, unchanged. Match the document's "
    "language (French stays French, English stays English). Output only the "
    "rewritten paragraph, no preamble."
)


def writer_user(level_name: str, tokenized_paragraph: str, language: str | None = None) -> str:
    level_def = LEVEL_DEFINITIONS[level_name]
    lang_line = ""
    if language:
        # Small QAT models drift to English; pin the language explicitly and last.
        lang_line = (
            f"\n\nWrite the rewrite in {language}. Do NOT translate — keep the "
            f"original language of the paragraph."
        )
    return (
        f"LEVEL: {level_name} — {level_def}\n\n"
        f"PARAGRAPH:\n{tokenized_paragraph}{lang_line}"
    )


# Corrective suffix appended on retry when a sealed token was dropped/duplicated
# (§5 step 3). Unused in Tier 1 (no invariants) but kept next to the writer prompt.
def writer_correction(missing_or_dup: list[str]) -> str:
    joined = ", ".join(missing_or_dup)
    return (
        "\n\nYour previous rewrite broke sealed tokens. Every token of the form "
        f"⟦INV:x⟧ must appear EXACTLY ONCE, unchanged. Fix these: {joined}. "
        "Output only the corrected paragraph."
    )


# ---- Tier 2 (defined now, invoked later) ----------------------------------
INVARIANT_SYSTEM = (
    "You extract sealed facts from one paragraph. Return strict JSON of the form "
    '{"invariants":[{"text":"...","kind":"amount|date|name|ref|pct"}]}. '
    "Only include facts whose alteration would change what the reader is entitled "
    "to, owes, or must do by when. No commentary."
)

AUDITOR_SYSTEM = (
    "You are a strict fidelity auditor. Compare an original paragraph with a "
    "rewrite. Flag any added claim, dropped condition, changed obligation, or "
    "shifted meaning. When in doubt, say uncertain. Return strict JSON: "
    '{"verdict":"faithful|uncertain","reason":"<one sentence>"}.'
)


def auditor_user(original: str, rewrite: str) -> str:
    return f"ORIGINAL:\n{original}\n\nREWRITE:\n{rewrite}"
