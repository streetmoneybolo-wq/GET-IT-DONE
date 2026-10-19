# Smart-money audit: data feeds, MEM ALGO, SMC

Where the Academy's reads come from, where they leak, and the formulas that get more out of the Massive and moomoo OpenD data the Academy already gathers. Written against the code as of migration 054. Paths are under `services/sml-platform/platform/`.

The INTENT tool (`academy-smart-intent.js`, panel `academy-smart-intent-ui.js`, route `GET /academy-activity/intent`) ships the formulas in section 3 live on the chart.

---

## 1. The holes, ranked by how much they distort the smart-money read

### Data feeds

| # | Hole | Where | Why it matters |
|---|------|-------|----------------|
| 1 | moomoo tape capped at 40 prints per poll | `academy-order-flow-service.js:44` (`ticks=40`) | SPY/QQQ print far faster than 40 prints per 1 to 2.5 s. CVD, delta, absorption, icebergs and large-print bias are built on an undersampled tape with no gap flag. |
| 2 | Massive stream drops sequence and never backfills | `academy-massive-stream.js:128-151` | A reconnect loses minutes silently. Session buy/sell totals, VWAP and blocks are then wrong for the rest of the day. |
| 3 | No trade-condition filter by default | `academy-massive-stream.js:17` | Late, out-of-sequence, average-price, derivatively-priced and benchmark-cross prints count as blocks, sweeps and dark-pool size. |
| 4 | Trade record capped at the last 50k prints, no pagination, no time filter | `market-data-service.js:105-118` | On a liquid name the "session" dark-pool read covers minutes, not the session. |
| 5 | Provider failures cached as empty for 60 s; no 429 / Retry-After handling anywhere | `market-data-service.js:117-118` | "No prints" is shown when the provider refused. Readers cannot tell data from outage. |
| 6 | Midpoint prints are neutral; the REST path is tick-rule only | `data-quality.js classifyTrade` | Most dark-pool prints are at the midpoint, so dark-pool lean is mostly unknown. |
| 7 | Options chain truncated at 1,000 contracts; GEX, put/call and max pain run on the partial chain | `market-data-service.js:186-217` | SPY/QQQ walls and flip strike can be off by strikes. |
| 8 | "Live" options stream polls a 10-minute cache | `academy-options-stream.js:16`, `server.js:4341` | Unusual activity lags by up to 10 minutes on the moomoo path. |
| 9 | No options trade tape | `news-engine/src/triggers/options.js:75-80` | Unusual activity is volume/OI only: no aggressor side, no sweep flag, dealer side inferred from a possibly stale `last`. |
| 10 | 5-minute order-flow outcomes live in memory | `academy-order-flow-service.js:22,140` | Lost on deploy, skipped when a symbol is evicted; hit rates are biased. |
| 11 | Level 2 reader uses 10 of the 60 levels fetched | `academy-order-flow.js:41` | Walls, spoofs and refills beyond the touch are invisible to the live read; only the offline replay sees the full book. |
| 12 | Timestamp mismatch between live (SIP `t`) and REST (`participant_timestamp`) | `academy-tick-bars.js:40 mergeTrades` | The same print can be counted twice; TRF reporting lag is discarded. |
| 13 | Raw depth persisted for SPY/QQQ only; no raw tick persistence; stream stats reset on deploy; `flow_days.tape_source` overwritten on every fold | `academy-depth-recorder.js`, `academy-flow-daily.js:115` | Nothing to backtest the depth formulas on, and a day can mix sources invisibly. |
| 14 | Fixed 40% "typical" dark share for every symbol; no venue split; no DIX history | `academy-dark-pool-summary.js:10` | UNUSUAL / HEAVY verdicts are not symbol-relative. |
| 15 | Staleness gaps: no age check on the newest depth snapshot, missing `asof` replaced by server time, quote size `*100` may be inflated 100x, serial 8-symbol polling with 15 s timeout | `academy-depth-insights.js:244`, `order-flow-service.js:50`, `massive-stream.js:125` | A stuck feed reads as a live book; one slow symbol stalls the others. |

### MEM ALGO and SMC

