# Making Easy Money Academy Bot

This is a separate Discord application and Render web service. It does not use
the StockMarketLoop Connect application ID, public key, or bot token.

The Academy service shares the platform PostgreSQL database so existing linked
Discord identities, paid membership entitlements, curriculum records, student
progress, quizzes, badges, and audit records remain authoritative in one place.
It does not duplicate billing or role-reconciliation logic.

## Runtime boundary

- Start command: `npm run academy`
- Health check: `GET /health`
- Discord interaction endpoint: `POST /v1/academy/interactions`
- Render service: `making-easy-money-academy`

## Required environment

- `DATABASE_URL`
- `SML_ACADEMY_ENABLED=1`
- `SML_ACADEMY_PUBLIC_KEY`
- `SML_ACADEMY_APP_ID`
- `SML_ACADEMY_BOT_TOKEN`
- `SML_ACADEMY_GUILD_ID`
- `SML_ACADEMY_CATEGORY_ID`
- `SML_ACADEMY_MANAGER_ROLE_ID`

Register guild commands with `npm run academy:register -- --apply`. Provision
the approved Academy channels with `npm run academy:setup -- --apply`. Both
commands are non-mutating dry runs unless `--apply` is explicitly present.

In the Discord Developer Portal, set the interaction endpoint to:

`https://<academy-render-host>/v1/academy/interactions`

The Academy bot should receive only the permissions required for its learning
channels. Payment, dispute, global moderation, and Connect administration
commands remain outside this bot.
