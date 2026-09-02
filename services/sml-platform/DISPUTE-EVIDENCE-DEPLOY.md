# Stock Market Loop Connect — dispute & evidence system

Operations guide for the dispute-evidence subsystem added on top of the existing
billing platform (Render API + worker, Postgres, WordPress bridge, Discord role
reconciler). Everything here ships **disabled by default** and fails closed.

## 1. What it is

| Layer | Component | Where |
| --- | --- | --- |
| Schema | migration `012_dispute_evidence` (append-only ledgers, hash chains) | `group-subs/migrations/` |
| Ingestion | Stripe post-commit fan-out + catch-up sweep (`stripe-ledger.js`, `dispute-cases.js`) | API + worker |
| Ingestion | PayPal webhook (`POST /v1/paypal/webhook`, verify-webhook-signature API) | API |
| Ingestion | Upgrade.Chat wake-up webhook (`POST /v1/upgrade-chat/webhook/{path token}`) + read-only reconcile | API + worker |
| Ingestion | WordPress gateway `usage.*` events → `service_usage_events` (`usage-consumer.js`) | worker |
| Engine | pure evidence engine + provider limits + packet generator (PDF + JSON manifest, sha256) | `evidence-engine.js`, `provider-limits.js`, `packet-generator.js` |
| Review | signed admin endpoints `POST /v1/billing/disputes/*` (`dispute-service.js`) | API |
| Control | Discord interactions endpoint `POST /v1/discord/interactions` (`discord-interactions.js`, `connect-commands.js`) | API |
| Alerts | outbox intents `dispute_alert` / `dispute_deadline` → Discord DM + WordPress `dispute_notify` (`dispute-notifier.js`) | worker |
| Roles | disputed-access policy inside the EXISTING `subscription_access_reconcile` enrichment (`billing-worker.js`) | worker |
| WordPress | `sml-platform-billing-bridge` 0.4.0 (`dispute_notify` intent) + `sml-connect-dispute-admin` 0.2.0 (console, review page, admin linking) | plugins |

One factory, `platform/dispute-runtime.js`, assembles all of it for both processes.

## 2. Configuration (secret NAMES only — values live in Render)

API service:

| Name | Effect |
| --- | --- |
| `SML_DISPUTE_EVIDENCE_ENABLED=1` | turns the subsystem on (ledgers, cases, admin endpoints, sweeps). Unset = every surface 503s / worker registers nothing. |
| `SML_EVIDENCE_ENCRYPTION_KEY` | comma-separated key list. First entry encrypts and HMACs new rows; every entry decrypts/verifies old rows (rotation = prepend a new key). Required for enablement. |
| `SML_PAYPAL_ENABLED=1`, `SML_PAYPAL_ENV` (`sandbox`\|`live`), `SML_PAYPAL_CLIENT_ID`, `SML_PAYPAL_CLIENT_SECRET`, `SML_PAYPAL_WEBHOOK_ID` | PayPal REST app + registered webhook id. Missing any = PayPal webhook answers 503 and PayPal redelivers. |
| `SML_CONNECT_BOT_ENABLED=1`, `SML_DISCORD_CONNECT_PUBLIC_KEY`, `SML_DISCORD_CONNECT_APP_ID` | the SML Connect Discord **application** (must be a separate app from the share bot: an app cannot use both a gateway and an interactions endpoint). |
| `SML_CONNECT_REVIEW_URL_SECRET` | signs the 15-minute review-page approval reference. Without it non-administrator group owners cannot approve from `/connect-review/`. |
| `SML_CONNECT_REVIEW_URL_BASE` | defaults to `https://stockmarketloop.com/connect-review/`. |
| `SML_UC_WEBHOOK_PATH_TOKEN` | unguessable path segment for the Upgrade.Chat wake-up route. |
| `SML_BILLING_API_SECRET` | (existing) signs every `/v1/billing/disputes/*` call from WordPress. |

Worker service adds: `SML_DISCORD_CONNECT_BOT_TOKEN` (private DM alerts + command registration), plus the same `SML_DISPUTE_EVIDENCE_ENABLED`, `SML_EVIDENCE_ENCRYPTION_KEY`, PayPal names, and the existing `UPGRADE_CHAT_CLIENT_ID/SECRET` for the reconcile sweep.

