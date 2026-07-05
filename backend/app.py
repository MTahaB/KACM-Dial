"""FastAPI app — the five endpoints of SPEC §4, and no others.

Poll /status at 500ms; no websockets. Frontend talks only to this, on
localhost:8000, and works fully offline once models are pulled.
"""
from __future__ import annotations

import json

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

import cache
import orchestrator
from config import (
    AUDITOR_MODEL,
    DIFFUSION_MODEL,
    METRICS_PATH,
    VRAM_GB,
    WRITER_BACKEND,
    WRITER_MODEL,
)
from models import (
    DocResponse,
    IngestRequest,
    IngestResponse,
    Invariant,
    MetricsResponse,
    ParagraphOut,
    StatusResponse,
)

app = FastAPI(title="Dial", version="1.0-tier1")

# Local dev only; the app never talks to anything but this backend.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    cache.init_db()


@app.post("/ingest", response_model=IngestResponse)
def ingest(req: IngestRequest) -> IngestResponse:
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="empty text")
    doc_id, n = orchestrator.ingest(req.text, req.title or "Untitled")
    return IngestResponse(doc_id=doc_id, n_paragraphs=n)


@app.get("/status/{doc_id}", response_model=StatusResponse)
def status(doc_id: str) -> StatusResponse:
    if not cache.document_exists(doc_id):
        raise HTTPException(status_code=404, detail="unknown doc_id")
    progress, done, total = cache.get_status(doc_id)
    return StatusResponse(progress=progress, paragraphs_done=done, total_jobs=total)


@app.get("/doc/{doc_id}", response_model=DocResponse)
def doc(
    doc_id: str,
    level: str = Query("standard", pattern="^(expert|standard|plain|simple)$"),
) -> DocResponse:
    result = cache.get_doc(doc_id, level)
    if result is None:
        raise HTTPException(status_code=404, detail="unknown doc_id")
    title, paragraphs = result
    return DocResponse(
        title=title,
        paragraphs=[ParagraphOut(**p) for p in paragraphs],
        invariants=[Invariant(**inv) for inv in cache.get_invariants(doc_id)],
    )


@app.get("/paragraph/{doc_id}/{par_id}", response_model=ParagraphOut)
def paragraph(
    doc_id: str,
    par_id: int,
    level: str = Query("standard", pattern="^(expert|standard|plain|simple)$"),
) -> ParagraphOut:
    p = cache.get_paragraph(doc_id, par_id, level)
    if p is None:
        raise HTTPException(status_code=404, detail="unknown doc_id/par_id")
    return ParagraphOut(**p)


@app.get("/metrics/{doc_id}", response_model=MetricsResponse)
def metrics(doc_id: str) -> MetricsResponse:
    if not cache.document_exists(doc_id):
        raise HTTPException(status_code=404, detail="unknown doc_id")

    # Average tokens/s across all logged writer calls (README benchmark source).
    total_tps = 0.0
    n_calls = 0
    try:
        with open(METRICS_PATH, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                if rec.get("tokens_per_s"):
                    total_tps += rec["tokens_per_s"]
                    n_calls += 1
    except (OSError, json.JSONDecodeError):
        pass
    avg_tps = round(total_tps / n_calls, 2) if n_calls else 0.0

    active_writer = DIFFUSION_MODEL if WRITER_BACKEND == "diffusion" else WRITER_MODEL
    return MetricsResponse(
        model_writer=active_writer,
        model_auditor=AUDITOR_MODEL,
        tokens_per_s_avg=avg_tps,
        vram_gb=VRAM_GB,
        n_rewrites=cache.count_rewrites(doc_id),
        n_uncertain=cache.count_by_audit(doc_id, "uncertain"),
        n_seal_violations_caught=cache.count_by_audit(doc_id, "failed"),
    )
