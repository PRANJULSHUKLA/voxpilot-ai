"""Opt-in local inference benchmark; cached weights only, no Gemini/network calls.

Run from repository root: HF_HUB_OFFLINE=1 .venv/bin/python scripts/evaluate_stt.py
"""

import json
import os
from pathlib import Path
import platform
import sys
from time import perf_counter

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["HF_HUB_OFFLINE"] = "1"
from app.core.config import Settings  # noqa: E402
from app.providers.transcription import LocalTranscription  # noqa: E402
from app.services.evaluation import word_error_rate  # noqa: E402

settings = Settings(_env_file=None, stt_model_cache=str(ROOT / ".cache/whisper"))
provider = LocalTranscription(settings)
start = perf_counter()
provider.prepare()
initialization_ms = (perf_counter() - start) * 1000
fixtures = ROOT / "backend/tests/fixtures"
reference = (fixtures / "jfk.txt").read_text()
results = []
for extension, mime in [("wav", "audio/wav"), ("webm", "audio/webm")]:
    result = provider.transcribe((fixtures / f"jfk.{extension}").read_bytes(), mime)
    results.append(
        {
            "fixture": f"jfk.{extension}",
            "wer": word_error_rate(reference, result["transcript"]),
            **result,
        }
    )
print(
    json.dumps(
        {
            "machine": platform.platform(),
            "python": platform.python_version(),
            "model": settings.stt_model,
            "device": settings.stt_device,
            "compute_type": settings.stt_compute_type,
            "cpu_threads": settings.stt_cpu_threads,
            "initialization_ms": initialization_ms,
            "results": results,
        },
        indent=2,
    )
)
