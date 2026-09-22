'use strict';

/* Daily Social Payouts Discord command adapter.
 *
 * It intentionally supports only disclosed, original promotional-analysis
 * tasks. Likes, comments, reposts, quote-posts, follows and engagement
 * farming are not commands and cannot create an earning record.
 */

const { createDailySocialPayouts } = require('./daily-social-payouts');

const EPHEMERAL = 64;
const MANAGE_GUILD_PERMISSION = '32';
const COMMAND_DEFINITIONS = [
  { type: 1, name: 'payout-balance', description: 'Show your approved Daily Social Payouts balance', contexts: [0], options: [] },
  { type: 1, name: 'payout-claim', description: 'Claim an open original-content task', contexts: [0], options: [{ type: 3, name: 'task_id', description: 'Task id', required: true }] },
  { type: 1, name: 'payout-submit', description: 'Submit an original disclosed post for review', contexts: [0], options: [
    { type: 3, name: 'claim_id', description: 'Claim id', required: true },
    { type: 3, name: 'proof_url', description: 'Public URL of your post', required: true },
    { type: 3, name: 'account_url', description: 'Your public account URL', required: true },
    { type: 3, name: 'body', description: 'Exact post body including disclosure and source URL', required: true }
  ] },
  { type: 1, name: 'payout-task', description: 'Create a reviewed original-content task', default_member_permissions: MANAGE_GUILD_PERMISSION, contexts: [0], options: [
    { type: 3, name: 'platform', description: 'reddit, stocktwits, or x', required: true },
    { type: 3, name: 'article_url', description: 'Source article URL', required: true },
    { type: 3, name: 'title', description: 'Article title', required: true },
    { type: 3, name: 'summary', description: 'Verified source summary', required: true },
    { type: 4, name: 'reward_cents', description: 'Reward in cents (25–10000)', required: true },
    { type: 3, name: 'tickers', description: 'Optional comma-separated tickers; Stocktwits needs 1–2', required: false }
  ] },
  { type: 1, name: 'payout-review', description: 'Approve or reject a submitted proof', default_member_permissions: MANAGE_GUILD_PERMISSION, contexts: [0], options: [
    { type: 3, name: 'submission_id', description: 'Submission id', required: true },
    { type: 5, name: 'approve', description: 'Approve this submission', required: true },
    { type: 3, name: 'reason', description: 'Optional review reason', required: false }
  ] }
];

function option(interaction, name) {
  const row = ((interaction && interaction.data && interaction.data.options) || []).find((item) => item && item.name === name);
  return row ? row.value : undefined;
}

function userId(interaction) {
  const user = (interaction && interaction.member && interaction.member.user) || (interaction && interaction.user);
  return user && /^\d{5,24}$/.test(String(user.id || '')) ? String(user.id) : null;
}

function integer(value, label) {
  if (!/^\d{1,18}$/.test(String(value || ''))) throw new TypeError(`${label} must be a number`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new TypeError(`${label} must be a number`);
  return parsed;
}

function text(value, label, maximum = 1900) {
  const result = String(value || '').trim();
  if (!result || result.length > maximum) throw new TypeError(`${label} is required`);
  return result;
}

function reply(content) { return { response: { type: 4, data: { content: String(content).slice(0, 2000), flags: EPHEMERAL } } }; }

function manager(interaction, managerRoleId) {
  const permissions = String(interaction && interaction.member && interaction.member.permissions || '');
  const roles = interaction && interaction.member && Array.isArray(interaction.member.roles) ? interaction.member.roles : [];
  let hasManageGuild = false;
  try { hasManageGuild = (BigInt(permissions || '0') & 32n) === 32n || (BigInt(permissions || '0') & 8n) === 8n; } catch (_) { /* role check below */ }
  return hasManageGuild || roles.includes(managerRoleId);
}

function createDailySocialCommands({ pool, guildId, channelId, managerRoleId, now } = {}) {
  const service = createDailySocialPayouts({ pool, now });

  function verifyScope(interaction, needsManager) {
    if (!userId(interaction)) throw new TypeError('Discord user not available');
    if (String(interaction.guild_id || '') !== String(guildId || '')) throw new TypeError('Use this command in the Making Easy Money server');
    if (needsManager && !manager(interaction, String(managerRoleId || ''))) throw new TypeError('Only a server manager can use that command');
  }

  async function handleCommand(interaction) {
    try {
      const name = String(interaction && interaction.data && interaction.data.name || '');
      const actor = userId(interaction);
      if (name === 'payout-balance') {
        verifyScope(interaction, false);
        const balance = await service.balance(actor);
        return reply(`Available balance: $${(Number(balance.available_cents || 0) / 100).toFixed(2)}\nPaid total: $${(Number(balance.paid_cents || 0) / 100).toFixed(2)}\nPayouts remain subject to admin approval.`);
      }
      if (name === 'payout-claim') {
        verifyScope(interaction, false);
        const claimed = await service.claimTask({ taskId: integer(option(interaction, 'task_id'), 'task id'), discordUserId: actor });
        return reply(`Task claimed (#${claimed.task.id}); claim #${claimed.claim.id}.\n\nCopy draft:\n${claimed.task.draft}\n\nPost only where permitted. Then use /payout-submit with the public post URL and your exact final text.`);
      }
      if (name === 'payout-submit') {
        verifyScope(interaction, false);
        const submitted = await service.submitProof({
          claimId: integer(option(interaction, 'claim_id'), 'claim id'), discordUserId: actor,
          proofUrl: text(option(interaction, 'proof_url'), 'proof URL'), accountUrl: text(option(interaction, 'account_url'), 'account URL'),
          body: text(option(interaction, 'body'), 'post body', 10000)
        });
        return reply(`Submission #${submitted.id} is queued for a human review. Payment is not guaranteed until the post is verified.`);
      }
      if (name === 'payout-task') {
        verifyScope(interaction, true);
        const tickerText = String(option(interaction, 'tickers') || '');
        const task = await service.createTask({
          platform: text(option(interaction, 'platform'), 'platform', 20), articleUrl: text(option(interaction, 'article_url'), 'article URL'),
          articleTitle: text(option(interaction, 'title'), 'title', 200), articleSummary: text(option(interaction, 'summary'), 'summary', 1500),
          tickers: tickerText.split(',').map((ticker) => ticker.trim()), rewardCents: option(interaction, 'reward_cents'),
          channelId, createdBy: actor
        });
        return reply(`Task #${task.id} is open in the review queue. It pays $${(Number(task.reward_cents) / 100).toFixed(2)} only after human approval.`);
      }
      if (name === 'payout-review') {
        verifyScope(interaction, true);
        const result = await service.reviewSubmission({ submissionId: integer(option(interaction, 'submission_id'), 'submission id'), reviewerId: actor,
          approved: option(interaction, 'approve') === true, reason: String(option(interaction, 'reason') || '') });
        return reply(result.status === 'approved' ? `Approved. $${(result.amountCents / 100).toFixed(2)} is now available in the member balance.` : 'Rejected. No earning was added.');
      }
      return reply('Unknown Daily Social Payouts command.');
    } catch (error) {
      const message = error instanceof TypeError ? String(error.message).replace(/[^A-Za-z0-9 $.,:;()#\-]/g, '').slice(0, 300) : 'The command could not be completed.';
      return reply(message || 'The command could not be completed.');
    }
  }

  return Object.freeze({ handleCommand, handleComponent: async () => reply('This button is no longer active.') });
}

module.exports = { COMMAND_DEFINITIONS, createDailySocialCommands };

