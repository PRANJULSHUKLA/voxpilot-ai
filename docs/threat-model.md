# Threat model — local edition

Assets: microphone audio, transcripts, documents/chunks, notes, conversation history, server API key, database backups and model quota. Trust boundaries: browser → local API; uploaded data → parser/model; backend → Gemini; API → database; host → containers/cache.

| Threat | Implemented mitigation / evidence | Residual risk |
| --- | --- | --- |
| A hostile site triggers a local write | Explicit Origin and Fetch Metadata mutation guard; `test_hardening.py` checks simple POST side effects and allowed origins | Not authentication; native clients can forge headers. DNS rebinding and hostile local processes are not comprehensively addressed. |
| Cross-session retrieval | Document/session matching in `retrieve`; existing application isolation tests | Anyone with API access can enumerate IDs. No user identities/tenant isolation. |
| Prompt injection in text/documents | Evidence serialized under a separate system instruction; no model shell/SQL tools; citation membership checked | Semantic attacks may still succeed. Mock tests prove boundaries, not live model resistance. |
| Fabricated/empty output | Pydantic schemas, allowed citation IDs, exact action evidence/owner/deadline checks, blank grounded-answer rejection | Citations can be valid but irrelevant. Human edits are trusted user content. |
| Corrupt vectors | Batch count/dimension and finite nonzero validation, model compatibility checks; atomic rejection tests | Provider semantic quality and threshold calibration are unmeasured. |
| Secret or payload leakage | Backend-only SecretStr configuration, sanitized errors, payload-free traces; provider tests include private exception strings | Database stores plaintext business content; host administrators/backups can access it. |
| Resource exhaustion | Byte/duration/input limits, single inference lock, process-local mutation limiter, per-session lock, bounded history/model timeout | PDF decoding is not process-isolated; request-body slow clients/global concurrency remain risks. |
| Unsafe generated HTML | ReactMarkdown without raw HTML plugin; nginx CSP | Markdown links and user decisions still require care. No comprehensive browser security assessment. |
| Duplicate or incomplete turns | Validate then commit; failed requests rollback; cancellation and no-overlap UI tests | Lost HTTP response after commit can lead to duplicates on manual retry. |
| Retained private data | Explicit deletion cascades; session expiry blocks use; trace retention | Expiry is not automatic deletion; backups and storage are not securely erased. Citations are not persisted with messages. |

Do not present this as a multi-user production system. Before shared deployment: authenticated ownership, TLS, host/origin policy, protected metrics, distributed concurrency controls, retention jobs, backup recovery and independent security review.
