# Architecture decision records

Status: accepted for the local edition. See [research](research-and-decisions.md) for primary sources.

1. **Preserve a modular monolith.** FastAPI routes, provider adapters, graph, repositories and retrieval modules already separate concerns. Keep one backend and PostgreSQL rather than introduce microservices; the local workload does not justify their operational cost.
2. **Local speech, hosted generation.** Keep faster-whisper and browser synthesis. Local audio processing avoids a speech API/key, but CPU latency, cache preparation and browser voice availability remain user-visible constraints. Transcripts and retrieved text leave the backend for Gemini.
3. **Explicit bounded workflows.** Route by API operation, not an LLM classifier. This saves a call and makes transitions testable. No arbitrary tools or autonomous execution. No checkpoints until resumable multi-step work justifies their access and retention design.
4. **Atomic completed turns.** Validate before committing user/assistant pairs. A separate transaction records operation metrics. Do not stream partial answers yet. A network disconnect can still leave a committed result unknown to the client; durable idempotency is future work.
5. **Small-corpus relational vectors.** Retain page-aware character chunks and JSON vectors, with a per-document cosine scan. Validate vectors and embedding compatibility rather than adding a vector database. pgvector becomes appropriate after measured volume/latency requires indexing.
6. **Local security scope.** Loopback services plus explicit browser origins are proportionate to the current personal workspace. They cannot replace authentication. Shared deployment requires authenticated ownership on every resource and metrics endpoint.
7. **Use deterministic tests first.** Mock generation for economical, reproducible failure and persistence tests. Run opt-in actual speech against a reference; keep paid Gemini evaluation separate. Report these as different kinds of evidence.
