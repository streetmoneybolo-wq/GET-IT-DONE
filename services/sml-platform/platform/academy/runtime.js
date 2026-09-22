'use strict';

/* Academy interactions remain available even when the unrelated dispute
 * evidence feature flag is off.  The fallback command handler intentionally
 * exposes no billing or dispute surface. */
const { createDiscordInteractions } = require('../discord-interactions');
const { createAcademyCommands } = require('./commands');

function createAcademyInteractions({ config, pool, fetchImpl, now } = {}) {
  if (!config?.academyEnabled || !config?.academyGuildId ||
      !config?.academyPublicKey || !config?.academyAppId) return null;
  const academy = createAcademyCommands({
    pool,
    guildId: config.academyGuildId,
    monarchRoleId: config.academyMonarchRoleId,
    enabled: true,
    now,
    disciplinePlayerBaseUrl: 'https://sml-platform-api.onrender.com/academy-discipline'
  });
  return createDiscordInteractions({
    config: { discordConnectPublicKey: config.academyPublicKey, discordConnectAppId: config.academyAppId },
    pool,
    academy,
    commands: { handleCommand: async () => ({ response: { type: 4, data: { content: 'This command is not available.', flags: 64 } } }) },
    fetchImpl,
    now
  });
}

module.exports = { createAcademyInteractions };
