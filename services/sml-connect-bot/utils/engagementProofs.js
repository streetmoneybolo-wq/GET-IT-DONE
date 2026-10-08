import { randomUUID } from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { mutateJson, paths, readSettings } from './storage.js';

export const PROOF_ACTIONS = new Set(['comment', 'share', 'like', 'upvote']);

const platformHosts = {
  reddit: ['reddit.com'], x: ['x.com', 'twitter.com'], stocktwits: ['stocktwits.com'],
  bluesky: ['bsky.app'], threads: ['threads.net', 'threads.com'], facebook: ['facebook.com'],
};

function cleanAction(value) {
  const action = String(value || '').trim().toLowerCase().replace('repost', 'share');
  if (!PROOF_ACTIONS.has(action)) throw new Error('Action must be COMMENT, SHARE, LIKE, or UPVOTE.');
  return action;
}

export function validateProofUrl(raw, platform, action) {
  const normalizedAction = cleanAction(action);
  if (normalizedAction === 'like' || normalizedAction === 'upvote') {
    throw new Error('A post URL cannot prove a like or upvote. Use screenshot proof or an official connected-account verification when available.');
  }
  let url;
  try { url = new URL(String(raw || '').trim()); } catch { throw new Error('Paste a complete public https:// proof URL.'); }
  if (url.protocol !== 'https:') throw new Error('Proof links must use https://.');
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!(platformHosts[platform] || []).some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error(`That proof link is not hosted on ${platform}.`);
  }
  url.hash = '';
  return { action: normalizedAction, url: url.toString() };
}

export function proofContextFromMessage(message) {
  for (const row of message?.components || []) {
    for (const component of row.components || []) {
      const id = component.customId || component.data?.custom_id || '';
      const match = String(id).match(/^sml-engagement-(?:reply|done|proof):([0-9a-f-]{36}):([0-9a-f-]{36})$/i)
        || String(id).match(/^sml-proof-(?:link|shot):([0-9a-f-]{36}):([0-9a-f-]{36})$/i);
      if (match) return { postID: match[1], externalPostId: match[2] };
    }
  }
  return null;
}

export async function createProof({ user, post, externalPost, action, method, evidenceUrl, attachment }) {
  const normalizedAction = cleanAction(action);
  if (!['public_url', 'screenshot'].includes(method)) throw new Error('Unknown proof method.');
  let result;
  await mutateJson(paths.engagementProofs, [], (rows) => {
    const existing = rows.find((row) => row.userId === user.id && row.externalPostId === externalPost.id
      && row.action === normalizedAction && !['rejected', 'withdrawn'].includes(row.status));
    if (existing) { result = { changed: false, proof: existing }; return; }
    if (method === 'public_url' && new URL(evidenceUrl).toString() === new URL(externalPost.url).toString()) {
      result = { changed: false, duplicateEvidence: true, reason: 'The original post URL does not prove that you commented or shared it.' };
      return;
    }
    const reused = rows.find((row) => (evidenceUrl && row.evidenceUrl === evidenceUrl)
      || (attachment?.id && row.attachment?.id === attachment.id));
    if (reused) {
      result = { changed: false, duplicateEvidence: true, reason: 'That exact evidence was already submitted.' };
      return;
    }
    const proof = {
      id: randomUUID(), postID: post.postID, externalPostId: externalPost.id,
      platform: externalPost.platform, originalPostUrl: externalPost.url,
      userId: user.id, userName: user.username, action: normalizedAction, method,
      evidenceUrl: evidenceUrl || '', attachment: attachment || null,
      status: method === 'screenshot' ? 'manual_review' : 'public_url_submitted',
      createdAt: new Date().toISOString(), reviewedAt: '', reviewedBy: '', reviewNote: '', reviewMessageId: '',
    };
    rows.push(proof);
    result = { changed: true, proof };
  });
  return result;
}

export async function reviewProof(proofId, reviewer, decision) {
  let result = null;
  await mutateJson(paths.engagementProofs, [], (rows) => {
    const proof = rows.find((row) => row.id === proofId);
    if (!proof) return;
    if (['approved', 'rejected'].includes(proof.status)) { result = { changed: false, proof }; return; }
    proof.status = decision === 'approve' ? 'approved' : 'rejected';
    proof.reviewedAt = new Date().toISOString();
    proof.reviewedBy = reviewer.id;
    result = { changed: true, proof };
  });
  return result;
}

export async function sendProofForReview(client, proof, post) {
  const settings = await readSettings();
  const channelId = settings.proofReview?.channelId || settings.workReport?.channelId || settings.workReport?.channels?.[0]?.channelId;
  if (!channelId) throw new Error('No proof-review channel is configured.');
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error('The proof-review channel is unavailable.');
  const evidence = proof.method === 'screenshot' ? proof.attachment?.url : proof.evidenceUrl;
  const embed = new EmbedBuilder()
    .setColor(0xf59e0b).setTitle('🕵️ Engagement proof needs review')
    .setDescription(`This is **not verified yet**. Review the evidence and approve or reject it.`)
    .addFields(
      { name: 'Member', value: `<@${proof.userId}> · \`${proof.userId}\``, inline: true },
      { name: 'Platform / action', value: `${proof.platform} · ${proof.action}`, inline: true },
      { name: 'Evidence tier', value: proof.method === 'screenshot' ? 'Screenshot — manual review' : 'Public URL — submitted for review', inline: false },
      { name: 'Original task', value: `[Open original post](${proof.originalPostUrl})`, inline: false },
      { name: 'Evidence', value: `[Open evidence](${evidence})`, inline: false },
      { name: 'Article', value: post?.link ? `[Open article](${post.link})` : 'Unavailable', inline: false },
    ).setFooter({ text: `Proof ID ${proof.id}` }).setTimestamp();
  if (proof.method === 'screenshot' && /^image\//i.test(proof.attachment?.contentType || '')) embed.setImage(proof.attachment.url);
  return channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sml-proof-review:${proof.id}:approve`).setLabel('Approve').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`sml-proof-review:${proof.id}:reject`).setLabel('Reject').setStyle(ButtonStyle.Danger),
    )],
    allowedMentions: { users: [proof.userId] },
  });
}
