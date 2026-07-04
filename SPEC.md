# DIAL — Technical Specification
### Semantic Level-of-Detail Reader · RAISE Summit Hackathon 2026 · Track 5 (Google DeepMind Remote: Gemma on-device)

> **One-liner:** Google Maps gave zoom to space. Dial gives it to meaning. A document reader where reading level is a property of your gaze, not of the document — 100% local, offline, privacy-first. Gemma writes, Nemotron audits, nothing leaves the machine.

---

## 0. Context & Hard Constraints (READ FIRST)

- **Deadline:** Sunday July 5th, 12:00 PM Paris time. ~24h remaining. Everything below is prioritized in 3 tiers — Tier 1 alone must be submittable.
- **Track requirement:** Gemma must run **locally** and be the load-bearing model. No cloud inference of any kind. The app must work with WiFi off (we will film it in airplane mode).
- **Banned by rules (avoid at all costs):** Streamlit apps, basic RAG, dashboards-as-main-feature, medical advice. Dial is none of these — keep it that way (do NOT add a chat interface, do NOT add document Q&A, it drifts toward banned categories).
- **New work only:** repo is public, all code written during the event. Both teammates must commit. No copying of prior private code.
- **Judging:** Demo 50% · Impact 25% · Creativity 15% · Pitch 10%. Judged remotely via 1-minute video + repo + description. Every decision optimizes for what is *visible* in 60 seconds.
- **Bonus target:** NVIDIA "best use of Nemotron" — Nemotron is the fidelity auditor (Tier 2). It must be a real, non-decorative use, but must remain secondary to Gemma.

---

## 1. Product Definition

### 1.1 Core mechanic
A document (pasted text or uploaded .txt/.md; PDF out of scope) is displayed in a reader. The user controls **reading level** through:

1. **Global dial (Tier 1):** a slider with N=4 discrete levels — `expert` (original), `standard`, `plain` (clear-language), `simple` (ELI-teen). Moving the dial morphs the whole document in place.
2. **Semantic zoom (Tier 3):** pinch/scroll-zoom (or click) on a single paragraph expands *that paragraph only* to a more detailed level while the rest stays at the global level. Level-of-detail per paragraph, like map tiles.
3. **Split view "two readers" (Tier 3):** same document side-by-side at two different levels, scroll-synced paragraph-to-paragraph.

### 1.2 Trust layer
- **Sealed invariants (Tier 2):** hard facts (amounts, dates, percentages, proper names, legal/article references) are extracted once from the original and rendered as visually distinct "sealed chips" inside the text. They must appear **verbatim and identical at every level**. Rewrites happen around them.
- **Fidelity audit (Tier 2):** every rewritten paragraph is checked by a *second, different model family* (Nemotron) for meaning preservation. Verdict per paragraph: `faithful` (subtle green check), `uncertain` (orange highlight + "verify this passage yourself" tooltip), plus invariant presence check (hard fail → red if a sealed fact is missing/altered → auto-regenerate once, then flag).
- **Honest abstention:** when the auditor is uncertain, the UI says so. Tagline for README: *"The app that knows when it might have betrayed the text."*

### 1.3 Explicit non-goals (do NOT build)
Multi-document library, version history, accounts, PDF parsing, export, TTS/STT, chat with the document, more than one rewrite axis (reading level only — no formality/length sliders; cut from earlier drafts for scope).

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Frontend: React + Vite (plain CSS or Tailwind)          │
│  - Reader view, dial, zoom, split view, audit badges     │
│  - Talks ONLY to local backend, works offline            │
└───────────────▲──────────────────────────────────────────┘
                │ HTTP (localhost:8000), JSON
┌───────────────┴──────────────────────────────────────────┐
│  Backend: Python 3.11 + FastAPI + uvicorn                │
│  - Orchestrator: chunking, cache, job queue              │
│  - Invariant extractor (regex + Gemma pass)              │
│  - Writer client  → Ollama: Gemma (QAT quant)            │
│  - Auditor client → Ollama: Nemotron Nano (quantized)    │
│  - SQLite cache (document → level → paragraph → text)    │
└───────────────▲──────────────────────────────────────────┘
                │ http://localhost:11434 (Ollama REST)
