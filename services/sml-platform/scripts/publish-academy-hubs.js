'use strict';

const { publishAcademyHubs } = require('../platform/academy/hub-publisher');

const apply = process.argv.includes('--apply');
const token = String(process.env.SML_ACADEMY_BOT_TOKEN || process.env.DISCORD_ACADEMY_BOT_TOKEN || '').trim();
const guildId = String(process.env.SML_ACADEMY_GUILD_ID || process.env.SML_DISCORD_GUILD_ID || '').trim();
const categoryId = String(process.env.SML_ACADEMY_CATEGORY_ID || '').trim();

async function main() {
  const result = await publishAcademyHubs({ token, guildId, categoryId, apply });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
