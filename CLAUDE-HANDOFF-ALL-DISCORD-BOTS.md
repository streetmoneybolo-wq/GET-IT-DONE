# Claude Cloud Handoff: All Discord Bots

## Authority and mission

Vaughn McNair authorizes Claude to continue the engineering, configuration, deployment, and verification of the existing Discord-bot ecosystem in this repository. Work end to end across the existing codebase, Render services, Discord applications, the Making Easy Money Discord server, and the StockMarketLoop WordPress integrations as needed to complete the owner's requested features.

This authorization covers normal in-scope operational work: inspect code and logs, edit the correct repository, run tests, register commands, configure existing applications, update existing Render services, deploy changes, repair bot-owned Discord modules, and verify behavior in Discord and WordPress.

This handoff does not contain credentials. Use existing authorized Render, GitHub, Discord, WordPress, Stripe, Upgrade.Chat, PayPal, Massive, ElevenLabs, Anthropic, and OpenAI sessions/secrets. Never print, paste, export, or commit secret values. If a required account is unavailable, ask the owner to authenticate that specific service. Do not bypass access controls or rotate credentials without explicit direction.

Destructive or financially consequential actions still require exact-target verification. Do not mass-delete messages, mass-ban/unban members, send bulk marketing email, publish financial articles, make payouts, charge/refund money, or rotate tokens merely because this handoff grants broad engineering access.

## Repository state

Authoritative checkout/branch at handoff:

```text
repository: streetmoneybolo-wq/GET-IT-DONE
branch: deploy/bot-suite-release
baseline commit before this handoff: 2a2612a76cfe353b60c6a03571412b69a963fe43
baseline subject: Fix Discord Academy unlock flow
```

The local checkout contained untracked owner files under `services/daily-social-payouts/`. They were deliberately not added to this handoff commit. Preserve any equivalent files if they appear in a future working copy:

```text
services/daily-social-payouts/.env.paypal.example
services/daily-social-payouts/config/settings.before-daily-social-optimization-20260911.json
services/daily-social-payouts/config/settings.before-mem-clone-20260910-063140.json
services/daily-social-payouts/scripts/
services/daily-social-payouts/tests/
services/daily-social-payouts/wpcode-making-easy-money-discord-connect-cta.php
```

Do not assume every Render service deploys this branch. First record each service's repository, branch, and deployed SHA. Historical worktrees and branches contain experiments; trace production before editing.

## System map

The ecosystem has separate bot identities that may share normalized backend data but must not share Discord tokens or impersonate one another.

| Component | Render process/service | Responsibility | Identity rule |
|---|---|---|---|
| StockMarketLoop Connect | `sml-platform-worker` plus API interaction routes | Account linking, memberships, platform commands, billing-related role synchronization | Must never impersonate the Academy |
| Making Easy Money Academy | `making-easy-money-academy` | Private Discord Activity, lessons, chart, scanner, narration, quizzes, progress | Owns Academy commands, OAuth, Activity, branding, and sessions |
| Daily Social Payouts | `daily-social-payouts` | Social tasks, proof, engagement, XP, leaderboards, payout records | Neutral public brand; no SML or MEM branding |
| Retail Trader Spotlight | `retail-trader-spotlight-monitor` | Read-only alert monitoring, market-data enrichment, article drafts | Separate least-privilege worker and token |
| Dispute/evidence bot | API and `sml-platform-worker`, with separate app credentials | Payment evidence, dispute cases, restricted notifications | Separate app identity; strict PII/evidence controls |
| Shared platform API | `sml-platform-api` | Database/API, provider webhooks, WordPress bridges, interaction endpoints | Shared infrastructure, not a replacement bot identity |

The Render Blueprint is `services/sml-platform/render.yaml`.

### Current Render definitions

1. `sml-platform-api`
   - root: `services/sml-platform`
   - build: `npm ci`
   - predeploy: `npm run db:release`
   - start: `npm start`
   - health: `/health`
2. `making-easy-money-academy`
   - root: `services/sml-platform`
   - build: `npm ci`
   - start: `npm run academy`
   - health: `/health`
3. `sml-platform-worker`
   - root: `services/sml-platform`
   - build: `npm ci`
   - start: `npm run worker`
4. `daily-social-payouts`
   - root: `services/daily-social-payouts`
   - start: `npm run start:daily-social`
   - disk: `/var/data`
5. `retail-trader-spotlight-monitor`
   - root: `services/daily-social-payouts`
   - start: `npm run start:spotlight`
   - disk: `/var/data`

