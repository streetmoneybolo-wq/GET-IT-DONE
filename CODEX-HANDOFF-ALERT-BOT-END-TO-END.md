# Codex master prompt: finish the Grandmaster-Obi alert flow end to end

Repo: streetmoneybolo-wq/GET-IT-DONE, service `services/sml-platform`, deploy branch `deploy/node-platform` (Render auto-deploys; `npm run db:release` runs migrations). Work on a branch; deploy only after the owner says "push it". Tests: `cd services/sml-platform && npm test` (expect 0 failures).

## Goal
When the owner (Discord id 1087769175453339648, "Grandmaster-Obi") presses Send in Click-to-Alert in the Academy, the alert goes to the Making Easy Money trading Discord with: the typed alert text (bold-serif Grandmaster-Obi format), the exact price and time (ET), entry/target/stop, and the two scenario chart images, posted by a second Discord bot that carries the owner's name and avatar. Other members keep the shared Academy app. Discord does not allow posting as a user account, so never use user tokens or self-bots.

## Already built (read before changing)
- `platform/academy-click-alert.js` / `academy-click-alert-ui.js`: preview card, Loop Bucks unlock, three posting modes. Mode A, `personas` (owner's own bot via `SML_OBI_BOT_TOKEN`, created in server.js as `personaBots`): lists servers and channels from that bot, checks, posts text plus two PNG attachments. Mode B, webhook "under my name and picture" (`directory.postAsMember`, needs Manage Webhooks). Mode C, "send through StockMarketLoop" (`platform/academy-sml-publish.js` plus `plugins/sml-alert-publish`), optional and off unless `SML_ALERT_PUBLISH_GROUP_ID` is set.
- `platform/academy-free-users.js`: the owner gets every feature free.
- Live site facts: the Making Easy Money group is group id 7 on stockmarketloop.com. The `sml_alert` post type does NOT exist on the site, so Mode C returns 503 "Missing: post_type:sml_alert". The site has other alert plugins (SML Discord + Telegram Alert Bridge 5.2.9, StockMarketLoop Discord Alerts, StockMarketLoop Alert Card + Share) whose code is not in this repo.

## Your tasks, in order
1. **Mode A end to end (priority).** With the owner, create the second bot (Developer Portal: name Grandmaster-Obi, avatar, token into Render as `SML_OBI_BOT_TOKEN`, invite with View Channel, Send Messages, Attach Files, Mention Everyone, bot role above others as needed). Verify live: open the Academy as the owner, press ALERT, click a price, see the server and channel lists come from the new bot, confirm the preview, send, and confirm the post shows the bot name and avatar, the typed text, and both scenario images in Discord. Fix anything that breaks in the real iframe. Report honestly what you could and could not verify.
2. **Time and price line.** Make Mode A include the same "time (ET) and price at alert" line that Mode C adds, so the Discord post always shows the exact price and time. Add a test.
3. **Mode C decision.** Inspect the site's existing alert plugins (WordPress.com MCP plugin list; read their code if exportable) and find where group alerts actually live. If the owner still wants the alert to appear in the site group feed as him, publish into that real store instead of `sml_alert`, then let the existing Alert Bot mirror it to Discord. If not needed, deactivate the `SML Alert Publish` plugin on the site and remove Mode C's default-on path. Do not guess: confirm with the owner.
4. **Loop Bucks and access checks on the real site.** Confirm the two-step sign-in system on the site (`/wp-json/sml-2step/v1/...` exists) and how it reports a member's status, then wire the Loop Bucks pass eligibility to it. Set `SML_ACADEMY_LB_PRICES` and `SML_CLICK_ALERT_LB_PRICES` with the owner's prices (Academy: daily 500, weekly 2000, monthly 5000, 3-month 15000 or 1500 (ask), 6-month 25000, yearly 35000, lifetime 100000).
5. **Final live audit.** Chart loads, Ticks dropdown (1 to 1000), alert preview, unlock buttons, LOOP-KICK phone, chat threads and Customize panel all work in the real Discord Activity. List anything unverified.

## Rules
- Never print or commit tokens or secrets. Never disable TLS verification. Inlined page scripts (`platform/academy-*-ui.js`) must contain no backticks, no `${`, no backslashes.
- Do not post test alerts to real member channels; use a private test channel.
- Report honestly: what was verified live, what was only tested with fakes, and what the owner still has to do.
