# Runway

Email scheduling dashboard built with TypeScript, Express, PostgreSQL, BullMQ/Redis, Elasticsearch, Nodemailer/Ethereal, React, Vite and Tailwind.

## Run locally

1. Copy `.env.example` to `.env`, set a strong `SESSION_SECRET`, and add Google OAuth credentials with callback `http://localhost:4000/api/auth/google/callback`.
2. Start infrastructure: `docker compose up -d`.
3. Install workspace packages: `npm install`.
4. Generate/apply the database schema: `npm run db:generate --workspace backend` and `npm run db:migrate --workspace backend`.
5. Start API and UI with `npm run dev`.
6. Sign in through Google. The API creates an Ethereal account with `POST /api/senders/test` (from Compose, use **Create Ethereal sender** once signed in).

In development, the API listens on `http://localhost:4000` and Vite serves the UI on `http://localhost:5173`. In production, Express serves `frontend/dist` from the API origin. Protected Bull Board at `/admin/queues` uses the credentials in `.env`.

## Ethereal

Ethereal is a test SMTP service: messages are captured for inspection and are not delivered to real recipients. Runway creates a test account per user through `nodemailer.createTestAccount()`. A successful send event records Nodemailer's preview URL.

## Configuration

See `.env.example`. `WORKER_CONCURRENCY` controls active worker jobs. `MIN_DELAY_MS_BETWEEN_SENDS` spaces sends per sender using Redis. `MAX_EMAILS_PER_HOUR_PER_SENDER` caps hourly reservations, keyed by UTC hour. PostgreSQL, Redis (AOF enabled), and Elasticsearch are persistent Docker services.

## Architecture and trade-offs

- `planSchedule` is a pure ordered planner shared by campaign creation and preview. It rotates senders, applies a per-sender spacing interval, and moves overflow to later UTC hour windows.
- Campaign rows and queued events are inserted with pre-generated IDs in one database transaction with a 60-second timeout. BullMQ receives deterministic `email:<emailId>` job IDs in bulk. Redis AOF and PostgreSQL volumes retain queue and application state across container restarts.
- Workers pass the Redis sender-spacing gate before conditionally claiming `scheduled` rows or `processing` rows stale by two minutes. Startup recovery resets stale rows and repairs scheduled rows without queue jobs. The send itself is at-least-once across the narrow failure window after SMTP accepts mail but before the database commits; SMTP has no general idempotency key, so exactly-once delivery cannot be guaranteed. The row claim prevents ordinary duplicate work.
- Hourly reservations use an atomic Redis Lua increment/undo. The hourly key uses UTC windows. The global hourly setting is applied per sender. Slack rate-limit notices are deduplicated by sender and hour.
- BullMQ delayed jobs, not cron, handle all scheduling. Elasticsearch is a derived search index and is updated when emails are queued, sent, or fail.
- OAuth is required for dashboard APIs. A standalone email/password form is shown to mirror the reference, while account sign-in uses Google OAuth.

## Features mapped to the assignment

- Campaign create/preview and bulk queueing: `backend/src/routes/campaigns.ts`, `backend/src/services/campaigns.ts`.
- Persistent queue, sender gate, rate limiting, crash recovery and Ethereal delivery: `backend/src/worker/`.
- Slack OAuth and notifications: `backend/src/routes/slack.ts`, `backend/src/services/slackNotifier.ts`.
- Search, email lists/events, stats and sender endpoints: `backend/src/routes/emails.ts`.
- Compose/upload/preview and dashboard components: `frontend/src/App.tsx`, `frontend/src/components/`, `frontend/src/api.ts`.
- Docker services and environment template at repository root.

## Assumptions

- Chosen default delay is **1 second between sends from the same sender** (`MIN_DELAY_MS_BETWEEN_SENDS=1000`). It is a conservative demo value that keeps scheduling responsive while visibly spacing messages. Set a longer delay for real provider policies. The default per-sender cap is 100 messages per UTC hour; both are configurable.
- Senders belong to one authenticated user. Each compose action creates a campaign and deduplicates recipients case-insensitively.
- The screenshots use placeholder data for their list/detail examples; the dashboard displays the authenticated user's real queued/sent data.
- Gmail/Google and Slack credentials are provisioned outside the repository. Do not commit real secrets.

## Development checks

Run planner tests and the Redis Lua integration test with `npm test`; Redis must be running, and `REDIS_TEST_URL` can point the test at a dedicated Redis instance. Preview a 1,200-recipient schedule distribution with `npm run loadtest --workspace backend` after configuring a user and sender.
