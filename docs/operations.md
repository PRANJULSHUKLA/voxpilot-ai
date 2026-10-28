# Operations and recovery

Use the root README for full setup. Do not overwrite an existing `.env`. Compose injects root configuration; host execution from `backend/` requires exported variables or a private backend `.env`.

```sh
docker compose up --build -d
docker compose ps
docker compose logs --tail=100 backend
curl http://localhost:8000/api/v1/health
curl http://localhost:8000/api/v1/config/status
curl http://localhost:8000/api/v1/audio/status
```

Health checks the database, not Gemini quota or Whisper readiness. `/config/status` means key presence only. Prepare Whisper through Settings or `POST /api/v1/audio/prepare`; first use downloads weights, later calls reuse the cache. Do not send private audio to a backend you do not control. Browser synthesis is supplied by the browser/OS.

After changing environment configuration, recreate the backend with `docker compose up -d --force-recreate backend`. Keep one worker: session locks, rate limits and model concurrency are process-local. If changing frontend port or hostname, add that exact scheme/host/port to `CORS_ORIGINS`. `origin_denied` means the browser origin is not configured; do not solve it with a wildcard.

Migrations execute before Uvicorn in the backend container. For host SQLite development, run `../.venv/bin/alembic upgrade head` from `backend/`. Normal startup does not create tables opportunistically. Never downgrade a live database casually. Test migrations on a disposable database and back up before schema releases.

| Symptom | Recovery |
| --- | --- |
| `provider_unconfigured` | Add server key and recreate backend. |
| `provider_credentials` | Check key validity and API permissions; no secret is returned by the API. |
| `provider_model_unavailable` | Check configured model identifier and account availability; no fallback is performed. |
| `provider_quota` / `provider_unavailable` | Wait/check provider quota or availability; no application retry loop. |
| Timeout or browser cancel | Refresh stored history before retrying; the server may have completed. |
| `embedding_error` | Provider supplied malformed vectors; no document is committed. Retry after checking provider configuration. |
| `embedding_mismatch` | Model/dimensions differ from stored data. Deliberately re-upload affected documents; no automatic destructive reindex. |
| STT load failure | Check cache permissions and download access. Retry preparation; text entry remains available. |
| STT busy / no speech | Wait for current inference or check microphone input. Decode errors do not initialize the model. |
| Response saved but refresh failed | Use Refresh conversation. Do not resubmit merely to reload the saved answer. |

Logs and `/observability/traces` use correlation IDs and sanitized categories, not prompts. The summary counts workflow/transcription traces, not all HTTP traffic. P95 uses up to the latest 1,000 retained operation latencies; it is not a measured production SLO. Traces survive restart. Old trace rows are purged on subsequent trace saves; business records require explicit deletion. Session TTL only blocks use.

Back up PostgreSQL using `pg_dump` to a protected destination with encryption/access controls, record the schema revision, and rehearse restoration to a separate database before trusting the backup. No backup restore was executed in this increment. Application deletes cascade to messages/documents/chunks; backups have their own retention. `docker compose down` preserves volumes. Avoid `down -v` on user data.

A future vendor-neutral deployment can use these images behind TLS with managed PostgreSQL, environment-managed secrets, restricted network paths, resource limits and a monitored backup policy. First add authentication/ownership and distributed coordination. Local Compose success does not prove scalability or public deployment safety.
