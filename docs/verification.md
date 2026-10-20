> Historical verification from 19 October. The 20 October voice repair adds real local transcription; see [voice repair](voice-repair.md) and the latest results below.

# Verification record

Executed locally on 19 October 2026. No Gemini API key was supplied and no paid model calls were made.

| Check | Observed result |
| --- | --- |
| Python backend suite | 31 passed, 1 live test skipped (macOS / Python 3.11). |
| Linux container backend suite | 31 passed, 1 live test skipped in the built Linux/Python 3.11 container. |
| Frontend suite | 11 passed in 4 files, covering reviewed/interim speech, fallback, duplicate submission, oversize drafts, speech interruption, pending permission cancellation, fetch abort and note export. |
| TypeScript + Vite production build | Passed with Vite 7.3.7. |
| Ruff | Backend and smoke scripts passed. |
| npm audit | Zero known vulnerabilities after patched packages were installed. |
| Compose build/start | Frontend and backend images built successfully; PostgreSQL, backend and frontend became healthy. |
| Real-stack no-key smoke | Passed: nginx API proxy, health, PostgreSQL sessions, input validation, transcript persistence, safe missing-key error and corresponding trace. |
| Real PostgreSQL + mocked provider | Passed chat, follow-up history, structured notes, persisted document vectors and cited Q&A. Test sessions and synthetic usage traces were removed afterward. |
| Alembic | Initial migration applied successfully to PostgreSQL at container startup; upgrade/downgrade tested independently on SQLite. |
| Browser | Opened real Compose frontend, switched modes, created meeting, submitted reviewed transcript, inspected missing-key disablement and empty observability metrics. |
| Responsive layout | Checked 1440px desktop and 390px mobile; document width matched viewport width at both sizes. |
| Configuration security | Public endpoints/OpenAPI tested for secret non-disclosure; invalid config validation tested not to echo the secret. Git ignores .env, venv, node_modules and build artifacts. |

Screenshots of the actual running empty-key application: [desktop](screenshots/desktop.png), [mobile](screenshots/mobile.png). The app was left running on localhost:5173 with an empty server key. Initial infrastructure smoke tests intentionally generated missing-key failure traces; these are actual failed requests, not example metrics.

The explicit PostgreSQL mocked smoke test is available in `backend/tests/postgres_smoke.py`. It is excluded from normal pytest discovery because it targets a running migrated database and cleans up its own records. To run it after building the image:

```sh
docker compose exec backend python tests/postgres_smoke.py
```

The normal suite uses mocks and temporary SQLite databases and requires neither credentials nor a running Compose stack. One opt-in `live` test runs four semantic/model smoke probes; it was **not executed**. Deterministic tests of prompt boundaries/citation membership do not prove live model accuracy or injection resistance.

## Not verified automatically

- Real Gemini chat/structured generation, account quota/model availability and remote embedding quality: no key supplied.
- Actual microphone recognition against browser vendor speech services, OS audio output and voice quality: no live microphone/audio session was performed. Provider lifecycle and controls were tested with browser API mocks.
- Public deployment, authenticated tenancy, load behavior, hostile PDF parser isolation, distributed concurrency or backup recovery: outside the local MVP scope.
- Streaming audio/text, full duplex, OCR and guaranteed provider cancellation are not implemented.

## Manual acceptance after adding a key

1. Set GEMINI_API_KEY in the root .env and recreate backend. Confirm Settings says configured, then send a text request to verify actual access/quota.
2. Send "My project is Atlas", then ask "What is my project called?". Refresh and check both turns persist.
3. In a supported browser, Start listening, allow microphone, speak, verify interim/final text, edit it, then submit. Confirm no speech was sent before submission.
4. Enable spoken responses, select an OS voice and rate, replay a reply, then interrupt it. Deny microphone permission and verify the text fallback.
5. Start a meeting, add at least 20 words including an explicit action. Generate notes and confirm absent owners/deadlines stay empty. Edit, save, export Markdown and reopen the meeting.
6. Upload a searchable PDF, ask an answerable question and inspect actual supporting page excerpts. Ask an unsupported question. Delete the document and confirm it disappears.
7. Inspect metrics after successes and failures; confirm usage is available only when the SDK supplied it. Cancel a browser request, wait, refresh messages and check whether the server saved a result before retrying.
8. Delete your disposable conversations/meetings once finished. Their payload-free traces remain until the configured retention period.

## Latest verification — 20 October 2026

The previous record describes the original browser-recognition version. The current implementation uses MediaRecorder and local faster-whisper.

| Executed check | Observed result |
| --- | --- |
| Backend tests, host | 42 passed, 1 paid/live test skipped. Includes real WAV/WebM decoding with mocked inference. |
| Backend tests, Linux ARM64 Docker | 42 passed, 1 paid/live test skipped. |
| Frontend tests | 23 passed in 6 files. Includes capture, permission denial, unsupported MIME, empty/short/oversize recording, automatic submission, editable review, interruption and stale responses. |
| TypeScript / production bundle | Passed. |
| Ruff / Prettier | Passed for project sources. |
| npm audit | Zero known vulnerabilities. |
| Actual local inference on Apple Silicon | Multilingual base / CPU int8 correctly recognized the public 11-second JFK WAV fixture. |
| Offline local inference | WebM/Opus fixture recognized with HF_HUB_OFFLINE=1 after caching. |
| Actual Linux/Docker HTTP transcription | WebM/Opus → nginx proxy → FastAPI → local base model returned the expected JFK passage, without a Gemini key. A warmed run measured 2.88 seconds; this is one observation, not a performance guarantee. |
| Complete backend voice pipeline | Real local recognition → actual LangGraph → mocked Gemini → PostgreSQL persistence passed in the container. Synthetic sessions and usage traces were cleaned up. |
| Persistent model volume | Backend recreation followed by offline recognition succeeded using the retained /models cache. |
| Real browser capture | The in-app browser granted microphone access, recorded 5.7 seconds, released the microphone on Stop and uploaded valid audio. Available input was silent (meter 0%); the model returned no_speech and the UI showed an actionable error with text fallback. No live spoken utterance was verified. |
| Browser UI | Dark cosmic voice workspace, settings, observability, meeting and knowledge navigation inspected. Desktop/mobile sizes checked; screenshots saved. |
| Service health | PostgreSQL, backend and frontend built and reported healthy. Main local speech model prepared successfully. |

No live Gemini generation was performed because no Gemini key is configured. Answer-only browser synthesis and interruption were verified by automated API mocks. Native browser voice Preview and Stop were also exercised without UI/console errors; actual speaker audibility was not verified. Browser recordings were not saved permanently. Recorded metadata-only traces include the genuine silent-input failure and real fixture successes; model-based mocked test traces were removed.

Reproduce real local recognition over HTTP with `python3 scripts/transcription_smoke.py`. Reproduce the full real-STT/mocked-Gemini database flow with:

```sh
docker compose exec -e RUN_REAL_STT=1 -e HF_HUB_OFFLINE=1 backend python tests/postgres_smoke.py
```

Prepare model weights first. This command makes no paid API calls. The normal pytest suite does not load/download weights.
