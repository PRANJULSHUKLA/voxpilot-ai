from datetime import timezone
from sqlalchemy import select
from app.core.errors import AppError
from app.db.models import Message, Session, now


def get_session(db, session_id: str, kind: str | None = None):
    session = db.get(Session, session_id)
    if session is None or (kind and session.kind != kind):
        raise AppError(404, "session_not_found", "Session not found. Start a new conversation.")
    if session.expires_at.replace(tzinfo=timezone.utc) < now():
        raise AppError(
            410, "session_expired", "Session expired. Export or delete it from the session list and start a new one."
        )
    return session


def history(db, session_id: str, count: int, max_chars: int):
    if count == 0:
        return []
    rows = db.scalars(
        select(Message)
        .where(Message.session_id == session_id)
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(count)
    ).all()
    result, size = [], 0
    for row in rows:
        if size + len(row.content) > max_chars:
            break
        result.append(("human" if row.role == "user" else "ai", row.content))
        size += len(row.content)
    return list(reversed(result))
