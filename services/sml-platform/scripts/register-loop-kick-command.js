'use strict';

/**
 * Registers the Connect application's /loop-kick Entry Point command — Discord
 * launches the LOOP-KICK Activity itself (handler 2), no bot message is ever
 * posted. Dry-run by default; pass --apply to write.
 *
 *   node scripts/register-loop-kick-command.js [--apply]
 *
 * Env: SML_DISCORD_CONNECT_APP_ID, SML_DISCORD_CONNECT_BOT_TOKEN.
 */

const SNOWFLAKE_RE = /^[0-9]{15,24}$/;

const LOOP_KICK_ENTRY_COMMAND = {
  name: 'loop-kick',
  description: 'Open LOOP-KICK — your stockmarketloop.com messages and alerts',
  type: 4,
  handler: 2,
  integration_types: [0],
  contexts: [0],
};

async function registerLoopKickCommand({ env = process.env, fetchImpl = fetch, log = console.log, apply = false } = {}) {
  const appId = String(env.SML_DISCORD_CONNECT_APP_ID || '').trim();
  const botToken = String(env.SML_DISCORD_CONNECT_BOT_TOKEN || '').trim();
  if (!SNOWFLAKE_RE.test(appId)) throw new Error('SML_DISCORD_CONNECT_APP_ID is missing or malformed.');
  if (!botToken) throw new Error('SML_DISCORD_CONNECT_BOT_TOKEN is missing.');
  if (!apply) {
    log(`[dry-run] would POST /applications/${appId}/commands with ${JSON.stringify(LOOP_KICK_ENTRY_COMMAND)}`);
    return { applied: false };
  }
  const response = await fetchImpl(`https://discord.com/api/v10/applications/${appId}/commands`, {
    method: 'POST',
    headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(LOOP_KICK_ENTRY_COMMAND),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Discord refused the command (${response.status}): ${JSON.stringify(body).slice(0, 300)}`);
  log(`Registered global /loop-kick Entry Point (id ${body.id || 'unknown'}) on application ${appId}.`);
  return { applied: true, id: body.id };
}

module.exports = { registerLoopKickCommand, LOOP_KICK_ENTRY_COMMAND };

if (require.main === module) {
  registerLoopKickCommand({ apply: process.argv.includes('--apply') }).catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}
