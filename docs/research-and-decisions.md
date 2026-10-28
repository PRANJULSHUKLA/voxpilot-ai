# Research and decisions — 25 October 2026

Research was limited to primary sources and installed adapter code. No model API calls were made. Account availability is unverified.

| Decision | Evidence and alternative | Reason / limitation |
| --- | --- | --- |
| Set code default to `gemini-3.6-flash`, retain explicit overrides | [Google model catalog](https://ai.google.dev/gemini-api/docs/models) lists the exact identifier. Existing example config already uses it. | Avoid divergent host/Compose defaults; no silent fallback. Installed LangChain request tests cover chat and structured wire configuration, not remote access. |
| Keep Pydantic structured generation and deterministic checks | [Structured output](https://ai.google.dev/gemini-api/docs/structured-output), [LangChain Gemini](https://docs.langchain.com/oss/python/integrations/chat/google_generative_ai) | Predictable shape plus citation/evidence checks. Schema compliance is not factual correctness. |
| Keep `gemini-embedding-001` and validate vectors | [Google embeddings](https://ai.google.dev/gemini-api/docs/embeddings) still lists the text-only model. Alternative: newer embeddings and reindexing. | Avoid invalidating existing vectors. Model identity and dimensions are checked; changing the model requires re-upload. |
| Keep bounded explicit graph; no checkpoint service | [Workflows](https://docs.langchain.com/oss/python/langgraph/workflows-agents), [persistence](https://docs.langchain.com/oss/python/langgraph/persistence) | Short request-response operations do not yet require resumable human approvals. Business records are not checkpoints. |
| Keep nonstreaming response transaction | Existing output validation and persistence precede returning the answer. Streaming is supported by the adapter but requires partial-output, cancellation and commit semantics. | Remove avoidable UI waits first. Streaming remains future work, not a claimed capability. |
| Preserve single-worker containers | [FastAPI containers](https://fastapi.tiangolo.com/deployment/docker/) | Existing in-memory session guards and local Whisper serialization depend on this. Multiple workers require coordinated limits and concurrency design. |
| Preserve durable DB traces, avoid new telemetry service | [OpenTelemetry instrumentation](https://opentelemetry.io/docs/languages/python/instrumentation/) | Current API-only span hooks do not install an SDK/exporter. DB traces supply real local evidence; model/prompt versions and stage-level traces remain incomplete. |
| Add deterministic browser Origin guard | Local API has no authentication; CORS alone does not prevent simple POST execution. | Explicit origins checked before parsing/side effects. CLI and local-process access are still trusted. This is not multi-user security. |

Risk framing: [OWASP GenAI 2026](https://genai.owasp.org/resource/owasp-genai-llm-top-10-2026/) and [NIST GenAI profile](https://www.nist.gov/publications/artificial-intelligence-risk-management-framework-generative-artificial-intelligence) inform the threat review. The implementation does not establish compliance or comprehensive prompt-injection resistance.

The installed `langchain_google_genai/chat_models.py` wraps SDK errors using exception causes. Safe provider classification now follows up to eight causes and maps numeric status codes without inspecting or returning private SDK messages. Automatic application retries remain absent to avoid extra quota use; browser cancellation is not durable deduplication.
