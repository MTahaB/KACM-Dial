# Dial — Semantic Level-of-Detail Reader

> Google Maps gave zoom to space. **Dial** gives it to meaning.
> A document reader where reading level is a property of your gaze, not of the document.
> **100% local, offline, privacy-first.** Gemma writes, Nemotron audits, nothing leaves the machine.

RAISE Summit Hackathon 2026 · Track 5 (Google DeepMind — Gemma on-device)

---

## What it does

Paste an administrative letter, a contract clause, or a course extract, and turn a
single **dial** to re-read the *same document* at four levels of detail —
`expert` (original) · `standard` · `plain` · `simple` — with a signature cascade
morph. Every level is generated **once at ingest** by a local Gemma model and
cached, so the dial is instant. Hard facts (amounts, dates, article references)
are preserved verbatim across every level.

## Why local is not a gimmick here

- **Privacy:** the documents this is built for — benefit notices, tax letters,
  leases — are exactly the ones you should not paste into a cloud service.
- **Offline:** works with WiFi off. All inference is on-device via Ollama.
- **Trust:** sealed facts and (Tier 2) a second-model fidelity audit mean the app
  can tell you when it might have betrayed the text — not just rewrite blindly.

## Architecture

```
React + Vite  ──HTTP(localhost:8000)──►  FastAPI  ──localhost:11434──►  Ollama
  reader / dial / cascade                orchestrator                    Gemma (writer)
  offline, talks only to backend         SQLite cache                    Nemotron (auditor, Tier 2)
```

- **Pre-generation, not on-demand** (§3.3): all levels for all paragraphs are
  generated at ingest and stored in SQLite; the dial reads from cache with zero
  inference latency.
- **Model names are env-configurable** — the exact Ollama tag is never hardcoded
  (registry tags change).

## Run it (≤ 5 commands)

```bash
# 0. Prereqs: Python 3.11+, Node 18+, Ollama running, models pulled:
ollama pull gemma3:4b-it-qat            # writer   (override with DIAL_WRITER_MODEL)
ollama pull nemotron-mini               # auditor  (override with DIAL_AUDITOR_MODEL)

# 1. Backend
cd backend && python -m venv .venv && ./.venv/Scripts/pip install -r requirements.txt
./.venv/Scripts/uvicorn app:app --port 8000

# 2. Frontend (new terminal)
cd frontend && npm install && npm run dev      # http://localhost:5173
```

The frontend also runs **without a backend** for UI work: `VITE_USE_MOCK=1 npm run dev`
serves canned data (`src/mock.ts`) implementing all five endpoints.

### Configuration (env vars)

| Var | Default | Meaning |
|---|---|---|
| `DIAL_WRITER_MODEL` | `gemma3:4b-it-qat` | Ollama writer tag |
| `DIAL_AUDITOR_MODEL` | `nemotron-mini:latest` | Ollama auditor tag (Tier 2) |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama REST endpoint |
| `DIAL_VRAM_GB` | `0` | VRAM figure surfaced in `/metrics` |

## API (frozen contract — SPEC §4)

`POST /ingest` · `GET /status/{doc_id}` · `GET /doc/{doc_id}?level=…` ·
`GET /paragraph/{doc_id}/{par_id}?level=…` · `GET /metrics/{doc_id}`.
No other endpoints, no websockets (poll `/status` at 500ms).

## Trust layer (Tier 2)

- **Sealed invariants.** Hard facts — amounts, dates, percentages, proper names,
  legal references — are extracted once from the original (regex Pass A ∪ a Gemma
  JSON pass), replaced with `⟦INV:id⟧` tokens before rewriting, and required to
  reappear **exactly once, unchanged** in every rewrite. They render as lock-glyph
  "sealed chips", verbatim and identical at every level. If the writer breaks a
  token, one corrective retry fires; if it still fails, the original is served and
  the passage is flagged red.
- **Dual-model fidelity audit.** Every rewrite is checked by a *different model
  family* — **NVIDIA Nemotron** — at temperature 0: `faithful` (subtle green
  check) or `uncertain` (orange highlight + the auditor's one-sentence reason,
  "verify this passage yourself"). If Nemotron isn't available it falls back to
  Gemma self-audit (product survives, NVIDIA bonus lost).
- **Honest abstention.** When the auditor is unsure, the UI says so. *The app that
  knows when it might have betrayed the text.* The audit is a heuristic dual-model
  check with explicit abstention — not a formal statistical guarantee.

## Benchmark

Generated from `metrics.jsonl` (`python backend/bench.py`). Numbers below are from
a **CPU-only** dev box — expect an order of magnitude more on the demo GPU:

| Model | Role | Avg tokens/s |
|---|---|---:|
| `gemma3:4b-it-qat` | writer | ~3 (CPU) |
| `nemotron-mini:latest` | auditor | ~4 (CPU) |

## Build status

- **Tier 1 (submittable core) — DONE.** `/ingest → /doc` pipeline with rewrite at
  4 levels, chunking, SQLite cache, streamed progress, React reader + dial +
  cascade morph.
- **Tier 2 (trust & bonus) — DONE.** Invariant extraction + sealed chips,
  token-preserving rewrite with corrective retry, Nemotron fidelity audit +
  badges, `/metrics` with uncertain/seal-violation counts, benchmark generator.
  Verified end-to-end against real Gemma + Nemotron (facts sealed at every level,
  auditor catches a deliberate obligation flip).
- **Tier 3 (the wow) — DONE.** Per-paragraph **semantic zoom** (hover +/−
  controls or ctrl+scroll raise one paragraph's level of detail while the rest
  hold, with a 1s focus dim), **split "two readers"** view (two scroll-synced
  columns with independent dials), and a design pass. Verified live in-browser.

## Honest limitations

- The fidelity audit (Tier 2) is a **heuristic dual-model check with explicit
  abstention**, not a formal statistical guarantee.
- `.txt` / `.md` text only — no PDF parsing.
- Single machine; no accounts, history, or export (by design — see SPEC §1.3).

## Contributors

- **Taha** — backend, models, prompts, metrics.
- **Ismail** — frontend, video, README.

See [`SPEC.md`](SPEC.md) for the full technical specification.
