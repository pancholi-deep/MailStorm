# MailStorm

MailStorm sends personalized bulk emails through a signed-in Google account using the Gmail API. The frontend uses React, React Router, Tailwind CSS, and React Scripts; the backend uses FastAPI.

## Local setup

Use Python 3.11 or newer and Node.js 22. From the repository root:

```sh
python3 -m venv backend/.venv
source backend/.venv/bin/activate
pip install -r backend/requirements-dev.txt
cp -n backend/.env.example backend/.env
cp -n frontend/.env.example frontend/.env
```

Configure a Google OAuth web client with the Gmail API enabled and the consent screen configured for the Gmail send and profile/email scopes. Register `http://localhost:3000` as an authorized JavaScript origin. Put the same client ID in both environment files and the client secret only in `backend/.env`. Popup OAuth exchanges use the frontend origin, not a callback path. Production origins must use HTTPS.

Run the backend from the repository root:

```sh
uvicorn backend.main:app --reload --port 8000
```

In a second terminal:

```sh
cd frontend
npm ci
npm start
```

Open http://localhost:3000. Frontend environment changes require restarting the dev server or rebuilding. Missing backend OAuth credentials fail validation at startup.

## Sending emails

Sign in with Google, upload a UTF-8 CSV, and either upload a TXT/HTML template or compose manually. CSV headers are case insensitive and must include unique `name` and `email` columns. Quoted commas, escaped quotes, CRLF, and a UTF-8 BOM are supported. Blank rows are skipped; incomplete rows and malformed addresses reject the entire batch before sending. Recipients can use any valid email domain.

```csv
name,email
Alice Smith,alice@example.org
"Doe, Jane",jane@example.org
```

TXT templates use:

```text
Subject: Hello {name}
Body: Your address is {email}.
Additional body lines are preserved.
```

HTML templates may include `<!-- Subject: Hello {name} -->`; otherwise enter the subject in the existing subject field after processing. HTML fragments are supported. `{name}` retains the original first-name behavior and `{email}` inserts the recipient address. Other named placeholders are rejected. Values inserted in HTML bodies are escaped. Manually composed messages are plain text.

The default limits are 2 MiB per CSV, 500 recipients, 998 subject characters, and 1,000,000 body characters. Backend limits are authoritative. Match frontend `REACT_APP_MAX_CSV_BYTES` and `REACT_APP_MAX_RECIPIENTS` to backend limits if customized. Upload bytes are counted as they arrive, with size, timeout, and concurrency limits.

## Verification

```sh
backend/.venv/bin/python -m pytest backend/tests -q
cd frontend
CI=true npm test -- --watchAll=false --runInBand
CI=true npm run build
```

Runtime Python dependencies are listed in `backend/requirements.txt`; existing transitive pins live in `backend/constraints.txt`. The privacy page uses `frontend/src/privacyPolicy.json`; run `npm run sync:privacy` in frontend after changing it to regenerate the Markdown policy.

Tests mock Google; they do not send real emails. CI runs backend regressions, frontend regressions, and the production build. Live OAuth needs configured Google credentials and a registered frontend origin.

## Durable campaign architecture (current implementation)

The background campaign API supersedes the request-scoped SSE/checkpoint flow described in older revisions. The existing upload, template/manual composition, progress, Cancel, Reset, dark mode, and Download Logs controls remain. A browser disconnect stops observation; workers continue. Reloading the authenticated screen reconnects to a running campaign. The visible log holds the latest 500 messages; Download Logs exports the complete server record.

The browser reserves an upload, streams its contents to local storage or directly to private S3, finalizes it, and submits a template with an idempotency key. Workers validate the entire CSV in 250-row transactions before sending any mail. Templates, recipients, and Google credentials are encrypted in the database. Provider acceptance IDs and each attempt are retained. Acceptance by Gmail is not confirmation of inbox delivery.

| API | Behavior |
| --- | --- |
| `POST /auth/google` | Exchanges the popup code; returns an opaque seven-day application session, never a Google token. |
| `POST /v1/uploads` | Reserves size and SHA-256; returns a local PUT target or a signed S3 POST. |
| `PUT /v1/uploads/{id}/content` | Streams a development upload with exact size/checksum checks. |
| `POST /v1/uploads/{id}/complete` | Seals the upload once; S3 checksum is verified during import before sending. |
| `POST /v1/campaigns` | Requires UUID `Idempotency-Key`; returns `202` with a durable campaign ID. Reusing a key with changed content returns `409`. |
| `GET /v1/campaigns` | Lists the owner's latest 50 campaigns. |
| `GET /v1/campaigns/{id}` | Returns authoritative status and aggregate counts. |
| `GET /v1/campaigns/{id}/recipients?after=0&limit=250` | Returns a bounded page using recipient row numbers. |
| `POST /v1/campaigns/{id}/cancel` | Requests cancellation; an in-flight request can finish. |
| `POST /v1/campaigns/{id}/retry` | Continues unsent rows; never replays accepted, permanently failed, or unknown rows. |
| `GET /v1/campaigns/{id}/logs` | Streams a CSV export, with spreadsheet formula escaping. |
| `POST /v1/logout` | Revokes the current application session. |
| `GET /readyz` | Checks database connectivity and schema version. |

