import { EmbedBuilder } from 'discord.js';
import { mutateJson, paths, readJson } from './storage.js';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']);

export async function recordPremiumVerificationDm(message, settings) {
  if (message.guild || message.author?.bot) return false;
  const state = await readJson(paths.premiumVerification, { campaigns: [] });
  const active = [...(state.campaigns || [])]
    .reverse()
    .find((campaign) => (campaign.recipients || []).some((row) => row.userId === message.author.id && row.status === 'notified'));
  if (!active) return false;

  const attachments = [...(message.attachments?.values?.() || [])]
    .filter((attachment) => IMAGE_TYPES.has(String(attachment.contentType || '').toLowerCase()) || /\.(png|jpe?g|webp|gif)$/i.test(String(attachment.name || attachment.url || '')))
    .map((attachment) => ({
      id: attachment.id,
      name: attachment.name || '',
      url: attachment.url,
      contentType: attachment.contentType || '',
      size: attachment.size || 0,
    }));
  if (!attachments.length) {
    await message.reply('Please send the Upgrade.Chat proof as an image screenshot. Crop or blur card numbers, billing address, and unrelated purchases.').catch(() => {});
    return true;
  }

  await mutateJson(paths.premiumVerification, { campaigns: [] }, (value) => {
    const campaign = (value.campaigns || []).find((item) => item.id === active.id);
    if (!campaign) return;
    const row = (campaign.recipients || []).find((item) => item.userId === message.author.id);
    if (!row) return;
    row.status = 'submitted';
    row.submittedAt = new Date().toISOString();
    row.messageId = message.id;
    row.attachments = attachments;
  });

  await message.reply('✅ Screenshot received. Staff will review it. If more proof is needed, someone from Making Easy Money will follow up.').catch(() => {});

  const channelId = settings.memberSecurity?.premiumVerification?.logChannels?.find((item) => String(item.guildId) === String(active.guildId))?.channelId || '';
  if (channelId) {
    const channel = await message.client.channels.fetch(channelId).catch(() => null);
    if (channel?.isTextBased()) {
      const embed = new EmbedBuilder()
        .setTitle('Premium verification screenshot received')
        .setDescription(`User <@${message.author.id}> submitted ${attachments.length} screenshot${attachments.length === 1 ? '' : 's'} for campaign \`${active.id}\`.`)
        .addFields(
          { name: 'Discord user ID', value: message.author.id, inline: true },
          { name: 'Attachments', value: attachments.map((item, index) => `[Screenshot ${index + 1}](${item.url})`).join('\n').slice(0, 1000), inline: false },
        )
        .setTimestamp(new Date());
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  }
  return true;
}
