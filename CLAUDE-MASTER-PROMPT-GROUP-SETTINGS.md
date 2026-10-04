# Master prompt for Claude: finish the Group Settings timeout fix end to end

You are working in repo streetmoneybolo-wq/GET-IT-DONE on branch `feat/etoro-snapshot-algo-lab` (commit `0f0aee9` or later). The site is stockmarketloop.com (WordPress.com Atomic, blog_id 239074360). Use the WordPress.com MCP tools for site work.

## Problem
Members and managers get "timed out" in Group Settings. Cause: `plugins/sml-group-settings-hub` puts a REST nonce (`wp_create_nonce('wp_rest')`) on the page at load. WordPress retires it after 12-24 h, and every later request returns 403 `rest_cookie_invalid_nonce`, which the hub showed as a raw error.

## Already done in the repo (commit 0f0aee9)
- `assets/hub.js`: `api()` now refreshes the nonce through `admin-ajax.php?action=rest-nonce` on a stale-nonce 403 and retries once, refreshes every 10 minutes, and shows "Your session ended. Please log in again and reopen Group Settings." when the member is really signed out.
- `includes/loader.php`: adds `ajax` (admin-ajax URL) to the `window.SML_HUB` config.

## Your tasks
1. Read both files and confirm the change is correct. Do not rewrite it.
2. Run `php -l` on the PHP and `node --check` on the JS. If `plugins/sml-group-settings-hub/tests/hub-harness.js` can run (needs `playwright`, install temporarily and remove after), run it and fix any regression.
3. Zip the plugin folder and install it on the site (WordPress.com MCP plugin upload with the zip as base64, then activate or update). Back up the currently installed version first and tell the owner how to roll back.
4. Purge the Atomic edge cache by re-saving one page (do not change content or close comments).
5. Verify on the live site: load a group page while logged in, confirm `window.SML_HUB.ajax` exists and `hub.js?v=` has the new version, and that the hub opens. If you cannot log in, say so and mark it unverified.
6. Check the cookie lifetime. If members are signed out early, look for an `auth_cookie_expiration` filter or a security plugin shortening sessions, and report what you find (change nothing without the owner's OK).

## Rules
- Never disable TLS verification, never print secrets, never close comments or edit page content.
- Outward actions (plugin install, cache purge) are covered by this prompt; anything else needs the owner's OK.
- Report honestly: what changed, what was verified live, what is unverified, and the rollback step.
