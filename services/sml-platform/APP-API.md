# StockMarketLoop App API v1

Base URL: `https://sml-platform-api.onrender.com/v1/app`
Contract date: 2026-10-12 (`GET /v1/app` returns it as `contract`).

This is the only server the phone app and the PWA shell talk to. It never sends the app to stockmarketloop.com, so the site's per-IP rate limit does not apply to app traffic. Everything is JSON (`{ ok: true, ... }` or `{ ok: false, error: 'snake_code' }`) except the live streams, which are Server-Sent Events.

## Sign-in

Members sign in with their stockmarketloop.com username (or email) and password. The platform checks them with the site through a signed server-to-server call (plugin `sml-app-identity`), then issues its own tokens.

| Call | Body | Answer |
|---|---|---|
| `POST /auth/login` | `{login, password, code?, device:{id,name,platform,appVersion}}` | `200 {ok, user, groups, wallet, extras, accessToken, accessExpiresAt, refreshToken, refreshExpiresAt, sessionId, tokenType:"Bearer"}` |
| `POST /auth/refresh` | `{refreshToken}` | `200 {ok, userId, accessToken, accessExpiresAt, refreshToken, refreshExpiresAt, sessionId}` |
| `POST /auth/logout` | `{refreshToken}` | `200 {ok}` (always, even for an unknown token) |
| `POST /auth/logout-all` | bearer | signs every device out |
| `GET /auth/sessions` | bearer | `{sessions:[{id, device, createdAt, lastUsedAt, expiresAt, current}]}` |
| `DELETE /auth/sessions/{id}` | bearer | revokes one device |

Sign-in refusals (status, `error`):

- `401 invalid_credentials` for a wrong username or password (never says which).
- `403 two_step_required` with `method` (`totp`, `email`, `backup`) and, for email, a `hint` like `v•••@example.com`. Send the same login call again with `code`. For `email` the code was just sent.
- `403 two_step_invalid`: wrong code; the account's failure counter advances.
- `403 account_blocked`.
- `429 rate_limited` with `retryAfterSec`: 10 attempts a minute per address, 10 per account name per 15 minutes.
- `503 app_auth_unconfigured`: the platform has no signing secret or the site plugin is not installed.

Tokens:

- **Access token**: `Authorization: Bearer <accessToken>`. Lives 15 minutes. Signed, not stored. When it expires every route answers `401 token_expired`: refresh and retry once. Any other 401 (`authorization_required`, `session_revoked`) means sign in again.
- **Refresh token**: lives 60 days, one per device, stored hashed. Every refresh rotates it: keep the new one, discard the old. Presenting an old one again revokes that device entirely (`401 refresh_reused`), so store it in the keychain / keystore and never retry a refresh with a token you already used.

Rate limit for signed-in calls: 600 a minute per member (streams count 5, site proxy calls count 2). `429 rate_limited` carries `retryAfterSec`.

## The member

`GET /me` → `{user:{id, login, email, displayName, handle, avatar, profileUrl, roles, registeredAt, emailVerified, twoStep:{enabled}}, groups:[{id,name,role}], wallet, extras:{wallet, profile, loopBucks, groupKick, notifications}}`. Cached for a minute; `?fresh=1` re-reads the site. `extras` are the raw answers of the site's own routes (`/sml-lb/v1/me`, `/sml-members/v1/profile`, `/sml-members/v1/loop-bucks`, `/sml-group-kick/v1/me`, `/sml-members/v1/notifications`) run as the member; `null` where a route is missing on the site.

## Market data (from the platform's own feeds, never the site)

