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


def cosine(a, b):
    if len(a) != len(b):
        raise AppError(409, "embedding_mismatch", "Embedding dimensions changed. Delete and re-upload the document.")
    denominator = math.sqrt(sum(x * x for x in a) * sum(x * x for x in b))
    return sum(x * y for x, y in zip(a, b)) / denominator if denominator else 0.0


async def retrieve(db, provider, settings, session_id, document_id, question, trace):
    started = perf_counter()
    doc = db.scalar(select(Document).where(Document.id == document_id, Document.session_id == session_id))
    if not doc:
        raise AppError(404, "document_not_found", "Document not found in this session.")
    if doc.embedding_model != settings.embedding_model:
        raise AppError(409, "embedding_mismatch", "Embedding model changed. Re-upload the document.")
    query = (await provider.embed([question], query=True))[0]
    chunks = db.scalars(select(Chunk).where(Chunk.document_id == doc.id)).all()
    ranked = sorted([(cosine(query, c.vector), c) for c in chunks], key=lambda item: item[0], reverse=True)
    sources = [
        {"id": c.id, "name": doc.name, "page": c.page, "excerpt": c.text}
        for score, c in ranked[: settings.retrieval_top_k]
        if score >= settings.retrieval_min_score
    ]
    trace.retrieval_latency_ms = (perf_counter() - started) * 1000
    return sources
