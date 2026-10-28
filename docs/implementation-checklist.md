# Verified improvement checklist — 25 October 2026

Scope: preserve the existing local single-user product; prioritize complete fixes over new infrastructure.

- [x] Audit voice, graph, provider, retrieval, persistence, middleware, deployment and existing tests. Clean starting tree on `main`; baseline: 47 backend passed / 1 opt-in live skipped, 23 frontend passed, production build passed.
- [x] Remove nonessential status/history requests from the voice response critical path; regression-test stalls.
- [x] Validate embedding batches and reject invalid vectors before storage/retrieval; retain model-space mismatch checks.
- [x] Reject foreign browser origins on mutations; preserve explicitly allowed local origins and CLI use.
- [x] Classify safe provider failures; align configured default with verified Gemini 3.6 identifier.
- [x] Run deterministic checks, migrations and available isolated real speech/database checks.
- [x] Add CI, architecture diagrams, threat model, decisions, evaluation and interview/demo guides.

Audit findings: local transcription already has bounded bytes/duration, reusable locked inference, cancellation handling and real WAV/WebM fixtures. Graph validation precedes atomic message persistence. Traces are already durable. Do not replace these components. Actual gaps include status refresh blocking transcript delivery, history refresh blocking playback, unvalidated embedding values, generic provider errors, no server-side Origin write guard, no CI, and missing interview documentation.

Remaining scope will be recorded here with verification evidence. No live Gemini calls, paid deployment, commits or pushes are required for this increment. Existing `.env` and user data must remain untouched.


## Completed verification

79 backend tests passed on macOS and Linux ARM64; 1 paid/live test skipped. 27 frontend tests passed; TypeScript/Vite builds, repository-configured Ruff, Compose config, npm audit and real PostgreSQL smoke passed. Real local WAV/WebM recognition scored WER 0.0 against one short reference. Real STT → graph → mocked Gemini → PostgreSQL and nginx HTTP transcription passed. See [verification](verification.md) for exact scope and initial failures that were resolved.

## Continue here, ranked

1. **Durable request idempotency:** add a migrated request/result record and unique key; handle lost responses and retries without duplicate messages or model calls. Test disconnect/retry and concurrent clients.
2. **Durable citation provenance:** migrate message source snapshots (document/chunk identity, page, excerpt, operation); return them on history reload and define behaviour after document deletion. Currently only answer text persists.
3. **Representative RAG evaluation:** label retrieved evidence and answerability on held-out sample questions; measure recall, abstention and claim support before changing thresholds or adding reranking. Run paid probes only with explicit opt-in.
4. **Shared-deployment prerequisites:** authentication and resource ownership, protected metrics, host policy/DNS rebinding defence, distributed limits, parser isolation, retention/backup recovery. Until then keep loopback and one worker.
5. **Operational evidence:** prompt/model versions and stage timings in migrated traces; Python/image dependency and secret scanning; hosted CI run; real browser spoken acceptance. No broad production performance or security claims yet.

Streaming, checkpoints, automatic retention of business data and larger-corpus indexing remain deliberately deferred until justified. No working subsystem was replaced, and no runtime dependency or schema change was needed for this increment. Existing migration checks passed. The isolated verification containers were stopped with volumes retained; no user data or existing configuration was deleted.
