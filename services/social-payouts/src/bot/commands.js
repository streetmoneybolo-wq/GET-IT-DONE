/* The slash commands this bot owns, and where they get registered. Commands are guild-scoped (they appear instantly), in the seed guild and every guild the bot has joined. */
import { Collection } from 'discord.js';
import * as share from '../../commands/share.js';
import * as news from '../../commands/news.js';
import * as leaderboard from '../../commands/leaderboard.js';
import * as boost from '../../commands/boost.js';
import * as tracking from '../../commands/tracking.js';
import * as earnings from '../../commands/earnings.js';
import * as connectPayPal from '../../commands/connectPayPal.js';
import * as paypal from '../../commands/paypal.js';
import * as payoutAdmin from '../../commands/payoutAdmin.js';
import * as shareSetup from '../../commands/shareSetup.js';

export const COMMANDS = [share, news, leaderboard, boost, tracking, earnings, connectPayPal, paypal, payoutAdmin, shareSetup];

export function buildCommandCollection() {
  const collection = new Collection();
  for (const command of COMMANDS) collection.set(command.data.name, command);
  return collection;
}

export async function registerCommandsInGuild(client, guild) {
  await guild.commands.set(client.commands.map((command) => command.data.toJSON()));
  console.log(`Commands registered in ${guild.name} (${guild.id}).`);
}

/* Seed guild first, then every guild the bot can see: the bot gets moved between servers and admin tools like /share-setup have to exist wherever it lives. */
export async function registerCommandsEverywhere(client, seedGuildId = process.env.GUILD_ID) {
  const ids = [...new Set([seedGuildId, ...client.guilds.cache.keys()].filter(Boolean))];
  for (const guildId of ids) {
    const guild = await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) { console.warn(`Could not register commands: bot is not available in guild ${guildId}.`); continue; }
    await registerCommandsInGuild(client, guild).catch((error) => console.error(`Could not register commands in ${guildId}:`, error.message || error));
  }
}
