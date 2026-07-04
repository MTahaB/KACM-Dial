"""Runtime configuration. Everything overridable via environment so the exact
Ollama tag names (which change in the registry — see SPEC §3.1) are never
baked into code.
"""
import os

OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434")

# Writer = Gemma QAT (load-bearing, Track 5 requirement). Default is a QAT tag;
# override with DIAL_WRITER_MODEL if the registry tag differs at setup time.
WRITER_MODEL = os.environ.get("DIAL_WRITER_MODEL", "gemma3:4b-it-qat")

# Auditor = Nemotron Nano-class (Tier 2). Unused in Tier 1 but surfaced in
# /metrics so the contract shape is stable.
AUDITOR_MODEL = os.environ.get("DIAL_AUDITOR_MODEL", "nemotron-mini:latest")

# SQLite cache location.
DB_PATH = os.environ.get("DIAL_DB_PATH", os.path.join(os.path.dirname(__file__), "dial.db"))

# Metrics log (one JSON object per LLM call — README benchmark table source).
METRICS_PATH = os.environ.get("DIAL_METRICS_PATH", os.path.join(os.path.dirname(__file__), "metrics.jsonl"))

# Per-call generation limits.
WRITER_TEMPERATURE = float(os.environ.get("DIAL_WRITER_TEMPERATURE", "0.3"))
WRITER_MAX_TOKENS = int(os.environ.get("DIAL_WRITER_MAX_TOKENS", "1024"))
LLM_TIMEOUT_S = int(os.environ.get("DIAL_LLM_TIMEOUT_S", "120"))

# Reported VRAM figure for the metrics endpoint (set at deploy time; 0 = unknown).
VRAM_GB = float(os.environ.get("DIAL_VRAM_GB", "0"))
