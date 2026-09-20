import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, PermissionFlagsBits } from 'discord.js';
import { readSettings } from './utils/storage.js';
import { backfillAlertHistory, processAlertMessage } from './utils/alertMonitor.js';
import { startArticleAutomation } from './utils/articleAutomation.js';

if (!process.env.SPOTLIGHT_DISCORD_TOKEN) throw new Error('SPOTLIGHT_DISCORD_TOKEN is required');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel],
});

client.once('clientReady', async () => {
  const settings = await readSettings();
  if (!settings.alertMonitor?.enabled) throw new Error('alertMonitor.enabled must be true');
  for (const channelId of settings.alertMonitor.channelIds || []) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== settings.alertMonitor.guildId) {
      throw new Error(`Allowlisted alert channel ${channelId} is unavailable or belongs to another server`);
    }
    const permissions = channel.permissionsFor(client.user);
    for (const [name, flag] of [
      ['ViewChannel', PermissionFlagsBits.ViewChannel],
      ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
    ]) {
      if (!permissions?.has(flag)) throw new Error(`Alert channel ${channelId} is missing ${name}`);
    }
  }
  await backfillAlertHistory(client);
  if (settings.articleAutomation?.enabled) {
    startArticleAutomation(client, settings.articleAutomation.pollIntervalSeconds);
  }
  console.log(`Retail Trader Spotlight Monitor ready as ${client.user.tag}.`);
});

client.on('messageCreate', async (message) => {
  if (message.author?.bot) return;
  await processAlertMessage(message);
});

client.on('messageUpdate', async (_oldMessage, message) => {
  try {
    if (message.partial) await message.fetch();
    if (message.author?.bot) return;
    await processAlertMessage(message, 'updated');
  } catch (error) {
    console.error('Spotlight alert update failed safely:', error.message || error);
  }
});

client.login(process.env.SPOTLIGHT_DISCORD_TOKEN);
