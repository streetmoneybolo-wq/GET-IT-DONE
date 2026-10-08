import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { centsToUsd, payoutPolicy } from '../utils/payoutPolicy.js';
import { getUserPayoutSummary } from '../utils/payoutLedger.js';

function summarizeRecent(rows) {
  return rows.slice(0, 8).map((row) => {
    const when = row.createdAt ? `<t:${Math.floor(Date.parse(row.createdAt) / 1000)}:R>` : 'recently';
    const status = String(row.status || 'pending_hold').replaceAll('_', ' ');
    const action = row.type === 'published_link' ? 'posted link' : row.action;
    return `• **${row.amountUsd || centsToUsd(row.amountCents)}** — ${row.platformLabel || row.platform} ${action} · ${status} · ${when}`;
  }).join('\n') || 'No payout work is recorded yet.';
}

export const data = new SlashCommandBuilder()
  .setName('earnings')
  .setDescription('Show your Daily Social Payouts earnings ledger.');

export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const summary = await getUserPayoutSummary(interaction.user.id);
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle('💵 Your Daily Social Payouts ledger')
    .setDescription('These totals are based on returned public post links and approved engagement proof. Amounts can still be voided if the public link/proof is removed before the verification threshold.')
    .addFields(
      { name: 'Pending hold', value: summary.formatted.pendingCents, inline: true },
      { name: 'Payable now', value: summary.formatted.payableCents, inline: true },
      { name: 'Paid', value: summary.formatted.paidCents, inline: true },
      { name: 'Voided/rejected', value: summary.formatted.voidedCents, inline: true },
      { name: 'Total valid work', value: summary.formatted.totalEarnedCents, inline: true },
      { name: 'Hold rules', value: `Links must stay public at least **${payoutPolicy.publicLinkMinimumHours} hours**. Payout entries become payable after **${payoutPolicy.verificationHoldHours} hours** if still valid.`, inline: false },
      { name: 'Recent work', value: summarizeRecent(summary.rows), inline: false },
      { name: 'PayPal payouts', value: 'PayPal account connection must happen through a secure payout dashboard, not by posting PayPal emails in Discord. Once the secure PayPal setup is connected, this ledger can be paid from the payable balance.', inline: false },
    )
    .setFooter({ text: 'Use the proof buttons on each work item so your work can be reviewed and counted.' })
    .setTimestamp();
  await interaction.editReply({ embeds: [embed] });
}
