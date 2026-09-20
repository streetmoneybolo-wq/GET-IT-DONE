import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { centsToUsd } from '../utils/payoutPolicy.js';
import { getPayablePayoutEntries, getUserPayoutSummary, markPayoutEntriesPaid } from '../utils/payoutLedger.js';
import { createPayPalPayout } from '../utils/paypalPayouts.js';
import { paypalPayoutStatus, paypalSetupText } from '../utils/paypalStatus.js';

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
    .addStringOption((option) => option.setName('paypal_email').setDescription('Recipient PayPal email. Not stored.').setRequired(true))
    .addStringOption((option) => option.setName('confirm').setDescription('Type PAY to confirm.').setRequired(true))
    .addNumberOption((option) => option.setName('max_usd').setDescription('Optional cap for this payout run.')));

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.editReply('Only server managers can use payout admin commands.');
  }
  const subcommand = interaction.options.getSubcommand();
  const status = paypalPayoutStatus();
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
    if (!entries.length || totalCents <= 0) return interaction.editReply(`${memberLabel(user)} has no payable balance right now.`);
    const maxUsd = interaction.options.getNumber('max_usd');
    const capCents = maxUsd ? Math.max(0, Math.floor(maxUsd * 100)) : totalCents;
    const payable = [];
    let running = 0;
    for (const entry of entries) {
      const amount = Number(entry.amountCents || 0);
      if (running + amount > capCents && payable.length) break;
      if (amount > capCents && !payable.length) break;
      payable.push(entry);
      running += amount;
    }
    if (!payable.length || running <= 0) return interaction.editReply('No payable entries fit inside that max_usd cap.');
    const receiver = interaction.options.getString('paypal_email', true);
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
        receiver,
        payoutBatchId: payout.batchId,
        payoutItemId: payout.itemId,
        dryRun: false,
      });
    }
    const embed = new EmbedBuilder()
      .setColor(payout.dryRun ? 0xf59e0b : 0x22c55e)
      .setTitle(payout.dryRun ? 'PayPal payout dry run complete' : 'PayPal payout submitted')
      .setDescription(`${memberLabel(user)}\nAmount: **${payout.amount}**\nStatus: **${payout.status}**`)
      .addFields(
        { name: 'Batch ID', value: `\`${payout.batchId}\``, inline: false },
        { name: 'Ledger entries', value: String(payable.length), inline: true },
        { name: 'Dry run', value: payout.dryRun ? 'YES — no money sent and ledger not marked paid' : 'NO — ledger marked paid', inline: true },
      )
      .setFooter({ text: 'Recipient email is not stored in the payout ledger display.' });
    return interaction.editReply({ embeds: [embed] });
  }
  return interaction.editReply('Unknown payout-admin action.');
}
