import asyncio
import logging
import math
import re
from contextlib import asynccontextmanager
from datetime import timedelta
from uuid import UUID
from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from sqlalchemy import Integer, func, select
from sqlalchemy.orm import Session as DBSession
from starlette.concurrency import run_in_threadpool
from app.core.errors import AppError
from app.db.models import Chunk, Document, Message, Session, Trace, now
from app.graph.workflow import build_graph
from app.observability.tracing import RequestTrace
from app.repositories.sessions import get_session
from app.schemas.api import (
    ChatInput,
    ChatOut,
    DocumentOut,
    MeetingNotes,
    MessageOut,
    SessionCreate,
    SessionOut,
    TextInput,
    TraceOut,
)
from app.services.retrieval import chunk_pages, extract_pages

router = APIRouter(prefix="/api/v1")
logger = logging.getLogger("voxpilot")


def database(request: Request):
    with request.app.state.db_factory() as db:
        yield db


@asynccontextmanager
async def session_lock(request, session_id):
    # One worker in the local MVP. Avoid overlapping generation/edits for a session.
    locks = request.app.state.session_locks
    if session_id in locks:
        raise AppError(409, "session_busy", "A request is already running for this session. Wait for it to finish.")
    locks.add(session_id)
    try:
        yield
    finally:
        locks.discard(session_id)


async def run_workflow(request, db, state):
    trace = RequestTrace(request.state.trace_id, state["intent"], state["session_id"])
    request.state.workflow_trace = trace
    error = None
    try:
        async with session_lock(request, state["session_id"]):
            async with asyncio.timeout(request.app.state.settings.request_timeout_seconds + 5):
                return await build_graph(db, request.app.state.provider, request.app.state.settings, trace).ainvoke(
                    state, {"recursion_limit": 12}
                )
    except AppError as exc:
        error = exc.code
        db.rollback()
        raise
    except TimeoutError:
        error = "request_timeout"
        db.rollback()
        raise AppError(504, error, "The request timed out. Please retry.") from None
    except Exception:
        error = "workflow_error"
        db.rollback()
        raise AppError(502, error, "The workflow could not complete. Please retry.") from None
    finally:
        try:
            trace.save(request.app.state.db_factory, request.app.state.settings.trace_retention_days, error)
        except Exception:
            logger.error('{"event":"trace_write_failed","trace_id":"%s"}', trace.id)


@router.get("/health")
def health(request: Request, db: DBSession = Depends(database)):
    db.execute(select(1))
    return {"status": "ok", "database": "ready"}


@router.get("/config/status")
def config_status(request: Request):
    settings = request.app.state.settings
    return {
        "provider": "Gemini",
        "configured": settings.provider_ready,
        "readiness": "configured_unverified" if settings.provider_ready else "missing_key",
        "model": settings.gemini_model,
        "embedding_model": settings.embedding_model,
        "max_input_characters": settings.max_input_characters,
        "max_upload_bytes": settings.max_upload_bytes,
        "request_timeout_seconds": settings.request_timeout_seconds,
        "session_ttl_hours": settings.session_ttl_hours,
        "notice": "Key presence is checked locally; model access and quota are verified on your first request.",
    }


def create_session(db, settings, title, kind):
    session = Session(title=title, kind=kind, expires_at=now() + timedelta(hours=settings.session_ttl_hours))
    db.add(session)
    db.commit()
    return session


@router.post("/sessions", response_model=SessionOut, status_code=201)
def new_session(payload: SessionCreate, request: Request, db: DBSession = Depends(database)):
    return create_session(db, request.app.state.settings, payload.title, "chat")


@router.get("/sessions", response_model=list[SessionOut])
def sessions(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), db: DBSession = Depends(database)):
    return db.scalars(
        select(Session).where(Session.kind == "chat").order_by(Session.created_at.desc()).offset(offset).limit(limit)
    ).all()


@router.get("/sessions/{session_id}", response_model=SessionOut)
def session_detail(session_id: UUID, db: DBSession = Depends(database)):
    return get_session(db, str(session_id), "chat")