`render.yaml` declares every name with `sync: false`; nothing is committed.

WordPress: `sml-connect-dispute-admin` reuses `SML_PLATFORM_API_URL` and `SML_PLATFORM_BILLING_API_SECRET` from the SML Platform Runtime Config plugin. Optional overrides: `SML_CONNECT_ADMIN_API_URL`, `SML_CONNECT_ADMIN_API_SECRET`.

## 2b. Owner quick start (the only steps that need your accounts)

Facts already confirmed from the live site (read-only): owner WordPress user
`258456581` (login `ben`), owner Discord user `1087769175453339648`, merchant
guild `938894329076940820` = group 7 "Making Easy Money", Stripe account
`acct_1ND1yGBpqyUyWsXe`, Discord application "StockMarketLoop Connect" already
exists in the developer portal.

1. **Render (3 minutes, one command).** Create an API key in the Render
   dashboard (Account settings → API keys), then in a terminal on your machine:

   ```bash
   cd services/sml-platform
   RENDER_API_KEY=<your key> node scripts/render-configure-dispute-evidence.js --apply
   ```

   The script generates `SML_EVIDENCE_ENCRYPTION_KEY`,
   `SML_CONNECT_REVIEW_URL_SECRET`, and `SML_UC_WEBHOOK_PATH_TOKEN` locally,
   sets `SML_DISPUTE_EVIDENCE_ENABLED=1` on both services, never rotates a key
   that already exists, and triggers both deploys. Without `--apply` it only
   prints the plan. Secret values never leave your terminal. Add
   `SML_DISCORD_CONNECT_PUBLIC_KEY`, `SML_DISCORD_CONNECT_APP_ID`,
   `SML_DISCORD_CONNECT_BOT_TOKEN`, `SML_CONNECT_BOT_ENABLED=1`, or the
   `SML_PAYPAL_*` names to the same command's environment and the script
   forwards them to the right service.
2. **WordPress (1 minute).** wp-admin → Disputes → "Merchant admins": WordPress
   user id `258456581`, Discord user id `1087769175453339648`, scope
   `platform`. Repeat with a connected-account id for any marketplace seller.
3. **Discord (5 minutes).** Developer portal → StockMarketLoop Connect →
   General Information: copy Application ID and Public Key into the Render
   command above. Bot → Reset Token → paste as `SML_DISCORD_CONNECT_BOT_TOKEN`
   (worker). After the deploy, set Interactions Endpoint URL to
   `https://sml-platform-api.onrender.com/v1/discord/interactions`, invite the
   bot to guild `938894329076940820`, then run
   `SML_DISCORD_CONNECT_APP_ID=… SML_DISCORD_CONNECT_BOT_TOKEN=… SML_CONNECT_GUILD_IDS=938894329076940820 node scripts/register-connect-commands.js`.
4. **Stripe (2 minutes).** Developers → Webhooks → the `sml-platform-api`
   endpoint → confirm the events listed in §3 step 5.
5. **PayPal and Upgrade.Chat** as in §3 steps 6–7; the Render script prints the
   exact Upgrade.Chat webhook URL to register.

## 3. Rollout sequence (what has been done vs what the owner must do)

