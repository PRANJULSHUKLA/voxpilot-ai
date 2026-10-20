import hashlib
import json
import logging
from dataclasses import dataclass, field
from datetime import timedelta
from time import perf_counter
from app.db.models import Trace, now
from sqlalchemy import delete

logger = logging.getLogger("voxpilot")


@dataclass
class RequestTrace:
    id: str
    route: str
    session_id: str | None
    started_at: object = field(default_factory=now)
    start: float = field(default_factory=perf_counter)
    nodes: int = 0
    model_latency_ms: float | None = None
    retrieval_latency_ms: float | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None

    def save(self, factory, retention_days, error=None):
        latency = (perf_counter() - self.start) * 1000
        record = Trace(
            id=self.id,
            route=self.route,
            session_ref=hashlib.sha256(self.session_id.encode()).hexdigest()[:12] if self.session_id else None,
            started_at=self.started_at,
            completed_at=now(),
            latency_ms=latency,
            model_latency_ms=self.model_latency_ms,
            retrieval_latency_ms=self.retrieval_latency_ms,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            success=error is None,
            error_category=error,
            nodes=self.nodes,
        )
        with factory() as db:
            db.execute(delete(Trace).where(Trace.started_at < now() - timedelta(days=retention_days)))
            db.add(record)
            db.commit()
        logger.info(
            json.dumps(
                {
                    "event": "workflow_complete",
                    "trace_id": self.id,
                    "route": self.route,
                    "success": error is None,
                    "error_category": error,
                    "latency_ms": round(latency, 2),
                    "nodes": self.nodes,
                }
            )
        )
