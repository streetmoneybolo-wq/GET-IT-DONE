# Academy data trust: accuracy, reliability, insight, sentiment

What changed and how to operate it. Code is in `platform/`; all new modules have tests registered in `package.json`.

## Accuracy
| Change | Where |
|---|---|
| New York market clock: daylight saving, NYSE holidays, 1 pm early closes, pre/regular/post sessions. Replaces the UTC-only `marketOpen`. | `market-clock.js` |
| Bad-print filter on the live trade stream (spike vs rolling median AND live quote mid, accepted when a second print confirms the move). Crossed quotes are dropped. Optional trade-condition exclusion list. | `data-quality.js`, `academy-massive-stream.js` |
| Buy/sell classification uses the quote only when it is current at the print, else the tick rule. Each print records which `rule` was used. | `data-quality.js` |
| Candle sanity: invalid bars dropped, OHLC envelope repaired, single-bar spike wicks repaired on intraday charts. | `data-quality.js` (`sanitizeBars`) |
| Every candle payload says `source`, `adjusted` (true / null = unknown), `lastBarAt`, `session`, `marketOpen`, `liveness` (live, lagging, closed, extended_idle), `repairedBars`. | `annotateCandles`, server candle paths |
| Options: Massive snapshot is paged (`MASSIVE_OPTIONS_MAX_PAGES`, default 4 = 1,000 contracts) and reports `pages`, `contracts`, `complete`. Options payloads now say which vendor answered (`source`) and `fallback: true` when the preferred one was skipped. | `market-data-service.js`, `tagOptionsSource` |

## Reliability
| Change | Where |
|---|---|
| Provider health registry with circuit breaker (opens after 5 consecutive failures, doubling cool-down to 5 min, one trial call when half-open) and `Retry-After` handling for 429s. Wraps Massive REST/options/indices, site history, scanner, depth, order flow, options bridge and the hub proxy. | `data-health.js` |
| `GET /health` now carries a `data` block (never fails the probe); `GET /academy-activity/data-status` feeds the toolbar chip. | `server.js` |
| Per-caller rate limit on heavy data routes (`ACADEMY_DATA_RATE_PER_MIN`, default 240) keyed by token hash or IP, with `Retry-After`. | `data-rate-limit.js` |
| SSE backpressure: a client with more than 512 KB queued is dropped and reconnects. | `sse-safe.js` |
| MEM LAB champion/runs and sentiment memory persist in Postgres (`academy_state_kv`, migration 041), adopting the old `/tmp` file on first run. | `academy-state-store.js` |
| Failure-path tests: stale serving, cold failure, empty feed, 429, circuit open, malformed input. | `academy-data-failure.test.js`, `market-data-trust.test.js` |

## Insight and sentiment
- `GET /academy-activity/sentiment?symbol=` (paid tier): composite -100..+100 from news (headline lexicon with negation and recency), social (StockTwits tags plus posting velocity vs the symbol's own baseline), options (put/call, unusual-flow premium, GEX flip, max pain) and market (SPY/QQQ, VIX). Unavailable components are reported, never counted as neutral; coverage is shown; history is kept. `academy-sentiment.js`, `market-gauges.js`.
- Earnings date is now a risk-grader factor (swing weight 9, long-term 3). Unknown date is "unavailable", not "safe". `academy-earnings-date.js`.
- UI: **SENTIMENT** panel and **DATA** status chip in the Academy toolbar (`academy-sentiment-panel.js`, `academy-data-chip.js`).

## Environment
| Variable | Default | Purpose |
|---|---|---|
| `ACADEMY_DATA_RATE_PER_MIN` | 240 | per-caller cap on heavy data routes |
| `MASSIVE_OPTIONS_MAX_PAGES` | 4 | options snapshot pages (250 contracts each) |
| `ACADEMY_TRADE_EXCLUDE_CONDITIONS` | empty | comma list of vendor trade-condition codes to drop. Fill it from the vendor's condition table; nothing is excluded by condition until you do. |
| `ACADEMY_MEM_LAB_FILE` | `/tmp/sml-mem-lab.json` | now only the first-run import source |

Apply migration `041_academy_state_kv_up.sql` before deploy (Render pre-deploy migrate runs it).

## Known limits
- VIX needs an index entitlement on the Massive plan. Without it the gauge is simply absent and the sentiment read says so.
- News sentiment is a transparent lexicon, not an ML model. It is deterministic and testable; accuracy will improve if a scored-news vendor is added.
- The data chip never claims "real-time" or "delayed": the feed class is a property of the vendor plan and is not visible to the code.
- Scanner change-rate windows (30s to 1h) still live in process memory and are blank for a few minutes after a restart.
- Earnings and options payload shapes from the moomoo bridge are not pinned; the extractor is defensive and returns unknown rather than guessing.
- No crypto/FX/futures feeds, no analyst/insider/institutional data: these need new vendors, not code.