1. **Schema** — migration 012 is applied by the API pre-deploy hook (`npm run db:release`, `SML_MIGRATION_MODE=apply`). Verify with `GET /health` → `"schema":"012"`.
2. **Code** — API + worker deploy from `deploy/node-platform` (the branch Render tracks). With the flags unset nothing changes for existing billing, subscriptions, or role automation.
3. **Enable collection only** — set `SML_DISPUTE_EVIDENCE_ENABLED=1` + `SML_EVIDENCE_ENCRYPTION_KEY` on API and worker. The worker's catch-up sweeps then back-fill `billing_events`/`billing_transactions`/`billing_subscriptions` from the existing `stripe_events` history and create `dispute_cases` for every historical `charge.dispute.*` event. Submission is impossible until an admin approves a packet.
4. **WordPress** — bridge 0.4.0 must be active before the worker delivers `dispute_notify` (0.3.0 rejects the intent with 400 and the outbox row retries with backoff). Activate `sml-connect-dispute-admin`, then link each merchant admin (WordPress user id + Discord user id + scope) on the Disputes page. Only linked admins can use the bot or approve from a review link.
5. **Stripe** — confirm the existing endpoint subscribes to `charge.dispute.created/updated/closed/funds_withdrawn/funds_reinstated`, `charge.succeeded/refunded/failed`, `refund.*`, `invoice.paid/payment_succeeded/payment_failed`, `customer.subscription.*`, `checkout.session.completed`. Dispute events feed the case projection; the rest feed the ledger.
6. **PayPal** — create a REST app (sandbox first), register `https://sml-platform-api.onrender.com/v1/paypal/webhook` for `CUSTOMER.DISPUTE.CREATED/UPDATED/RESOLVED` (plus `PAYMENT.CAPTURE.*`, `BILLING.SUBSCRIPTION.*` for the ledger), put the webhook id in `SML_PAYPAL_WEBHOOK_ID`, set `SML_PAYPAL_ENABLED=1`. Prove idempotency with the PayPal simulator (the same event id twice → second answers `duplicate`).
7. **Upgrade.Chat** — set `SML_UC_WEBHOOK_PATH_TOKEN`, register `https://sml-platform-api.onrender.com/v1/upgrade-chat/webhook/{token}` in the Upgrade.Chat developer settings. The body is never trusted; every delivery is validated and re-fetched through the authenticated API.
8. **Discord** — create the SML Connect application, set the interactions endpoint URL to `https://sml-platform-api.onrender.com/v1/discord/interactions` (Discord probes it with bad signatures; the endpoint 401s them), set `SML_CONNECT_BOT_ENABLED=1` + public key + app id on the API and the bot token on the worker, invite the bot to the merchant guild(s), then run `node scripts/register-connect-commands.js` with `SML_DISCORD_CONNECT_APP_ID`, `SML_DISCORD_CONNECT_BOT_TOKEN`, `SML_CONNECT_GUILD_IDS`. Commands are hidden (`default_member_permissions: 0`) until a guild admin grants them.
9. **Submission** — enabled by code only through the review page; there is no automatic submission path. Prove it in Stripe test mode / PayPal sandbox before any live dispute.

## 4. Webhook contracts

- Stripe: raw body, `Stripe-Signature` verified against `SML_STRIPE_WEBHOOK_SECRET` (both event destinations), stored first (`stripe_events` unique on event id), then projected post-commit. Replays and out-of-order deliveries cannot mutate a case backwards (`last_event_at` watermark) or duplicate a ledger row (`billing_events` unique).
- PayPal: 256 KB cap, per-IP + global token buckets, strict header shape, verification through PayPal's `verify-webhook-signature` API with the raw bytes spliced verbatim; `FAILURE` → 400, transport/ambiguous → 503 (PayPal redelivers), duplicates → 200.
- Upgrade.Chat: wake-up only. UUID extracted, constant-time path-token check, `GET /v1/webhook-events/{id}/validate` must return `valid:true`, body re-fetched from the API, stored as `supplemental=true` (a CHECK constraint makes it structurally non-authoritative).
- WordPress gateway: `usage.login|group_access|content_access|stream_access` accepted through the existing signed gateway; the worker copies them into the per-identity hash chain. No IP, user agent, or device data is stored (see §7).

## 5. Truthfulness safeguards (encoded, not prose)