| # | Hole | Where | Why it matters |
|---|------|-------|----------------|
| 1 | No SMC outcome tracking | `academy-signal-outcomes.js` measures depth and week signals only | Order blocks, gaps, sweeps, BOS/CHoCH are never scored forward. Every SMC weight is a guess. |
| 2 | Live context stamped onto historical signals | `academy-mem-algo.js:213-391` with `academy-mem-algo-ui.js:186-217` | Today's depth, flow, dark pool and gamma are applied to every past signal, so the A to D bucket stats and "filter helped" are contaminated. |
| 3 | SMC has no smart-money inputs | `academy-smart-money.js analyze()` | Depth, CVD, sweeps, dark-pool blocks and gamma walls never validate an order block, a gap or a sweep. |
| 4 | Confidence is uncalibrated everywhere | SMC explainer, depth confidence, alert brain, radar, setups | Only SPY direction has a Brier score, and it is not fed back into weights. |
| 5 | Premium / discount uses a k=3 micro-range; HTF context is never passed | `academy-smart-money.js:172-177`, `academy-smart-money-ui.js` (fixed in this change: `htf` is now passed) | "Discount" can be the bottom of a 30-minute wiggle. |
| 6 | Weak order-block definition | `academy-smart-money.js:74-81` | Lowest-low candle, 0.05 ATR displacement, no gap or volume requirement at detection. |
| 7 | Sweeps are single-bar; pools have no age limit | `academy-smart-money.js:89-109` | Multi-bar raids are labelled "taken"; stale equal highs from months ago still count. |
| 8 | Confluence denominators vary with data; missing earnings scores as safe (10/10) | `academy-mem-algo.js:336` | Scores are not comparable across symbols or over time. |
| 9 | MEM LAB cannot test confluence or SMC; its confirmation reuses the test slice; no multiple-testing correction | `academy-mem-lab.js:39,115`, `academy-mem-lab-service.js:61` | The lab can only tune indicator vetoes. |
| 10 | Five ATR definitions, three swing definitions, two gap rules, three grade scales | mem-algo, smart-money, patterns, spy-engine, chart-intelligence | The same chart gets different numbers in different panels. |
| 11 | No time-of-day volume normalisation; no ADV normalisation for walls (200 sh) or large prints (1,000 sh / $50k) | MEM volume factor, SMC `volumeFlags`, depth walls | Opening bars always read as "high volume"; a 200-share wall means nothing on SPY. |
| 12 | Outcome metric is raw %, overlapping samples, lost horizons, no beta or ATR adjustment, no confidence interval | `academy-signal-outcomes.js` | Hit rates cannot be compared across symbols or regimes. |
| 13 | No per-candle footprint or delta | prints exist, candles are never tagged | OB, FVG and BOS candles carry no aggressor information. |
| 14 | Fixed thresholds that ignore volatility | divergence 15% / 0.08%, FVG 0.12 ATR, EQ tolerance 0.1 ATR, pressure bands 25/40/60 | The same numbers for a $5 stock and SPY. |
| 15 | Bugs that silently dropped evidence (fixed in this change) | `academy-setups.js` (structure event field, VWAP treated as an object), `academy-mem-algo.js:356` (balanced dark-pool lean scored 0), SMC explainer HTF never passed | Setups never saw VWAP targets or the last structure break; MEM confluence under-scored balanced dark pools. |

### Collected but unused by any score

Volume profile (POC / VAH / VAL), VWAP sigma bands, depth distance bands and front-load ratio, `orderStats.largeShare`, thin zones, tape velocity, dark-pool block prices and `byHour` share, the 10-session dark-pool memory, flow-ledger `bull_minutes` / `bear_minutes` / `ev_bull` / `ev_bear` / `off_vol` / `retail_net`, the recorded SPY/QQQ book history, the outcome summaries, the SPY direction calibration, and the gamma call/put walls as levels.

The INTENT tool now uses: volume profile, book walls from the full snapshot, dark-pool levels and the off-exchange buy/sell counters, the gamma walls and flip, and the SMC order blocks, gaps and pools, all fused in one liquidity map.

---

## 2. Fix list, in order

