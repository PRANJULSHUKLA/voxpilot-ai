"""Explicit real-PostgreSQL/mock-provider verification. Not part of pytest discovery."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1]))
from conftest import FakeProvider  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import delete  # noqa: E402
from app.core.config import Settings  # noqa: E402
from app.db.models import Trace  # noqa: E402
from app.main import create_app  # noqa: E402


def main():
    settings = Settings()
    assert settings.database_url.startswith("postgresql"), "Use a migrated disposable/local PostgreSQL database."
    app = create_app(settings, FakeProvider())
    sessions, trace_ids = [], []
    with TestClient(app) as client:

        def call(path, method="GET", **kwargs):
            response = client.request(method, "/api/v1" + path, **kwargs)
            trace_ids.append(response.headers.get("X-Trace-ID"))
            assert response.is_success, response.text
            return response.json() if response.status_code != 204 else None

        try:
            session = call("/sessions", "POST", json={"title": "Disposable mocked PostgreSQL flow"})["id"]
            sessions.append(session)
            call("/chat", "POST", json={"session_id": session, "text": "My project is Atlas."})
            call("/chat", "POST", json={"session_id": session, "text": "What is it called?"})
            assert len(call(f"/sessions/{session}/messages")) == 4
            if os.environ.get("RUN_REAL_STT") == "1":
                fixture = (Path(__file__).parent / "fixtures/jfk.webm").read_bytes()
                recognized = call(
                    "/audio/transcribe", "POST", files={"file": ("jfk.webm", fixture, "audio/webm;codecs=opus")}
                )
                assert "country" in recognized["transcript"].lower()
                call("/chat", "POST", json={"session_id": session, "text": recognized["transcript"]})
                print(
                    "PASS: real local speech transcription → actual LangGraph → mocked Gemini → PostgreSQL persistence."
                )
            assert ("human", "My project is Atlas.") in app.state.provider.calls[-1]["history"]
            meeting = call("/meetings", "POST", json={"title": "Disposable mocked meeting"})["id"]
            sessions.append(meeting)
            call(
                f"/meetings/{meeting}/transcript",
                "POST",
                json={
                    "text": "Today the engineering team met to discuss the Atlas release. We reviewed the design, identified open questions and agreed to continue the discussion next week."
                },
            )
            notes = call(f"/meetings/{meeting}/summarize", "POST")
            assert notes["action_items"] == []
            doc = call(
                f"/documents/upload?session_id={session}",
                "POST",
                files={"file": ("atlas.txt", b"The project is called Atlas.", "text/plain")},
            )["id"]
            grounded = call(
                f"/documents/{doc}/ask", "POST", json={"session_id": session, "text": "What is the project called?"}
            )
            assert grounded["sources"][0]["name"] == "atlas.txt"
            print(
                "PASS: actual PostgreSQL transactions with mocked chat, follow-up context, structured notes, document vectors and cited answers."
            )
        finally:
            for session in sessions:
                call(f"/sessions/{session}", "DELETE")
            # Remove our synthetic usage traces so dashboard values remain genuine.
            with app.state.db_factory() as db:
                db.execute(delete(Trace).where(Trace.id.in_([t for t in trace_ids if t])))
                db.commit()


if __name__ == "__main__":
    main()
