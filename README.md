# Runway

Email scheduling dashboard built with TypeScript, Express, PostgreSQL, BullMQ/Redis, Elasticsearch, Nodemailer/Ethereal, React, Vite and Tailwind.

## Run locally

1. Copy `.env.example` to `.env`, set a strong `SESSION_SECRET`, and add Google OAuth credentials with callback `http://localhost:4000/api/auth/google/callback`.
2. Start infrastructure: `docker compose up -d`.
3. Install workspace packages: `npm install`.
4. Generate/apply the database schema: `npm run db:generate --workspace backend` and `npm run db:migrate --workspace backend`.
5. Start API and UI with `npm run dev`.
6. Sign in through Google. The API creates an Ethereal account with `POST /api/senders/test` (from Compose, use **Create Ethereal sender** once signed in).

API listens on `http://localhost:4000`; UI on `http://localhost:5173`; protected Bull Board at `/admin/queues` uses the credentials in `.env`.

## Ethereal

Ethereal is a test SMTP service: messages are captured for inspection and are not delivered to real recipients. Runway creates a test account per user through `nodemailer.createTestAccount()`. A successful send event records Nodemailer's preview URL.

## Configuration

See `.env.example`. `WORKER_CONCURRENCY` controls active worker jobs. `MIN_DELAY_MS_BETWEEN_SENDS` spaces sends per sender using Redis. `MAX_EMAILS_PER_HOUR_PER_SENDER` caps hourly reservations, keyed by UTC hour. PostgreSQL, Redis (AOF enabled), and Elasticsearch are persistent Docker services.

## Architecture and trade-offs

- `planSchedule` is a pure ordered planner shared by campaign creation and preview. It rotates senders, enforces a per-sender minimum interval, and moves overflow to later UTC hour windows.
- A campaign and all email rows/events are created in one database transaction. Then each delayed BullMQ job receives stable `email:<emailId>` identity. Redis AOF and PostgreSQL volumes retain queue and application state across container restarts.
- Workers claim only `scheduled` rows with an atomic conditional update. Stale `processing` rows older than two minutes are reset and requeued at startup. The send itself is at-least-once across the narrow failure window after SMTP accepts mail but before the database commits; SMTP has no general idempotency key, so exactly-once delivery cannot be guaranteed. The row claim prevents ordinary duplicate work.
- Hourly reservations use an atomic Redis Lua increment/undo. The hourly key uses UTC windows. The global hourly setting is applied per sender. Slack rate-limit notices are deduplicated by sender and hour.
- BullMQ delayed jobs, not cron, handle all scheduling. Elasticsearch is a derived search index and is updated when queued/sent. Reindexing can be performed from PostgreSQL if ES is lost.
- OAuth is required for dashboard APIs. A standalone email/password form is shown to mirror the reference, while account sign-in uses Google OAuth.

## Features mapped to the assignment

- Campaign create/preview, pure scheduling planner and tests: `backend/src/schedule.ts`, `/api/campaigns*`.
- Persistent queue, worker, rate limiting, crash recovery, Ethereal delivery: `backend/src/queue.ts`.
- Slack incoming-webhook OAuth, Elasticsearch search, Bull Board, Google sign-in, email events/stats and dev kill switch: `backend/src/index.ts`.
- Compose/upload/dedupe/preview, scheduled and sent lists, search, details/timeline and responsive dashboard: `frontend/src/App.tsx`.
- Docker services and environment template at repository root.

## Assumptions

- Default chosen minimum delay is 1 second and default per-sender cap is 100 messages per UTC hour; both are configurable.
- Senders belong to one authenticated user. Each compose action creates a campaign and deduplicates recipients case-insensitively.
- The screenshots use placeholder data for their list/detail examples; the dashboard displays the authenticated user's real queued/sent data.
- Gmail/Google and Slack credentials are provisioned outside the repository. Do not commit real secrets.

## Development checks

Run planner and basic rate-limit behavior tests with `npm test`. Preview a 1,200-recipient schedule distribution with `npm run loadtest --workspace backend` after configuring a user and sender.
