# Group Pro Tools

The Academy's live analytics, offered inside StockMarketLoop groups.

## Tools
| Tool | What it shows | Source engine |
|---|---|---|
| Setups | Per horizon (day, swing, mid, long): long or short lean, entry, stop, targets from chart structure, risk-to-reward, 0-100 score and grade, evidence for and against, what invalidates it, a short-selling warning with a defined-risk alternative | `academy-setups.js` (MEM ALGO, patterns, smart-money, order book, absorption, short data, sentiment, earnings) |
| Absorption meter | -100..+100: buyers absorbing selling vs sellers absorbing buying, from the tape (tick-rule aggressor volume vs actual price move) blended with the Level 2 reader, persistence, and recorded 5-minute outcomes when enough exist | `academy-absorption.js` |
| Options strategies | From the live chain: long call/put, vertical debit and credit spreads, protective put, collar, covered call. Legs, cost, max profit/loss, breakevens, chance of profit, net Greeks, leverage or hedge coverage, expiry P/L curve, liquidity and spread warnings | `academy-strategies.js` (BSM from `academy-options-calc.js`) |
| Dark pool | Off-exchange share vs typical, where off-exchange volume clusters, largest prints, buy/sell lean, with a plain caveat that this is not an institutional-order feed | `academy-dark-pool-summary.js` |
| Dashboard | One row per group ticker: price, day change, sentiment, absorption, dark pool share, best setup, earnings date. The list is curated by analysts, moderators and the owner (max 12) | `academy-group-tools.js` |
| Sentiment | The Academy sentiment read (news, social, options, market) | `academy-sentiment.js` |

## Architecture
```
Group page (JS) -> WordPress sml-gpro/v1/run -> signed POST -> platform /v1/group-tools/run -> engines
```
- WordPress decides access (`plugins/sml-group-pro-tools/includes/access.php`): not a member = refused; free member = **preview**; Premium, analyst, moderator, admin, owner, site admin = **full**.
- The platform route is signed with the existing billing bridge secret (HMAC-SHA256 over `timestamp.body`, 5-minute window), so no new secret is needed. Preview trimming happens on the platform, so a preview request never receives the full payload.
- Short caches on both sides (WordPress transients 6-20 s, platform memo 6-25 s) keep a busy group from multiplying vendor calls. Per-group rate limit: `GROUP_TOOLS_RATE_PER_MIN` (default 600).
- `GROUP_TOOLS=off` disables the platform side.

## Honesty rules built in
- Every card shows its evidence, including the evidence against, and what invalidates it.
- Unknown inputs are left out and say so (no neutral defaults). No chain means no strategies, not invented prices. A strike far from the level a hedge needs is not offered.
- Absorption needs live prints; with too few it says so.
- Dark pool is labelled as off-exchange prints, not institutional flow.
- Everything carries the educational-only disclaimer. Nothing places an order.

## Install
1. Deploy the platform (route `/v1/group-tools/run`).
2. Install `plugins/sml-group-pro-tools` on the site (needs `SML_PLATFORM_BILLING_API_SECRET` and base URL, already present for the billing bridge).
3. Optional: set the group's ticker in its profile so the Setups tab opens on it.

## Tests
`npm test` (Node engines, route) and `php plugins/sml-group-pro-tools/tests/php-test.php` (access, signing, caching, error mapping).
