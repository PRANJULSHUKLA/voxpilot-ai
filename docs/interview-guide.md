# Interview defence guide

## 60–90 second pitch

VoxPilot is a local voice-first knowledge workspace for students reviewing course material, teams turning meeting transcripts into notes, and people asking questions about their documents. The browser records audio and a reusable local faster-whisper model transcribes it. Users can review the text or auto-send it. FastAPI runs a bounded LangGraph workflow, LangChain calls Gemini, and successful validated results are stored in PostgreSQL. The browser can speak the answer.

The engineering value is in the boundaries: audio limits and inference serialization, editable transcripts, explicit workflow routing, atomic persistence, source-scoped retrieval, structured notes and safe failure reporting. I preserved working components and fixed observable failures such as status polling delaying transcript delivery, history refresh blocking playback, invalid vectors entering storage and wrapped provider errors losing their category. The tests use mocks for Gemini and real decoding; a separate offline speech evaluation uses a known reference.

This is a single-user local application. I do not claim public production readiness, general RAG accuracy or live Gemini verification from deterministic tests. The next priorities are durable retry deduplication, saved citation provenance and authenticated ownership before shared deployment.

## Five-minute architecture walkthrough

1. **Problem, 45 seconds:** capture spoken ideas, turn transcripts into reviewable notes, and retrieve passages from approved documents. Use the synthetic Atlas data in `docs/demo/`.
2. **Voice path, 60 seconds:** follow the sequence diagram in [architecture](architecture.md). `recorder.ts` handles capture/resources, `speech.ts` manages lifecycle/cancellation, `api/audio.py` bounds uploads, and `providers/transcription.py` decodes and runs local inference off the event loop. Gemini is not speech recognition.
3. **Application workflow, 60 seconds:** `api/routes.py` selects explicit intent; `graph/workflow.py` validates input, loads bounded context, routes, generates, validates and persists. Only one branch runs; no paid classifier or autonomous loop. Failed results do not become successful message pairs.
4. **Knowledge and meetings, 60 seconds:** explain page-aware overlapping chunks, task-specific embeddings and per-document cosine retrieval in `services/retrieval.py`. Explain membership-checked citations, abstention and exact action evidence checks. Shape validity and evidence membership are weaker than factual correctness.
5. **Operations/trade-offs, 75 seconds:** PostgreSQL stores business data and traces; Alembic owns schema evolution. Session locks and rate limits assume one worker. Origin checks reduce hostile browser writes but there is no identity system. Explain the measured tests and explicitly unverified paid/browser behaviour in [evaluation](evaluation.md).

## Significant dependencies

| Component | Actual role / code |
| --- | --- |
| React / TypeScript / Vite | UI state and typed build; `frontend/src/App.tsx` and feature components |
| Browser MediaRecorder / Web Audio / speechSynthesis | Capture, amplitude meter and answer playback; `services/recorder.ts`, `speech.ts`, `synthesis.ts` |
| FastAPI / Starlette / Pydantic | HTTP validation, middleware, worker offloading and typed schemas; `main.py`, `api/`, `schemas/api.py` |
| faster-whisper / CTranslate2 / PyAV / NumPy | Local CPU/int8 inference, bounded decoding/resampling; `providers/transcription.py` |
| LangChain core / langchain-google-genai / google-genai | Prompts, Gemini adapter, embeddings and structured output; `providers/gemini.py` |
| LangGraph | Typed bounded workflow; `graph/workflow.py` |
| SQLAlchemy / psycopg / Alembic / PostgreSQL | Transactions, database access and migrations; `db/`, `alembic/` |
| pypdf | Text extraction from searchable PDFs; `services/retrieval.py` |
| react-markdown / lucide-react | Safe-by-default Markdown display and UI icons |
| OpenTelemetry API | API dependency only; no configured SDK/exporter. Durable metrics come from `observability/tracing.py`. |
| pytest / Vitest / Testing Library / Ruff | Deterministic backend/frontend tests and Python lint |
| nginx / Docker Compose | Same-origin static/API serving and reproducible local services |

## Questions and defensible answers

