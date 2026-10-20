import io
import wave
from pathlib import Path
from types import SimpleNamespace
import pytest
from app.core.config import Settings
from app.providers.transcription import LocalTranscription

SPEECH = (Path(__file__).parent / "fixtures/jfk.wav").read_bytes()


class FakeWhisper:
    def transcribe(self, audio, **kwargs):
        assert len(audio) == 176000
        return iter([SimpleNamespace(text=" Ask not what your country can do for you.")]), SimpleNamespace(
            language="en"
        )


@pytest.fixture
def audio_setup(setup):
    client, provider, app = setup
    app.state.settings.gemini_api_key = __import__("pydantic").SecretStr("")
    calls = []

    def factory(*args, **kwargs):
        calls.append(kwargs)
        return FakeWhisper()

    app.state.transcriber = LocalTranscription(app.state.settings, factory)
    return client, app, calls


def send(client, data=SPEECH, mime="audio/wav"):
    return client.post("/api/v1/audio/transcribe", files={"file": ("recording", data, mime)})


def test_valid_audio_without_gemini_and_reused_model(audio_setup):
    client, app, calls = audio_setup
    assert not client.get("/api/v1/config/status").json()["configured"]
    for _ in range(2):
        response = send(client)
        assert response.status_code == 200, response.text
        assert response.json()["provider"] == "faster-whisper"
        assert response.json()["language"] == "en"
        assert response.json()["duration_seconds"] == 11
        assert "country" in response.json()["transcript"]
        assert response.json()["trace_id"] == response.headers["X-Trace-ID"]
    assert len(calls) == 1 and calls[0]["compute_type"] == "int8" and calls[0]["device"] == "cpu"
    status = client.get("/api/v1/audio/status").json()
    assert status["ready"] and status["successes"] == 2 and status["failures"] == 0
    traces = client.get("/api/v1/observability/traces").json()
    assert traces[0]["route"] == "transcription" and traces[0]["input_tokens"] is None


@pytest.mark.parametrize(
    "data,mime,code",
    [
        (b"", "audio/wav", "empty_audio"),
        (b"not audio", "audio/webm", "invalid_audio"),
        (SPEECH, "text/plain", "unsupported_audio"),
        (SPEECH, "audio/webm", "audio_type_mismatch"),
    ],
)
def test_invalid_audio_uploads(audio_setup, data, mime, code):
    response = send(audio_setup[0], data, mime)
    assert response.status_code in [415, 422]
    assert response.json()["error"]["code"] == code


def test_upload_and_actual_decoded_duration_limits(audio_setup):
    client, app, _ = audio_setup
    app.state.settings.stt_max_upload_bytes = 1024
    assert send(client).status_code == 413
    app.state.settings.stt_max_upload_bytes = 10485760
    app.state.settings.stt_max_duration_seconds = 1
    response = send(client)
    assert response.status_code == 413 and response.json()["error"]["code"] == "audio_duration_limit"
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(bytes(1600))
    assert send(client, out.getvalue()).json()["error"]["code"] == "short_audio"


def test_model_download_or_initialization_failure(audio_setup):
    client, app, _ = audio_setup

    def broken(*args, **kwargs):
        raise RuntimeError("private path and sensitive details")

    app.state.transcriber = LocalTranscription(app.state.settings, broken)
    response = send(client)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "stt_model_unavailable"
    assert "private path" not in response.text
    status = client.get("/api/v1/audio/status").json()
    assert status["state"] == "error" and not status["ready"]


def test_empty_transcript_and_recovery(audio_setup):
    client, app, _ = audio_setup
    app.state.transcriber.prepare()
    app.state.transcriber._model.transcribe = lambda *a, **k: (iter([]), SimpleNamespace(language="en"))
    response = send(client)
    assert response.status_code == 422 and response.json()["error"]["code"] == "no_speech"
    app.state.transcriber._model = FakeWhisper()
    assert send(client).status_code == 200
    assert client.get("/api/v1/audio/status").json()["last_error"] is None


def test_successful_transcript_survives_gemini_failure(audio_setup):
    from app.providers.gemini import GeminiProvider

    client, app, _ = audio_setup
    transcript = send(client).json()["transcript"]
    session = client.post("/api/v1/sessions", json={}).json()["id"]
    app.state.provider = GeminiProvider(app.state.settings)
    response = client.post("/api/v1/chat", json={"session_id": session, "text": transcript})
    assert response.status_code == 503 and response.json()["error"]["code"] == "provider_unconfigured"
    assert client.get("/api/v1/audio/status").json()["successes"] == 1


def test_prepare_is_reusable_and_inference_busy(audio_setup):
    client, app, calls = audio_setup
    assert client.post("/api/v1/audio/prepare").status_code == 200
    assert client.post("/api/v1/audio/prepare").status_code == 200
    assert len(calls) == 1
    app.state.transcriber._inference_lock.acquire()
    try:
        assert send(client).status_code == 429
    finally:
        app.state.transcriber._inference_lock.release()


def test_browser_webm_opus_decoding():
    from app.providers.transcription import decode_recording

    audio, duration = decode_recording(
        (Path(__file__).parent / "fixtures/jfk.webm").read_bytes(), "audio/webm;codecs=opus", Settings(_env_file=None)
    )
    assert 10.9 < duration < 11.1
    assert audio.dtype.name == "float32"
