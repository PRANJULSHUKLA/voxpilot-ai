# Security and privacy boundaries

## Implemented

- Server-side secret configuration using SecretStr; the public config response is an explicit allowlist. Wire logging for HTTP/Google/model libraries is suppressed. Validation responses do not echo request inputs.
- Versioned, typed routes; UUID validation; bounded inputs, actual HTTP body bytes and uploads; UTF-8/signature/content checks; sanitized basenames and no original-file disk writes.
- Narrow CORS; loopback-only published ports; no exposed database port. Nginx adds CSP, frame restrictions, MIME sniffing protection and microphone/camera policy. Markdown uses react-markdown without raw HTML execution.
- Session-scoped document access, retrieval and deletion; foreign-key cascades verified in tests. No generated code execution, autonomous tools, command runner or external URLs fetched by the model.
- Pydantic model output validation, citation membership validation, conservative exact evidence validation for generated action owners/deadlines, and explicit uncertainties in meeting notes.
- Metadata-only request traces, hashed session references, configurable retention and safe correlation IDs in errors. No sensitive payload logging by default.
- Single-worker per-session concurrency guard and basic in-memory mutation limiter. Safe provider errors and request timeouts.

## Required before sharing

There is no login, ownership authorization, CSRF protection, distributed rate limiter, audit identity, encrypted storage or backup/restore service. CORS and random session IDs do not authenticate callers. Metrics and sessions are readable by anyone who can access the API. Keep host ports bound to loopback. Do not use the app as a shared-host service where other local users must be isolated.

Before public or multi-user use: enforce authenticated tenant ownership on all routes/queries, protect metrics, configure TLS and trusted proxy handling, implement robust CSRF/origin checks and distributed quotas, add upload malware/decompression isolation, manage secrets, encrypt backups, define data retention/consent, review dependencies/images and run a security review. Large or hostile PDFs should be parsed in a resource-isolated worker; the MVP bounds bytes/pages/text but does not provide a parser sandbox.

Document prompt instructions are constrained at the system/prompt boundary but cannot be guaranteed harmless. Valid citations can still support a wrong inference. A meeting schema can still contain an inaccurate summary/decision. Human review and adversarial evaluation remain necessary. Manual note edits are not model-validated claims.

## Data lifecycle

Recognized transcripts, recent conversation history, meeting transcripts, document text for embeddings, retrieved excerpts and questions are transmitted to Google's configured APIs as necessary. Microphone audio is sent only to this backend for local recognition and is discarded. Some browser synthesis voices may use vendor network services. Consult the respective service terms and privacy policy before sensitive use. This app does not control those external retention policies.

LocalStorage holds only UI preferences and the last session UUID. User payloads are stored in the relational database. No raw audio or raw upload file is retained permanently; multipart uploads may spool temporarily to OS storage and are closed/deleted after reading. Model weights, not recordings, persist in the model cache. Deleting a conversation removes messages/documents/chunks; deleting a meeting removes transcript/notes. Expired content stays in the database until explicit deletion. UI deletion is immediate, with no trash/undo. Database backups and underlying disk remnants are outside application deletion guarantees.

Operational traces store no payloads and survive session deletion until the retention cutoff. Queries omit expired traces; the next workflow completion purges them physically. Trace retention defaults to seven days. Default logs contain only sanitized events and IDs. Docker volume deletion permanently removes the database volume; it is not certified secure erasure.

AbortController stops the browser from waiting, and audio cancellation stops synthesis. Neither guarantees Gemini stops processing or charging. There is no durable deduplication of a retry after disconnect. Check stored messages before retrying.
