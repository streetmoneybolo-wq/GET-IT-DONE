'use strict';

/**
 * One-shot guild-scoped registration of the SML Connect slash commands.
 *
 * Usage: node scripts/register-connect-commands.js
 *
 * Reads (env NAMES only — values are never printed or logged):
 *   SML_DISCORD_CONNECT_APP_ID     the Connect Discord application id
 *   SML_DISCORD_CONNECT_BOT_TOKEN  bot token for that application
 *   SML_CONNECT_GUILD_IDS          comma-separated guild ids to register in
 *
 * PUT /applications/{appId}/guilds/{guildId}/commands replaces the guild's
 * command set atomically, so re-running is idempotent. Guild-scoped commands
 * apply instantly (global ones can take an hour) — per DESIGN §4.
 */

const { COMMAND_DEFINITIONS } = require('../platform/connect-commands');

const DISCORD_API = 'https://discord.com/api/v10';
const SNOWFLAKE_RE = /^[0-9]{15,24}$/;

async function registerConnectCommands({ env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const appId = String(env.SML_DISCORD_CONNECT_APP_ID || '').trim();
  const botToken = String(env.SML_DISCORD_CONNECT_BOT_TOKEN || '').trim();
  const guildCsv = String(env.SML_CONNECT_GUILD_IDS || '').trim();

  const missing = [];
  if (!SNOWFLAKE_RE.test(appId)) missing.push('SML_DISCORD_CONNECT_APP_ID');
  if (!botToken) missing.push('SML_DISCORD_CONNECT_BOT_TOKEN');
  if (!guildCsv) missing.push('SML_CONNECT_GUILD_IDS');
  if (missing.length) {
    throw new Error(`missing or invalid environment: ${missing.join(', ')}`);
  }

  const guildIds = guildCsv.split(',').map((value) => value.trim()).filter(Boolean);
  const invalid = guildIds.filter((value) => !SNOWFLAKE_RE.test(value));
  if (!guildIds.length || invalid.length) {
    throw new Error('SML_CONNECT_GUILD_IDS must be a comma-separated list of Discord guild ids');
  }

  const body = JSON.stringify(COMMAND_DEFINITIONS);
  const results = [];
  for (const guildId of guildIds) {
    let status = null;
    let detail = '';
    try {
      const response = await fetchImpl(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
        method: 'PUT',
        headers: {
          authorization: `Bot ${botToken}`,
          'content-type': 'application/json'
        },
        body
      });
      status = Number(response.status);
      if (status >= 200 && status < 300) {
        detail = `registered ${COMMAND_DEFINITIONS.length} commands`;
      } else {
        /* Discord error bodies are safe to print (they never echo the token),
         * but keep them short. */
        try {
          detail = String(await response.text()).slice(0, 300);
        } catch (_) {
          detail = 'no response body';
        }
      }
    } catch (_) {
      /* Never print the caught error: a transport failure can embed request
       * details. A fixed message keeps the token out of every output path. */
      status = 0;
      detail = 'request failed (network or DNS error)';
    }
    log(`guild ${guildId}: ${status === 0 ? 'error' : `HTTP ${status}`} — ${detail}`);
    results.push({ guildId, status });
  }

  const failed = results.filter((entry) => !(entry.status >= 200 && entry.status < 300));
  log(`done: ${results.length - failed.length}/${results.length} guilds registered`);
  return { results, ok: failed.length === 0 };
}

if (require.main === module) {
  registerConnectCommands()
    .then((summary) => {
      if (!summary.ok) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

module.exports = { registerConnectCommands };
