# SML platform deployment

This folder is the deployment shell for the existing `news-engine`, `group-subs`, and `db` modules.

## Safety properties

- Database credentials only enter services through Render's `fromDatabase` binding in `render.yaml`.
- The API health check fails closed with HTTP 503 when Postgres is unavailable.
- The API and worker drain their Postgres pools on `SIGTERM` and `SIGINT`.
- The API service alone runs migrations in Render's pre-deploy stage. A migration failure cancels that deployment rather than exposing a partially deployed API.
- The worker enforces the third-failure/72-hour subscription cutoff and drains
  the idempotent billing outbox for Loop Bucks, membership reconciliation, and
  seller dispute recovery.
- The worker drains at most three article jobs per minute. It stays online but
  disables publishing when any AI or WordPress credential is absent.
- The WordPress gateway at `POST /v1/wordpress/events` is disabled until
  `SML_WORDPRESS_WEBHOOK_SECRET` is configured in Render. It uses HMAC-SHA256,
  a five-minute timestamp window, a 64 KiB body limit, and a database-backed
  event-id ledger to reject replays. Accepted events are recorded only; they
  cannot yet publish content, charge anyone, or change access.

## Local validation

```powershell
npm install
npm test
```

`npm run db:dry-run`, `npm run db:migrate`, and `npm run db:verify` require `DATABASE_URL`. Do not place production credentials in a committed file. In Render, `render.yaml` supplies that variable from the private database connection.

## WordPress gateway setup

After the D4 deployment is healthy, set one high-entropy value as
`SML_WORDPRESS_WEBHOOK_SECRET` in the **API service's** Render environment and
configure the identical value in the matching WordPress sender. Never commit,
log, or paste the value into a chat. The request contract is intentionally
small and documented alongside the sender at `../../wpcode/sml-platform-gateway.php`.

## Deployment

Commit this folder together with `news-engine`, `group-subs`, and `db` to the repository that Render will connect. Create the Blueprint from `render.yaml`. It creates the API and worker only; the existing `sml-platform-db` is referenced by name and is not recreated.

## Make.com replacement: SML NEWS article pipeline

The API accepts the same essential contract observed in the former Make
scenario: one `source_url`. The endpoint is authenticated and queues work; it
never performs OpenAI or WordPress calls inside the webhook request.

```http
POST /v1/news/articles
Authorization: Bearer <SML_NEWS_INGEST_TOKEN>
Content-Type: application/json

{"source_url":"https://publisher.example/story"}
```

Duplicate protection exists in three layers:

1. PostgreSQL has a unique SHA-256 source URL key.
2. Generated slugs carry a source-hash suffix.
3. The WordPress companion plugin rejects an already-seen source hash.

The worker fetches only public HTTPS sources, blocks private/loopback targets,
limits downloads, produces schema-validated structured output with the OpenAI
Responses API, checks article length and near-duplicates, uploads the source
image, verifies that its WordPress application password belongs to
`/stockmarketloop/` with display name `SML NEWS`, and then publishes. A failure
retries at most five times with backoff; permanent source, author, and quality
failures are rejected rather than published.

Required Render secrets:

- API: `SML_NEWS_INGEST_TOKEN`
- Worker: `OPENAI_API_KEY`, `SML_WORDPRESS_USERNAME`,
  `SML_WORDPRESS_APP_PASSWORD`

Install and activate `plugins/sml-news-render-publisher-100` before enabling
the upstream sender. Keep the Make scenario inactive during parallel testing;
only redirect the upstream webhook after a dry-run source completes and the
created WordPress post shows `SML NEWS` as its author.
