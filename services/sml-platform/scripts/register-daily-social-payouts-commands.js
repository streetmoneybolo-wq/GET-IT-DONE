'use strict';

/* One-shot, guild-scoped command registration for the separate
 * Daily Social Payouts Discord app. Values are deliberately never printed. */

const { COMMAND_DEFINITIONS } = require('../platform/daily-social-commands');

const DISCORD_API = 'https://discord.com/api/v10';
const SNOWFLAKE_RE = /^[0-9]{15,24}$/;

async function registerDailySocialPayoutsCommands({ env = process.env, fetchImpl = globalThis.fetch, log = console.log } = {}) {
  const appId = String(env.SML_DSP_DISCORD_APP_ID || '').trim();
  const botToken = String(env.SML_DSP_DISCORD_BOT_TOKEN || '').trim();
  const guildId = String(env.SML_DSP_GUILD_ID || '').trim();
  const missing = [];
  if (!SNOWFLAKE_RE.test(appId)) missing.push('SML_DSP_DISCORD_APP_ID');
  if (!botToken) missing.push('SML_DSP_DISCORD_BOT_TOKEN');
  if (!SNOWFLAKE_RE.test(guildId)) missing.push('SML_DSP_GUILD_ID');
  if (missing.length) throw new Error(`missing or invalid environment: ${missing.join(', ')}`);

  let response;
  try {
    response = await fetchImpl(`${DISCORD_API}/applications/${appId}/guilds/${guildId}/commands`, {
      method: 'PUT',
      headers: { authorization: `Bot ${botToken}`, 'content-type': 'application/json' },
      body: JSON.stringify(COMMAND_DEFINITIONS)
    });
  } catch (_) {
    throw new Error('Discord command registration request failed');
  }
  if (!response || Number(response.status) < 200 || Number(response.status) >= 300) {
    throw new Error(`Discord command registration failed (HTTP ${Number(response && response.status) || 0})`);
  }
  log(`registered ${COMMAND_DEFINITIONS.length} Daily Social Payouts commands for one guild`);
  return { ok: true, count: COMMAND_DEFINITIONS.length };
}

if (require.main === module) {
  registerDailySocialPayoutsCommands().catch((error) => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { registerDailySocialPayoutsCommands };