1. **Raise the moomoo tape**: request `ticks=200` or the bridge's maximum, and flag a gap when the oldest returned print is newer than the last one kept. Until then, treat moomoo-only CVD as "sampled".
2. **Backfill Massive after reconnect**: keep `q` (sequence) per symbol; on reconnect pull `/v3/trades` from the last sequence timestamp and replay through the same classifier. Expose `gapMs` in `peek().stats`.
3. **Condition filter**: exclude conditions 2 (average price), 7 (cash), 12 (form T outside the session, unless extended), 13 (extended), 20 (next day), 21 (prior reference price), 22 (price variation), 29 (seller), 33 (sold last), 52 (contingent), 53 (qualified contingent), 37 (odd lot: keep for size but do not move last). Massive's condition codes are documented in their trade conditions reference; map by id, not name.
4. **Paginate the trade record** by `timestamp.gte=sessionOpen` with `limit=50000` and the `next_url` cursor; cache per session date.
5. **Separate "empty" from "failed"**: cache `{ error, retryAfter }` on 429/5xx and surface `provider_failed` to the UI.
6. **Lee-Ready for midpoints**: at the midpoint use the tick rule against the last different price; in `sessionDarkPool` pass the quote at print time from the recorded quote tape.
7. **Full chain**: raise `maxPages` for SPY/QQQ/IWM (or filter to ±15% strikes server-side before paging) and run GEX only when `complete`.
8. **Persist outcomes**: write the 5-minute order-flow outcomes into `academy_signal_outcomes` with a `family = 'orderflow'`.
9. **SMC outcomes**: on each order-block touch, FVG touch, EQH/EQL sweep and BOS/CHoCH, stamp mid and score 1 / 5 / 15 bars forward in ATR units. One row per event, `family = 'smc'`. This is the single change that turns SMC weights from guesses into measurements.
10. **One ATR, one swing, one grade scale** in a shared `academy-market-math.js`, imported by every module.
11. **Time-of-day volume**: divide bar volume by the average for that minute-of-day over the last 20 sessions (needs 1-minute bars; `flow_days` can hold the profile).
12. **ADV normalisation**: walls and large prints as a share of ADV / 390 (one minute of ADV); report in those units everywhere.

---

## 3. Formulas that get more out of the data you already gather

All of these are implemented in `academy-smart-intent.js` and explained live in the INTENT panel. Inputs: Massive signed prints `[t, price, size, side]`, moomoo full-book snapshots every 2.5 s, dark-pool counters, the gamma chain, the chart bars.

### 3.1 VPIN: volume-synchronised probability of informed trading

Split the tape into buckets of equal volume `V` (we use `ADV / 50`, else session volume / 20). For each bucket `k`:

```
OI_k = | buyVol_k - sellVol_k | / V
VPIN = mean(OI_k) over the last 20 buckets
```

Bands: `< 0.25` balanced, `0.25-0.40` mixed, `0.40-0.60` informed, `>= 0.60` toxic. Rising VPIN means one side owns the volume; market makers widen and moves extend. Pair it with direction (sign of net flow) to know which side.

### 3.2 Kyle's lambda: price impact per unit of flow

Bin the tape by minute. For bin `i`: `dp_i` = mid change in bps, `q_i` = signed volume as % of ADV.

```
lambda = cov(q, dp) / var(q)          (OLS slope, bps per 1% of ADV)
R2     = corr(q, dp)^2
```

Reads: `lambda >= 4` high impact (thin, aggressive, informed), `1.5-4` normal, `-1.5..1.5` **absorbed** (big flow, no price change: someone is working the other side), `< -1.5` inverted (price moving against the flow: a trap or a sweep being sold into).

### 3.3 Order-sign persistence: is someone slicing a parent order?

Trade signs `s_i ∈ {+1, -1}`. Autocorrelation at lag `L`:

```
acf(L) = sum_i (s_i - m)(s_{i-L} - m) / ((n - L) * var(s))
P = mean(acf(1..5))
```

`P >= 0.25` worked order (algorithmic accumulation or distribution), `0.12-0.25` some slicing, `-0.05..0.12` random, `< -0.05` ping-pong (market making). The side is the sign of the mean of the last 100 signs.

### 3.4 Footprint: who is printing

```
p95        = 95th percentile of print sizes
largeShare = volume in prints >= max(p95, 300) / total volume
largeBias  = (largeBuy - largeSell) / largeVolume
oddShare   = volume in prints < 100 / total volume
roundShare = volume in prints that are multiples of 100 / total volume
```

`largeShare >= 0.35` institutions printing size; `oddShare >= 0.35` retail-heavy; `roundShare >= 0.5` algorithmic child orders. `largeBias` beyond ±0.25 gives the side of the size.

### 3.5 Icebergs: hidden size at a price

Over the book window (24 snapshots, 60 s): for every price that was in the top 5 levels, `shown_p` = the largest size ever displayed there, `done_p` = volume executed there by the opposite aggressor.

```
iceberg if done_p >= max(500, 3 * shown_p)
hidden buyer  when sells executed at a bid price exceed 3x its displayed size
hidden seller when buys executed at an ask price exceed 3x its displayed size
```

The ratio `done_p / shown_p` is the "refill factor". The level goes on the map with weight 2.4 (the strongest single source: it is observed, not inferred).

### 3.6 Spoofing: fake liquidity

Between consecutive snapshots `a` and `b`, for a resting order on side `S` at price `p`:

