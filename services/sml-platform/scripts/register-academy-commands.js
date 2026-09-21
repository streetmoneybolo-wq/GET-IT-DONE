#!/usr/bin/env node
'use strict';

/* Registers the private guild command suite plus the app's single global
 * Primary Entry Point. Discord owns the entry-point launch interaction and
 * opens the configured Activity inside Discord (handler 2). */
const { COMMAND_DEFINITIONS, ENTRY_POINT_COMMAND } = require('../platform/academy/commands');
const token = String(process.env.SML_ACADEMY_BOT_TOKEN || '').trim();
const applicationId = String(process.env.SML_ACADEMY_APP_ID || '').trim();
const guildId = String(process.env.SML_ACADEMY_GUILD_ID || '').trim();
if (!token || !applicationId || !guildId) throw new Error('SML_ACADEMY_BOT_TOKEN, SML_ACADEMY_APP_ID, and SML_ACADEMY_GUILD_ID are required');
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ dryRun: true, guildId, commandCount: COMMAND_DEFINITIONS.length, commands: COMMAND_DEFINITIONS.map((x) => x.name), entryPoint: ENTRY_POINT_COMMAND }, null, 2));
  process.exit(0);
}
(async () => {
  const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`, {
    method: 'PUT', headers: { Authorization: `Bot ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(COMMAND_DEFINITIONS)
  });
  if (!response.ok) throw new Error(`Discord command registration failed: ${response.status}`);
  const result = await response.json();
  const entryPointResponse = await fetch(`https://discord.com/api/v10/applications/${applicationId}/commands`, {
    method: 'POST', headers: { Authorization: `Bot ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(ENTRY_POINT_COMMAND)
  });
  if (!entryPointResponse.ok) throw new Error(`Discord Activity entry-point registration failed: ${entryPointResponse.status}`);
  const entryPoint = await entryPointResponse.json();
  console.log(JSON.stringify({ registered: result.length, guildId, entryPoint: { id: entryPoint.id, name: entryPoint.name, type: entryPoint.type, handler: entryPoint.handler } }, null, 2));
})().catch((error) => { console.error(error.message); process.exit(1); });