`POST /send-emails` accepts the old multipart field names but now returns `202` campaign JSON, not SSE. All authenticated endpoints require the application session. Update API clients with the frontend; Google bearer tokens are no longer accepted directly.

Workers use database-time leases, unique worker IDs, and incrementing generations. Every import, checkpoint, heartbeat, and release checks the live generation. Expired `submitting` rows become `unknown`, preventing automatic duplicates after a crash or ambiguous network response. Exactly-once delivery cannot be guaranteed across Gmail and the database. Only known-safe connection failures and explicit rate-limit rejections retry automatically, with jitter, bounded attempts, and `Retry-After`. Uncertain requests pause a campaign; review the sender's Gmail account before choosing how to handle unknown recipients.

Per-sender and project pacing are shared across worker processes. Defaults are deliberately conservative (1.1 seconds per sender, 0.01 seconds project-wide). These are configurable pacing limits, not a promise that a Google account can send at that rate indefinitely. Account daily limits still apply. Queue admission and upload concurrency are bounded. Limits remain 2 MiB CSV / 500 recipients by default; raise backend `MAX_CSV_BYTES` / `MAX_RECIPIENTS` and matching frontend `REACT_APP_MAX_CSV_BYTES` / `REACT_APP_MAX_RECIPIENTS` together only after staging load tests.

### Local operation

Existing `backend/.env` OAuth values stay in place. Install `backend/requirements-dev.txt`, run `uvicorn backend.main:app --reload`, and run `npm start` in `frontend`. Development creates the queue schema, uses SQLite, stores uploads under `backend/.data/uploads`, and runs an embedded worker. Its generated `backend/.data/encryption.key` must stay with the database: losing it makes encrypted records unreadable. Do not commit, publish, or delete it while campaigns remain. Use a single API process for local development.

To exercise a separate worker locally, set `EMBEDDED_WORKER=false`, run `python -m backend.jobs.migrate`, and run `python -m backend.jobs.worker` alongside the API. All commands run from the repository root with the backend virtual environment activated.

### Production rollout

1. Drain the old request-scoped sender before upgrading. Preserve a backup of its SQLite checkpoints and reconcile unfinished/unknown batches; legacy hash-only records cannot reconstruct campaign payloads. Do not resubmit already-sent legacy lists as new campaigns. Deploy API and frontend together and sign in again.
2. Provision PostgreSQL and a private S3 bucket. Configure the bucket to permit signed POST uploads from the exact frontend HTTPS origin, including `x-amz-server-side-encryption`. Block public access. Give the service identity only required object read/write/delete permissions for `incoming/` and `sealed/`. Configure lifecycle expiration for incoming objects and noncurrent versions consistent with retention.
3. Set `APP_ENV=production`, `EMBEDDED_WORKER=false`, `DATABASE_URL`, `S3_BUCKET`, `AWS_REGION`, HTTPS `FRONTEND_URL`, and a shared `CREDENTIAL_ENCRYPTION_KEY`. Generate a Fernet key with `python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'` and put it in the deployment secret manager. Use the same key across API and workers; back it up securely. Changing it requires decrypting/re-encrypting retained records first.
4. Run `python -m backend.jobs.migrate` once before starting API and worker processes. Startup verifies schema version. The initial migration creates new `job_*` tables without modifying old checkpoints. Subsequent schema changes require an explicit new migration; `create_all` does not alter existing columns.
5. Start the API with Uvicorn and at least one separate `python -m backend.jobs.worker` process. Allow a shutdown grace period exceeding `HTTP_TIMEOUT` plus checkpoint time. More worker processes increase concurrency across owners; one owner's campaigns remain serialized. Keep PostgreSQL connections within its budget (each process has a bounded pool).
6. Require HTTPS at the proxy, cap request sizes and slow uploads there too, and apply unauthenticated edge/IP rate limits to sign-in. Set alarms for `worker_operation_failed`, `worker_lease_lost`, queue age, paused/unknown campaigns, database lock latency, storage failures, and provider throttling. Check worker liveness separately: API readiness does not prove workers are running. Test backup restoration together with the encryption key.

`render.yaml` describes a paid API, worker, and database deployment; it does not provision the S3 bucket or deploy anything automatically here. Ensure the schema migration completes before the first worker starts (restart the worker after the first migration if services start concurrently).

Terminal/paused campaigns expire after `RETENTION_SECONDS` (default 30 days). Active jobs remain. A running worker performs cleanup; unused uploads become eligible after an hour, and inactive credentials are deleted after retention once no campaign or live session references them. Object deletion precedes upload metadata removal and is retried on failure. Backups and bucket version retention need matching operator policies.

### Validation and remaining capacity work

Run `python -m pytest backend/tests -q`, then `npm test -- --watchAll=false --runInBand`, `npm run check:privacy`, and `npm run build` inside `frontend`. Tests use mocked Google calls and never send real emails. PostgreSQL integration runs when `TEST_POSTGRES_URL` names an isolated test database (CI provisions one).

The database queue intentionally serializes short write transactions through a scheduler lock for a straightforward initial correctness model. This is a potential throughput ceiling; measure lock wait time and queue age before increasing workers. Large-scale production sizing, live S3 integration, provider quota calibration, infrastructure provisioning, dashboard/alert setup, key rotation, and disaster-recovery drills remain deployment work. Do not treat unit tests as a production capacity certification.

## License

[MIT](LICENSE).
