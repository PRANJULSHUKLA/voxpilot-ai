"""Local, reusable CPU Whisper model. Raw recordings exist only in bounded memory."""

import io
import threading
from time import perf_counter
import av
import numpy as np
from app.core.errors import AppError

MIME_CONTAINERS = {
    "audio/webm": {"matroska", "webm"},
    "audio/ogg": {"ogg"},
    "audio/mp4": {"mov", "mp4", "m4a", "3gp", "3g2", "mj2"},
    "audio/x-m4a": {"mov", "mp4", "m4a"},
    "audio/wav": {"wav"},
    "audio/x-wav": {"wav"},
    "audio/mpeg": {"mp3"},
}


def decode_recording(data: bytes, mime: str, settings):
    if not data:
        raise AppError(422, "empty_audio", "The recording is empty. Check your microphone and record again.")
    mime = mime.split(";")[0].strip().lower()
    if mime not in MIME_CONTAINERS:
        raise AppError(415, "unsupported_audio", "Use WebM/Opus, Ogg, MP4/M4A, WAV or MP3 audio.")
    try:
        with av.open(io.BytesIO(data)) as container:
            if not set(container.format.name.split(",")) & MIME_CONTAINERS[mime]:
                raise AppError(415, "audio_type_mismatch", "Audio contents do not match the declared recording format.")
            if not container.streams.audio:
                raise ValueError("no audio")
            resampler = av.AudioResampler(format="s16", layout="mono", rate=16000)
            arrays, count = [], 0
            for frame in container.decode(audio=0):
                for converted in resampler.resample(frame):
                    count += converted.samples
                    if count > settings.stt_max_duration_seconds * 16000:
                        raise AppError(
                            413,
                            "audio_duration_limit",
                            f"Record up to {settings.stt_max_duration_seconds} seconds per turn.",
                        )
                    arrays.append(converted.to_ndarray().reshape(-1))
            for converted in resampler.resample(None):
                count += converted.samples
                arrays.append(converted.to_ndarray().reshape(-1))
            duration = count / 16000
            if duration > settings.stt_max_duration_seconds:
                raise AppError(413, "audio_duration_limit", "Recording exceeds the duration limit.")
            if duration < settings.stt_min_duration_seconds or not arrays:
                raise AppError(
                    422, "short_audio", "Recording is too short. Speak for at least half a second and stop again."
                )
            return np.concatenate(arrays).astype(np.float32) / 32768.0, duration
    except AppError:
        raise
    except Exception:
        raise AppError(
            422, "invalid_audio", "The recording could not be decoded. Record again using a supported browser."
        ) from None


class LocalTranscription:
    def __init__(self, settings, model_factory=None):
        self.settings = settings
        self._factory = model_factory
        self._model = None
        self._load_lock = threading.Lock()
        self._inference_lock = threading.Lock()
        self.state = "not_loaded"
        self.last_error = None
        self.successes = 0
        self.failures = 0
        self.last_latency_ms = None

    def status(self):
        return {
            "provider": "faster-whisper",
            "model": self.settings.stt_model,
            "device": self.settings.stt_device,
            "compute_type": self.settings.stt_compute_type,
            "state": self.state,
            "ready": self._model is not None,
            "last_error": self.last_error,
            "successes": self.successes,
            "failures": self.failures,
            "last_latency_ms": self.last_latency_ms,
            "busy": self._inference_lock.locked(),
            "max_upload_bytes": self.settings.stt_max_upload_bytes,
            "max_duration_seconds": self.settings.stt_max_duration_seconds,
            "notice": "Counters reset on backend restart. First use downloads model weights; recordings stay local to this backend.",
        }

    def prepare(self):
        with self._load_lock:
            if self._model is not None:
                return self.status()
            self.state = "loading"
            self.last_error = None
            try:
                if self._factory is None:
                    import onnxruntime

                    onnxruntime.disable_telemetry_events()
                    from faster_whisper import WhisperModel

                    factory = WhisperModel
                else:
                    factory = self._factory
                self._model = factory(
                    self.settings.stt_model,
                    device=self.settings.stt_device,
                    compute_type=self.settings.stt_compute_type,
                    download_root=self.settings.stt_model_cache,
                    cpu_threads=self.settings.stt_cpu_threads,
                    num_workers=1,
                )
                self.state = "ready"
            except Exception:
                self.state = "error"
                self.last_error = "model_initialization_failed"
                raise AppError(
                    503,
                    "stt_model_unavailable",
                    "Local speech model could not load. Check model download access, cache permissions and STT settings; then retry Prepare model.",
                ) from None
        return self.status()

    def transcribe(self, data: bytes, mime: str):
        if not self._inference_lock.acquire(blocking=False):
            raise AppError(429, "stt_busy", "The local speech model is processing another recording. Please wait.")
        started = perf_counter()
        try:
            audio, duration = decode_recording(data, mime, self.settings)
            self.prepare()
            segments, info = self._model.transcribe(
                audio, beam_size=3, vad_filter=True, condition_on_previous_text=False
            )
            text = " ".join(segment.text.strip() for segment in segments).strip()
            if not text:
                raise AppError(
                    422,
                    "no_speech",
                    "No speech was recognized. Check microphone input and speak clearly before stopping.",
                )
            if len(text) > self.settings.max_input_characters:
                raise AppError(422, "transcript_limit", "Transcript exceeds the input limit. Record a shorter turn.")
            self.successes += 1
            self.last_error = None
            return {
                "transcript": text,
                "language": info.language,
                "duration_seconds": round(duration, 3),
                "provider": "faster-whisper",
                "transcription_latency_ms": round((perf_counter() - started) * 1000, 2),
            }
        except AppError as exc:
            self.failures += 1
            self.last_error = exc.code
            raise
        except Exception:
            self.failures += 1
            self.last_error = "transcription_failed"
            raise AppError(
                503,
                "transcription_failed",
                "Local transcription failed. Retry the recording or check speech model status.",
            ) from None
        finally:
            self.last_latency_ms = round((perf_counter() - started) * 1000, 2)
            self._inference_lock.release()
