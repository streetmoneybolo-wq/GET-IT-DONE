import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { getReceiverMasked, receiverStoreStatus } from '../utils/payoutReceivers.js';
import { paypalPayoutStatus } from '../utils/paypalStatus.js';

/**
 * Kept as an alias for muscle memory: payout addresses are now saved with
 * `/paypal set` (a private modal, encrypted at rest). This command explains
 * that instead of linking to the never-built dashboard payouts tab.
 */

export const data = new SlashCommandBuilder()
  .setName('connect-paypal')
  .setDescription('How to connect PayPal for Daily Social Payouts.')
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Run this inside the payout Discord server.', ephemeral: true });
  }
  const store = receiverStoreStatus();
  const saved = store.enabled ? await getReceiverMasked(interaction.user.id).catch(() => null) : null;
  const paypal = paypalPayoutStatus();
  const embed = new EmbedBuilder()
    .setColor(saved ? 0x22c55e : 0xf59e0b)
    .setTitle(saved ? 'PayPal payout address saved' : 'Connect PayPal for payouts')
    .setDescription(saved
      ? `Your payouts go to **${saved.emailMasked}**. Use \`/paypal status\`, \`/paypal set\`, or \`/paypal remove\` to manage it.`
      : store.enabled
        ? 'Run **`/paypal set`** — a private form only the bot receives. Your address is stored encrypted and only ever shown masked. Never post PayPal emails, passwords, or payment credentials in channels.'
        : 'Payout address storage is not enabled on this server yet. An admin must configure it before addresses can be saved.')
    .setFooter({ text: paypal.connected ? 'Payout processing is connected on the server side.' : 'Payout processing is not yet enabled on the server side.' });
  return interaction.reply({ embeds: [embed], ephemeral: true });
}