```
spoof if size_a >= 2.5 * median(side sizes)
      and |p - touch_a| >= 2 ticks
      and size_b <= 0.2 * size_a
      and the touch moved toward p
      and no print at p between a and b
```

Count by side. Two or more vanished bids = fake support, the real intent is to sell; two or more vanished asks = fake ceiling, the real intent is to buy.

### 3.7 Dark pool DIX and clusters

```
DIX = offBuy / (offBuy + offSell)      (off-exchange volume, quote-rule classified)
```

`>= 0.55` dark buying, `<= 0.45` dark selling. Clusters: off-exchange prints bucketed by price (step 1.00 above $200, 0.50 above $100, 0.25 above $20), top 4 by volume, with lean. A cluster that is also an order block or a put wall is where a block changed hands, and it goes on the map with weight 2.0.

### 3.8 Liquidity map: where they are placed

Every level the feeds know, within 12% of price, with a source weight:

| Source | Weight | Source | Weight |
|---|---|---|---|
| iceberg | 2.4 | order block | 2.2 |
| dark-pool cluster | 2.0 | equal highs / lows | 1.8 |
| call / put wall | 1.8 | book wall (>= 2.5x median, >= 200 sh) | 1.6 |
| point of control | 1.5 | fair value gap | 1.4 |
| gamma flip | 1.2 | VAH / VAL | 1.0 |
| high-volume node | 0.9 | VWAP | 0.8 |
| swing high / low | 0.7 | | |

Levels are merged within `max(0.15 ATR, 0.08%)`. Cluster score = sum of weights; price = weight-averaged. Grade `A >= 5`, `B >= 3.2`, `C >= 2`, else `D`. Role: below price, support if the buy-side sources outnumber the sell-side ones, else trap; above price, resistance if the sell-side sources outnumber, else target.

### 3.9 Intent: what they are doing

Evidence weights (positive = buyers positioning, negative = sellers):

| Evidence | Weight | Condition |
|---|---|---|
| Absorption | ∓2.2 against the flow | `\|delta\| >= 0.15` and `\|move\| <= 0.35 ATR` over the last 400 prints |
| Markup / markdown | ±1.5 with the flow | `\|delta\| >= 0.15`, move with the flow and `> 0.6 ATR` |
| Thin move | ±1.2 | `\|delta\| < 0.08` and `\|move\| > 0.8 ATR` |
| Kyle lambda absorbed | ∓1.6 against the flow | band absorbed and `\|delta\| >= 0.1` |
| Kyle lambda high impact | ±1.2 with the flow | band high impact |
| Persistence | ±1.8 (worked) / ±1.0 (some) | side of the signs |
| Footprint | ±1.3 | big prints lean beyond ±0.25 |
| Iceberg | ±2.0 | hidden buyer / seller |
| Spoof | ±1.4 | 2+ pulled on one side, opposite to the painted side |
| Dark DIX | ±1.2 | beyond 55% / 45% |

`acc` = sum of positioning evidence, `mark` = sum of trend evidence (markup, thin, structure, value-area position, VPIN with direction).

```
accumulation  acc >= 2.5 and mark <= 0.8
distribution  acc <= -2.5 and mark >= -0.8
markup        mark >= 1.8 and acc >= 0
markdown      mark <= -1.8 and acc <= 0
trap          acc and mark disagree strongly (|acc| >= 1.5, |mark| >= 1.2, opposite signs)
strength      min(100, 18 * |acc + 0.6 mark| + 8 * (number of non-zero evidence))
```

The read names the phase, the side, the evidence in plain English, and the level on the map that flips it.

### 3.10 Still to add, in order of value

1. **SMC outcome rows** (section 2, item 9): without them nothing in 3.8 can be calibrated.
2. **Per-candle footprint**: bin the signed ticks into the chart's candles; draw delta under volume and tag OB / FVG / BOS candles with their delta and absorption. The data is already in memory (`academyMassive.ticks`, now signed).
3. **Spoof and iceberg persistence**: write them to `academy_orderflow_events` so the sweep-vs-wall outcomes can score them.
4. **Replay the recorded SPY/QQQ book** through `academy-smart-intent.js` to tune the bands (VPIN, lambda, persistence) per symbol from history instead of the fixed cuts above.
5. **Gamma gradient**: `d(netGex)/dS` around spot from `byStrike`, as a pin-versus-accelerate score; add vanna and charm once the chain is complete.
6. **Time-of-day baselines** for volume, spread and VPIN from `flow_days`, so "unusual" is relative to the clock.
