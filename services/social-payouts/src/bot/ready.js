/* Startup: background jobs, command registration, and a permission check of every channel the workflows depend on. */
import { PermissionFlagsBits } from 'discord.js';
import { readSettings } from '../../utils/storage.js';
import { linkWorkflowsFromSettings } from '../../utils/linkWorkflow.js';
import { startDailyPayoutScheduler } from '../../utils/dailyPayoutCycle.js';
import { startArticleFeed } from '../../utils/articleFeed.js';
import { registerCommandsEverywhere } from './commands.js';
import { resumePendingApplicationReviews } from '../features/socialApplications.js';

async function checkChannel(client, channelId, label, required) {
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) { console.warn(`${label} channel ${channelId} is unavailable or is not text-based.`); return; }
  const permissions = channel.permissionsFor(client.user);
  const missing = required.filter(([, flag]) => !permissions?.has(flag)).map(([name]) => name);
  if (missing.length) console.warn(`${label} channel ${channelId} is missing bot permissions: ${missing.join(', ')}`);
  else console.log(`${label} channel ready: #${channel.name} (${channel.id}).`);
}

const WORK_PERMISSIONS = [['ViewChannel', PermissionFlagsBits.ViewChannel], ['SendMessages', PermissionFlagsBits.SendMessages], ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory]];

export async function onReady(client) {
  const stops = [];
  const configured = process.env.CLIENT_ID;
  if (configured && client.application?.id && configured !== client.application.id) {
    console.warn(`CLIENT_ID (${configured}) does not match the logged-in application (${client.application.id}). Fix the environment variable.`);
  }
  await registerCommandsEverywhere(client);

  const settings = await readSettings();
  for (const workflow of linkWorkflowsFromSettings(settings)) {
    await checkChannel(client, workflow.returnLinksChannelId, `Return-links (${workflow.id || 'workflow'})`, [...WORK_PERMISSIONS, ['ManageMessages', PermissionFlagsBits.ManageMessages]]);
  }
  if (settings.engagementEveryonePing) {
    const channelIds = [...new Set(linkWorkflowsFromSettings(settings).flatMap((workflow) => [workflow.shareChannelId, workflow.engagementChannelId]).filter(Boolean))];
    for (const channelId of channelIds) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (!channel?.permissionsFor(client.user)?.has(PermissionFlagsBits.MentionEveryone)) console.warn(`Work channel ${channelId} does not grant MentionEveryone; @everyone alerts will not notify members there.`);
    }
  }
  if (settings.workReport?.enabled) {
    const targets = settings.workReport.channels?.length ? settings.workReport.channels : settings.workReport.channelId ? [{ channelId: settings.workReport.channelId }] : [];
    for (const target of targets) await checkChannel(client, target.channelId, 'Work-report', [...WORK_PERMISSIONS, ['EmbedLinks', PermissionFlagsBits.EmbedLinks]]);
  }

  const resumed = await resumePendingApplicationReviews(client);
  if (resumed) console.log(`Resumed ${resumed} pending application review(s).`);
  stops.push(startDailyPayoutScheduler(client));
  console.log('Daily payout scheduler started (holds, payable notifications, and the gated payment step).');
  stops.push(startArticleFeed(client));
  console.log('Article feed watcher started (new site articles become share packages automatically).');
  console.log(`Ready as ${client.user.tag}; registered ${client.commands.size} guild commands.`);
  return () => stops.forEach((stop) => { try { stop?.(); } catch { /* shutting down */ } });
}
