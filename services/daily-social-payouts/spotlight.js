import 'dotenv/config';
import { Client, GatewayIntentBits, Partials, PermissionFlagsBits } from 'discord.js';
import { readSettings } from './utils/storage.js';
import { backfillAlertHistory, monitoredChannelRefs, processAlertMessage } from './utils/alertMonitor.js';
import { startArticleAutomation } from './utils/articleAutomation.js';
import { ensureMessageContentIntent } from './utils/ensureMessageContentIntent.js';
import { forwardAlertToTelegram } from './utils/telegramForwarder.js';

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
    if (!channel?.isTextBased() || (guildId && channel.guildId !== guildId)) {
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
  // Telegram needs the original alert even when it was posted by the approved
  // alert bot/webhook. The forwarder itself restricts bot messages to the
  // configured alert channels; Spotlight does not analyse them as articles.
  const settings = await readSettings();
  await forwardAlertToTelegram(message, settings).catch((error) => {
    console.error('Telegram alert forward failed safely:', error.message || error);
  });
  if (message.author?.bot) return;
  await processAlertMessage(message);
});

client.on('messageUpdate', async (_oldMessage, message) => {
  try {
    if (message.partial) await message.fetch();
    const settings = await readSettings();
    await forwardAlertToTelegram(message, settings, 'updated').catch((error) => {
      console.error('Telegram alert update forward failed safely:', error.message || error);
    });
    if (!message.author?.bot) await processAlertMessage(message, 'updated');
  } catch (error) {
    console.error('Spotlight alert update failed safely:', error.message || error);
  }
});

/* The monitor reads alert text, which needs the Message Content privileged intent.
   Switch it on for this application before connecting so a new app does not die
   with "Used disallowed intents"; a refusal is logged with the portal link. */
await ensureMessageContentIntent(process.env.SPOTLIGHT_DISCORD_TOKEN);
client.login(process.env.SPOTLIGHT_DISCORD_TOKEN);