The platform services share PostgreSQL database `sml-platform-db`. Shared storage does not authorize cross-use of bot credentials.

## Verified identifiers

```text
Making Easy Money guild: 938894329076940820
StockMarketLoop Connect application: 1537698927401377894
Making Easy Money Academy application: 1551336038713139370
Academy monarch role: 1260433215189946420
Academy daily briefing and only intended native Play/Join channel: 1551147441993285692
Academy lessons/live-chart channel: 1551459038405992488
Academy Activity URL: https://sml-platform-api.onrender.com/academy-activity/
Academy interaction route: /v1/academy/interactions
```

Connect authorization URL currently documented:

```text
https://discord.com/oauth2/authorize?client_id=1537698927401377894&scope=bot%20applications.commands&permissions=268520514
```

Resolve Daily Social Payouts, Retail Trader Spotlight, and dispute app IDs read-only from Render environment configuration and the Discord Developer Portal. Do not invent IDs.

## Secret names, not values

The Blueprint and runtime use these groups of environment variables. Inspect the deployed revision for the authoritative set.

### Platform/API/worker

```text
DATABASE_URL
SML_STRIPE_WEBHOOK_SECRET
STRIPE_SECRET_KEY
SML_BILLING_API_SECRET
UPGRADE_CHAT_CLIENT_ID
UPGRADE_CHAT_CLIENT_SECRET
UPGRADE_CHAT_PLAN_MAP_JSON
SML_NEWS_INGEST_TOKEN
SML_ALERT_ROUTER_SECRET
SML_CORPORATE_ENABLED
SML_CORPORATE_VERIFICATION_SECRET
SML_DISPUTE_EVIDENCE_ENABLED
SML_EVIDENCE_ENCRYPTION_KEY
SML_PAYPAL_ENABLED
SML_PAYPAL_ENV
SML_PAYPAL_CLIENT_ID
SML_PAYPAL_CLIENT_SECRET
SML_PAYPAL_WEBHOOK_ID
SML_CONNECT_BOT_ENABLED
SML_DISCORD_CONNECT_PUBLIC_KEY
SML_DISCORD_CONNECT_APP_ID
SML_DISCORD_CONNECT_BOT_TOKEN
SML_DISPUTE_BOT_ENABLED
SML_DISPUTE_BOT_PUBLIC_KEY
SML_DISPUTE_BOT_APP_ID
SML_DISPUTE_BOT_TOKEN
SML_CONNECT_REVIEW_URL_SECRET
SML_UC_WEBHOOK_PATH_TOKEN
SML_WORDPRESS_BILLING_BRIDGE_URL
SML_WORDPRESS_BILLING_BRIDGE_SECRET
SML_WORDPRESS_URL
SML_WORDPRESS_USERNAME
SML_WORDPRESS_APP_PASSWORD
OPENAI_API_KEY
ANTHROPIC_API_KEY
```

### Academy

```text
SML_ACADEMY_ENABLED
SML_ACADEMY_PUBLIC_KEY
SML_ACADEMY_APP_ID
SML_ACADEMY_CLIENT_SECRET
SML_ACADEMY_BOT_TOKEN
SML_ACADEMY_GUILD_ID
SML_ACADEMY_CATEGORY_ID
SML_ACADEMY_MANAGER_ROLE_ID
SML_ACADEMY_MONARCH_ROLE_ID
ELEVENLABS_API_KEY
SML_ACADEMY_ELEVENLABS_VOICE_ID
SML_ACADEMY_ELEVENLABS_MODEL
```

Verify the actual code before adding any missing ElevenLabs or Anthropic variable. Never create duplicate names by guessing.

### Daily Social Payouts

```text
BOT_RUNTIME_MODE
DATA_DIR
DISCORD_TOKEN
CLIENT_ID
GUILD_ID
BASE_SHARE_LINK
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET
```

### Retail Trader Spotlight

```text
DATA_DIR
SPOTLIGHT_DISCORD_TOKEN
MASSIVE_API_KEY
OPENAI_API_KEY
OPENAI_ARTICLE_MODEL
WP_BASE_URL
WP_USERNAME
WP_APP_PASSWORD
ARTICLE_POLL_SECONDS
```

## First priority: Academy Activity launch

The unresolved highest-priority issue is the Academy launcher inside Discord.

Confirmed diagnosis from the previous engineering session:

