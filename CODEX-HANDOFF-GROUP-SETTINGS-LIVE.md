# Codex master prompt: finish Group Settings live-save, Onboarding (9 featured) and the locked-channel overlay, end to end

You are working in `streetmoneybolo-wq/GET-IT-DONE`. Production site: stockmarketloop.com (WordPress.com Atomic, blog_id 239074360). Group of interest: Making Easy Money, group id 7, `/groups/making-easy-money/`. Do not touch the Node platform (`services/sml-platform`) for this task. Commit only to branches below; never force-push; never deploy `deploy/node-platform`.

## What is already done (verify, do not redo)
1. `js/group-categories.js` (branch `fix/group-edit-live-save`): channel editor saves live (rename, create, delete, reorder, categories), no page reload, "Done" button, `syncRevision()` re-reads the layout revision right before each save (fixes "Could not confirm the current layout").
2. `js/group-onboarding.js` (same branch): featured-channel limit raised 5 -> 9 in the editor UI.
3. `plugins/sml-gcat-live-save/` is INSTALLED and ACTIVE on the site. It output-buffers `/groups/{slug}/` and rewrites the jsDelivr SHA for only `js/group-categories.js` and `js/group-onboarding.js` (the site pins every other asset via `SML_CDN_ASSET_REVISION` in the site mu-plugin `sml-cdn-version-resolver.php`). To ship a new JS revision: push it, then bump the SHAs in that plugin and re-upload (WordPress.com MCP `plugin.upload` with `overwrite:true`, then `plugin.activate`). Hand-copying large base64 corrupts; keep the zip tiny (`zip -0`) or fetch a zip from jsDelivr with an installer plugin (see `plugins/sml-hub-installer`).
4. `plugins/sml-group-settings-hub` 1.0.6 (branch `fix/hub-live-save`, installed): roles, channel permissions, follow-to-unlock config and a new live "Group profile" form (name, link, description, ticker, sector, pitch via `sml/v1/group/editor` GET and `sml/v1/group/update` POST) autosave; the legacy Edit Group button is hidden by `body.sml-hub-dedupe`.

## Open problems to finish
### A. Featured channels will not save past 5 (server cap)
The save endpoint is `POST /wp-json/sml-onboard/v1/config` (mu-plugin `sml-group-onboarding.php` 2.0.0 on the site, NOT in this repo). It trims `featured_channels` to 5. Steps:
- Obtain the file content from the site owner (WP Admin file editor, or the host file manager/SFTP). If you have no access, STOP and ask for the file; do not install a code-reader plugin on the production site.
- Raise the cap to 9 everywhere it appears (save sanitizer, and the code that builds `overlay.featured` for the public gate). Keep the max a single constant.
- Add that mu-plugin to the repo under `mu-plugins/` so it is reviewable, with a PHP stub test that saves 9 and reads 9 back and rejects 10.
- Note: mu-plugins cannot be uploaded through the WordPress.com MCP. The owner must upload it by SFTP/host file manager, or you ship the change as a normal plugin that filters the value (only if the mu-plugin exposes a filter).

### B. Locked paid channel overlay does not match what the owner configured in Onboarding
Client: `js/group-onboarding.js` (`gateHtml`, `plansHtml`, `showGate`, `unlock`). Server data: `sml-onboard/v1/access` and `/flow`. The owner says the overlay does not look/behave like what they set up. Reproduce first (logged out, logged in free member, owner preview) and compare field by field against the saved config (`welcome_message`, `featured`, `open_channels`, `rules`, `plans`, `checkout_url`):
- every featured channel (up to 9) is listed in "Inside Premium";
- channels the owner marked open appear in "Free to browse" and are not gated;
- welcome text, rules and membership cards match the saved values and ordering;
- Unlock goes to the owner's checkout URL;
- the overlay covers only the conversation area of locked channels and never an open one.
Fix whatever differs. Capture before/after screenshots at 1280x900 and 390x844 (headless Chromium via playwright-core against a stubbed `sml-onboard/v1`, like `plugins/sml-group-settings-hub/tests/hub-harness.js`).

### C. Remaining Edit Group items to move into Group Settings
Icon, header banner and background uploads/sliders still live only in the legacy Edit Group modal (inline script `sml-group-owner-editor-js`, plugin `sml-group-owner-editor`, endpoints `sml/v1/group/image-upload`, `group/watermark`, `group/header-banner`; the modal reloads the page after saving). Add a "Visuals" block to the hub Overview that uploads and saves live without reloading, then keep the old button hidden. Also access model/price (`access_model`, `monthly_price_loopbucks`) if safe. Respect the editor's rule: call watermark then header-banner sequentially, never in parallel.

## Rules
- Inlined scripts in the Node server must contain no backticks, `${` or backslashes (not relevant here, but do not touch `platform/server.js`).
- WordPress side: PHP 7.4 compatible, `php -l` every file, no secrets in the repo, no fabricated claims.
- Test with the existing harnesses; add new cases; run `npm test` in `services/sml-platform` only if you touched it (you should not).
- Verify the live page loads the new revisions: `curl -s https://stockmarketloop.com/groups/making-easy-money/ | grep -o 'GET-IT-DONE@[a-f0-9]*/js/group-[a-z]*.js'`.
- Report honestly: what was verified live vs only in the harness, and what needs the owner's login (live clicking in the editor, onboarding save, overlay as a free member).
