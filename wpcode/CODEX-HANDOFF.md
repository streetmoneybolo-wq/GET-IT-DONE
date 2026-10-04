# Codex master prompt: finish the AdSense "no publisher content" fix + Academy rollout

## Paste this to Codex

You are finishing a production fix for stockmarketloop.com (WordPress, Rank Math, WPCode, many `SML *` plugins) and the Node service in `services/sml-platform`. Repo: `streetmoneybolo-wq/GET-IT-DONE`. Work on branch `fix/adsense-thin-screens` (PHP) and branch `deploy/node-platform` (Node, auto-deploys on Render; never force-push it).

### Problem
Google AdSense rejected the site: "Google-served ads on screens without publisher-content" (low-value content, under construction, alert/navigation/behavioural screens). Goal: only pages with real written content are indexable and ad-eligible; app, account, sign-in and utility screens are noindex and never show ads; then get the site re-reviewed.

### Already done (verify, don't redo)
1. `wpcode/seo-adsense-thin-screens.php`: noindex (wp_robots, Rank Math filter, X-Robots-Tag), Rank Math sitemap exclusion, and `sml_adsense_screen_allowed()` (true only on single `post`). Includes `/watch/` as thin. Live copy may be one version behind: confirm the WPCode snippet matches the repo file.
2. 33 utility pages noindexed via Jetpack meta `jetpack_seo_noindex` (wallet, my-account, cart, checkout, settings, creator-wallet*, etc.).
3. `SML Ticker Content` plugin (v1.0.0, from `wpcode/seo-ticker-content.php`) is active: adds About / Trading today / Holder cost model / Latest coverage sections to `/stocks/{ticker}/`. Depends on snippets `seo-ege-core.php` and `seo-ticker-augment.php` (hooks at `template_redirect` priority 0).

### Remaining work (in order)
1. **Sync + verify the snippet.** Make sure the live WPCode snippet equals `wpcode/seo-adsense-thin-screens.php`. Then, for each slug in `sml_adsense_thin_paths()` plus one `/watch/{id}/` URL, confirm via `curl`: `X-Robots-Tag: noindex` header AND meta robots noindex. Known gap: `/stock-chart/` still prints a meta `index, follow` (header is noindex). Find what emits it (Rank Math page setting or another snippet) and fix it at the source.
2. **Sitemaps.** `page-sitemap.xml` still lists noindexed pages. Confirm the `rank_math/sitemap/entry` filter works (or set Rank Math "noindex" on each page) and flush the sitemap cache. Verify with `curl https://stockmarketloop.com/page-sitemap.xml`.
3. **AdSense gating.** Find where (if anywhere) the AdSense script is injected (theme, Site Kit, Rank Math, a snippet, auto-ads). Wrap it in `if ( function_exists('sml_adsense_screen_allowed') && sml_adsense_screen_allowed() )`. Ads must NOT render on: homepage, `/stocks/*`, `/watch/*`, `/stock-chart/`, account/app pages, 404, search. Confirm no `adsbygoogle` / `pagead2` in the HTML of those URLs.
4. **Watch pages.** `/watch/{id}/` video pages are ~160-220 words (player chrome + 2-sentence description + "No transcript generated"). Decision: keep noindex unless the video has a transcript (>= 300 words) — then index and allow ads. Implement transcript detection if a reliable field exists in `loop-channel-data-api.php` / video transcript plugin; otherwise leave thin.
5. **Ticker pages.** Spot-check 10 tickers (incl. ETF `spy`, crypto `btc`, a small cap). Confirm `#sml-stc` renders, words >= ~400, no PHP warnings, no broken layout on mobile. SPY currently shows no summary box (quote check returned invalid): investigate `sml_ege_score_ticker('SPY')`.
6. **Homepage.** It is a feed with a "Loading your live market feed…" placeholder. Keep ads off. Optionally add a short, factual editorial intro block (what the site covers, link to editorial policy) as a real WP block — no generated filler.
7. **Quality sweep for AdSense.** Confirm About, Contact, Privacy, Terms, Editorial Policy, Advertising Policy, Cookie Policy pages exist and are linked in the footer; `ads.txt` contains `google.com, pub-7919811784057534, DIRECT, f08c47fec0942fa0`.
8. **Report** the exact results table (URL | robots meta | X-Robots-Tag | in sitemap | ads present) and tell the owner to click "Request review" in AdSense.

