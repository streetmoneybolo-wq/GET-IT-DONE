import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { centsToUsd } from '../utils/payoutPolicy.js';
import { getPayablePayoutEntries, getPayableEntriesGroupedByUser, getUserPayoutSummary, markPayoutEntriesPaid } from '../utils/payoutLedger.js';
import { createPayPalPayout } from '../utils/paypalPayouts.js';
import { paypalPayoutStatus, paypalSetupText } from '../utils/paypalStatus.js';
import { dailyPayoutConfig, planDailyPayouts, runDailyPayoutCycle, withPayoutLock } from '../utils/dailyPayoutCycle.js';
import { listConfirmedReceivers, maskEmail, resolveReceiverEmail } from '../utils/payoutReceivers.js';

function memberLabel(user) {
  return user ? `<@${user.id}> · \`${user.id}\`` : 'Unknown member';
}

function payableTotal(entries) {
  return entries.reduce((sum, row) => sum + Number(row.amountCents || 0), 0);
}

function recentPayableLines(entries) {
  return entries.slice(0, 10).map((row) => (
    `• ${row.amountUsd || centsToUsd(row.amountCents)} — ${row.platformLabel || row.platform} ${row.action} · ${row.sourceId}`
  )).join('\n') || 'No payable entries yet.';
}

