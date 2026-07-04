"""Generate the README benchmark table from metrics.jsonl (SPEC §3.2 / §11).

Every LLM call appends a row to metrics.jsonl with its model and tokens/s. This
script aggregates per model and prints a Markdown table. Run after generating a
document so the table reflects real hardware:

    python bench.py            # reads backend/metrics.jsonl
    python bench.py --md >> ../README.md
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict

from config import METRICS_PATH, VRAM_GB


def aggregate(path: str) -> dict[str, dict]:
    stats: dict[str, dict] = defaultdict(lambda: {"tps": [], "calls": 0, "tokens": 0})
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                rec = json.loads(line)
                model = rec.get("model", "?")
                s = stats[model]
                s["calls"] += 1
                s["tokens"] += rec.get("eval_count", 0) or 0
                if rec.get("tokens_per_s"):
                    s["tps"].append(rec["tokens_per_s"])
    except FileNotFoundError:
        pass
    return stats


def render(stats: dict[str, dict]) -> str:
    lines = [
        "| Model | Role | Calls | Tokens | Avg tokens/s | VRAM (GB) |",
        "|---|---|---:|---:|---:|---:|",
    ]
    for model, s in sorted(stats.items()):
        role = "auditor" if "nemotron" in model.lower() else "writer"
        avg = round(sum(s["tps"]) / len(s["tps"]), 1) if s["tps"] else 0.0
        vram = VRAM_GB if VRAM_GB else "—"
        lines.append(
            f"| `{model}` | {role} | {s['calls']} | {s['tokens']} | {avg} | {vram} |"
        )
    return "\n".join(lines)


if __name__ == "__main__":
    stats = aggregate(METRICS_PATH)
    if not stats:
        print("No metrics yet — generate a document first.", file=sys.stderr)
        sys.exit(1)
    print(render(stats))