┌───────────────┴──────────────────────────────────────────┐
│  Ollama (local inference, GPU)                           │
│  Models: gemma writer + nemotron auditor (see §3)        │
└──────────────────────────────────────────────────────────┘
```

**Why this stack:** Ollama removes all inference plumbing risk; FastAPI is fastest to write; React frontend avoids the Streamlit ban and gives us the polish for the 50% demo criterion. Everything runs on one machine, offline once models are pulled.

**Repo layout:**
```
dial/
  backend/
    app.py            # FastAPI app, all endpoints
    orchestrator.py   # pipeline: chunk → invariants → rewrite → audit
    llm.py            # Ollama clients (writer, auditor), retries, timeouts
    prompts.py        # ALL prompt templates live here, nowhere else
    invariants.py     # regex + LLM extraction, verification
    cache.py          # SQLite layer
    models.py         # Pydantic schemas (the API contract, §4)
  frontend/
    src/
      App.tsx
      components/ Reader.tsx, Dial.tsx, Paragraph.tsx, SplitView.tsx, AuditBadge.tsx, SealedChip.tsx
      api.ts          # typed client matching §4 exactly
      mock.ts         # mock server responses (frontend dev starts here)
  samples/            # 3 demo documents (see §8)
  README.md
  SPEC.md             # this file
```

---

## 3. Models & Inference

### 3.1 Model selection (decide in the first hour — go/no-go test)
- **Writer (primary):** the newest Gemma QAT instruction-tuned quant that fits in VRAM alongside the auditor. Test order: 12B-class QAT first; if VRAM or tokens/s is inadequate, drop to the 4B-class. Pull via Ollama; verify actual tag names with `ollama search gemma` / the Ollama library at setup time (do not hardcode guesses — tag names in the registry change).
- **Writer (stretch, timeboxed to 2h max):** DiffusionGemma for parallel infilling, only if it runs trivially in our stack. If not running end-to-end within 2 hours → permanent fallback to autoregressive Gemma. The product is identical either way; diffusion is an implementation detail, not a dependency.
- **Auditor:** smallest Nemotron Nano-class quant available in Ollama/GGUF that fits in remaining VRAM. If both models can't co-reside, load sequentially per batch (writer pass, unload, auditor pass) — slower but acceptable since everything is pre-generated (§3.3).
- **Fallback auditor (if Nemotron won't run at all):** Gemma audits itself with a different prompt + temperature 0. We lose the NVIDIA bonus, product survives. Decide by H+14, not later.

### 3.2 Ollama call contract (`llm.py`)
- Single function `generate(model, system, prompt, json_schema=None, temperature, max_tokens, timeout_s=120)`.
- Use Ollama's `format: json` mode for all structured outputs (invariants, audit verdicts).
- Retries: 1 retry on timeout/malformed JSON, then raise; orchestrator marks paragraph as `failed` and keeps original text (never block the whole document on one paragraph).
- Log tokens/s per call to a `metrics.jsonl` — the README benchmark table is generated from this (free NVIDIA-bonus material).

### 3.3 Pre-generation, not on-demand
All levels for all paragraphs are generated **once at ingest**, stored in SQLite. The dial, zoom, and scrubbing then read from cache with zero inference latency. This is what makes the demo feel instant. Ingest of a 2-page document at 3 rewrite levels ≈ 30–60 LLM calls — show a progress bar with paragraph-level granularity, and stream results in as they complete (the document "develops" like a photo; nice demo moment on its own).

---

## 4. API Contract (frozen at H+1 — frontend developed against mock until backend is real)

```
POST /ingest
  body: { "text": string, "title": string }
  resp: { "doc_id": string, "n_paragraphs": int }

GET /status/{doc_id}
  resp: { "progress": float,               // 0..1
          "paragraphs_done": int, "total_jobs": int }

GET /doc/{doc_id}?level=expert|standard|plain|simple
  resp: { "title": string,
          "paragraphs": [ {
            "id": int,
            "html": string,                // rewritten text with <seal id=".."/> placeholders resolved
            "level": string,
            "audit": "faithful"|"uncertain"|"failed"|"pending",
            "audit_note": string|null      // one-sentence reason when uncertain
          } ],
          "invariants": [ { "id": string, "text": string, "kind": "amount"|"date"|"name"|"ref"|"pct" } ] }