- The lesson module publishes a normal component with `custom_id=academy:hub:lesson`.
- The component handler converts that into the ordinary `lesson` command.
- The ordinary lesson command returns an ephemeral lesson embed.
- It does not invoke Discord's native Activity Entry Point.
- The real Entry Point command is `launch`, command type `4`, handler `2`.
- Therefore the visible button can respond without ever opening the live-chart Activity.

The baseline branch contains a commit named `Fix Discord Academy unlock flow`, but do not assume it is deployed or complete. Compare the live Render SHA with the branch, inspect the fix, and test through Discord.

### Required Academy outcome

1. Application `1551336038713139370`, never Connect, owns Academy commands, interaction endpoint, OAuth, native Activity, and branding.
2. The native Play/Join invitation exists only in channel `1551147441993285692`.
3. The lessons/live-chart channel directs members into the supported native Discord Activity flow without opening an external browser.
4. Sessions are keyed at minimum by `guild_id + discord_id` and cannot leak between members.
5. Returning members resume module, lesson, completion, XP/badges, narration position, and relevant chart state.
6. Text lessons remain only a clear fallback if Activity launch is unavailable.
7. Hub publication is idempotent and does not create random duplicate invitations.

### Academy workspace requirements

- 101 lessons across 28 modules.
- Responsive live chart with visible bottom/time and price axes.
- Level 2/order-book teaching.
- S.I.R.E. scanner based on the actual three-minute percentage calculation.
- Full scanner below the chart.
- College-level options chain and options curriculum.
- Owner-voice narration with preload, auto-next, resume, and obvious red mute control.
- Synchronized visuals, arrows, and highlights anchored to real elements/data coordinates.
- Glossary, flashcards, quizzes, challenges, replay, progress, and badges integrated into related learning modules.
- Intro/banner media fits desktop and mobile without cropping.
- Lesson/slides reflow available chart space and never cover chart, quotes, statistics, or scanner.

Do not show implementation wording such as “AI generated,” “Claude generated,” “playing Obi's voice,” or descriptions of how the feature was built. Never present delayed or simulated data as real-time.

### Academy Discord acceptance test

1. Open guild `938894329076940820`.
2. Enter lessons/live-chart channel `1551459038405992488`.
3. Use its primary Academy action.
4. Launch/join the Making Easy Money Academy Activity inside Discord.
5. Confirm the authenticated member's next lesson is selected.
6. Confirm chart, axes, lesson, scanner, narration controls, and progress work.
7. Confirm the lesson panel shifts/reflows instead of covering market data.
8. Confirm highlights remain anchored through scroll/resize.
9. Confirm the scanner is below the chart and the options chain is usable.
10. Join with a second account and prove independent state.
11. Close/reopen and prove each account resumes separately.
12. Confirm no Connect identity appears in the Academy invitation or commands.
13. Confirm native Play/Join remains confined to `1551147441993285692`.
14. Remove obsolete bot-owned duplicate invitations without deleting member content.

## Bot-specific rules

### StockMarketLoop Connect

- Application ID `1537698927401377894`.
- Handles shared platform/account capabilities and membership/billing role synchronization.
- Must not register/respond as the Academy.
- Audit command ownership by application ID before registration.
- WordPress newsroom identity remains `SML NEWS` with handle `SMLNEWS`.
- Vaughn McNair's nickname/handle is Grandmaster-Obi. Never overwrite SML NEWS with that identity.

### Making Easy Money Academy

- Application ID `1551336038713139370`.
- Separate web service and Discord Activity.
- The daily briefing provides realistic, actionable goals for average members: savings, portfolio funding, budgeting, debt/risk management, emergency reserves, and financial-freedom habits.
- Academy channels may have attractive standalone animated banner posts, but do not attach banners to every response or produce repeated Activity invitations.
- Consolidate glossary, flashcards, and quiz features into the related lesson/module experience instead of recreating deleted command-only channels.

### Daily Social Payouts

- Public name is `Daily Social Payouts`.
- Never use `StockMarketLoop Social Rewards`, MEM, or SML public branding.
- Own token/application.
- Payouts require verified identity, amount, policy, idempotency, and audit logs. A Discord click alone is not payment authorization.

### Retail Trader Spotlight

- Separate read-only monitoring worker/token.
- Watches authorized alert channels, normalizes alert data, enriches it through Massive, and creates article drafts.
- Draft-first: do not publish without explicit owner approval or a separately approved bounded automation.
- Calculate peak price/time, elapsed time, and gains using timestamped source data, timezone handling, and corporate-action adjustments.
- Private or missing channels must not crash the worker.
- Upload supplied alert images to WordPress media with accurate alt text and attach them to the correct draft.

