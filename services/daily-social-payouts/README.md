# Daily Social Payouts

A neutral-brand `discord.js` v14 bot for posting assignments, returned-link tracking, engagement proof, payout records, XP, and leaderboards. Its public Discord identity must not use StockMarketLoop or Making Easy Money names, logos, descriptions, status text, or onboarding copy.

Run the separated production identity with `BOT_RUNTIME_MODE=daily-social`. In this mode the bot registers only social-reward commands and does not start article monitoring, site account linking, role synchronization, membership security, branded onboarding, Telegram forwarding, or community moderation jobs.

## What it tracks

- `/share` and `/news` packages created by a Discord user.
- Platform choices inside Discord and first-party outbound redirect clicks.
- Replies made directly to a bot-created share message.
- `🚀` boosts, `⬆️`/`👍` upvotes, and `🔁` repost signals added as Discord reactions.
- XP and leaderboards derived from those bot-observed Discord events.

An outbound click means the visitor reached a platform composer. It does **not** prove that a post was published and never awards share XP. External posts, Reddit votes, Stocktwits replies, and Facebook activity remain unverified until an official OAuth integration is added.

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and fill in the Discord application values.
4. In the Discord Developer Portal, enable the **Message Content Intent** if reply tracking is wanted.
5. Invite the bot with `bot` and `applications.commands` scopes.
6. Give it View Channels, Send Messages, Embed Links, Read Message History, Add Reactions, and—only if `/boost` should manage an opt-in role—Manage Roles.
7. Keep the bot role above the configured boost-notification role.
8. Run `npm start`.

Set `TRACKING_API_URL` to the StockMarketLoop tracking endpoint and set `TRACKING_SECRET` to the same integration secret stored by the `sml-discord-share-tracking` WordPress plugin. The bot never sends a raw Discord user ID to WordPress; it sends a keyed pseudonymous actor value.

Use `/tracking` to view measured links and clicks. Its output deliberately keeps those metrics separate from verified external posts.

## Three-channel article workflow

Run this once as a member with Manage Server:

```text
/share-setup source:#article-intake sharing:#share-this engagement:#article-discussion
```

When a Manage Server member posts an article link in the intake channel, the bot creates one platform-sharing card and one separate discussion card. The discussion card generates article-aware starting points privately; members must edit and submit their own comments and must perform any vote themselves. Repeated copies of the same canonical article are suppressed for 24 hours.

Guild slash commands are registered on startup and normally appear quickly.

## Automatic article feed

`articleFeed` in `config/settings.json` replaces the article supply the isolated
daily-social identity lost: the retired monolith pushed its own published articles
into the share workflow, and that subsystem does not run here. The feed watcher polls
the site's public WordPress REST list (default every 10 minutes) and turns each NEW
published article into the same share + discussion package a Manage Server member
would create by hand - in every configured workflow, each with its own per-workflow
duplicate window (the same article may be packaged once per ambassador program).

Flood guards: the first run only records a baseline and posts nothing; articles older
than 24 hours are never auto-packaged; at most `maxPerCycle` (default 3) per poll with
the rest carried to the next cycle; a feed failure logs and skips. The manual intake
channel keeps working unchanged and wins no special treatment - both paths share one
package pipeline and one duplicate window.

## Notification safety

Role pings are disabled by default. To enable an already-established opt-in role, set:

```json
"allowRolePing": true
```

in `config/settings.json`, then configure `BOOST_ROLE_ID`. Members can use `/boost on` and `/boost off` to manage that role.

## Cross-server member security gate

The optional `memberSecurity` policy can remove a newly joining member from the protected server only after the bot positively confirms that the same Discord user ID is a member of a configured blocked server. It never matches on server names, usernames, or display names.

Before enabling it:

1. Add this bot to the protected server and both blocked servers.
2. Enable **Server Members Intent** in the Discord Developer Portal.
3. Set `SECURITY_GATE_MEMBERS_INTENT=1` in `.env`.
4. Put both exact blocked-server IDs in `config/settings.json`.
5. Give the bot **Kick Members** in the protected server and place its role above ordinary member roles.
6. Set `memberSecurity.enabled` to `true`, then restart the bot. On the first enabled startup, the bot takes a one-time snapshot of every existing protected-server member. Those accounts are permanently grandfathered and will not be removed, including after a later leave/rejoin.

If either blocked server is unavailable, either ID is missing, or membership verification errors, the gate fails safely and does not remove the user. Decisions are recorded privately in `data/member-security-audit.json`; the bot does not publicly identify the other server.