| Call | Answer |
|---|---|
| `GET /tickers/{SYM}/quote` | `{symbol, last, quote:{bid,ask,bs,as,t}, quoteFresh, lastTradeAt, stats, tape[], asOf}`; `ready:false, warming:true` for the first second after a cold symbol is first asked for |
| `GET /tickers/{SYM}/candles?tf=5m` | `{symbol, tf, bars:[{t,o,h,l,c,v,vw,n}], asOf, source}`. Timeframes: `1m 3m 5m 10m 15m 30m 1h 2h 4h 1D 1W 1M 1Q 1Y`. Massive serves the ones it has; the rest come from the site relay with the same shape |
| `GET /tickers/{SYM}/news` | `{symbol, articles:[{title, url, ...}], asOf}` (the site's ticker-news feed, 15-minute cache) |
| `GET /scanner` | the live scanner: `{rows:[{symbol, price, change..., changeRate1min, changeRate3min (S.I.R.E.), rvol, volume, ...}], asOf, session, marketOpen, stale?}` |
| `GET /scanner/stream` | SSE. `snapshot` once (`{rows:[{s,n,p,ch,c,r1,r3,rv,v,b,a,bs,as,t}], ...}`, compact keys: symbol, name, price, change, changePct, 1-minute rate, 3-minute S.I.R.E. rate, rvol, volume, bid, ask, bid size, ask size, time), then `tick {at, rows:[...]}` where each row carries `s` plus only the fields that changed. Same feed the Academy's S.I.R.E. panel uses |
| `GET /stream?symbols=NVDA,AMD` | SSE, up to 20 symbols. `snapshot` per symbol, then `trade {symbol,p,s,t,...}` and `quote {symbol,bid,ask,bs,as,t}` (quotes coalesced to 10 a second per symbol) |

Streams: at most 4 per member. Send `Accept: text/event-stream`; a keep-alive comment arrives every 15 seconds. Reconnect with backoff on close.

## Push

Register the device, then prove it with the test route.

| Call | What it does |
|---|---|
| `POST /push/devices {platform:"ios"\|"android"\|"web", token, deviceId?, appVersion?, keys?}` | registers (or re-registers) the device for the signed-in member; a token moves to whoever signs in on that phone. iOS: the 64-hex APNs device token. Android: the FCM registration token. Web (the PWA shell): the push subscription's `endpoint` as `token` plus `keys:{p256dh, auth}` |
| `DELETE /push/devices {token}` | on sign-out or when the member turns notifications off |
| `GET /push/devices` | the member's live devices |
| `POST /push/test {title?, body?}` | sends a real push to every device of the signed-in member and returns per-device results (`{devices, sent, gone, results:[{platform, ok, status, reason}]}`). Counts 10 against the rate limit |
| `GET /push/vapid-key` | the web push application server key for `pushManager.subscribe({applicationServerKey})` |

How a push arrives:

- **iOS**: `aps.alert.title/body`, `sound`, `badge` when given, `thread-id` and `apns-collapse-id` from `collapseId`, `mutable-content: 1`. Custom `data` keys and `url` sit at the top level of the payload.
- **Android**: `notification.title/body` plus `data` (always includes `title`, `body`, and `url` when given) so the app can route a tap. Channel id is `alerts` unless the sender says otherwise; `collapseId` becomes `collapse_key` and the notification `tag`.
- **Web**: the service worker receives `{title, body, url, data, tag}` encrypted with the VAPID key above.

Dead tokens are pruned automatically: APNs `Unregistered` / `BadDeviceToken`, FCM `UNREGISTERED`, web 404 / 410 disable the device, and the next registration from that phone revives it.

**For the site** (alert plugins, Loop Kick): `POST /push/send {userIds:[...≤500], message:{title, body, url?, data?, collapseId?, ttl?, badge?}}` signed like every other site-to-platform call (`x-sml-timestamp`, `x-sml-signature` = HMAC-SHA256 over `"{ts}.{body}"` with the billing API secret). In WordPress just call `sml_app_push( $user_ids, $message )` or `do_action( 'sml_app_push', $user_ids, $message )` from the `sml-app-identity` plugin. Answers `202 {members, reached, devices, sent, gone}`.

Senders are off until their credentials exist. `GET /v1/app` shows which are on under `pushSenders`.

## The site, as the member

`GET|POST|DELETE /site/{wordpress-route}?query` runs one of the site's own REST routes as the signed-in member and returns `{ok, route, status, body}` with the site's status (also in `x-sml-site-status`). Use it for everything that lives only in WordPress: the feed, profiles, follows, groups, Loop Bucks, notifications, sentiment votes.

Allowed namespaces (prefix match): `sml-feed/v1`, `sml-feed-profiles/v1`, `sml-members/v1`, `sml-group-kick/v1`, `sml-lb/v1`, `sml-lbm/v1`, `sml-boot/v1`, `sml-hub/v1/group`, `sml-group-tools/v1`, `sml-locsec/v1`, `sml-loop-kick/v1/bootstrap`, `sml-loop-kick-post/v1`, `sml-2step/v1/status`, `sml-2step/v1/sessions`, `sml-scanner/v1`, `sml-ticker-news/v1`, `sml-sentiment/v1`, `sml-mood/v1`, `sml-tags/v1`, `sml-watch/v1`, `sml-profile-preview/v1`, `sml-friends-profile/v1`, `sml-store/v1`, `sml-storefront/v1`, `sml-sub/v1`, `sml-subscribers/v1`, `sml-gifts/v1`, `sml-emotes/v1`, `sml-group-landing/v1`, `sml-group-shell/v1`, `sml-group-score/v1`, `sml-gextras/v1`, `sml-cues/v1`, `sml-playlists/v1`, `sml-creator-videos/v1`, `sml-creator-comments/v1`, `sml-display-name/v1`, `wp/v2/users/me`.

Refused everywhere (`404 site_route_not_allowed`): anything named login, register, resend-code, webhook, reset, reconcile, admin, export, oauth, checkout, purchase-intent, upload, image. Sign-in is `/auth/login` only; purchases stay on the web until the payments decision.

Useful site routes for the first screens (shapes are the site's own; call them once from a signed-in session to see them):

- Feed: `sml-feed/v1/slot`, `sml-feed/v1/visible` (POST), `sml-feed/v1/hide`, `sml-feed-profiles/v1/strip`, `sml-members/v1/profile-feed`, `sml-members/v1/post-vote` (POST), `sml-members/v1/follow` (POST)
- Tickers from the site: `sml-members/v1/news-feed?symbol=`, `sml-members/v1/market-data/company?symbol=`, `sml-members/v1/market-data/fundamentals?symbol=`, `sml-members/v1/market-data/filings?symbol=`, `sml-members/v1/sentiment`
- Groups: `sml-boot/v1/group?group_id=`, `sml-group-kick/v1/me`, `sml-group-kick/v1/feed`, `sml-group-kick/v1/chirps`, `sml-hub/v1/group/{id}/members`, `sml-group-tools/v1/status/{id}`, `sml/v1/group/algos?group_id=` (the group's ALGO list; add `sml/v1/` to the allow list when the chart ships in the app)
- Loop Bucks: `sml-lb/v1/me`, `sml-lb/v1/earn`, `sml-lb/v1/leaderboard`, `sml-lb/v1/vault`, `sml-members/v1/loop-bucks`
- Profile and settings: `sml-members/v1/profile` (GET/POST), `sml-members/v1/notifications` (GET/POST), `sml-2step/v1/status`, `sml-2step/v1/sessions`

## Deep links and the app shell (served by the site)

The `sml-app-links` plugin on stockmarketloop.com serves the files phones look for, with a settings page for the values the builder supplies:

| URL | Purpose |
|---|---|
| `https://stockmarketloop.com/.well-known/apple-app-site-association` | iOS universal links for `TEAMID.bundleid` over the whole site except admin, API, checkout and store paths; also `webcredentials` for password autofill |
| `https://stockmarketloop.com/.well-known/assetlinks.json` | Android app links (`handle_all_urls`) and credential sharing (`get_login_creds`) for the package and every signing fingerprint |
| `https://stockmarketloop.com/manifest.webmanifest` | the PWA manifest: name, colours, icons, start URL, store listings |

Until the Team ID, bundle ID, package name and SHA-256 fingerprints are entered under Settings → SML App Links, the first two are served empty and valid. Status on 2026-10-12: Google's verifier reads the Android file fine; Apple's CDN is refused (403) by WordPress.com's bot challenge in front of the site, so iOS universal links need that challenge lifted for `/.well-known/*` first (see the plugin README). The app needs `applinks:stockmarketloop.com` and `webcredentials:stockmarketloop.com` in its Associated Domains (iOS) and an `autoVerify` intent filter for `https://stockmarketloop.com` (Android). Any site link then opens the app, which maps the URL to a screen: `/groups/{slug}/` → group, `/markets/...` → tickers, `/{handle}/` → profile, article slugs → the post.

## CORS

Browser origins `https://stockmarketloop.com`, `https://www.stockmarketloop.com`, any `https://*.stockmarketloop.com`, plus whatever `SML_APP_CORS_ORIGINS` lists (comma separated) may call every route with `Authorization` and `Content-Type` headers. Native apps need none of this.

## Platform configuration (Render, service `sml-platform-api`)

| Variable | Purpose |
|---|---|
| `SML_LOOP_KICK_BRIDGE_URL`, `SML_LOOP_KICK_BRIDGE_SECRET` | already set: the signed channel to the site, reused by the identity plugin |
| `SML_APP_TOKEN_SECRET` | optional, 32+ random characters. Signs access tokens. Until set, a key derived from the bridge secret is used. Changing it signs every app out at their next refresh |
| `SML_APP_CORS_ORIGINS` | optional extra browser origins for the PWA shell |
| `SML_APP_API` | `0` turns the whole `/v1/app` surface off |
| `SML_APNS_KEY`, `SML_APNS_KEY_ID`, `SML_APNS_TEAM_ID`, `SML_APNS_BUNDLE_ID` | iOS push. The .p8 key from the Apple Developer account (paste the PEM; `\n` for newlines is fine), its 10-character key id, the team id, and the app's bundle id. `SML_APNS_ENV=sandbox` for development builds, default production |
| `SML_FCM_SERVICE_ACCOUNT` | Android push. The Firebase service-account JSON (raw or base64) with the Firebase Cloud Messaging API enabled |
| `SML_APP_PUSH_SECRET` | optional. Who may call `/push/send`; defaults to the alert-router secret, then the billing API secret, which is what the site already holds |

Web push needs nothing new: it reuses the VAPID key pair the platform already keeps for Loop Kick web push.

Database: migrations `042_app_sessions` (tables `app_sessions`, `app_push_devices`) and `043_app_push_keys` run in the pre-deploy step like every other migration.

Site: install and activate `plugins/sml-app-identity` (see its README). `GET /v1/app` answers `ready: true` once both sides are in place.
