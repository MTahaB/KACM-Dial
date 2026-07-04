"""SQLite cache (SPEC §2/§3.3): document → level → paragraph → text.

All levels for all paragraphs are pre-generated once at ingest and read back
with zero inference latency. Writes happen from a background generation thread,
so every connection uses check_same_thread=False guarded by a module lock.
"""
from __future__ import annotations

import sqlite3
import threading
from typing import Optional

from config import DB_PATH
from prompts import REWRITE_LEVELS

_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
    return _conn


def init_db() -> None:
    with _lock:
        conn = _get_conn()
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS documents (
                doc_id     TEXT PRIMARY KEY,
                title      TEXT NOT NULL,
                total_jobs INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS paragraphs (
                doc_id     TEXT NOT NULL,
                par_id     INTEGER NOT NULL,
                original   TEXT NOT NULL,
                is_heading INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (doc_id, par_id)
            );
            CREATE TABLE IF NOT EXISTS rewrites (
                doc_id     TEXT NOT NULL,
                par_id     INTEGER NOT NULL,
                level      TEXT NOT NULL,
                html       TEXT NOT NULL,
                audit      TEXT NOT NULL DEFAULT 'pending',
                audit_note TEXT,
                PRIMARY KEY (doc_id, par_id, level)
            );
            CREATE TABLE IF NOT EXISTS invariants (
                doc_id TEXT NOT NULL,
                inv_id TEXT NOT NULL,
                text   TEXT NOT NULL,
                kind   TEXT NOT NULL,
                PRIMARY KEY (doc_id, inv_id)
            );
            """
        )
        conn.commit()


def create_document(
    doc_id: str, title: str, paragraphs: list[tuple[int, str, bool]]
) -> None:
    """Persist the document skeleton. `paragraphs` = list of (par_id, text, is_heading).

    Every paragraph gets its `expert` row immediately (the original, trivially
    faithful). Non-heading paragraphs contribute rewrite jobs to total_jobs.
    """
    n_rewrite_paras = sum(1 for _, _, is_heading in paragraphs if not is_heading)
    total_jobs = n_rewrite_paras * len(REWRITE_LEVELS)
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO documents (doc_id, title, total_jobs) VALUES (?,?,?)",
            (doc_id, title, total_jobs),
        )
        for par_id, text, is_heading in paragraphs:
            conn.execute(
                "INSERT OR REPLACE INTO paragraphs (doc_id, par_id, original, is_heading) VALUES (?,?,?,?)",
                (doc_id, par_id, text, 1 if is_heading else 0),
            )
            # expert level == original, present from the start.
            conn.execute(
                "INSERT OR REPLACE INTO rewrites (doc_id, par_id, level, html, audit, audit_note) VALUES (?,?,?,?,?,?)",
                (doc_id, par_id, "expert", text, "faithful", None),
            )
        conn.commit()


def save_rewrite(
    doc_id: str,
    par_id: int,
    level: str,
    html: str,
    audit: str = "pending",
    audit_note: Optional[str] = None,
) -> None:
    with _lock:
        conn = _get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO rewrites (doc_id, par_id, level, html, audit, audit_note) VALUES (?,?,?,?,?,?)",
            (doc_id, par_id, level, html, audit, audit_note),
        )
        conn.commit()


def save_invariants(doc_id: str, invariants: list[dict]) -> None:
    """Persist the doc-level sealed facts. `invariants` = [{id, text, kind}]."""
    with _lock:
        conn = _get_conn()
        for inv in invariants:
            conn.execute(
                "INSERT OR REPLACE INTO invariants (doc_id, inv_id, text, kind) VALUES (?,?,?,?)",
                (doc_id, inv["id"], inv["text"], inv["kind"]),
            )
        conn.commit()


def get_invariants(doc_id: str) -> list[dict]:
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT inv_id, text, kind FROM invariants WHERE doc_id = ? ORDER BY inv_id",
            (doc_id,),
        ).fetchall()
    return [{"id": r["inv_id"], "text": r["text"], "kind": r["kind"]} for r in rows]


def document_exists(doc_id: str) -> bool:
    with _lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT 1 FROM documents WHERE doc_id = ?", (doc_id,)
        ).fetchone()
        return row is not None


def get_title(doc_id: str) -> Optional[str]:
    with _lock:
        conn = _get_conn()
        row = conn.execute(
            "SELECT title FROM documents WHERE doc_id = ?", (doc_id,)
        ).fetchone()
        return row["title"] if row else None


def get_status(doc_id: str) -> tuple[float, int, int]:
    """Return (progress 0..1, rewrite_jobs_done, total_jobs)."""
    with _lock:
        conn = _get_conn()
        doc = conn.execute(
            "SELECT total_jobs FROM documents WHERE doc_id = ?", (doc_id,)
        ).fetchone()
        if doc is None:
            return 0.0, 0, 0
        total = doc["total_jobs"]
        placeholders = ",".join("?" * len(REWRITE_LEVELS))
        done = conn.execute(
            f"SELECT COUNT(*) AS c FROM rewrites WHERE doc_id = ? AND level IN ({placeholders})",
            (doc_id, *REWRITE_LEVELS),
        ).fetchone()["c"]
    progress = (done / total) if total else 1.0
    return progress, done, total


def get_doc(doc_id: str, level: str) -> Optional[tuple[str, list[dict]]]:
    """Return (title, [paragraph dict]) at `level`.

    Falls back to the original (expert) text for any paragraph not yet generated
    at the requested level — the dial always shows *something*, marked pending.
    Headings are always served as their original text.
    """
    title = get_title(doc_id)
    if title is None:
        return None
    with _lock:
        conn = _get_conn()
        paras = conn.execute(
            "SELECT par_id, original, is_heading FROM paragraphs WHERE doc_id = ? ORDER BY par_id",
            (doc_id,),
        ).fetchall()
        out: list[dict] = []
        for p in paras:
            out.append(_assemble_paragraph(conn, doc_id, p, level))
    return title, out


def _read_rewrite(conn, doc_id: str, par_id: int, level: str):
    return conn.execute(
        "SELECT html, audit, audit_note FROM rewrites WHERE doc_id = ? AND par_id = ? AND level = ?",
        (doc_id, par_id, level),
    ).fetchone()


def _assemble_paragraph(conn, doc_id: str, p, level: str) -> dict:
    """Resolve one paragraph at `level`, reading seal-bearing rows from `rewrites`.

    Headings always serve their (pass-through) expert row. Non-headings serve the
    requested level; if that level isn't generated yet, they fall back to the
    expert row and are marked `pending` so the dial always shows something.
    """
    par_id = p["par_id"]
    effective = "expert" if p["is_heading"] else level
    row = _read_rewrite(conn, doc_id, par_id, effective)
    if row is not None:
        return {
            "id": par_id,
            "html": row["html"],
            "level": level,
            "audit": row["audit"],
            "audit_note": row["audit_note"],
        }
    # Level not generated yet: fall back to expert row, else raw original.
    expert = _read_rewrite(conn, doc_id, par_id, "expert")
    html = expert["html"] if expert is not None else p["original"]
    return {
        "id": par_id,
        "html": html,
        "level": level,
        "audit": "faithful" if (p["is_heading"] or level == "expert") else "pending",
        "audit_note": None,
    }


def get_paragraph(doc_id: str, par_id: int, level: str) -> Optional[dict]:
    with _lock:
        conn = _get_conn()
        p = conn.execute(
            "SELECT par_id, original, is_heading FROM paragraphs WHERE doc_id = ? AND par_id = ?",
            (doc_id, par_id),
        ).fetchone()
        if p is None:
            return None
        return _assemble_paragraph(conn, doc_id, p, level)


def count_rewrites(doc_id: str) -> int:
    with _lock:
        conn = _get_conn()
        placeholders = ",".join("?" * len(REWRITE_LEVELS))
        return conn.execute(
            f"SELECT COUNT(*) AS c FROM rewrites WHERE doc_id = ? AND level IN ({placeholders})",
            (doc_id, *REWRITE_LEVELS),
        ).fetchone()["c"]


def count_by_audit(doc_id: str, verdict: str) -> int:
    """Count rewrite rows (non-expert) with a given audit verdict — for /metrics."""
    with _lock:
        conn = _get_conn()
        placeholders = ",".join("?" * len(REWRITE_LEVELS))
        return conn.execute(
            f"SELECT COUNT(*) AS c FROM rewrites WHERE doc_id = ? AND audit = ? AND level IN ({placeholders})",
            (doc_id, verdict, *REWRITE_LEVELS),
        ).fetchone()["c"]