GET /paragraph/{doc_id}/{par_id}?level=...   // for semantic zoom: single paragraph at another level
  resp: same paragraph object as above

GET /metrics/{doc_id}
  resp: { "model_writer": string, "model_auditor": string,
          "tokens_per_s_avg": float, "vram_gb": float,
          "n_rewrites": int, "n_uncertain": int, "n_seal_violations_caught": int }
```

Rules: no other endpoints. No websockets (poll `/status` at 500ms). Frontend `mock.ts` implements all five with canned data so UI work starts at H+0.

---

## 5. Pipeline (orchestrator.py)

For each ingested document:

1. **Chunking:** split on blank lines into paragraphs; merge fragments < 200 chars with their neighbor; hard-cap paragraphs at ~1,500 chars (split on sentence boundary). Headings detected (`#`, ALL-CAPS lines, numbered clauses) are passed through untouched at all levels.
2. **Invariant extraction (per paragraph):**
   - Pass A, regex: currency amounts, numbers+units, percentages, ISO/written dates, article/section references (`Article 12`, `§4.2`, `L.121-1`).
   - Pass B, Gemma with JSON schema: proper names and any missed hard facts. Union of A∪B, deduplicated.
   - Each invariant gets an id; in the source paragraph, occurrences are replaced by `⟦INV:id⟧` tokens before rewriting.
3. **Rewrite (per paragraph × per level, skip `expert` = original):** Gemma receives the tokenized paragraph + level instructions (§6) + the rule that every `⟦INV:id⟧` token must appear exactly once, unmodified. Post-check: if any token is missing/duplicated → one retry with a corrective suffix → if still bad, mark `failed`, serve original text for that level.
4. **Audit (per rewritten paragraph):** Nemotron receives original + rewrite (both with invariant tokens resolved back to real values) and returns strict JSON: `{"verdict": "faithful"|"uncertain", "reason": "<one sentence>"}` under a "you are a strict fidelity auditor; flag any added claim, dropped condition, changed obligation, or shifted meaning; when in doubt say uncertain" system prompt, temperature 0.
5. **Assembly:** resolve `⟦INV:id⟧` → `<seal id>` markup, store in cache, expose via API.

**Honesty note for README/pitch:** the audit threshold is a heuristic second-model check, not a formal statistical guarantee — describe it as "dual-model fidelity verification with explicit abstention," never overclaim calibration we didn't validate. If time allows (Tier 3+, unlikely), a small labeled set of perturbed rewrites can turn the auditor score into a calibrated threshold; otherwise this is future work and one honest sentence in the README.

---

## 6. Prompt Templates (prompts.py — final wording tuned during build, structure fixed)

**Level definitions (shared constant):**
- `standard`: educated adult, no jargon unless defined, sentences ≤ 25 words.
- `plain`: clear-language standard, common words, active voice, one idea per sentence, sentences ≤ 15 words.
- `simple`: attentive 14-year-old, short sentences, everyday vocabulary, concrete phrasing; never childish in tone.

**Writer (system):**
> You rewrite one paragraph of a document at a specified reading level. Preserve ALL meaning, obligations, conditions, and nuances. Never add information. Never drop a condition or exception. Tokens like ⟦INV:x⟧ are sealed facts: reproduce each exactly once, unchanged. Match the document's language (French stays French, English stays English). Output only the rewritten paragraph, no preamble.

**Writer (user):** `LEVEL: {level_name} — {level_definition}\n\nPARAGRAAPH:\n{tokenized_paragraph}`

**Invariant extractor (system):** strict JSON `{"invariants":[{"text":"...","kind":"amount|date|name|ref|pct"}]}`, instruction: only facts whose alteration would change what the reader is entitled to, owes, or must do by when.

**Auditor (system):** as in §5 step 4; strict JSON; temperature 0.

---

## 7. Frontend Spec

**Design intent:** calm, editorial, "reading app" aesthetic — serif for document text, clean sans for UI, generous margins, subtle transitions. It must NOT look like an admin dashboard (banned category adjacency) or an AI chat app. One screen, zero navigation.

