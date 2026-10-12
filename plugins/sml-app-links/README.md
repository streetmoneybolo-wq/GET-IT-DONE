# SML App Links

Serves the deep-link and app-shell files for the StockMarketLoop phone app and PWA from stockmarketloop.com, with a settings page for the values the app builder supplies.

## What it serves

| URL | Purpose | Until configured |
|---|---|---|
| `/.well-known/apple-app-site-association` (also `/apple-app-site-association`) | iOS universal links and password autofill (`webcredentials`) for `TEAMID.bundle.id` | `{"applinks":{"details":[]}}` |
| `/.well-known/assetlinks.json` | Android app links and credential sharing for the package and its signing fingerprints | `[]` |
| `/manifest.webmanifest` (also `/manifest.json`, `/site.webmanifest`) | the PWA manifest: name, colours, icons (the site icon by default), start URL, App Store and Play listings | served with site defaults |

All three are answered before WordPress routes the request: correct content type, `Cache-Control: public, max-age=3600`, no theme, no 404 page. Every page also gets `<link rel="manifest">`, `theme-color`, `apple-touch-icon`, the mobile-web-app metas, the Safari Smart App Banner once an App Store ID exists, and the Google Play hint once a package name exists.

## Settings → SML App Links

- **iPhone**: Apple Team ID (10 characters), Bundle ID, App Store ID.
- **Android**: package name, SHA-256 signing fingerprints (one per line: upload key, Play App Signing key, debug key). Bare 64-hex or colon form both work.
- **Web manifest**: name, short name, colours, start URL, icon overrides.
- **Paths that stay in the browser**: defaults exclude `/wp-admin/*`, `/wp-login.php`, `/wp-json/*`, `/wp-content/*`, `/wp-includes/*`, `/feed/*`, `/xmlrpc.php`, `/cart/*`, `/checkout/*`, `/my-account/*`, `/store/*`. Every other link on the site opens in the app once installed. Checkout and the store stay on the web until the payments decision.

Constants in `wp-config.php` win over the saved settings: `SML_APP_IOS_TEAM_ID`, `SML_APP_IOS_BUNDLE_ID`, `SML_APP_IOS_STORE_ID`, `SML_APP_ANDROID_PACKAGE`, `SML_APP_ANDROID_SHA256`.

## The app side (for the builder)

- iOS: add the Associated Domains entitlement `applinks:stockmarketloop.com` and `webcredentials:stockmarketloop.com`. Apple's CDN fetches the AASA when the app installs; allow up to a day after the first save here.
- Android: declare an intent filter with `android:autoVerify="true"` for `https://stockmarketloop.com`. Verify with `adb shell pm verify-app-links --re-verify <package>` or the Play Console deep-links report.
- Both: a tap on any stockmarketloop.com link then opens the app, which reads the URL and routes to the screen (feed post, group, ticker, profile) via the app API.

## Known blocker: WordPress.com's browser challenge vs Apple's fetcher

Checked on 2026-10-12, minutes after activation:

- Google's verifier (`digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://stockmarketloop.com`) fetched `/.well-known/assetlinks.json` from the site without error.
- Apple's CDN (`app-site-association.cdn-apple.com/a/v1/stockmarketloop.com`) was refused by the site: `Apple-Failure-Reason: SWCERR00101 Bad HTTP Response: 403 Forbidden`. The 403 is WordPress.com's "Checking your browser" bot challenge in front of the site, which also blocks plain `curl`. The plugin never answers 403.

Until Apple's fetcher can read the file, iOS universal links will not verify on real installs (development builds can use `?mode=developer` in the entitlement to fetch directly). Fix on the hosting side: ask WordPress.com support to exempt `/.well-known/apple-app-site-association` (ideally all of `/.well-known/*`) from the browser challenge for stockmarketloop.com, or to allow Apple's AASA fetcher. Re-check with the Apple CDN URL above; Apple caches a failure for a while, so allow an hour after the change.

## Tests

```
php -d display_errors=1 tests/test-app-links.php
```

Checks the three documents and the routing with WordPress stubbed out.