### Hard rules
- WPCode merges all "Run Everywhere" PHP snippets into one `eval()`; the merged code may contain at most 5 matches of `base64_decode(`, `eval(`, `ini_set(`, `error_reporting(` (comments count). The site is at 5/5. Never add another. Never top-level `return;`/`exit;` in a snippet. Prefer packaging new PHP as a plugin (see `SML Ticker Content`) over adding WPCode snippets.
- Never fabricate content. Every sentence on a ticker page must come from real data; omit sections with no data.
- Production changes need explicit owner approval; deactivate-to-rollback must always work. Do not print or commit secrets.
- Node side: `cd services/sml-platform && npm test` must stay green (1839 pass / 0 fail / 2 skipped). Template-literal rule in `platform/server.js`: no backticks, `${` or backslashes inside inlined browser JS.
- Commit messages must not include model identifiers.

## Tools Codex needs
- Shell with `git`, `curl`, `php` (>= 8.1, for `php -l`), `node >= 22.14`, `npm`, `jq`, `python3`.
- GitHub push access to `streetmoneybolo-wq/GET-IT-DONE` (branches above).
- WordPress admin access: ideally a **temporary application password** for a dedicated user with plugin and WPCode rights (store as an environment secret, never in chat), OR the WordPress.com MCP connector (it can edit pages, set `jetpack_seo_noindex` meta, upload/activate plugins via `zip_base64`; it cannot edit WPCode snippets).
- Optional: SSH/SFTP to the WordPress.com Atomic site (to drop a `mu-plugin`).
- Playwright/Chromium only if visually checking pages (`playwright-core`, no `playwright install`).
- Google AdSense + Search Console access (owner only): "Request review", URL Inspection.

## Skills / plugins / WP components involved
- WP plugins already active: Rank Math (robots, sitemap, canonical, JSON-LD), Jetpack SEO meta, WPCode Lite, `SML Ticker Content`, `SML Creator Analytics Runtime`, `SML Academy Chart Lab`, `SML Academy Data Bridge`, and the other `SML *` plugins.
- Codex skills worth enabling: a PHP/WordPress review skill (hooks, escaping, nonces), a SEO/robots audit skill, and a shell/curl verification skill. None are required.

## Files
- `wpcode/seo-adsense-thin-screens.php` — noindex + sitemap exclusion + ad gate.
- `wpcode/seo-ticker-content.php` — ticker content template (source of the active plugin `sml-ticker-content`).
- `wpcode/seo-ticker-augment.php`, `wpcode/seo-ege-core.php` — canonical/robots/JSON-LD/summary and the ticker scoring engine (dependencies).
- `wpcode/seo-sitemaps.php`, `wpcode/seo-robots.php` — entity sitemaps and robots.txt additions.
- `wpcode/creator-adsense-attribution.php`, `wpcode/loop-channel-data-api.php`, `wpcode/site-search-api.php` — `/watch/` URL handling and AdSense attribution (read-only context).
- `wpcode/README.md` — WPCode rules (5-match eval limit).
- `services/sml-platform/` — Node platform (Chart Lab, screener, chat); `platform/server.js`, `package.json`.
- `services/daily-social-payouts/` — Discord bots incl. Retail Trader Spotlight (`spotlight.js`).
- `services/sml-platform/SPOTLIGHT-HANDOFF-REPAIR.md` — Spotlight intake notes.

## Live endpoints for checks
- `https://stockmarketloop.com/wp-json/sml/v1/{quote|company2|market-position|ticker-alerts}?symbol=AAPL`
- `https://stockmarketloop.com/{page-sitemap,sml-stocks-sitemap,sml-video-sitemap}.xml`, `/ads.txt`, `/robots.txt`
