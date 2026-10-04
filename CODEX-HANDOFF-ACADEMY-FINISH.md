# Codex master prompt: finish the Making Easy Money Academy end to end

You are finishing work on the Making Easy Money Academy Live Chart Lab.
Repo: streetmoneybolo-wq/GET-IT-DONE. Service: `services/sml-platform` (Node, no framework, `platform/server.js` serves one huge HTML template literal).
Deploy branch: `deploy/node-platform` (Render auto-deploys; `preDeployCommand: npm run db:release` runs migrations in `group-subs/migrations`).
Live release at handoff: `b0b0e79`, schema 038. Tests: `cd services/sml-platform && npm test` (expect 0 failures).

## Hard rules
- Any script inlined into the page (files read with `fs.readFileSync` in `server.js`) must contain NO backticks, NO `${`, NO backslashes. Use `[0-9]` not `\d`, a typographic apostrophe not `\'`. `platform/server.test.js` asserts this for the chat and appearance scripts; extend it for anything new.
- Page CSP: `img-src 'self' data:`, `connect-src 'self'`. The Activity runs in a Discord iframe: proxy external images through the server, open external links with `window.smlAcademyOpenExternal(url)`. Auth is `window.smlAcademySessionToken` as a Bearer token.
- Never disable TLS verification. Never commit secrets. Feature work goes on a branch; deploy to `deploy/node-platform` only after the owner says "push it".
- Report honestly: say what is verified live and what is only tested against fakes.

## Already built and live
Chat avatars and profile cards; threaded replies, up/down votes, hot threads per room (migration 038); Customize panel (colour scheme, font, text size); SMC hover explainer; Click-to-Alert with the Grandmaster-Obi alert format and two scenario images; Quick Snapshot to Discord; eToro, orange moomoo and options-chain broker buttons; AdSense thin-page gating and ticker content; MEM LAB (signals, gated optimizer, champion/challenger service, opt-in routes).

## Your tasks, in order
1. **Chart bug (owner reports the live chart "isn't working anymore").** Not reproduced anonymously: SPY/AAPL load with candles, no page errors. Reproduce inside the Discord Activity or a signed-in session, then fix. Look at `ACADEMY_CHART_GUARD` in `server.js`, the capture-phase pointerdown handlers on `.academy-chart-stage` (click-alert, SMC, snapshot) which may swallow pan/zoom, and the new `html{font-size}` rule in `academy-appearance-ui.js` (rem sizing may collapse the chart row). Search Render logs for `chart_blank`. Add a regression test or a headless-browser check.
2. **Verify Click-to-Alert live.** Role ID `1553515556399747092` is set as `SML_ACADEMY_CLICK_ALERT_ROLE_IDS`. Confirm `SML_ACADEMY_GUILD_ID` is set, the Academy bot has View Channel, Send Messages, Attach Files (and Mention Everyone) in a test channel, then run entry/target/send and confirm both scenario PNGs attach. If `@resvg/resvg-js` failed to install, fix the install so images render.
3. **Verify live chat threads.** Two accounts: reply, vote, delete a parent with replies (must show `[deleted]`), switch rooms (each room keeps its own threads), confirm the busiest thread is pinned with HOT THREAD. Fix anything that breaks in the real iframe.
4. **MEM LAB to production quality.** Replace the JSON file store (`/tmp/sml-mem-lab.json`, wiped on deploy) with a Postgres store plus migration `039_mem_lab_*` (up and down). Add a real history source (the Academy chart service gives about 250 candles, too few trades). Show an approved champion to users: wrap `platform/academy-mem-signals.js` for the browser like `MemAlgoEngine` and wire it into `academy-mem-algo-ui.js` line ~84. Run a real backtest on real data and report the numbers, including failures. Keep promotion manual unless the owner enables `ACADEMY_MEM_LAB_AUTOPROMOTE`.
5. **Options broker deep links.** Brokers do not offer contract-level links; buttons open the underlying symbol. Re-check each broker's current URL format and improve where one exists.
6. **AdSense final audit** (see `CODEX-HANDOFF.md`): live-audit noindex on thin screens, ad gate, policy pages, ticker content; then list what the owner must click in AdSense.
7. **Housekeeping:** install `plugins/sml-academy-profile-card` on the WordPress site if the owner approves; confirm the LOOP-KICK secret and URL mapping (`SML_LOOP_KICK_BRIDGE_SECRET`).

## Definition of done
`npm test` green; each task verified on the live site or explicitly marked unverified; a short report listing what changed, what was verified, and what the owner still has to do; deploy only after "push it".
