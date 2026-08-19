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
