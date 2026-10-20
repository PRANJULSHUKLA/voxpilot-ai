"""Real local speech recognition over HTTP, no Gemini calls. Requires prepared/running backend."""

import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

base = os.environ.get("VOXPILOT_URL", "http://localhost:5173") + "/api/v1"
fixture = Path(__file__).parents[1] / "backend/tests/fixtures/jfk.webm"
boundary = "voxpilot-speech-fixture-boundary"
body = (
    (
        f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="jfk.webm"\r\n'
        "Content-Type: audio/webm;codecs=opus\r\n\r\n"
    ).encode()
    + fixture.read_bytes()
    + f"\r\n--{boundary}--\r\n".encode()
)
request = Request(
    base + "/audio/transcribe",
    data=body,
    headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
)
with urlopen(request, timeout=300) as response:
    result = json.load(response)
assert result["provider"] == "faster-whisper"
assert "country" in result["transcript"].lower(), result
assert 10.9 < result["duration_seconds"] < 11.1
print(json.dumps(result, indent=2))
print(
    "PASS: real WebM/Opus → local Whisper → transcript via frontend proxy. No Gemini request made."
)