**Components & behaviors:**
- `Dial.tsx` — vertical or horizontal slider, 4 detents, keyboard accessible, big enough to be legible in the video. On change: crossfade each paragraph (staggered 30ms cascade top-to-bottom, ~250ms per paragraph — this cascade IS the signature visual; spend real time here).
- `Paragraph.tsx` — renders html with `SealedChip` (rounded chip, lock glyph, monospace numerals) and audit state: green micro-check (faithful, subtle), orange left-border + background tint (uncertain, with `audit_note` on hover/tap), red only for seal violations that survived retry.
- Semantic zoom (Tier 3): ctrl+scroll or pinch over a paragraph, or a per-paragraph `+/–` affordance on hover, fetches `/paragraph?level=deeper` and expands in place with the rest dimmed by ~15% for 1s to sell the "focus" metaphor.
- `SplitView.tsx` (Tier 3): toggle button → two synced columns, independent dials, scroll sync by paragraph id.
- Offline proof: a small "● local — no network" pill in the header; in the video we additionally toggle OS airplane mode on camera.
- Ingest state: progress bar + paragraphs appearing as generated.

---

## 8. Demo Content (samples/ — prepare early, they drive the video)

1. **French administrative letter** (CAF/prefecture-style, invented but realistic, dense legalese, 1 page, with amounts, deadlines, article refs) — the emotional core of the video.
2. **Rental contract excerpt** (2 clauses with obligations, penalties, dates) — invariants showcase.
3. **Physics course extract** (English, 3 paragraphs) — education use case + shows bilingual capability.

Author these by hand during the event (they're demo data, not code). Seed one deliberate stress case: a clause whose naive simplification flips an obligation — we want Nemotron to catch a real drift on camera. Find this case by trial during Tier 2 testing; do not fake it.

---

## 9. Build Plan — 3 tiers with go/no-go gates

**Tier 1 — the submittable core (target H+8):**
repo + CI-less scaffolding, Ollama models pulled, `/ingest → /doc` pipeline with rewrite at 4 levels (no invariants, no audit), React reader + dial + cascade morph + progress. *Gate at H+3: one paragraph rewritten end-to-end through the real stack. If DiffusionGemma was attempted and failed, fallback already active.*

**Tier 2 — trust & bonus (target H+14):**
invariants pipeline + sealed chips, Nemotron audit + badges/highlights, metrics endpoint + README benchmark table. *Gate at H+14: if Nemotron is not running, switch to self-audit fallback and move on without regret.*

**Tier 3 — the wow (target H+20):**
semantic zoom, split view, scrubbing polish, design pass. *Hard feature freeze at H+20.*

**H+20 → H+22:** film & edit the 60s video (storyboard already agreed: scrub morph in airplane mode → pinch zoom → Nemotron catches a drift → split view parent/teen → closing card "Gemma writes. Nemotron verifies. Nothing leaves." + tokens/s overlay).
**H+22:** README final (GIF at top, architecture diagram, benchmark table, honest limitations section), dry-run submission on the Cerebral Valley form. **Submit no later than H+23.**

**Team split:** Person A (Taha) owns backend + models + prompts + metrics; Person B owns frontend + video + README. Sync points: H+3, H+8, H+14, H+20. Both commit throughout (judges check contribution).

---

## 10. Risk Register

| Risk | Detection | Mitigation |
|---|---|---|
| DiffusionGemma doesn't run locally | H+2 timebox | Autoregressive Gemma QAT, same product |
| Two models don't fit in VRAM | first-hour test | Sequential load per batch; or 4B writer |
| Rewrite quality poor in French | sample doc test at H+3 | Bigger writer variant; tighten level prompts; French-first prompt wording |
| Invariant tokens broken by writer | post-check in pipeline | Retry with corrective suffix → serve original |
| Ollama JSON mode flaky | malformed JSON errors | 1 retry, then degrade gracefully (paragraph marked failed) |
| Scope creep | any feature not in this file | It's cut. This spec is the contract. |

---

## 11. README Requirements (part of the deliverable, Person B)

Hero GIF (scrub morph) · one-paragraph pitch · "Why local is not a gimmick here" section (privacy of administrative/legal documents; offline access; sealed-facts trust) · architecture diagram · benchmark table from `/metrics` (models, quant, VRAM, tokens/s) · honest limitations (audit is heuristic dual-model verification, no formal guarantee; .txt/.md only; single-machine) · how-to-run in ≤ 5 commands · both contributors listed with roles.