### Dispute/evidence bot

- Separate identity and least privilege.
- Evidence/payment data requires encryption, role-based access, redaction, audit events, and retention rules.
- Never expose emails, payment IDs, documents, or case details in public Discord.
- A dispute is not proof of fraud. Access policy follows verified provider state and approved rules.

## Shared analytics and privacy

Bots may write normalized, idempotent events to the platform, for example:

```text
discord.guild.joined
discord.member.linked
academy.lesson.started
academy.lesson.completed
academy.quiz.completed
social.task.completed
social.payout.approved
spotlight.alert.observed
spotlight.article.drafted
billing.subscription.verified
billing.renewal.due
dispute.case.opened
```

Requirements:

- Keep raw identifiers separate from aggregate reports.
- Restrict analytics to authorized administrators.
- Pseudonymize where identity is unnecessary.
- Document source, purpose, retention, and deletion flow.
- Analytics failure must not block core bot operation.
- Never scrape Discord emails; Discord guild membership does not grant them.
- Stripe/Upgrade.Chat emails may be ingested only with proper authority, purpose, privacy notice, and controls.
- Marketing email needs consent, unsubscribe handling, and suppression lists.
- Do not auto-ban by email without verified account linking and an approved policy.
- Reconcile paid state using signed webhooks/provider APIs and fail safe when ambiguous.

## WordPress integrations

Relevant plugin directories:

```text
plugins/sml-academy-data-bridge
plugins/sml-platform-billing-bridge
plugins/sml-connect-migration-hub
plugins/sml-newsroom-queue
```

Verify the live plugin version before changing any API contract. Draft before publishing unless the owner explicitly authorizes publication. Keep the newsroom author identity separate from personal nicknames.

## Tests and commands

From `services/sml-platform`:

```text
npm ci
npm test
npm run db:status
npm run db:dry-run
npm run db:verify
npm run academy:register
npm run academy:setup
```

Do not run production migrations until the dry run and target database are confirmed. `db:release` must remain additive and idempotent.

Canonical scripts at baseline:

```text
scripts/ai-orchestrator.js
scripts/register-academy-commands.js
scripts/register-connect-commands.js
scripts/setup-academy-channels.js
```

From `services/daily-social-payouts`:

```text
npm ci
npm run check
```

External-write commands such as command registration or server provisioning require verified application/guild IDs before execution.

## Deployment workflow

1. Fetch this branch and inspect status before editing.
2. In Render, record each affected service's repo, branch, deployed SHA, build/start command, and latest successful deploy.
3. In Discord Developer Portal, verify each application's ID, bot identity, interaction endpoint, OAuth redirects, Activity mappings, intents, and installation contexts.
4. Map each application to exactly one token variable and intended process.
5. Reproduce the issue and locate the authoritative code.
6. Make the smallest coherent fix.
7. Add tests for routing, identity separation, authorization, retries, and idempotency.
8. Run the relevant full suites.
9. Review the diff for secrets, branding leakage, and unrelated changes.
10. Commit/push the intended branch.
11. Deploy only affected services.
12. Check health/logs without exposing secrets.
13. Register commands only for the verified application.
14. Verify Discord functionality inside Discord, not only through a browser URL.
15. Verify WordPress/billing side effects when changed.
16. Report deployed SHA, services changed, tests run, live checks, and remaining limitations.

Never call a feature live because it exists locally. “Live” requires a confirmed deployed commit and successful production behavior check.

## Begin here

1. Fetch `origin/deploy/bot-suite-release` and read this document completely.
2. Inspect `services/sml-platform/render.yaml`, the Academy server/runtime/command code, and the recent commit history.
3. Inspect live Render service mappings and deployed SHAs without revealing secrets.
4. Verify the Academy application's Interaction Endpoint URL, OAuth redirects, Activity URL mapping, and registered `launch` Entry Point command.
5. Compare the live Academy revision with baseline commit `2a2612a` and the diagnosed component-to-text-lesson routing problem.
6. Repair and test the Academy Activity launch first.
7. Verify it in Discord using the Academy identity and specified channels.
8. Then audit Connect, Daily Social Payouts, Spotlight, and dispute bot identity/token/command isolation in that order of operational risk.

Keep a concise change log. If access is unavailable, identify the exact account/service that needs owner authentication and why; never ask the owner to paste a secret into chat.
