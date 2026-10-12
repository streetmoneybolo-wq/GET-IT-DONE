# SML Edge Cache

Lets WordPress.com's edge cache serve stockmarketloop.com's logged-out pages.

## The problem it fixes

Measured 2026-10-11: the home page and every 404 left the site with

```
Cache-Control: no-cache, must-revalidate, max-age=0, no-store, private
Expires: Wed, 11 Jan 1984 05:00:00 GMT
X-ac: 3.dca _atomic_dca MISS
```

That is WordPress's `nocache_headers()`, called by a plugin on every anonymous request. WordPress 6.8 made it `no-store, private` for everyone, not only signed-in users. Automattic's edge (Batcache + Edge Cache, the `X-ac` header) refuses to store any response with `cache-control: no-cache` or `max-age=0`, so every visitor waited on PHP: 1.4 s to first byte for the home page, 126 KB 404 pages built from scratch each time.

## What the plugin does

At `template_redirect`, after every other plugin has had its say and before a byte of the page is written, it decides whether the request is safe to cache and, if so, replaces the headers:

```
Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600, stale-if-error=3600
Vary: Accept-Encoding, Cookie
X-SML-Edge-Cache: cacheable (overrode 1 nocache call)
```

Safe means all of: a GET or HEAD, visitor not signed in, no `wordpress_*`, `wp-postpass_`, `comment_author_`, WooCommerce, PHP session or referral cookie on the request, the response has not set a cookie, not admin, REST, preview, search or a 404 beyond its short TTL, no query string other than tracking parameters, the page did not declare `DONOTCACHEPAGE`, and the path is not on the excluded list (`/wp-admin`, `/wp-login.php`, `/wp-json`, `/cart`, `/checkout`, `/my-account`, `/store`, `/register`, `/login`, `/connect-discord`, `/create-channel`, `/creator-studio`, `/verify`, `/account`, `/settings` by default).

Anything else is left exactly as it was, with `X-SML-Edge-Cache: skip <reason>` so you can see why.

## Finding the culprit

Every `nocache_headers()` call on an anonymous page is recorded with the plugin or snippet that made it (from the call stack). Settings → SML Edge Cache lists them. The override makes the site fast regardless, but deactivating or fixing the plugin that calls it on every page removes the need.

## Verifying

From a machine that is not signed in and not challenged by WordPress.com's bot protection:

```
curl -sI https://stockmarketloop.com/ | grep -i -E 'cache-control|x-ac|x-sml-edge'
curl -sI https://stockmarketloop.com/ | grep -i -E 'cache-control|x-ac|x-sml-edge'
```

The first answer should show `Cache-Control: public, ...` and `X-ac: ... MISS`; the second (same edge location) `X-ac: ... HIT`. In a browser: DevTools → Network → the document request → response headers, in a private window.

## Settings

Browser TTL (default 60 s), edge TTL (300 s), stale-while-revalidate (600 s), 404 TTL (120 s), excluded paths. Constants `SML_EDGE_CACHE_OFF`, `SML_EDGE_CACHE_TTL`, `SML_EDGE_CACHE_EDGE_TTL` override. Publishing or editing a post purges WordPress.com's edge for the whole site anyway, so stale pages after a publish are not a concern.

## Tests

```
php -d display_errors=1 tests/test-edge-cache.php
```

Runs the decision logic against every rule above with WordPress stubbed out.
