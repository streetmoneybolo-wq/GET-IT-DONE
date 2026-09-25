# Social Payouts (v2)

A `discord.js` v14 bot for social posting tasks, returned-link tracking, engagement proof, payout records, XP, leaderboards and the daily payout cycle. It is the cleaned-up rebuild of `services/daily-social-payouts`: same commands, same data files, same payout safety rules, without the legacy StockMarketLoop / Making Easy Money code that used to run inside it.

## Layout

```
index.js                     entry: storage check, one-time backup, instance lock, login, shutdown
src/bot/                     client + intents, event wiring, command registry, startup, routers, instance lock, backup
src/features/                social applications (durable reviews), message flows, reactions
src/interactions/            button and modal handlers (recruitment, proofs, engagement, sharing)
commands/                    the ten slash commands
utils/                       shared libraries (storage, tracking, payout ledger, payout cycle, PayPal, article feed ...)
tests/                       node --test suites (payout safety + platform behaviour)
```

## Commands

`/share` `/news` `/leaderboard` `/boost` `/tracking` `/earnings` `/connect-paypal` `/paypal` `/payout-admin` `/share-setup`

## What changed from the previous bot

- No leftover legacy duties: member security, protected-message/channel restore, ban reversal, Telegram forwarding, site role sync, alert monitoring and article automation are gone.
- All state is under `DATA_DIR`. The bot refuses to start on Render without it. The PayPal-info channel no longer writes a plaintext file: the email goes to the encrypted receiver store.
- Application reviews are saved to disk and re-armed on startup, so a restart never leaves an applicant waiting forever.
- One copy at a time: a heartbeat lock on the data disk stops a second copy from double-posting or double-paying.
- Settings overlays deep-merge (objects merge, arrays replace, `null` removes a key).
- Clean shutdown on SIGTERM/SIGINT; the lock is released and background jobs stop.
- `CLIENT_ID` is compared with the logged-in application at startup and a mismatch is logged.
- First start takes a one-time copy of every state file into `DATA_DIR/.state-backups/pre-v2/`.

## Environment (names only; never commit values)

Required: `DISCORD_TOKEN`, `DATA_DIR` (on Render). Recommended: `CLIENT_ID`, `GUILD_ID`.
Sharing/tracking: `BASE_SHARE_LINK`, `BOOST_ROLE_ID`, `TRACKING_API_URL`, `TRACKING_SECRET`.
Payouts: `PAYOUT_DETAILS_KEY`, `PAYOUT_MIN_USD`, `PAYOUT_DAILY_CAP_USD`, `PAYOUT_DAILY_HOUR_UTC`, `PAYOUT_AUTO_DAILY`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENV`, `PAYPAL_PAYOUT_CURRENCY`, `PAYPAL_PAYOUTS_ENABLED`, `PAYPAL_PAYOUT_DRY_RUN`.
Optional: `MEMBERS_INTENT=0` to run without the Server Members intent, `MASSIVE_API_KEY` for ticker enrichment in share copy.

Real money needs all three locks: `PAYPAL_PAYOUTS_ENABLED=1`, `PAYPAL_PAYOUT_DRY_RUN=0`, and `PAYOUT_AUTO_DAILY=1` (or a manual `/payout-admin run-daily execute:true`). Anything less previews.

## Discord Developer Portal

Turn on both privileged intents for the application: **Message Content** and **Server Members**.

## Running

```
npm install
npm test
npm start
```

## Cutting over from the previous bot

1. Stage the new application in a test server, run `/share-setup`, and watch a full cycle in preview mode.
2. Point the existing Render worker at `services/social-payouts` with the new application's `DISCORD_TOKEN`. Its disk, ledgers, receivers and settings carry over unchanged; the first start saves the `pre-v2` copy.
3. To roll back, point the worker back at `services/daily-social-payouts` with the old token. The data files are compatible in both directions (new files are additions).