The grandfather snapshot is stored in `data/member-security-grandfathered.json`. Do not delete or regenerate that file after activation: doing so would change who is protected by the original cutoff.

`memberSecurity.blockInviteLinks` is independent of the membership gate. When enabled, direct `discord.gg`, `discord.com/invite`, and `discordapp.com/invite` links are resolved through Discord to their immutable destination server ID. Messages linking to a configured blocked server are removed even when a new invite code is generated. Unrelated Discord invites are left alone.

`memberSecurity.newMemberWarning` sends each newly joined member one private policy notice and the configured image. Delivery is deduplicated in `data/member-warning-log.json`; closed DMs are recorded as failed without repeatedly messaging the member. Reliable join events require Server Members Intent. A Discord system welcome-message event is also supported as a fallback, but Rules Screening must be configured in Discord itself if acceptance is required before admission.

### Exact user safety blocks

`memberSecurity.exactUserBlockEnabled` and `memberSecurity.blockedUserIds` provide a narrow stable-ID deny list that is independent of the broader cross-server membership policy. On bot startup, each configured ID is banned from the protected server through Discord's API. If a listed account joins later, the join handler bans it immediately (or kicks only as a permission fallback). Exact blocks run before grandfather and exemption checks, are audited in `data/member-security-audit.json`, and never match usernames or display names.

The bot also records new-account and rapid-join signals when `newAccountReviewDays` or `joinBurst` are configured. These signals are audit-only: account age or a busy join window never causes an automatic punishment. Discord does not provide a server-wide switch that prevents members from sending friend requests or DMs, so members should also disable direct messages and friend requests from server members in Discord privacy settings when targeted.

## Daily payout cycle

Once a day (default 15:00 UTC, `PAYOUT_DAILY_HOUR_UTC`) the bot runs the cycle this
service is named for. Three steps always run for real; the fourth is gated:

1. **Hold enforcement.** Reddit work still inside its hold window is re-verified
   against Reddit's public JSON. An entry is voided only on positive confirmation of
   removal (404, `removed_by_category`, or a deleted comment). An unreachable page,
   rate limit, or parse failure never voids anything.
2. **Payable notifications.** Each member whose held work matured gets one private DM
   per entry set — never repeated daily — with their new payable total and, if they
   have no saved payout address, how to add one.
3. **Payment step.** Members with a **confirmed saved PayPal address** (`/paypal set`)
   and a payable balance of at least `PAYOUT_MIN_USD` (default $5) are paid in **one**
   PayPal Payouts batch, oldest-waiting member first, up to `PAYOUT_DAILY_CAP_USD`
   (default $200) per run. Members are never part-paid: a member who does not fit
   under the cap is skipped whole and is first in line the next day. Idempotency:
   one payment per member per day (`daily-YYYYMMDD-{userId}` item ids), and ledger
   entries are marked paid per item with the batch id.
4. **Summary card.** A numbers-only card (no addresses) posts to the work-report
   channel: holds checked/voided, members notified, paid or previewed totals, and
   skip reasons.

Real money moves only behind three independent locks: `PAYPAL_PAYOUTS_ENABLED=1`,
`PAYPAL_PAYOUT_DRY_RUN=0`, and `PAYOUT_AUTO_DAILY=1` (or an explicit
`/payout-admin run-daily execute:true`). Any other combination makes the payment step
a preview. `/payout-admin batch-preview` shows exactly who the next run would pay and
why everyone else is skipped.

## Member payout addresses

`/paypal set` opens a private Discord modal (double-entry confirmation) that only the
bot receives; nothing is posted to any channel. The address is stored encrypted
(AES-256-GCM, key = `PAYOUT_DETAILS_KEY`, 64 hex chars) and is only ever displayed in
masked form (`j******@g*****.com`), including in the payout ledger and admin screens.
`/paypal status` and `/paypal remove` manage it. Without `PAYOUT_DETAILS_KEY` the
store is disabled and nothing can be saved — the bot never falls back to plaintext.
`/payout-admin pay` uses the member's saved address when `paypal_email` is omitted.

## Data safety

JSON writes are serialized and use a temporary-file rename to reduce corruption risk. For multiple bot processes or a large server, migrate the storage adapter to PostgreSQL rather than sharing these JSON files.

## Verification

```bash
npm run check
```

The `/news` fetcher rejects local/private hosts, credential-bearing URLs, non-HTTP protocols, excessive redirects, non-HTML responses, and pages larger than 2 MB.

