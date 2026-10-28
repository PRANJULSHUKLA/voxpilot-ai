import io
import math
from time import perf_counter
from pypdf import PdfReader
from sqlalchemy import select
from app.core.errors import AppError
from app.db.models import Chunk, Document


def extract_pages(data: bytes, name: str, max_chars: int):
    if not data:
        raise AppError(422, "empty_file", "The uploaded file is empty.")
    try:
        if name.lower().endswith(".txt"):
            pages = [(None, data.decode("utf-8"))]
            if "\x00" in pages[0][1]:
                raise ValueError("binary text")
        elif name.lower().endswith(".pdf") and data.startswith(b"%PDF-"):
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted or len(reader.pages) > 100:
                raise ValueError("encrypted or too many pages")
            pages, count = [], 0
            for number, page in enumerate(reader.pages, 1):
                text = page.extract_text() or ""
                count += len(text)
                if count > max_chars:
                    raise AppError(413, "document_too_large", "Extracted text exceeds the configured limit.")
                pages.append((number, text))
        else:
            raise ValueError("unsupported file")
    except AppError:
        raise
    except Exception:
        raise AppError(
            422, "invalid_file", "Use a valid UTF-8 TXT or unencrypted text-based PDF (up to 100 pages)."
        ) from None
    if sum(len(t) for _, t in pages) > max_chars:
        raise AppError(413, "document_too_large", "Extracted text exceeds the configured limit.")
    if not any(t.strip() for _, t in pages):
        raise AppError(422, "empty_file", "No readable text found. Scanned PDFs require OCR, which is not enabled.")
    return pages


def chunk_pages(pages, size, overlap):
    return [
        (page, text[start : start + size])
        for page, text in pages
        for start in range(0, len(text), size - overlap)
        if text[start : start + size].strip()
    ]


def validate_vectors(vectors, expected_count):
    """Reject corrupt provider/stored vectors rather than silently abstaining."""
    if not isinstance(vectors, list) or len(vectors) != expected_count or not vectors:
        raise AppError(502, "embedding_error", "Embedding count did not match the requested inputs.")
    dimension = None
    for vector in vectors:
        if (
            not isinstance(vector, list)
            or not vector
            or any(type(value) not in (int, float) or not math.isfinite(value) for value in vector)
        ):
            raise AppError(502, "embedding_error", "Embedding contains invalid numeric values.")
        norm = math.hypot(*vector)
        if not math.isfinite(norm) or norm == 0:
            raise AppError(502, "embedding_error", "Embedding must have a finite nonzero norm.")
        if dimension is not None and len(vector) != dimension:
            raise AppError(502, "embedding_error", "Embedding dimensions are inconsistent within the batch.")
        dimension = len(vector)
    return vectors


def cosine(a, b):
    if len(a) != len(b):
        raise AppError(409, "embedding_mismatch", "Embedding dimensions changed. Delete and re-upload the document.")
    validate_vectors([a, b], 2)
    a_norm, b_norm = math.hypot(*a), math.hypot(*b)
    return sum((x / a_norm) * (y / b_norm) for x, y in zip(a, b))


async def retrieve(db, provider, settings, session_id, document_id, question, trace):
    started = perf_counter()
    doc = db.scalar(select(Document).where(Document.id == document_id, Document.session_id == session_id))
    if not doc:
        raise AppError(404, "document_not_found", "Document not found in this session.")
    if doc.embedding_model != settings.embedding_model:
        raise AppError(409, "embedding_mismatch", "Embedding model changed. Re-upload the document.")
    query = validate_vectors(await provider.embed([question], query=True), 1)[0]
    chunks = db.scalars(select(Chunk).where(Chunk.document_id == doc.id)).all()
    ranked = sorted([(cosine(query, c.vector), c) for c in chunks], key=lambda item: item[0], reverse=True)
    sources = [
        {"id": c.id, "name": doc.name, "page": c.page, "excerpt": c.text}
        for score, c in ranked[: settings.retrieval_top_k]
        if score >= settings.retrieval_min_score
    ]
    trace.retrieval_latency_ms = (perf_counter() - started) * 1000
    return sources
