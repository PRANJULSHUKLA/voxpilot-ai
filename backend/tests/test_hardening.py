import pytest
from sqlalchemy import func, select
from app.core.errors import AppError
from app.db.models import Document, Chunk
from app.services.retrieval import cosine, validate_vectors


@pytest.mark.parametrize("origin", ["https://attacker.example", "null", "http://localhost:5173.evil.test"])
def test_cross_origin_simple_post_has_no_side_effect(setup, origin):
    client, _, app = setup
    response = client.post("/api/v1/audio/prepare", headers={"Origin": origin})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "origin_denied"
    assert app.state.transcriber.state == "not_loaded"
    assert client.post("/api/v1/sessions", json={}, headers={"Origin": origin}).status_code == 403
    assert client.get("/api/v1/sessions").json() == []


@pytest.mark.parametrize("origin", [None, "http://localhost:5173", "http://127.0.0.1:5173"])
def test_local_and_cli_writes_remain_usable(setup, origin):
    headers = {"Origin": origin} if origin else {}
    assert setup[0].post("/api/v1/sessions", json={}, headers=headers).status_code == 201


def test_cross_site_without_origin_rejected(setup):
    assert setup[0].post("/api/v1/audio/prepare", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 403


@pytest.mark.parametrize("vector", [[], [0.0, 0.0], [float("nan"), 1.0], [float("inf")], [True, 1], ["1", 0]])
def test_bad_embedding_never_commits_document(setup, session_id, vector):
    client, provider, app = setup
    provider.vector = vector
    result = client.post(
        f"/api/v1/documents/upload?session_id={session_id}", files={"file": ("test.txt", b"Atlas facts")}
    )
    assert result.status_code == 502
    assert result.json()["error"]["code"] == "embedding_error"
    with app.state.db_factory() as db:
        assert db.scalar(select(func.count()).select_from(Document)) == 0
        assert db.scalar(select(func.count()).select_from(Chunk)) == 0


def test_bad_query_embedding_fails_without_generating_or_saving(setup, session_id):
    client, provider, _ = setup
    doc = client.post(
        f"/api/v1/documents/upload?session_id={session_id}", files={"file": ("test.txt", b"Atlas facts")}
    ).json()
    provider.vector = [float("nan"), 1, 0]
    result = client.post(f"/api/v1/documents/{doc['id']}/ask", json={"session_id": session_id, "text": "Atlas?"})
    assert result.status_code == 502
    assert provider.calls == []
    assert client.get(f"/api/v1/sessions/{session_id}/messages").json() == []


@pytest.mark.parametrize("batch,count", [([], 1), ([[1]], 2), ([[1], [1, 2]], 2)])
def test_inconsistent_embedding_batch(batch, count):
    with pytest.raises(AppError):
        validate_vectors(batch, count)


def test_cosine_handles_large_finite_vectors():
    assert cosine([1e200, 0], [1e200, 0]) == pytest.approx(1)


def test_blank_grounded_answer_is_not_persisted(setup, session_id):
    from app.schemas.api import GroundedAnswer

    client, provider, app = setup
    doc = client.post(
        f"/api/v1/documents/upload?session_id={session_id}", files={"file": ("test.txt", b"Atlas facts")}
    ).json()
    with app.state.db_factory() as db:
        chunk = db.scalar(select(Chunk).where(Chunk.document_id == doc["id"]))
        provider.result = GroundedAnswer(answer="   ", citation_ids=[chunk.id])
    result = client.post(f"/api/v1/documents/{doc['id']}/ask", json={"session_id": session_id, "text": "Atlas?"})
    assert result.status_code == 502
    assert result.json()["error"]["code"] == "invalid_output"
    assert client.get(f"/api/v1/sessions/{session_id}/messages").json() == []
