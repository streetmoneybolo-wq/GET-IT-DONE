# Phase 3 — Homepage Bootstrap: production verification report (2026-08-26)

## What shipped
- **Endpoint:** `GET /wp-json/sml-home/v2/bootstrap` — WPCode snippet "SML Home Bootstrap — aggregated read API" (hash `4f6985bab58eda7e`), Active.
- **Consolidates 6 read routes:** loopbucks(`/sml-lb/v1/me`), gates(`/sml-lb/v1/gates`), leaderboard(`/sml-lb/v1/leaderboard`), milestones(`/sml-lbm/v1/state`), watchlist(`/sml-members/v1/watchlist`), creatorGate(`/sml-creator-gate/v1/status`).
- **Stage:** `compat-adapter` — each component is fetched by internally dispatching its existing authoritative route (`rest_do_request`) as the current user. Honest label in every response; NOT represented as extracted-logic optimization. Shared-service extraction is the documented next step.
- **Client:** `js/home-feed.js` fetch shim front-runs one bootstrap and serves each panel's own GET from it; missing route / 403 rollout / error → transparent fall back to the 6 singles. Kill: `?hfboot=0`.

## Safety properties (verified)
- Authenticated only; `Cache-Control: private, no-store` (never edge/public cached). Logged-out → **401** (no data leak) — verified live.
- Per-user transient cache key `sml_home_boot_v2.1_{uid}`, TTL 15s; cache **hit** verified on 2nd rapid call.
- Isolated failure: each component wrapped in try/catch; a failure returns that component `null` + `component_status[x].status='error'`; others still return. No mutation on GET (earn/charge/publish/follow excluded — `sml-lb/v1/earn` remains a separate explicit request). No external HTTP (all local dispatch).
- **Admin-only rollout (phase 1):** `SML_HOME_BOOT_AUDIENCE='admins'` → non-admins get 403 and keep the UNCHANGED legacy 6-call path. Widen later by flipping to `'all'`.

## User-state behavior
- **Logged-out:** 401, no data. ✓ verified
- **Administrator:** full consolidated data, 6 routes served from 1 bootstrap (0 separate network calls), component status populated. ✓ verified
- **Premium / standard member:** phase-1 gate returns 403 → client uses the existing per-route path, **identical to pre-change behavior** (their permission checks and data unchanged). This is the intended phase-1 state. Direct multi-account verification requires non-admin credentials (not available this session).

## Measurements — 10 runs (5 cold-URL, 5 warm), admin, signed-in
LCP/FCP: **not measurable in this harness** (the Browser pane emits no paint-timing entries). Needs a real Chrome/Lighthouse run — flagged, not fabricated.

| metric | median | p95 | note |
|---|---|---|---|
| Homepage TTFB | 2306 ms | 2676 ms | WP.com server floor — unchanged by this phase |
| Bootstrap duration (client-observed) | 2352 ms | 13814 ms | median ≈ one round-trip; p95 outlier = WP.com request queueing |
| Bootstrap **internal compute** | ~30 ms | — | from `total_ms` + component_status |
| — gates | 8 ms | 10 ms | 16–19 queries |
| — leaderboard | 7 ms | 9 ms | 1 query |
| — milestones | 7 ms | 8 ms | 16–17 queries |
| — loopbucks | 2 ms | 3 ms | 2–3 queries |
| — watchlist | 1 ms | 1 ms | 0 queries |
| — creatorGate | 1 ms | 1 ms | 0 queries |
| Initial API requests | 4 | 4 | bootstrap + counts-batch + earn(mutation) + admin-ajax |
| Initial JSON requests | 4 | 4 | same |
| Initial total requests | 34 | 34 | was 84 at baseline |
| DOMContentLoaded | 2502 ms | 3873 ms | was 3393 ms baseline; 13.5 s in original audit |
| LCP | n/a | n/a | not measurable in pane |
| Error rate | 0 | 0 | 0/10 runs, 0 failed requests |

## Interpretation
- **Request count is the win:** homepage API 47 → **4** (3 data reads + 1 explicit mutation). The 6-panel parallel queueing (4–7 s each at baseline) is gone — the endpoint's real compute is ~30 ms.
- **TTFB / bootstrap median (~2.3 s) is the WP.com platform response floor**, not this endpoint. The p95 13.8 s outlier is server-side request queueing at the host. Both require server-level work outside this session's access; documented, not claimed fixed.
- Target "~3 initial API requests": at 4 total, 3 of which are data (bootstrap, counts-batch, admin-ajax) + 1 mutation (earn, correctly not consolidated).

## Files / rollback
- Endpoint: WPCode "SML Home Bootstrap — aggregated read API" — **deactivate to roll back** (route 404s → client auto-falls-back to 6 singles).
- Client: `js/home-feed.js` (commit bf35810) — `?hfboot=0` disables consolidation per-request; revert commit to remove entirely.
- Widen rollout: set `SML_HOME_BOOT_AUDIENCE` to `'all'` in the snippet. Narrow: back to `'admins'`.
