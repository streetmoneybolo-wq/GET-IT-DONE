# StockMarketLoop multi-author newsroom

## Editorial model

The fifteen new bylines are transparent automated editorial desks, not fictional people. Each desk owns one exclusive beat. An event specialist wins before a sector specialist, so an earnings result for a semiconductor company belongs to **SML Earnings Desk**, not **SML Semiconductors & AI**.

1. SML Options Flow
2. SML Gamma & Volatility
3. SML Earnings Desk
4. SML Filings & Corporate Actions
5. SML Analyst & Valuation
6. SML Institutional Ledger
7. SML Insider Activity
8. SML Short Interest Watch
9. SML Macro & Policy
10. SML Semiconductors & AI
11. SML Biotech & Healthcare
12. SML Energy & Commodities
13. SML Banks & Financials
14. SML Consumer & Retail
15. SML Small-Cap Risk Desk

The existing SML NEWS, Stock Market Loop Signals, and Stock Market Beginners identities stay separate and are not repurposed.

## Market-data inputs

- Options desks: live option chain, Greeks, volume, open interest, IV and underlying snapshot.
- Earnings desk: earnings calendar/history, reported EPS/revenue, guidance and quote/candle snapshot.
- Filings desk: SEC accession/form/date plus issuer action data for splits, dividends and buybacks.
- Ownership desks: institutional, shareholder and insider change datasets.
- Short desk: short interest, short volume and days-to-cover data.
- Macro desk: economic calendar, macro indicators, FedWatch and advance/decline breadth.
- Sector desks: scanner/hot-list shortlist, snapshots, candles, sector/industry identity and official issuer news.

All time-sensitive data must contain an `as_of` timestamp. A stale or missing required dataset produces no story. The immutable article text reports the publication-time snapshot; the embedded Ticker Terminal chart remains live and is clearly labeled as live.

## Duplicate and collision prevention

Every market event is normalized to `TICKER|EVENT_TYPE|SOURCE_EVENT_ID|MARKET_DATE`. The database has a global unique index on that fingerprint. The claim happens before AI generation, so two workers or two desks cannot write the same event. Existing source-URL and source-event uniqueness remain as additional guards. Semantic similarity moderation still runs before publishing.

## Official sources

Ingestion supplies an allowlisted list of verified regulator, exchange, or issuer URLs. SEC links are accepted from `sec.gov`; company investor-relations URLs require `verified: true` from the ingestion adapter. The model is told not to invent links, and the renderer appends the verified list independently of model output.

## SEO and rendering

- WordPress `post_author` is the configured desk user ID.
- Rank Math title, 140–160 character description and focus keyword are written as post meta.
- Each article uses the shared `css/article-styles.css` layout rather than duplicating CSS in every post.
- Stories include a live Ticker Terminal chart, internal ticker links, an official-source section, a visible desk disclosure and a risk disclaimer.
- The author profile bio discloses that the byline is an automated market-data editorial desk.

## Deployment order

1. Deploy database migration `008_editorial_desks_up.sql`.
2. Install and activate `build/sml-newsroom-author-provisioner`; verify all 15 author IDs.
3. Copy the admin notice JSON to the worker environment as `SML_NEWSROOM_AUTHORS_JSON`.
4. Deploy the Node newsroom service and shared article CSS.
5. Send one staged verified event per desk and inspect drafts/preview output.
6. Enable publishing desk-by-desk only after author, chart, official links, timestamp, metadata and duplicate suppression pass.

Do not enable all fifteen at once. A desk with no verified data adapter or no configured WordPress author fails closed.
