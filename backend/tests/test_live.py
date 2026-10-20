"""Paid smoke/semantic probes. Never run unless both explicit opt-in and key are present."""

import json
import os
from pathlib import Path
from uuid import uuid4
import pytest
from app.core.config import Settings
from app.observability.tracing import RequestTrace
from app.providers.gemini import GeminiProvider, SYSTEM, RAG_SYSTEM, MEETING_SYSTEM
from app.schemas.api import GroundedAnswer, MeetingNotes

pytestmark = [
    pytest.mark.live,
    pytest.mark.skipif(os.getenv("RUN_LIVE_GEMINI") != "1", reason="Live API calls require explicit opt-in"),
]


@pytest.mark.asyncio
async def test_live_semantic_cases():
    settings = Settings()
    if not settings.provider_ready:
        pytest.skip("GEMINI_API_KEY is missing")
    provider = GeminiProvider(settings)
    cases = json.loads((Path(__file__).parents[1] / "evals/cases.json").read_text())
    for case in cases:
        trace = RequestTrace(str(uuid4()), "evaluation", None)
        if "history" in case:
            result = await provider.generate(SYSTEM, case["question"], [tuple(h) for h in case["history"]], None, trace)
            assert case["required"].lower() in result.lower(), case["name"]
        elif "evidence" in case:
            result = await provider.generate(
                RAG_SYSTEM,
                json.dumps(
                    {
                        "question": case["question"],
                        "untrusted_evidence": [{"id": "chunk-1", "excerpt": case["evidence"]}],
                    }
                ),
                [],
                GroundedAnswer,
                trace,
            )
            if case.get("expect_insufficient"):
                assert result.insufficient_evidence, case["name"]
            else:
                assert case["required"].lower() in result.answer.lower(), case["name"]
                assert case["forbidden"] not in result.answer, case["name"]
                assert result.citation_ids == ["chunk-1"]
        else:
            result = await provider.generate(MEETING_SYSTEM, case["transcript"], [], MeetingNotes, trace)
            assert all(a.owner is None and a.deadline is None for a in result.action_items)
