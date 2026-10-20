import json
import logging
from collections import defaultdict, deque
from contextlib import asynccontextmanager
from time import monotonic
from uuid import uuid4
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException
from app.api.routes import router
from app.api.audio import router as audio_router
from app.providers.transcription import LocalTranscription
from app.core.config import get_settings
from app.core.errors import AppError
from app.db.database import make_database
from app.providers.gemini import GeminiProvider


def create_app(settings=None, provider=None):
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level, format="%(message)s")
    # SDK wire logs can include payloads. Only our sanitized application events are logged.
    for name in [
        "httpx",
        "httpx2",
        "httpcore",
        "httpcore2",
        "google",
        "langchain_google_genai",
        "pypdf",
        "huggingface_hub",
        "faster_whisper",
    ]:
        logging.getLogger(name).setLevel(logging.CRITICAL)
    engine, factory = make_database(settings.database_url)

    @asynccontextmanager
    async def lifespan(app):
        yield
        engine.dispose()

    app = FastAPI(title="VoxPilot AI", version="1.0.0", lifespan=lifespan)
    app.state.settings, app.state.db_factory, app.state.engine = settings, factory, engine
    app.state.provider = provider or GeminiProvider(settings)
    app.state.session_locks = set()
    app.state.transcriber = LocalTranscription(settings)
    app.include_router(router)
    app.include_router(audio_router)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[v.strip() for v in settings.cors_origins.split(",")],
        allow_methods=["GET", "POST", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
        expose_headers=["X-Trace-ID"],
    )
    windows = defaultdict(deque)

    def response_error(request, status, code, message):
        return JSONResponse(
            status_code=status,
            content={"error": {"code": code, "message": message, "trace_id": request.state.trace_id}},
            headers={"X-Trace-ID": request.state.trace_id, "Cache-Control": "no-store"},
        )

    @app.middleware("http")
    async def guard(request: Request, call_next):
        request.state.trace_id = str(uuid4())
        if request.method in {"POST", "PATCH", "DELETE"}:
            client = request.client.host if request.client else "local"
            current = monotonic()
            # Prune idle clients to bound memory; this is a single-worker local limiter.
            for key in list(windows):
                if not windows[key] or windows[key][-1] < current - 60:
                    del windows[key]
            hits = windows[client]
            while hits and hits[0] < current - 60:
                hits.popleft()
            if len(hits) >= settings.rate_limit_per_minute:
                return response_error(request, 429, "rate_limit", "Too many requests. Wait a minute.")
            hits.append(current)
            # Bound actual bytes, including chunked requests, before JSON/multipart parsing.
            limit = (
                settings.stt_max_upload_bytes + 65536
                if request.url.path.endswith("/audio/transcribe")
                else settings.max_upload_bytes + 65536
                if request.url.path.endswith("/documents/upload")
                else settings.max_input_characters * 6 + 65536
            )
            body = bytearray()
            async for part in request.stream():
                body.extend(part)
                if len(body) > limit:
                    return response_error(request, 413, "request_limit", "Request body exceeds the configured limit.")
            request._body = bytes(body)
        response = await call_next(request)
        response.headers["X-Trace-ID"] = request.state.trace_id
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request, exc):
        return response_error(
            request,
            exc.status_code,
            "http_error",
            "Resource not found." if exc.status_code == 404 else "Request could not be accepted.",
        )

    @app.exception_handler(AppError)
    async def known_error(request, exc):
        return response_error(request, exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request, exc):
        # Pydantic's default errors may echo user input; keep the envelope payload-free.
        return response_error(
            request, 422, "validation_error", "Invalid request. Check identifiers, field types and input lengths."
        )

    @app.exception_handler(SQLAlchemyError)
    async def database_error(request, exc):
        logging.getLogger("voxpilot").error(json.dumps({"event": "database_error", "trace_id": request.state.trace_id}))
        return response_error(
            request, 503, "database_unavailable", "Database unavailable. Check service health and migrations."
        )

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        logging.getLogger("voxpilot").error(json.dumps({"event": "internal_error", "trace_id": request.state.trace_id}))
        return response_error(
            request, 500, "internal_error", "An unexpected error occurred. Check the trace ID in server logs."
        )

    return app


app = create_app()
