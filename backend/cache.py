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
            par_id = p["par_id"]
            if p["is_heading"] or level == "expert":
                out.append(
                    {
                        "id": par_id,
                        "html": p["original"],
                        "level": level,
                        "audit": "faithful",
                        "audit_note": None,
                    }
                )
                continue
            row = conn.execute(
                "SELECT html, audit, audit_note FROM rewrites WHERE doc_id = ? AND par_id = ? AND level = ?",
                (doc_id, par_id, level),
            ).fetchone()
            if row is None:
                # Not generated yet — serve original, mark pending.
                out.append(
                    {
                        "id": par_id,
                        "html": p["original"],
                        "level": level,
                        "audit": "pending",
                        "audit_note": None,
                    }
                )
            else:
                out.append(
                    {
                        "id": par_id,
                        "html": row["html"],
                        "level": level,
                        "audit": row["audit"],
                        "audit_note": row["audit_note"],
                    }
                )
    return title, out


def get_paragraph(doc_id: str, par_id: int, level: str) -> Optional[dict]:
    with _lock:
        conn = _get_conn()
        p = conn.execute(
            "SELECT original, is_heading FROM paragraphs WHERE doc_id = ? AND par_id = ?",
            (doc_id, par_id),
        ).fetchone()
        if p is None:
            return None
        if p["is_heading"] or level == "expert":
            return {
                "id": par_id,
                "html": p["original"],
                "level": level,
                "audit": "faithful",
                "audit_note": None,
            }
        row = conn.execute(
            "SELECT html, audit, audit_note FROM rewrites WHERE doc_id = ? AND par_id = ? AND level = ?",
            (doc_id, par_id, level),
        ).fetchone()
    if row is None:
        return {
            "id": par_id,
            "html": p["original"],
            "level": level,
            "audit": "pending",
            "audit_note": None,
        }
    return {
        "id": par_id,
        "html": row["html"],
        "level": level,
        "audit": row["audit"],
        "audit_note": row["audit_note"],
    }


def count_rewrites(doc_id: str) -> int:
    with _lock:
        conn = _get_conn()
        placeholders = ",".join("?" * len(REWRITE_LEVELS))
        return conn.execute(
            f"SELECT COUNT(*) AS c FROM rewrites WHERE doc_id = ? AND level IN ({placeholders})",
            (doc_id, *REWRITE_LEVELS),
        ).fetchone()["c"]
