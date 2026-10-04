# Codex master prompt: fix "Unknown command" when members link their account or connect a group in Discord

Repo: streetmoneybolo-wq/GET-IT-DONE. The bot is `services/daily-social-payouts` (discord.js). Work on a branch; deploy only after the owner says "push it".

## Symptom
After copying a link or code from stockmarketloop.com, the owner pastes it into Discord and Discord says "Unknown command".

## What the code does (read these first)
- `wpcode/discord-role-group-connect.php` line ~327 gives group owners the text `/connect-sml-group code:<code>`.
- `services/daily-social-payouts/utils/onboarding.js` tells members to run `/link-sml` with the code from stockmarketloop.com/connect-discord/.
- `services/daily-social-payouts/commands/connectSmlGroup.js` and `commands/linkSml.js` define the commands.
- `services/daily-social-payouts/index.js`: commands are registered per guild at startup (log line "registered N guild commands") and in the `guildCreate` handler. Servers where the bot was added earlier, or where registration failed, never get the commands.

## Likely causes, check in this order
1. The member pasted the whole command as plain text. Discord does not run pasted slash commands; the member must type `/`, pick the command from the pop-up, and enter only the code in the `code` box. Fix the instructions everywhere they appear (site page, onboarding embed, DMs): show "type /link-sml, pick it from the menu, paste the code in the code box". Where possible give a button or a one-line copy of just the code, not the full `/command code:...` string.
2. The command is not registered in that guild. Confirm which guilds the bot is in, compare with where commands are registered, and add a safe re-registration path: on `ready` for every guild the bot is in (not only configured ones), and an admin-only command or script to re-register. Make sure registration failures are logged with the guild id (never tokens).
3. Application-commands permission: the bot invite must include the `applications.commands` scope, and the channel must allow "Use Application Commands". Verify the invite URL the site and onboarding generate.
4. The bot process is offline or crash-looping. Check the host logs and fix the cause.

## Deliverables
- Reproduce the failure or explain exactly which of the four causes it is, with evidence (logs, registered command list from Discord's API for the guild).
- Code changes: clearer instructions, guild-wide registration on ready, a re-register path, a friendlier reply when a code is expired or invalid, and tests for each.
- Run the service's tests (`npm test` in the service folder) and the root checks.
- Report honestly: what was verified live, what was only tested with fakes, and what the owner must do in Discord or the Developer Portal.

## Rules
- Never print or commit tokens or secrets. Never disable TLS verification.
- Do not change unrelated commands. Keep Discord permission scopes minimal.
- Deploy only after the owner says "push it".
