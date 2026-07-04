"""Ollama clients per SPEC §3.2.

Single `generate()` entrypoint: system + prompt in, text out. Optional JSON mode
for structured outputs (Tier 2 invariants/audit). One retry on timeout or
malformed JSON, then raise — the orchestrator degrades gracefully per paragraph.
Every call appends a row to metrics.jsonl (tokens/s) for the README benchmark.
"""
from __future__ import annotations

import json
import time
from typing import Any, Optional

import requests

from config import LLM_TIMEOUT_S, METRICS_PATH, OLLAMA_HOST


class LLMError(RuntimeError):
    pass


def _log_metric(record: dict[str, Any]) -> None:
    try:
        with open(METRICS_PATH, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except OSError:
        pass  # metrics are best-effort; never block generation on a log write


def _call_ollama(
    model: str,
    system: str,
    prompt: str,
    json_mode: bool,
    temperature: float,
    max_tokens: int,
    timeout_s: int,
) -> tuple[str, dict[str, Any]]:
    body: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "system": system,
        "stream": False,
        "options": {"temperature": temperature, "num_predict": max_tokens},
    }
    if json_mode:
        body["format"] = "json"

    resp = requests.post(f"{OLLAMA_HOST}/api/generate", json=body, timeout=timeout_s)
    resp.raise_for_status()
    data = resp.json()
    return data.get("response", ""), data


def generate(
    model: str,
    system: str,
    prompt: str,
    *,
    json_schema: Optional[dict] = None,
    temperature: float = 0.3,
    max_tokens: int = 1024,
    timeout_s: int = LLM_TIMEOUT_S,
) -> str:
    """Generate text from a local Ollama model.

    `json_schema` presence flips Ollama into `format: json` mode (we validate the
    shape downstream; the schema arg documents intent and gates a JSON re-parse).
    Returns the raw response string. Raises LLMError after one failed retry.
    """
    json_mode = json_schema is not None
    last_err: Optional[Exception] = None

    for attempt in range(2):  # initial try + one retry (§3.2)
        t0 = time.perf_counter()
        try:
            text, data = _call_ollama(
                model, system, prompt, json_mode, temperature, max_tokens, timeout_s
            )
            if json_mode:
                json.loads(text)  # will raise on malformed JSON → triggers retry

            elapsed = time.perf_counter() - t0
            eval_count = data.get("eval_count") or 0
            eval_ns = data.get("eval_duration") or 0
            tok_per_s = (eval_count / (eval_ns / 1e9)) if eval_ns else 0.0
            _log_metric(
                {
                    "ts": time.time(),
                    "model": model,
                    "json_mode": json_mode,
                    "eval_count": eval_count,
                    "tokens_per_s": round(tok_per_s, 2),
                    "wall_s": round(elapsed, 3),
                    "attempt": attempt,
                }
            )
            return text
        except (requests.RequestException, json.JSONDecodeError, ValueError) as exc:
            last_err = exc
            continue

    raise LLMError(f"generate() failed for model={model!r}: {last_err}")


def ping() -> bool:
    """True if the local Ollama server is reachable."""
    try:
        requests.get(f"{OLLAMA_HOST}/api/tags", timeout=3).raise_for_status()
        return True
    except requests.RequestException:
        return False


def available_models() -> set[str]:
    """Set of model tags currently pulled in Ollama (empty if unreachable)."""
    try:
        resp = requests.get(f"{OLLAMA_HOST}/api/tags", timeout=5)
        resp.raise_for_status()
        return {m.get("name", "") for m in resp.json().get("models", [])}
    except requests.RequestException:
        return set()