- Origin wording comes from `billing_subscriptions.origin` derived from facts (checkout key + engine row + Stripe trial fields); `unknown` is never upgraded.
- "Disclosed automatic conversion" needs a `customer_consents` row with `trial_disclosure` + displayed price/interval; policy assertions need `terms_versions.effective_from <= charge` **and** a consent row for that identity and version.
- "Service made available" comes from entitlement/role/delivery rows; "actively used" only from authenticated `service_usage_events` of usage kinds.
- Prior payments are stated as count + dates only.
- Every assertion cites evidence item ids; an assertion without a supporting item is dropped with an `unsupported_assertion_omitted` warning; a neutrality tripwire blocks characterizing language.
- Upgrade.Chat rows appear only in the timeline (labelled supplemental) or as contradictions, never as assertions.
- Stripe fields are restricted to the reason's allowed set; PayPal evidence types to what the dispute requested/permits; file type/size/page caps are validated with real byte sizes at approval time.
- The provider mapping (fields + file plan) is inside the hashed manifest; approval must quote `packet_sha256`, so the admin approves exactly what is transmitted.

## 6. Authorization model

- Admin console: WordPress `manage_options` + nonce + signed platform call.
- Bot: Discord user → verified `billing_identities` row → verified `merchant`/`connected_account` ref (created only by administrator confirmation on the Disputes page) → merchant scope. Re-evaluated per command; every command audited in `dispute_audit_log`; ephemeral replies; per-user rate limit.
- Review link: single-use, 15-minute token (sha256 stored only). The page requires login; the platform consumes the token and authorizes only `manage_options` users or verified merchant admins of the case's scope. Approval from the page also needs the signed 15-minute review reference issued at redeem time.
- Scope isolation: any caller carrying `merchantScope` sees only `COALESCE(merchant_account,'platform') = scope`; out-of-scope cases read as not found.

## 7. Retention, privacy, and telemetry

- Raw `stripe_events` / `paypal_events` payloads: prunable after 13 months.
- Evidence items, packets, submissions, audit rows: retain 24 months past the final case outcome.
- Identity refs: retained while any live subscription or open case references them; deletion = crypto-shredding (retire the key version / null the `*_enc` columns) so chains still verify.
- IP/device telemetry: **not collected** in v1. `customer_purchase_ip` can only come from a `customer_consents` row whose checkout matches the disputed charge and only when a `privacy_policy` terms version predates its collection. Before collecting checkout IPs or any device data, publish a privacy-policy update, record it with `record-terms-version` (`docKind: privacy_policy`), and only then pass `purchaseIp` into `record-consent`.
- Logs never contain payloads, emails, IPs, tokens, or secrets (the shared logger strips secret-like keys; a source-scan test enforces the modules use it).

## 8. Incident response

| Symptom | Where to look | Action |
| --- | --- | --- |
| New dispute, no case | `stripe_events` row exists? → worker log `dispute_sweep_failed` / `dispute_case_post_commit_failed` | The catch-up sweep retries every tick; fix the logged cause. Never hand-insert cases. |
| Deadline alert missing | `billing_outbox` rows `dispute_deadline` failed? bridge 0.4.0 active? admins linked? | Check `notification_delivery_events` + audit `alert_no_recipients`. |
| Submission stuck `submitting` | `dispute_submissions.status`, worker `sweepStuckSubmissions` | The sweep asks the provider (submission_count / dispute status) — never blind-retries. |
| PayPal 503s in provider dashboard | `SML_PAYPAL_WEBHOOK_ID` set? breaker open (5 consecutive verify failures → 30 s cooldown)? | PayPal redelivers; fix config. |
| Discord endpoint removed by Discord | endpoint must 401 bad signatures — check `SML_DISCORD_CONNECT_PUBLIC_KEY` | Re-set the URL in the developer portal after fixing. |
| Suspected tampering | `store.verifyChain(table, scope)` re-derives every hash; forks are unique-constraint violations | Investigate the first broken id. |

## 9. Rollback

- Code: redeploy the previous commit of `deploy/node-platform` (Render "Rollback"), or push a revert. Every new surface is additive and flag-gated; unsetting `SML_DISPUTE_EVIDENCE_ENABLED` alone returns the platform to its prior behavior without a deploy.
- Schema: `node db/migrate.js down 012 --yes` drops the ledgers (destructive; only after exporting evidence). The `wordpress_gateway_events` CHECK is restored to its original list by the down file.
- WordPress: deactivate `sml-connect-dispute-admin`; the bridge 0.4.0 keeps working for existing intents and merely 503s `dispute_notify` (outbox retries) until an adapter exists.
