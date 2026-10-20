import pytest
from fastapi.testclient import TestClient
from app.core.config import Settings
from app.db.models import Base
from app.main import create_app
from app.schemas.api import GroundedAnswer, MeetingNotes


class FakeProvider:
    def __init__(self):
        self.calls = []
        self.failure = None
        self.result = None
        self.vector = [1.0, 0.0, 0.0]

    async def generate(self, system, text, history, schema, trace):
        self.calls.append({"system": system, "text": text, "history": history, "schema": schema})
        if self.failure:
            raise self.failure
        trace.input_tokens, trace.output_tokens, trace.model_latency_ms = 42, 12, 3.0
        if self.result is not None:
            return self.result
        if schema is MeetingNotes:
            return MeetingNotes(
                summary="The team discussed its release plan.",
                key_points=["Release planning"],
                concepts=[],
                decisions=[],
                action_items=[],
                open_questions=[],
                follow_up_topics=[],
            )
        if schema is GroundedAnswer:
            import json

            sources = json.loads(text)["untrusted_evidence"]
            return GroundedAnswer(answer="The project is called Atlas.", citation_ids=[sources[0]["id"]])
        return "Let's explore that idea together."

    async def embed(self, texts, query=False):
        if self.failure:
            raise self.failure
        return [self.vector for _ in texts]


@pytest.fixture
def setup(tmp_path):
    settings = Settings(
        _env_file=None,
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        gemini_api_key="test-secret-never-return",
        rate_limit_per_minute=1000,
    )
    provider = FakeProvider()
    app = create_app(settings, provider)
    Base.metadata.create_all(app.state.engine)
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, provider, app


@pytest.fixture
def session_id(setup):
    return setup[0].post("/api/v1/sessions", json={"title": "Test session"}).json()["id"]