1. **Is this an autonomous agent?** No. `graph/workflow.py` is a predetermined workflow selected by explicit API intent. No model can execute shell, SQL or arbitrary tools.
2. **Why both LangChain and LangGraph?** The former handles prompt/message/provider composition; the latter makes execution and validation order explicit. A plain service pipeline could be simpler for three branches, but retaining the tested graph preserves clear orchestration.
3. **How do you bound execution?** Graph recursion limit is 12 in `routes.py`, history has count/character budgets, inputs and output tokens are bounded, and generation has a timeout. These do not impose a hard kill on native inference or remote billing.
4. **What does Gemini do?** Generate chat, structured notes and grounded answers, plus separate embedding requests. `providers/gemini.py` keeps the key server-side and exposes no tools.
5. **Why Gemini 3.6?** The brief requested it, the official catalog lists it, and the example configuration already selected it. Code defaults now agree. Request serialization tests cover the installed adapter; account access remains a live check.
6. **How are provider errors handled?** Numeric SDK status codes are recovered through bounded exception causes and mapped to safe credentials, model, quota, timeout and availability errors. Private exception text is not returned. See `test_provider.py`.
7. **Do you retry automatically?** There is no application retry loop and chat adapter retries are configured off. Users can retry after checking persisted history. Durable idempotency is not yet implemented.
8. **How is audio private?** Audio goes to the local backend for transcription and is discarded after processing; multipart may spool briefly. Recognized text goes to Gemini when submitted. Browser/OS synthesis privacy depends on the selected voice implementation.
9. **Does async mean inference is nonblocking?** No. Local decoding/inference is synchronous native work invoked through Starlette's thread pool. A nonblocking inference lock admits one request; additional work receives 429. See `providers/transcription.py`.
10. **How is conversation memory implemented?** `repositories/sessions.py` loads recent persisted messages within limits. This is application history, not a LangGraph checkpointer or a semantic memory service.
11. **What is atomic?** The graph validates the response and then commits the user/assistant pair or notes. Failure rolls back through `run_workflow`. A trace uses a separate transaction, so trace failure does not invalidate an already-saved answer.
12. **How does RAG work?** Extract pages, make overlapping character chunks, embed with document task type, store JSON vectors/model identity, embed the query with query task type, scan the selected document by cosine and prompt with top qualifying passages.
13. **Why not pgvector?** The current bounded per-document corpus does not require a new index. Scanning is linear and will become a bottleneck at scale. Measure retrieval latency and corpus size before migrating to pgvector.
14. **How do you choose chunk size?** Current default is 1,000 characters with 150 overlap, preserving PDF page references. It is a heuristic, not an optimized result. Evaluate recall and citation support on representative documents before tuning.
15. **How do you prevent embedding incompatibility?** Compare stored model identity and vector dimensions. Validate count, finite numbers and nonzero norms. A different embedding model requires re-upload, not comparison across spaces. Equal dimensions alone do not imply compatibility.
16. **What makes citations trustworthy?** IDs must belong to retrieved chunks, and the API returns actual filenames/pages/excerpts. This rejects invented IDs but cannot prove semantic entailment. Citation snapshots are not yet persisted with messages.
17. **When does the system abstain?** No chunks above threshold skips answer generation. Structured output indicating insufficient evidence or no citations returns the fixed abstention message. The cosine threshold is not a confidence probability.
18. **Can prompt injection still work?** Yes. The model is told to treat evidence as untrusted, and it has no arbitrary execution permissions. Deterministic citation checks limit damage, but live adversarial evaluation is still necessary. See `threat-model.md`.
19. **Does structured output stop hallucination?** No. Pydantic constrains shape. `validate_output` additionally verifies exact action evidence and that owner/deadline occur in that evidence. Summary correctness and implied commitments still require review.
20. **What authentication exists?** None. Loopback binding, explicit origins and session scoping support a personal workspace only. Any client with API access can read data. Authenticated ownership is a prerequisite for shared deployment, not an implemented feature.
21. **Why an Origin guard as well as CORS?** CORS restricts browser reads but simple cross-origin POSTs can execute. `main.py` rejects foreign/opaque origins before side effects. Originless CLI requests remain allowed; this is not authentication or complete DNS-rebinding protection.
22. **What latency did you measure?** See the dated table in `evaluation.md`: actual local fixture inference, with initialization separate. Do not extrapolate two formats of one utterance to microphone latency, concurrent throughput or production P95.
23. **How do you evaluate speech?** Normalize case/punctuation, compute word-level Levenshtein distance divided by reference length. `services/evaluation.py` and `scripts/evaluate_stt.py` are repeatable; insertions can make WER exceed 100%.
24. **How do you evaluate LLM quality?** The normal suite uses mocks and verifies orchestration, failures and validation. `evals/cases.json` drives four opt-in live semantic probes. This is not a representative benchmark; no new live scores are claimed.
25. **What do the metrics measure?** Durable workflow/transcription traces include elapsed time, success, sanitized error category and SDK usage where supplied. Summary P95 is over at most 1,000 recent traces. It excludes many HTTP routes; token usage is not a cost estimate.
26. **How does Docker help?** It packages nginx, API and PostgreSQL, applies migrations before serving, persists database/weights and binds local ports. It does not establish reliability under load, secure backups or public scalability.
27. **What does CI prove?** Added workflow runs tests/lint/build, PostgreSQL migration/mock smoke, Compose validation and npm audit. Local equivalents are recorded separately; a remote GitHub Actions pass is not claimed until pushed and run.
28. **What is the most valuable next change?** Durable idempotency for lost-response retries, followed by saved source provenance and representative RAG evaluation. Authentication comes before any shared deployment. Each needs tests and explicit lifecycle design.

Do not describe model mocks as live Gemini evidence, UUID scoping as authentication, citation membership as entailment, or the local benchmark as a production performance result.