export const data = new SlashCommandBuilder()
  .setName('payout-admin')
  .setDescription('Admin tools for Daily Social Payouts balances and PayPal payouts.')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((sub) => sub
    .setName('status')
    .setDescription('Check PayPal payout connection status.'))
  .addSubcommand((sub) => sub
    .setName('preview')
    .setDescription('Preview a member payable payout balance.')
    .addUserOption((option) => option.setName('user').setDescription('Member to preview.').setRequired(true)))
  .addSubcommand((sub) => sub
    .setName('pay')
    .setDescription('Send or dry-run a PayPal payout for a member payable balance.')
    .addUserOption((option) => option.setName('user').setDescription('Member to pay.').setRequired(true))
    .addStringOption((option) => option.setName('confirm').setDescription('Type PAY to confirm.').setRequired(true))
    .addStringOption((option) => option.setName('paypal_email').setDescription('Override email. Omit to use the member saved payout address.'))
    .addNumberOption((option) => option.setName('max_usd').setDescription('Optional cap for this payout run.')))
  .addSubcommand((sub) => sub
    .setName('batch-preview')
    .setDescription('Preview the daily batch: every member payable now, with skip reasons.'))
  .addSubcommand((sub) => sub
    .setName('run-daily')
    .setDescription('Run the daily payout cycle now (holds, notifications, and the payment step).')
    .addBooleanOption((option) => option.setName('execute').setDescription('true sends real money if PayPal is live-ready. Default: preview only.')));

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.editReply('Only server managers can use payout admin commands.');
  }
  const subcommand = interaction.options.getSubcommand();
  const status = paypalPayoutStatus();

  if (subcommand === 'batch-preview') {
    const config = dailyPayoutConfig();
    const groups = await getPayableEntriesGroupedByUser();
    let receivers = new Map();
    try { receivers = await listConfirmedReceivers(); } catch { /* store disabled: all skip */ }
    const plan = planDailyPayouts({ groups, receivers, minCents: config.minCents, dailyCapCents: config.dailyCapCents, dayKey: 'preview' });
    const payLines = plan.items.slice(0, 15).map((item) => `• <@${item.userId}> — ${centsToUsd(item.amountCents)} (${item.entryIds.length} items)`).join('\n') || 'Nobody qualifies right now.';
    const skipLines = plan.skipped.slice(0, 15).map((skip) => `• <@${skip.userId}> — ${centsToUsd(skip.totalCents)} · ${skip.reason.replaceAll('_', ' ')}`).join('\n') || 'None';
    const embed = new EmbedBuilder()
      .setColor(0x38bdf8)
      .setTitle('Daily batch preview')
      .setDescription(`Minimum ${centsToUsd(config.minCents)} · daily cap ${centsToUsd(config.dailyCapCents)} · auto-daily ${config.autoPayEnabled ? 'ON' : 'OFF'}`)
      .addFields(
        { name: `Would pay (${plan.items.length} · ${centsToUsd(plan.plannedCents)})`, value: payLines, inline: false },
        { name: `Skipped (${plan.skipped.length})`, value: skipLines, inline: false },
      );
    return interaction.editReply({ embeds: [embed] });
  }

  if (subcommand === 'run-daily') {
    const execute = interaction.options.getBoolean('execute') === true;
    const summary = await runDailyPayoutCycle(interaction.client, { dryRun: !execute, trigger: `admin:${interaction.user.id}` });
    const embed = new EmbedBuilder()
      .setColor(summary.payments.executed ? 0x22c55e : 0xf59e0b)
      .setTitle(summary.payments.executed ? 'Daily cycle ran — payments submitted' : 'Daily cycle ran — payment step previewed')
      .addFields(
        { name: 'Hold checks', value: `${summary.holds.checked} verified · ${summary.holds.voided} voided`, inline: true },
        { name: 'Members notified', value: String(summary.notifications.members), inline: true },
        { name: summary.payments.executed ? 'Paid' : 'Payable (preview)', value: `${summary.payments.items} members · ${centsToUsd(summary.payments.plannedCents)}`, inline: true },
        { name: 'Batch', value: summary.payments.batchId ? `\`${summary.payments.batchId}\`` : '—', inline: false },
        ...(summary.payments.errors.length ? [{ name: 'Errors', value: summary.payments.errors.join('\n').slice(0, 900), inline: false }] : []),
      )
      .setFooter({ text: execute && !summary.payments.executed ? 'Execute was requested but PayPal is not live-ready — see /payout-admin status.' : `Run ${summary.runId}` });
    return interaction.editReply({ embeds: [embed] });
  }

  if (subcommand === 'status') {
    const embed = new EmbedBuilder()
      .setColor(status.readyForRealMoney ? 0x22c55e : 0xf59e0b)
      .setTitle('PayPal payout status')
      .setDescription(paypalSetupText(status))
      .addFields(
        { name: 'Mode', value: status.mode, inline: true },
        { name: 'Dry run', value: status.dryRun ? 'ON' : 'OFF', inline: true },
        { name: 'Real-money ready', value: status.readyForRealMoney ? 'YES' : 'NO', inline: true },
      );
    return interaction.editReply({ embeds: [embed] });
  }

  const user = interaction.options.getUser('user', true);
  const summary = await getUserPayoutSummary(user.id);
  const entries = await getPayablePayoutEntries(user.id);
  const totalCents = payableTotal(entries);

  if (subcommand === 'preview') {
    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('Payout preview')
      .setDescription(memberLabel(user))
      .addFields(
        { name: 'Payable now', value: centsToUsd(totalCents), inline: true },
        { name: 'Pending hold', value: summary.formatted.pendingCents, inline: true },
        { name: 'Already paid', value: summary.formatted.paidCents, inline: true },
        { name: 'Payable entries', value: recentPayableLines(entries), inline: false },
      );
    return interaction.editReply({ embeds: [embed] });
  }

  if (subcommand === 'pay') {
    const confirm = interaction.options.getString('confirm', true);
    if (confirm !== 'PAY') return interaction.editReply('Payment not sent. Type `PAY` in the confirm field to run the payout action.');
    const maxUsd = interaction.options.getNumber('max_usd');
    const capCents = maxUsd == null ? Number.POSITIVE_INFINITY : Math.max(0, Math.floor(maxUsd * 100));
    if (capCents <= 0) return interaction.editReply('max_usd is $0.00 — nothing to pay.');
    let receiver = interaction.options.getString('paypal_email');
    let receiverSource = 'typed override';
    if (!receiver) {
      const saved = await resolveReceiverEmail(user.id).catch(() => null);
      if (!saved) {
        return interaction.editReply(`${memberLabel(user)} has no saved payout address. Ask them to run \`/paypal set\`, or pass \`paypal_email\` explicitly.`);
      }
      receiver = saved.email;
      receiverSource = `saved address ${saved.emailMasked}`;
    }
    /* Everything money runs inside the payout lock, and the payable snapshot
       is re-read there: a concurrent daily cycle cannot pay the same entries. */
    const result = await withPayoutLock(async () => {
      const lockedEntries = await getPayablePayoutEntries(user.id);
      const payable = [];
      let running = 0;
      for (const entry of lockedEntries) {
        const amount = Number(entry.amountCents || 0);
        if (running + amount > capCents && payable.length) break;
        if (amount > capCents && !payable.length) break;
        payable.push(entry);
        running += amount;
      }
      if (!payable.length || running <= 0) return { empty: true };
      const payout = await createPayPalPayout({
        receiverEmail: receiver,
        amountCents: running,
        senderItemId: `discord-${interaction.id}`,
        note: `Daily Social Payouts approved work for Discord user ${user.id}`,
      });
      if (!payout.dryRun) {
        await markPayoutEntriesPaid({
          userId: user.id,
          entryIds: payable.map((row) => row.id || row.sourceId),
          paidBy: interaction.user.id,
          receiver: maskEmail(receiver), // the ledger renders in Discord; never store the live address
          payoutBatchId: payout.batchId,
          payoutItemId: payout.itemId,
          dryRun: false,
        });
      }
      return { payout, payableCount: payable.length };
    });
    if (result.empty) return interaction.editReply(`${memberLabel(user)} has no payable balance inside that cap right now.`);
    const { payout } = result;
    const embed = new EmbedBuilder()
      .setColor(payout.dryRun ? 0xf59e0b : 0x22c55e)
      .setTitle(payout.dryRun ? 'PayPal payout dry run complete' : 'PayPal payout submitted')
      .setDescription(`${memberLabel(user)}\nAmount: **${payout.amount}**\nStatus: **${payout.status}**`)
      .addFields(
        { name: 'Batch ID', value: `\`${payout.batchId}\``, inline: false },
        { name: 'Ledger entries', value: String(result.payableCount), inline: true },
        { name: 'Dry run', value: payout.dryRun ? 'YES — no money sent and ledger not marked paid' : 'NO — ledger marked paid', inline: true },
      )
      .setFooter({ text: `Receiver: ${receiverSource}. Only a masked address is stored in the ledger.` });
    return interaction.editReply({ embeds: [embed] });
  }
  return interaction.editReply('Unknown payout-admin action.');
}
