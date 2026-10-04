#!/usr/bin/env node
'use strict';

/* Registers the private guild command suite plus the app's single global
 * Primary Entry Point. Discord owns the entry-point launch interaction and
 * opens the configured Activity inside Discord (handler 2). */
const { COMMAND_DEFINITIONS, USER_INSTALL_COMMAND_DEFINITIONS, ENTRY_POINT_COMMAND } = require('../platform/academy/commands');
const token = String(process.env.SML_ACADEMY_BOT_TOKEN || '').trim();
const applicationId = String(process.env.SML_ACADEMY_APP_ID || '').trim();
const guildId = String(process.env.SML_ACADEMY_GUILD_ID || '').trim();
if (!token || !applicationId || !guildId) throw new Error('SML_ACADEMY_BOT_TOKEN, SML_ACADEMY_APP_ID, and SML_ACADEMY_GUILD_ID are required');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Discord command writes have a tight route limit. Retrying a 429 in-process
 * makes this deploy-safe without leaking the bot token or asking an operator
 * to guess which commands made it through a partial registration. */
async function postDiscordCommand(url, command) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const commandResponse = await fetch(url, {
      method: 'POST', headers: { Authorization: `Bot ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(command)
    });
    if (commandResponse.ok) return commandResponse.json();
    if (commandResponse.status !== 429 || attempt === 3) {
      throw new Error(`Discord command registration failed for ${command.name}: ${commandResponse.status}`);
    }
    let delayMs = Number(commandResponse.headers.get('retry-after')) * 1000;
    try {
      const body = await commandResponse.json();
      delayMs = Number(body.retry_after) * 1000 || delayMs;
    } catch (_) { /* header value is enough */ }
    await sleep(Math.max(250, Number.isFinite(delayMs) ? delayMs : 1_000));
  }
  throw new Error(`Discord command registration failed for ${command.name}`);
}
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ dryRun: true, guildId, commandCount: COMMAND_DEFINITIONS.length, commands: COMMAND_DEFINITIONS.map((x) => x.name), userInstallCommands: USER_INSTALL_COMMAND_DEFINITIONS.map((x) => x.name), entryPoint: ENTRY_POINT_COMMAND }, null, 2));
  process.exit(0);
}
(async () => {
  const response = await fetch(`https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`, {
    method: 'PUT', headers: { Authorization: `Bot ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(COMMAND_DEFINITIONS)
  });
  if (!response.ok) throw new Error(`Discord command registration failed: ${response.status}`);
  const result = await response.json();
  const globalUrl = `https://discord.com/api/v10/applications/${applicationId}/commands`;
  const userInstallCommands = [];
  for (const command of USER_INSTALL_COMMAND_DEFINITIONS) userInstallCommands.push(await postDiscordCommand(globalUrl, command));
  const entryPoint = await postDiscordCommand(globalUrl, ENTRY_POINT_COMMAND);
  console.log(JSON.stringify({ registered: result.length, guildId, userInstallCommands: userInstallCommands.map((command) => command.name), entryPoint: { id: entryPoint.id, name: entryPoint.name, type: entryPoint.type, handler: entryPoint.handler } }, null, 2));
})().catch((error) => { console.error(error.message); process.exit(1); });
