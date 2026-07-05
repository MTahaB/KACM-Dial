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

# Auditor runs at temperature 0 (§5 step 4 / §6). Toggles for Tier 2 features so
# Tier 1 behaviour is recoverable by setting either to "0".
AUDITOR_TEMPERATURE = float(os.environ.get("DIAL_AUDITOR_TEMPERATURE", "0"))
USE_INVARIANTS = os.environ.get("DIAL_USE_INVARIANTS", "1") == "1"
USE_INVARIANT_LLM = os.environ.get("DIAL_USE_INVARIANT_LLM", "1") == "1"
USE_AUDIT = os.environ.get("DIAL_USE_AUDIT", "1") == "1"

# Reported VRAM figure for the metrics endpoint (set at deploy time; 0 = unknown).
VRAM_GB = float(os.environ.get("DIAL_VRAM_GB", "0"))

# ---- DiffusionGemma writer (additive, behind flags — see NOTES.md) ----------
# The Ollama pipeline stays the guaranteed default; "diffusion" switches the
# writer to an OpenAI-compatible endpoint (vLLM serving DiffusionGemma).
WRITER_BACKEND = os.environ.get("DIAL_WRITER_BACKEND", "ollama")  # ollama | diffusion
DIFFUSION_BASE_URL = os.environ.get("DIAL_DIFFUSION_BASE_URL", "http://localhost:8001/v1")
DIFFUSION_MODEL = os.environ.get("DIAL_DIFFUSION_MODEL", "google/diffusiongemma-26B-A4B-it")
# Canvas is 256 tokens — stay at 1-2 blocks per paragraph (brief step 1.c).
DIFFUSION_MAX_TOKENS = int(os.environ.get("DIAL_DIFFUSION_MAX_TOKENS", "512"))
# Best-of-k: number of parallel choices requested per rewrite (n=1 disables).
DIFFUSION_N = int(os.environ.get("DIAL_DIFFUSION_N", "1"))

# ---- Invariant marker format (brief step 1.d: ⟦⟧ survival test) -------------
# A different tokenizer may mangle the ⟦⟧ glyphs; "ascii" switches every marker
# to [[INV:id]] across the whole pipeline. Central here so nothing hardcodes it.
INV_STYLE = os.environ.get("DIAL_INV_STYLE", "unicode")  # unicode | ascii
_INV_FORMATS = {"unicode": ("⟦INV:", "⟧"), "ascii": ("[[INV:", "]]")}
INV_PREFIX, INV_SUFFIX = _INV_FORMATS.get(INV_STYLE, _INV_FORMATS["unicode"])


def inv_token(inv_id: str) -> str:
    """The one true way to spell a sealed-fact marker."""
    return f"{INV_PREFIX}{inv_id}{INV_SUFFIX}"
