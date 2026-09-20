import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, PermissionFlagsBits } from 'discord.js';
import { readSettings } from './utils/storage.js';
import { backfillAlertHistory, monitoredChannelRefs, processAlertMessage } from './utils/alertMonitor.js';
import { startArticleAutomation } from './utils/articleAutomation.js';

if (!process.env.SPOTLIGHT_DISCORD_TOKEN) throw new Error('SPOTLIGHT_DISCORD_TOKEN is required');

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel],
});

client.once('clientReady', async () => {
  const settings = await readSettings();
  if (!settings.alertMonitor?.enabled) throw new Error('alertMonitor.enabled must be true');
  let accessibleChannels = 0;
  for (const { guildId, channelId } of monitoredChannelRefs(settings)) {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || channel.guildId !== guildId) {
      console.warn(`Skipping unavailable alert channel ${channelId} in guild ${guildId}.`);
      continue;
    }
    const permissions = channel.permissionsFor(client.user);
    const missing = [
      ['ViewChannel', PermissionFlagsBits.ViewChannel],
      ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory],
    ].filter(([, flag]) => !permissions?.has(flag)).map(([name]) => name);
    if (missing.length) {
      console.warn(`Skipping alert channel ${channelId}; missing ${missing.join(', ')}.`);
      continue;
    }
    accessibleChannels += 1;
  }
  if (!accessibleChannels) throw new Error('No configured alert channels are accessible with read-only permissions');
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