@router.delete("/sessions/{session_id}", status_code=204)
async def remove_session(session_id: UUID, request: Request, db: DBSession = Depends(database)):
    async with session_lock(request, str(session_id)):
        # Expired sessions may still be deleted. FK cascades remove messages/chunks/documents.
        row = db.get(Session, str(session_id))
        if not row:
            raise AppError(404, "session_not_found", "Session not found.")
        db.delete(row)
        db.commit()


@router.get("/sessions/{session_id}/messages", response_model=list[MessageOut])
def messages(
    session_id: UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    db: DBSession = Depends(database),
):
    get_session(db, str(session_id))
    return db.scalars(
        select(Message)
        .where(Message.session_id == str(session_id))
        .order_by(Message.created_at, Message.id)
        .offset(offset)
        .limit(limit)
    ).all()


@router.post("/chat", response_model=ChatOut)
async def chat(payload: ChatInput, request: Request, db: DBSession = Depends(database)):
    state = await run_workflow(
        request, db, {"intent": "chat", "session_id": str(payload.session_id), "text": payload.text}
    )
    return {
        "answer": state["answer"],
        "trace_id": request.state.trace_id,
        "model_latency_ms": request.state.workflow_trace.model_latency_ms,
    }


@router.post("/meetings", response_model=SessionOut, status_code=201)
def new_meeting(payload: SessionCreate, request: Request, db: DBSession = Depends(database)):
    return create_session(db, request.app.state.settings, payload.title, "meeting")


@router.get("/meetings", response_model=list[SessionOut])
def meetings(offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=100), db: DBSession = Depends(database)):
    return db.scalars(
        select(Session).where(Session.kind == "meeting").order_by(Session.created_at.desc()).offset(offset).limit(limit)
    ).all()


@router.get("/meetings/{meeting_id}", response_model=SessionOut)
def meeting_detail(meeting_id: UUID, db: DBSession = Depends(database)):
    return get_session(db, str(meeting_id), "meeting")


@router.post("/meetings/{meeting_id}/transcript", response_model=SessionOut)
async def append_transcript(meeting_id: UUID, payload: TextInput, request: Request, db: DBSession = Depends(database)):
    async with session_lock(request, str(meeting_id)):
        session = get_session(db, str(meeting_id), "meeting")
        transcript = (session.transcript + "\n" + payload.text).strip()
        if len(transcript) > request.app.state.settings.max_input_characters:
            raise AppError(422, "transcript_limit", "Transcript exceeds MAX_INPUT_CHARACTERS. Start another meeting.")
        session.transcript = transcript
        db.commit()
        return session


@router.post("/meetings/{meeting_id}/summarize", response_model=MeetingNotes)
async def summarize(meeting_id: UUID, request: Request, db: DBSession = Depends(database)):
    session = get_session(db, str(meeting_id), "meeting")
    state = await run_workflow(request, db, {"intent": "meeting", "session_id": session.id, "text": session.transcript})
    return state["notes"]


@router.patch("/meetings/{meeting_id}/notes", response_model=MeetingNotes)
async def edit_notes(meeting_id: UUID, payload: MeetingNotes, request: Request, db: DBSession = Depends(database)):
    async with session_lock(request, str(meeting_id)):
        session = get_session(db, str(meeting_id), "meeting")
        session.notes = payload.model_dump()
        db.commit()
        return payload


@router.delete("/meetings/{meeting_id}/notes", status_code=204)
async def delete_notes(meeting_id: UUID, request: Request, db: DBSession = Depends(database)):
    async with session_lock(request, str(meeting_id)):
        session = get_session(db, str(meeting_id), "meeting")
        session.notes = None
        db.commit()


@router.delete("/meetings/{meeting_id}", status_code=204)
async def delete_meeting(meeting_id: UUID, request: Request, db: DBSession = Depends(database)):
    return await remove_session(meeting_id, request, db)


