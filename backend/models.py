"""Pydantic schemas — the API contract from SPEC §4. Frozen at H+1.

Nothing in this file should drift from §4 without a corresponding change to
frontend/src/api.ts and mock.ts. The literals here ARE the contract.
"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel

Level = Literal["expert", "standard", "plain", "simple"]
AuditVerdict = Literal["faithful", "uncertain", "failed", "pending"]
InvariantKind = Literal["amount", "date", "name", "ref", "pct"]


# ---- POST /ingest ---------------------------------------------------------
class IngestRequest(BaseModel):
    text: str
    title: str


class IngestResponse(BaseModel):
    doc_id: str
    n_paragraphs: int


# ---- GET /status/{doc_id} -------------------------------------------------
class StatusResponse(BaseModel):
    progress: float  # 0..1
    paragraphs_done: int
    total_jobs: int


# ---- GET /doc/{doc_id}?level=... ------------------------------------------
class ParagraphOut(BaseModel):
    id: int
    html: str  # rewritten text with <seal .../> placeholders resolved
    level: Level
    audit: AuditVerdict
    audit_note: Optional[str] = None  # one-sentence reason when uncertain


class Invariant(BaseModel):
    id: str
    text: str
    kind: InvariantKind


class DocResponse(BaseModel):
    title: str
    paragraphs: list[ParagraphOut]
    invariants: list[Invariant]


# ---- GET /metrics/{doc_id} ------------------------------------------------
class MetricsResponse(BaseModel):
    model_writer: str
    model_auditor: str
    tokens_per_s_avg: float
    vram_gb: float
    n_rewrites: int
    n_uncertain: int
    n_seal_violations_caught: int
