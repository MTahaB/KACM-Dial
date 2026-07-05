"""Harnais A/B writer (brief DiffusionGemma, étapes 1.d/1.e).

Mesure, pour le backend actif (DIAL_WRITER_BACKEND), sur un document sample :
  - survie des marqueurs scellés : 1er essai / après retry correctif (1.d test 1)
  - verrouillage de langue : sortie détectée vs entrée (1.d test 2)
  - optionnel --audit : verdicts Nemotron par réécriture (1.e)
  - vitesse : wall-clock par job (métriques détaillées dans metrics.jsonl)

Usage (machine GPU, une commande par backend) :
    python abtest.py ../samples/1_caf_letter.md                      # baseline Ollama
    DIAL_WRITER_BACKEND=diffusion python abtest.py ../samples/1_caf_letter.md
    DIAL_INV_STYLE=ascii DIAL_WRITER_BACKEND=diffusion python abtest.py ...  # si ⟦⟧ massacrés

Options : --levels plain,simple  --limit N  --audit  --json out.json
Ne touche ni à la base SQLite ni au serveur — pipeline appelé directement.
"""
from __future__ import annotations

import argparse
import json
import sys
import time

import invariants
import orchestrator as o
import prompts
from config import (
    AUDITOR_MODEL,
    INV_STYLE,
    USE_INVARIANT_LLM,
    WRITER_BACKEND,
    WRITER_MODEL,
    DIFFUSION_MODEL,
    inv_token,
)


def run(path: str, levels: list[str], limit: int | None, do_audit: bool) -> dict:
    text = open(path, encoding="utf-8").read()
    chunks = [(t, h) for t, h in o.chunk_document(text) if not h]
    if limit:
        chunks = chunks[:limit]

    writer = DIFFUSION_MODEL if WRITER_BACKEND == "diffusion" else WRITER_MODEL
    ext_model = WRITER_MODEL if USE_INVARIANT_LLM else None
    auditor, second_family = o._resolve_auditor()

    rows: list[dict] = []
    for pi, (par, _) in enumerate(chunks):
        facts = invariants.extract(par, model=ext_model)
        for i, f in enumerate(facts):
            f["id"] = f"p{pi}i{i}"
        tokenized, expected = invariants.tokenize(par, facts) if facts else (par, {})
        id2t = {f["id"]: f["text"] for f in facts}
        lang_in = o._detect_language(par)

        for level in levels:
            t0 = time.perf_counter()
            row = {
                "par": pi, "level": level, "n_seals": len(expected),
                "survived_first": None, "survived_final": None,
                "lang_in": lang_in, "lang_out": None, "audit": None,
                "audit_note": None, "rewrite": None, "error": None,
            }
            try:
                # Reproduit _rewrite_preserving mais en exposant le 1er essai.
                candidates = [
                    invariants.strip_unknown(c, expected)
                    for c in o._write(tokenized, level, lang_in)
                ]
                first_ok = any(not invariants.verify(c, expected) for c in candidates)
                row["survived_first"] = first_ok
                if first_ok:
                    out = next(c for c in candidates if not invariants.verify(c, expected))
                    row["survived_final"] = True
                else:
                    bad = invariants.verify(candidates[0], expected)
                    corr = prompts.writer_correction([inv_token(b) for b in bad])
                    retries = [
                        invariants.strip_unknown(c, expected)
                        for c in o._write(tokenized, level, lang_in, corr)
                    ]
                    ok_r = [c for c in retries if not invariants.verify(c, expected)]
                    row["survived_final"] = bool(ok_r)
                    out = ok_r[0] if ok_r else retries[0]
                row["lang_out"] = o._detect_language(out)
                row["rewrite"] = invariants.resolve(out, id2t, seal=False)
                if do_audit:
                    verdict, note = o._audit(par, row["rewrite"], auditor)
                    row["audit"], row["audit_note"] = verdict, note
            except Exception as exc:  # un job raté ne bloque pas la mesure
                row["error"] = str(exc)[:120]
            row["wall_s"] = round(time.perf_counter() - t0, 1)
            rows.append(row)
            print(
                f"[p{pi} {level:8s}] seals={row['n_seals']} "
                f"first={row['survived_first']} final={row['survived_final']} "
                f"lang={row['lang_in']}->{row['lang_out']} "
                f"audit={row['audit']} {row['wall_s']}s"
                + (f" ERR={row['error']}" if row["error"] else ""),
                flush=True,
            )

    ok_rows = [r for r in rows if not r["error"]]
    sealed = [r for r in ok_rows if r["n_seals"]]
    summary = {
        "backend": WRITER_BACKEND, "writer": writer, "inv_style": INV_STYLE,
        "auditor": auditor if do_audit else None, "second_family": second_family,
        "jobs": len(rows), "errors": len(rows) - len(ok_rows),
        "seal_survival_first_try": (
            round(sum(r["survived_first"] for r in sealed) / len(sealed), 3) if sealed else None
        ),
        "seal_survival_after_retry": (
            round(sum(r["survived_final"] for r in sealed) / len(sealed), 3) if sealed else None
        ),
        "language_lock": (
            round(sum(r["lang_in"] == r["lang_out"] for r in ok_rows) / len(ok_rows), 3)
            if ok_rows else None
        ),
        "avg_wall_s": round(sum(r["wall_s"] for r in ok_rows) / len(ok_rows), 1) if ok_rows else None,
        "audits": {v: sum(1 for r in ok_rows if r["audit"] == v)
                   for v in ("faithful", "uncertain")} if do_audit else None,
    }
    return {"summary": summary, "rows": rows}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("sample")
    ap.add_argument("--levels", default="standard,plain,simple")
    ap.add_argument("--limit", type=int, default=None, help="N premiers paragraphes")
    ap.add_argument("--audit", action="store_true")
    ap.add_argument("--json", dest="json_out", default=None)
    args = ap.parse_args()

    result = run(args.sample, args.levels.split(","), args.limit, args.audit)
    print("\n=== SUMMARY ===")
    print(json.dumps(result["summary"], indent=2, ensure_ascii=False))
    if args.json_out:
        with open(args.json_out, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=2, ensure_ascii=False)
        print(f"→ {args.json_out}", file=sys.stderr)
