"""Exercise the real running stack without making paid Gemini requests."""

import json
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen

BASE = os.environ.get("VOXPILOT_URL", "http://localhost:5173") + "/api/v1"


def call(path, method="GET", payload=None, expected=200):
    request = Request(
        BASE + path,
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urlopen(request, timeout=15) as response:
            assert response.status == expected
            body = response.read()
    except HTTPError as exc:
        assert exc.code == expected, (path, exc.code)
        body = exc.read()
    return json.loads(body) if body else None


def main():
    assert call("/health")["database"] == "ready"
    config = call("/config/status")
    session = call("/sessions", "POST", {"title": "Disposable smoke verification"}, 201)
    meeting = None
    try:
        assert call(f"/sessions/{session['id']}")["id"] == session["id"]
        assert call(f"/sessions/{session['id']}/messages") == []
        call("/chat", "POST", {"session_id": "bad-id", "text": "test"}, 422)
        if not config["configured"]:
            failure = call(
                "/chat",
                "POST",
                {"session_id": session["id"], "text": "Configuration check"},
                503,
            )
            assert failure["error"]["code"] == "provider_unconfigured"
            traces = call("/observability/traces")
            assert any(
                t["id"] == failure["error"]["trace_id"] and not t["success"]
                for t in traces
            )
        meeting = call(
            "/meetings", "POST", {"title": "Disposable meeting verification"}, 201
        )
        transcript = "Today we discussed the design of the new Atlas release. We reviewed the onboarding flow and noted several questions for the next planning meeting."
        call(f"/meetings/{meeting['id']}/transcript", "POST", {"text": transcript})
        assert call(f"/meetings/{meeting['id']}")["transcript"] == transcript
        assert call("/observability/summary")["requests"] >= (
            0 if config["configured"] else 1
        )
        print(
            "PASS: real database, sessions, validation, meeting persistence, configuration, traces and frontend API proxy. No paid calls made."
        )
    finally:
        call(f"/sessions/{session['id']}", "DELETE", expected=204)
        if meeting:
            call(f"/meetings/{meeting['id']}", "DELETE", expected=204)


if __name__ == "__main__":
    main()
