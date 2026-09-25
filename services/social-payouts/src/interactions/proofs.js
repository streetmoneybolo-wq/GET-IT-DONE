/* Interaction handlers (buttons, modals). Each returns false when the interaction is not its own. */
import { ActionRowBuilder, EmbedBuilder, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle } from 'discord.js';
import { postById } from '../../utils/tracking.js';
import { createProof, reviewProof, sendProofForReview, validateProofUrl } from '../../utils/engagementProofs.js';
import { recordApprovedProofPayout } from '../../utils/payoutLedger.js';

export async function proofReview(interaction) {
  if (!(interaction.isButton() && /^sml-proof-review:[0-9a-f-]{36}:(approve|reject)$/i.test(interaction.customId))) return false;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: 'Only a server manager can review engagement evidence.', ephemeral: true });
  }
  const [, proofId, decision] = interaction.customId.split(':');
  const result = await reviewProof(proofId, interaction.user, decision);
  if (!result) return interaction.reply({ content: 'That proof record no longer exists.', ephemeral: true });
  if (!result.changed) return interaction.reply({ content: `This proof is already ${result.proof.status}.`, ephemeral: true });
  const status = result.proof.status === 'approved' ? '✅ APPROVED' : '❌ REJECTED';
  const embeds = interaction.message.embeds.map((embed, index) => index === 0
    ? EmbedBuilder.from(embed).setColor(result.proof.status === 'approved' ? 0x22c55e : 0xef4444)
      .addFields({ name: 'Final review status', value: `${status}\nReviewed by <@${interaction.user.id}>`, inline: false })
    : EmbedBuilder.from(embed));
  await interaction.update({ embeds, components: [] });
  let payout = null;
  if (result.proof.status === 'approved') {
    const post = await postById(result.proof.postID).catch(() => null);
    payout = await recordApprovedProofPayout({ proof: result.proof, post }).catch((error) => {
      console.error('Proof payout ledger update failed safely:', error.message || error);
      return null;
    });
  }
  const member = await interaction.client.users.fetch(result.proof.userId).catch(() => null);
  const payoutLine = payout?.amountUsd
    ? `\n\nPayout ledger: **${payout.amountUsd}** · ${payout.rateRule}\nStatus: **pending hold** until <t:${Math.floor(Date.parse(payout.payableAt) / 1000)}:f> if the proof stays valid.`
    : '';
  await member?.send(`# ${status}\nYour **${result.proof.platform} ${result.proof.action}** evidence was ${result.proof.status}.\n\nEvidence type: **${result.proof.method === 'screenshot' ? 'Screenshot — manually reviewed' : 'Public URL — manually reviewed'}**\nProof ID: \`${result.proof.id}\`${payoutLine}\n\nNo password, cookie, or session access was used.`).catch(() => {});
  return;
  return true;
}

export async function proofLinkModal(interaction) {
  if (!(interaction.isModalSubmit() && /^sml-proof-link:[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(interaction.customId))) return false;
  try {
    await interaction.deferReply({ ephemeral: true });
    const [, postID, externalPostId] = interaction.customId.split(':');
    const post = await postById(postID);
    const externalPost = post?.externalPosts?.find((entry) => entry.id === externalPostId);
    if (!post || !externalPost) throw new Error('This engagement task is unavailable.');
    const checked = validateProofUrl(interaction.fields.getTextInputValue('proof_url'), externalPost.platform, interaction.fields.getTextInputValue('proof_action'));
    const result = await createProof({ user: interaction.user, post, externalPost, action: checked.action, method: 'public_url', evidenceUrl: checked.url });
    if (!result.changed) return interaction.editReply(result.duplicateEvidence
      ? `Proof rejected: ${result.reason}`
      : `You already submitted ${result.proof.action} evidence for this post. Current status: **${result.proof.status}**.`);
    const review = await sendProofForReview(interaction.client, result.proof, post);
    return interaction.editReply(`# ✅ PROOF RECEIVED\nYour **${externalPost.platform} ${checked.action}** public URL was submitted for review.\n\nStatus: **Public URL submitted — not verified yet**\nReview card: ${review.url}\nProof ID: \`${result.proof.id}\``);
  } catch (error) {
    const message = String(error?.message || 'The proof could not be submitted.').slice(0, 500);
    if (interaction.deferred || interaction.replied) return interaction.editReply(message).catch(() => {});
    return interaction.reply({ content: message, ephemeral: true }).catch(() => {});
  }
  return true;
}

export async function proofButtons(interaction) {
  if (!(interaction.isButton() && /^sml-proof-(link|shot):[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(interaction.customId))) return false;
  const [proofCommand, postID, externalPostId] = interaction.customId.split(':');
  const method = proofCommand.endsWith('-shot') ? 'shot' : 'link';
  const post = await postById(postID);
  const externalPost = post?.externalPosts?.find((entry) => entry.id === externalPostId);
  if (!post || !externalPost) return interaction.reply({ content: 'This engagement task is unavailable.', ephemeral: true });
  if (method === 'shot') {
    return interaction.reply({
      content: `# 📸 SCREENSHOT PROOF INSTRUCTIONS\nReply directly to the **engagement task message** with one image attached. Put exactly one of these on the first line:\n\n\`PROOF: LIKE\`\n\`PROOF: UPVOTE\`\n\`PROOF: COMMENT\`\n\`PROOF: SHARE\`\n\nShow the platform, your account identity, the completed action, and the related post. Crop out private messages, balances, email addresses, and unrelated personal data. Screenshots always go to **manual review** and are never labeled API verified.`,
      ephemeral: true,
    });
  }
  const modal = new ModalBuilder().setCustomId(`sml-proof-link:${postID}:${externalPostId}`).setTitle('Submit Public Engagement Proof')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('proof_action').setLabel('Action: COMMENT or SHARE').setPlaceholder('COMMENT').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('proof_url').setLabel('Direct public comment/share URL').setPlaceholder('https://...').setStyle(TextInputStyle.Short).setRequired(true)),
    );
  return interaction.showModal(modal);
  return true;
}
