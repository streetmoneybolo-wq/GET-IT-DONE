# SML platform deployment

This folder is the deployment shell for the existing `news-engine`, `group-subs`, and `db` modules.

## Safety properties

- Database credentials only enter services through Render's `fromDatabase` binding in `render.yaml`.
- The API health check fails closed with HTTP 503 when Postgres is unavailable.
- The API and worker drain their Postgres pools on `SIGTERM` and `SIGINT`.
- The API service alone runs migrations in Render's pre-deploy stage. A migration failure cancels that deployment rather than exposing a partially deployed API.
- The worker only checks database connectivity until D-7 and D-8 wire the existing subscription and news modules to real upstream adapters.
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