## Verified alert article automation

The bot monitors configured equity-alert channels and stores the supplied Discord alert separately from market verification. Massive adjusted one-minute aggregates are the only accepted performance source; API failure stops the cycle without substituting demo, cached-vendor, or synthetic prices.

For five observed U.S. trading dates after an alert, the bot records the verified high and queues one article at the highest newly crossed milestone: 100%, 200%, 500%, 700%, 900%, or 1200%. OpenAI returns strict structured prose, while local code builds and escapes the HTML, inserts verified calculations, adds the required disclaimer, and links tickers to `/stock-chart/?symbol=...`. WordPress slugs and local job IDs provide duplicate protection.

`articleAutomation.draftOnly` is the publication switch. When it is `false`, verified jobs are published only after market facts, SEO, identity links and media pass their hard gates. When it is not `false`, the bot produces drafts for review.

### Discord alert visual evidence

For every monitored alert, the bot renders a 1200×675 PNG evidence card from the original Discord message record. The card preserves the display name, message timestamp, Discord message ID, ticker and original alert text without adding a performance claim. It is not presented as a pixel-for-pixel Discord screenshot.

The bot then:

1. Stores the PNG under `data/alert-visuals/`.
2. Uploads it once to WordPress Media using a message-ID/content-hash idempotency key.
3. Sets its media title, alt text, caption and description.
4. Embeds it immediately before the article's reported-alert section.
5. Records the attachment ID and URL in the article audit log.
6. Blocks publication when `articleAutomation.alertVisuals.required` is enabled and generation or upload fails.

Existing monitored alerts in the recent Discord history are hydrated on startup when they do not yet have a visual. Random editorial artwork remains the featured image; the Discord alert visual is embedded evidence, so their roles are not conflated.

Every generated article also has a hard identity-link gate: at least five visible mentions each of `Grandmaster-OBI` and `Making Easy Money Discord`, with every occurrence linked to `https://x.com/ObiMem` and `https://discord.gg/DBFuRWEYe7` respectively.

## Work-report channel

`workReport.channels` supports one or more server-specific audit channels. Each receives an easy-to-read per-user card showing the member, completed action, platform, work item, article link, returned public-post link, verification status, and timestamp. It records article intake links, share-composer opens, returned public post links, Discord comments, likes, upvotes, boosts, repost reactions, and reaction removals. A composer-open report is explicitly labeled as intent—not proof that an external post was published. Public post activity is treated as verified only after the member returns its public URL.

### External engagement proof

Returned-post cards provide two evidence paths. **Submit Public Proof Link** accepts a direct same-platform comment or share URL. A post URL alone cannot prove a like/upvote. **Submit Screenshot Proof** instructs the member to reply to the task message with an image and `PROOF: LIKE`, `PROOF: UPVOTE`, `PROOF: COMMENT`, or `PROOF: SHARE`. Both paths enter an admin review queue; screenshots are always marked manual review. Exact evidence and per-user task/action duplicates are rejected. The bot never asks for passwords, cookies, or session tokens, and self-reported completion is not treated as proof.

## Premium membership evidence DMs

Membership verification notices are server-specific. They are copied only to the configured `memberSecurity.premiumVerification.logChannels` entry for that Discord server, not to the work-report channel.

The bot must attach billing evidence before it asks a member to respond. The safe flow is:

1. Build a billing map with Discord user IDs and either Stripe customer/subscription IDs or an Upgrade.Chat lookup.
2. Run `scripts/import-billing-evidence-source.mjs` to pull provider facts into `data/premium-verification-source.json`.
3. Run `scripts/generate-premium-evidence-cards.mjs` to create PNG evidence cards in `data/premium-verification-evidence/`.
4. Run `scripts/audit-tk-premium-members.mjs --apply`. It sends a DM only when an evidence image exists for that member. Without evidence, the member is logged as `missing_evidence` and no removal countdown starts.

When the source record includes `membershipUrl`, `subscriptionUrl`, `portalUrl` or `manageUrl`, the member DM includes a direct quick link to the exact membership/subscription the notice refers to. The importer also keeps provider-returned Stripe invoice links and Upgrade.Chat self-service/portal/manage links when available.

The evidence card is not a fake browser screenshot. It is a provider-backed StockMarketLoop evidence card generated from Stripe or Upgrade.Chat data, with no card numbers, bank details, or unrelated purchases shown.

Required secret environment variables are listed in `.env.example`. Never commit `.env`.
