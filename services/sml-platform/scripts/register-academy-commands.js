#!/usr/bin/env node
'use strict';

/* Registers only guild-scoped Academy commands. This is intentionally an
 * explicit release step; command registration never runs at server boot. */
const { COMMAND_DEFINITIONS } = require('../platform/academy/commands');
const token = String(process.env.SML_DISCORD_CONNECT_BOT_TOKEN || '').trim();
const applicationId = String(process.env.SML_DISCORD_CONNECT_APP_ID || '').trim();
const guildId = String(process.env.SML_ACADEMY_GUILD_ID || '').trim();
if (!token || !applicationId || !guildId) throw new Error('SML_DISCORD_CONNECT_BOT_TOKEN, SML_DISCORD_CONNECT_APP_ID, and SML_ACADEMY_GUILD_ID are required');
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ dryRun: true, guildId, commandCount: COMMAND_DEFINITIONS.length, commands: COMMAND_DEFINITIONS.map((x) => x.name) }, null, 2));
  process.exit(0);
}
(async () => {
  const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`, {
    method: 'PUT', headers: { Authorization: `Bot ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(COMMAND_DEFINITIONS)
  });
  if (!response.ok) throw new Error(`Discord command registration failed: ${response.status}`);
  const result = await response.json();
  console.log(JSON.stringify({ registered: result.length, guildId }, null, 2));
})().catch((error) => { console.error(error.message); process.exit(1); });
