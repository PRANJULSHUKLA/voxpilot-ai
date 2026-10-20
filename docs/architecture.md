# Design notes

## Workflow

Each request builds a compiled LangGraph around its own SQLAlchemy transaction, Gemini provider and trace. A typed state carries the input, explicit intent, bounded history, answer and structured artifacts. Six nodes execute on each successful path; recursion is limited to 12 steps. There is no agent loop and no autonomous tool execution.

| Node | Purpose |
| --- | --- |
| validate_input | Reject blank and oversized input using central configuration. |
| load_context | Verify session existence, kind and expiry; load recent history for chat within count and character budgets. |
| classify_intent | Route the explicit API/UI intent deterministically, without another model call. |
| conversational_response | Compose the system prompt, session history and current message using LangChain, then asynchronously call Gemini. |
| meeting_notes_workflow | Require a meaningful transcript and produce a validated MeetingNotes schema in one call. |
| document_question_answering | Embed the question, retrieve authorized document chunks, and ask Gemini for a schema-constrained cited answer. Skip generation when no evidence qualifies. |
| validate_output | Reject empty chat output, invalid citation IDs and action items whose exact evidence/owner/deadline do not match the transcript. |
| persist_result | Recheck expiry and save successful messages or notes transactionally. |

Only one of the three generation nodes runs. The request service rolls back failures and writes a separate payload-free trace regardless of outcome. Model exceptions are mapped to safe configuration, quota, timeout, invalid-output or provider-error categories. Model time includes structured parsing; workflow time includes graph and persistence. Input/output tokens are exact SDK usage when supplied, never estimates. A trace write failure is logged by correlation ID; it does not turn a persisted answer into a failed answer.

## Persistence and scope

PostgreSQL 16 is the Compose default. SQLite supports local development and isolated tests. SQLAlchemy models and explicit Alembic migrations define sessions (kind chat/meeting), messages, document metadata, chunks/vectors and traces. Foreign keys cascade session deletion to messages/documents and document deletion to chunks. UUIDs are validated by FastAPI. Sessions expire at creation time plus TTL; expiry blocks reads/workflows but rows can still be deleted. List endpoints paginate and expose expired session metadata for local management.

This is a local single-user security scope. Every document operation requires the parent session ID, and retrieval joins the selected document to that session. UUID scoping prevents accidental cross-session retrieval, not malicious access by someone with API access. Multi-user operation requires authenticated ownership on all models and queries.

A per-session in-memory guard prevents concurrent generation, transcript edits or deletion from racing in one worker. A bounded one-minute per-client limiter covers mutations. Neither is a distributed lock/rate limit. Use one backend worker as configured. There is no durable idempotency key; an interrupted browser request can complete remotely and be saved. Refresh before retrying.

## Retrieval

Files are read with a byte bound, parsed in a worker thread, and discarded. TXT must be UTF-8 without NUL characters. PDFs require a PDF signature, no encryption, at most 100 pages and readable extracted text. Extraction is capped at 100,000 characters by default; no OCR or original-file storage is provided. Chunking is page-aware with configurable 1,000-character chunks and 150-character overlap, so PDF page provenance is retained. At most 20 documents are allowed per session.

The explicitly configured `gemini-embedding-001` integration embeds documents with RETRIEVAL_DOCUMENT and queries with RETRIEVAL_QUERY. Embeddings are stored as JSON arrays in the relational database. Cosine retrieval scans only the selected session-authorized document's chunks, then takes the best four above a configurable 0.3 similarity threshold. This is real vector retrieval optimized for small local corpora, with no vector database service. The threshold is a heuristic, not a calibrated relevance probability. Changing the model or dimensions produces an explicit re-upload requirement rather than comparing incompatible spaces.

The RAG chain receives the current question and retrieved evidence as serialized untrusted data, under a system prompt that prohibits obeying document instructions or filling gaps from outside knowledge. Its structured answer names chunk IDs. Unknown IDs cause failure. No citations or insufficient evidence results in a consistent missing-evidence message. Valid references return filenames, page numbers where available, and actual excerpts. Citation membership does not prove semantic support; this requires evaluation/human review.

## Voice and frontend

RecordingProvider and SynthesisProvider isolate capture and browser playback. BrowserRecorder keeps getUserMedia tracks live during MediaRecorder capture, selects a supported MIME format and produces a binary Blob. It releases microphone tracks on stop/cancel/permission races and uses a Web Audio AnalyserNode RMS amplitude to drive the orb. Unsupported amplitude measurement is labeled, not faked. Recording is capped by time and byte count; transcript submission can be automatic (default) or reviewed first.

`POST /audio/transcribe` bounds multipart bytes, closes temporary upload handles, validates MIME against the decoded container, resamples to mono 16 kHz float32 with a sample-count duration bound, and runs local inference in a worker thread. A reusable, lock-protected faster-whisper base model uses CPU/int8. VAD avoids many silence-only hallucinations. Empty recognition is an explicit error. No Gemini call is involved in transcription. The status/preparation endpoints expose safe readiness and failure categories. Model initialization happens off the event loop, with persistent Docker weights at /models. Only one inference runs at a time; excess requests get 429. Corrupt/oversized audio does not trigger a model download.

The frontend voice state machine separates idle, requesting_permission, listening, stopping_recording, transcribing, transcript_ready, thinking, speaking and error. Invalid transitions and overlapping recording are blocked; epoch checks discard cancelled/stale transcription replies. Auto-send passes recognized text directly into the existing session-scoped chat/meeting/document route, without relying on asynchronous draft state updates. Missing Gemini configuration leaves text available. Per-turn measured recording duration, transcription latency, Gemini latency and total elapsed turn time are shown when available, never estimated. Transcription traces retain metadata only; in-process counters reset on restart.

Browser speech synthesis remains client-side. Interrupt detaches expected cancellation handlers, cancels capture/fetch and calls speechSynthesis.cancel. Text is preserved if playback fails. API fetch is bounded by AbortController timeouts, but closing a client connection cannot stop an already-running native inference thread or guarantee Gemini cancellation. Turns are not full duplex or streaming. Raw recordings are discarded after local processing; larger multipart uploads may be briefly spooled by Starlette and are closed reliably.

The cosmic shell uses CSS nebula layers, a finite star field, SVG constellation lines, a keyboard-operable recording orb and state-driven orbit animation. Listening expansion uses measured audio amplitude; speaking/processing effects are explicitly state animations. Reduced-motion disables animations and dynamic scaling. Chat, meetings, documents, settings and observability retain their original operations.

## Deployment decisions

A non-root Python container runs migrations then a single Uvicorn process. A multi-stage Node build produces static React assets, served by an unprivileged nginx container. Browser API requests use a same-origin nginx proxy; no API secret enters the build. PostgreSQL readiness gates backend startup, and backend readiness gates frontend startup. Secrets remain environment configuration, excluded by .gitignore/.dockerignore. Dependency versions are exact in requirements.txt and package-lock.json. Docker base images use maintained version tags; production deployments should pin reviewed image digests and add image scanning/backups.
