import logging
from uuid import UUID
from fastapi import APIRouter, File, Request, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from app.core.errors import AppError
from app.observability.tracing import RequestTrace

router = APIRouter(prefix="/api/v1/audio", tags=["local speech recognition"])
logger = logging.getLogger("voxpilot")


class TranscriptOut(BaseModel):
    transcript: str
    language: str
    duration_seconds: float
    provider: str
    transcription_latency_ms: float
    trace_id: UUID


@router.get("/status")
def audio_status(request: Request):
    return request.app.state.transcriber.status()


@router.post("/prepare")
async def prepare_model(request: Request):
    return await run_in_threadpool(request.app.state.transcriber.prepare)


@router.post("/transcribe", response_model=TranscriptOut)
async def transcribe(request: Request, file: UploadFile = File(...)):
    trace = RequestTrace(request.state.trace_id, "transcription", None)
    error = None
    try:
        try:
            data = await file.read(request.app.state.settings.stt_max_upload_bytes + 1)
        finally:
            await file.close()
        if len(data) > request.app.state.settings.stt_max_upload_bytes:
            raise AppError(413, "audio_upload_limit", "Audio recording exceeds STT_MAX_UPLOAD_BYTES.")
        result = await run_in_threadpool(request.app.state.transcriber.transcribe, data, file.content_type or "")
        return {**result, "trace_id": trace.id}
    except AppError as exc:
        error = exc.code
        raise
    except Exception:
        error = "transcription_failed"
        raise AppError(503, error, "Transcription is unavailable. Check local speech service status.") from None
    finally:
        try:
            trace.save(request.app.state.db_factory, request.app.state.settings.trace_retention_days, error)
        except Exception:
            logger.error('{"event":"trace_write_failed","trace_id":"%s"}', trace.id)