@router.post("/documents/upload", response_model=DocumentOut, status_code=201)
async def upload(request: Request, session_id: UUID, file: UploadFile = File(...), db: DBSession = Depends(database)):
    settings = request.app.state.settings
    async with session_lock(request, str(session_id)):
        get_session(db, str(session_id), "chat")
        count = db.scalar(select(func.count()).select_from(Document).where(Document.session_id == str(session_id)))
        if count >= 20:
            raise AppError(422, "document_limit", "Maximum 20 documents per session. Delete a document first.")
        name = re.sub(r"[^a-zA-Z0-9_. -]", "_", (file.filename or "document").replace("\\", "/").split("/")[-1])[:200]
        try:
            data = await file.read(settings.max_upload_bytes + 1)
        finally:
            await file.close()
        if len(data) > settings.max_upload_bytes:
            raise AppError(413, "upload_limit", "File exceeds MAX_UPLOAD_BYTES.")
        pages = await run_in_threadpool(extract_pages, data, name, settings.max_document_characters)
        chunks = chunk_pages(pages, settings.chunk_size, settings.chunk_overlap)
        vectors = await request.app.state.provider.embed([text for _, text in chunks])
        if len(vectors) != len(chunks):
            raise AppError(502, "embedding_error", "Embedding count did not match document chunks.")
        doc = Document(session_id=str(session_id), name=name, embedding_model=settings.embedding_model)
        db.add(doc)
        db.flush()
        db.add_all(
            [
                Chunk(document_id=doc.id, page=page, text=text, vector=vector)
                for (page, text), vector in zip(chunks, vectors)
            ]
        )
        db.commit()
        return doc


@router.get("/documents", response_model=list[DocumentOut])
def documents(
    session_id: UUID,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: DBSession = Depends(database),
):
    get_session(db, str(session_id), "chat")
    return db.scalars(
        select(Document)
        .where(Document.session_id == str(session_id))
        .order_by(Document.created_at.desc())
        .offset(offset)
        .limit(limit)
    ).all()


@router.post("/documents/{document_id}/ask", response_model=ChatOut)
async def ask_document(document_id: UUID, payload: ChatInput, request: Request, db: DBSession = Depends(database)):
    state = await run_workflow(
        request,
        db,
        {
            "intent": "document",
            "session_id": str(payload.session_id),
            "document_id": str(document_id),
            "text": payload.text,
        },
    )
    return {
        "answer": state["answer"],
        "sources": state.get("sources", []),
        "trace_id": request.state.trace_id,
        "model_latency_ms": request.state.workflow_trace.model_latency_ms,
    }


@router.delete("/documents/{document_id}", status_code=204)
async def remove_document(document_id: UUID, request: Request, session_id: UUID, db: DBSession = Depends(database)):
    async with session_lock(request, str(session_id)):
        get_session(db, str(session_id))
        doc = db.scalar(select(Document).where(Document.id == str(document_id), Document.session_id == str(session_id)))
        if not doc:
            raise AppError(404, "document_not_found", "Document not found in this session.")
        db.delete(doc)
        db.commit()


@router.get("/observability/summary")
def metrics(request: Request, db: DBSession = Depends(database)):
    cutoff = now() - timedelta(days=request.app.state.settings.trace_retention_days)
    total, success, latency, input_tokens, output_tokens, measured = db.execute(
        select(
            func.count(Trace.id),
            func.sum(Trace.success.cast(Integer)),
            func.avg(Trace.latency_ms),
            func.sum(Trace.input_tokens),
            func.sum(Trace.output_tokens),
            func.count(Trace.input_tokens),
        ).where(Trace.started_at >= cutoff)
    ).one()
    recent = list(
        db.scalars(
            select(Trace.latency_ms).where(Trace.started_at >= cutoff).order_by(Trace.started_at.desc()).limit(1000)
        )
    )
    return {
        "requests": total,
        "successes": success or 0,
        "error_rate": (total - (success or 0)) / total if total else None,
        "average_latency_ms": latency,
        "p95_latency_ms": sorted(recent)[max(0, math.ceil(len(recent) * 0.95) - 1)] if recent else None,
        "p95_sample_size": len(recent),
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "token_measured_requests": measured,
        "retention_days": request.app.state.settings.trace_retention_days,
    }


@router.get("/observability/traces", response_model=list[TraceOut])
def traces(
    request: Request,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: DBSession = Depends(database),
):
    cutoff = now() - timedelta(days=request.app.state.settings.trace_retention_days)
    return db.scalars(
        select(Trace).where(Trace.started_at >= cutoff).order_by(Trace.started_at.desc()).offset(offset).limit(limit)
    ).all()
