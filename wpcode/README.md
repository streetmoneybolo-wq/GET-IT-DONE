# Loop Channel WPCode snippets

Both files are the editor body for a WPCode **PHP Snippet** (there is no
opening `<?php`, matching WPCode's editor format).

Activation order:

1. Add and activate `loop-channel-data-api.php` as **Auto Insert / Run Everywhere**.
2. Verify `GET /wp-json/sml-channel/v1/channel/grandmasterobi` returns `200`,
   contains only `visibility: public` videos, and has creator-scoped posts.
3. Add and activate `loop-channel-loader.php` as **Auto Insert / Run Everywhere**.
4. Verify `/channel/grandmasterobi/?ch=1` while signed in as an administrator.
5. Verify `/channel/grandmasterobi/` logged out, then check `?ch=0` restores the
   original WordPress page.

Do not activate the loader before the API verification. Deactivate the loader
to roll back the page shell; deactivate the API separately only after the
loader is off.

## WPCode rules (READ BEFORE PASTING ANYTHING INTO WPCODE)

WPCode Lite merges EVERY "Run Everywhere" PHP snippet into ONE `eval()` (`class-wpcode-auto-insert-everywhere.php::run_snippets()`). Two consequences:

1. **Never `return;` or `exit;` at top level** of a snippet — it aborts every snippet merged after it.
2. **The merged code may contain at most 5** matches of `base64_decode(` / `eval(` / `ini_set(` / `error_reporting(` (comments count — WPCode scans raw text). Past 5, WPCode silently blanks ALL snippets: channels 404, CDN loader, Loop Bucks, creator gate, guards — everything dies with no error and no notice. **The site is already at 5/5** (snippets #4481 ×4, #6262 ×1). Sitewide outage on 2026-08-19 was exactly this (presence snippet added a 6th).

Diagnosis shortcut: a WPCode-registered REST route (e.g. `sml-channel/v1/channel/{handle}`) returns 404 while plugin routes (`sml-lb/v1/me`) work → the merged eval is dead → deactivate the newest snippet.

`creator-analytics-runtime-plugin.php` in this folder is a **plugin bootstrap** (it contains `eval(`) — it must be installed as a plugin, never pasted into WPCode.

`creator-adsense-attribution.php` is the payout-disabled AdSense PAGE_URL
attribution adapter. It imports the official ReportResult shape, maps only
canonical `/watch/{id}/` URLs to verified owners, and quarantines every other
row. It does not fetch reports until user OAuth is configured, and it never
writes to Loop Wallet or the verified revenue ledger.

## Scheduled live library and unique Watch URLs

`scheduled-live-api.php` stores every creator stream as a separate preserved
record and gives each newly scheduled stream a fresh, stable URL shaped as
`/live/?room={profile-handle}&stream={stream-id}`. The creator dashboard module
is loaded by `stream-countdown-loader.php` on `/go-live/` and lists the real
upcoming stream records with copy/open controls. `live-watch.js`,
`stream-countdown.js`, and `live-watch-social-cards.php` all resolve that exact
stream ID so sharing an older link cannot jump to a newer broadcast.

`POST /sml-scheduled-live/v1/creator` is create-only: it never reuses the
current stream ID or overwrites an earlier schedule. Cancelling one record
keeps every other scheduled stream and repoints the legacy creator-only URL to
the next upcoming stream.

Replay state is deliberately fail-closed. A stream appears as a saved replay
only after the RTMP recorder has persisted a real HTTPS asset and POSTed its
URL to `sml-scheduled-live/v1/creator/recording` as the signed-in creator with
`stream_id`, `status=ready`, and `recording_url`. WordPress metadata alone does
not record RTMP/HLS media. The nginx-rtmp host at `live.stockmarketloop.com`
must be configured to archive/transcode and perform that callback before the
automatic recording requirement is complete.
