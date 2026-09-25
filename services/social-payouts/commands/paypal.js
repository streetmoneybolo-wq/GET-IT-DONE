import {
  ActionRowBuilder,
  EmbedBuilder,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import {
  getReceiverMasked,
  isValidPayoutEmail,
  receiverStoreStatus,
  removeReceiver,
  saveReceiver,
} from '../utils/payoutReceivers.js';
import { dailyPayoutConfig } from '../utils/dailyPayoutCycle.js';
import { centsToUsd } from '../utils/payoutPolicy.js';

/**
 * Member payout details, handled entirely inside a private Discord modal.
 * Nothing is ever posted to a channel: the modal goes only to the bot, the
 * stored address is encrypted at rest, and every render after that shows the
 * masked form. The old guidance not to post PayPal emails in public channels
 * still stands - this flow is the sanctioned replacement.
 */

export const data = new SlashCommandBuilder()
  .setName('paypal')
  .setDescription('Manage the PayPal address your Daily Social Payouts are sent to.')
  .setDMPermission(false)
  .addSubcommand((sub) => sub.setName('set').setDescription('Save or replace your payout PayPal address (private form).'))
  .addSubcommand((sub) => sub.setName('status').setDescription('Show your saved payout address (masked) and payout rules.'))
  .addSubcommand((sub) => sub.setName('remove').setDescription('Delete your saved payout address.'));

function rulesField() {
  const config = dailyPayoutConfig();
  return {
    name: 'Daily payout rules',
    value: `Balances of **${centsToUsd(config.minCents)}+** with a saved address are included in the daily payout run. Smaller balances roll forward. Amounts follow the \`/earnings\` ledger and its hold rules.`,
    inline: false,
  };
}

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Run this inside the payout Discord server.', ephemeral: true });
  }
  const store = receiverStoreStatus();
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'status') {
    await interaction.deferReply({ ephemeral: true });
    const saved = store.enabled ? await getReceiverMasked(interaction.user.id) : null;
    const embed = new EmbedBuilder()
      .setColor(saved ? 0x22c55e : 0xf59e0b)
      .setTitle(saved ? 'PayPal payout address saved' : 'No payout address saved')
      .setDescription(saved
        ? `Daily payouts for your payable balance go to **${saved.emailMasked}** (saved <t:${Math.floor(Date.parse(saved.confirmedAt) / 1000)}:R>).\nUse \`/paypal set\` to replace it or \`/paypal remove\` to delete it.`
        : store.enabled
          ? 'Use `/paypal set` to save your PayPal address in a private form. Never post payout emails in channels.'
          : 'Payout address storage is not enabled on this server yet. An admin must configure it first.')
      .addFields(rulesField());
    return interaction.editReply({ embeds: [embed] });
  }

  if (subcommand === 'remove') {
    await interaction.deferReply({ ephemeral: true });
    if (!store.enabled) return interaction.editReply('Payout address storage is not enabled on this server yet.');
    const removed = await removeReceiver(interaction.user.id);
    return interaction.editReply(removed
      ? 'Your saved payout address was deleted. You will be skipped by payout runs until you save a new one with `/paypal set`.'
      : 'You have no saved payout address.');
  }

  // set
  if (!store.enabled) {
    return interaction.reply({ content: `Payout address storage is not enabled yet: ${store.reason}`, ephemeral: true });
  }
  const modalId = `paypal-set-${interaction.id}`;
  const modal = new ModalBuilder()
    .setCustomId(modalId)
    .setTitle('Save your PayPal payout address')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('paypal_email').setLabel('PayPal email').setPlaceholder('you@example.com').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(254),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('paypal_email_confirm').setLabel('Type it again to confirm').setPlaceholder('you@example.com').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(254),
      ),
    );
  await interaction.showModal(modal);
  let submitted;
  try {
    submitted = await interaction.awaitModalSubmit({
      time: 5 * 60_000,
      filter: (modalInteraction) => modalInteraction.customId === modalId && modalInteraction.user.id === interaction.user.id,
    });
  } catch {
    return; // modal dismissed or timed out; nothing was stored
  }
  await submitted.deferReply({ ephemeral: true });
  const email = String(submitted.fields.getTextInputValue('paypal_email') || '').trim();
  const confirm = String(submitted.fields.getTextInputValue('paypal_email_confirm') || '').trim();
  if (email.toLowerCase() !== confirm.toLowerCase()) {
    return submitted.editReply('The two entries did not match. Nothing was saved — run `/paypal set` again.');
  }
  if (!isValidPayoutEmail(email)) {
    return submitted.editReply('That does not look like a valid email address. Nothing was saved.');
  }
  try {
    const saved = await saveReceiver({ userId: interaction.user.id, userName: interaction.user.username, email });
    const embed = new EmbedBuilder()
      .setColor(0x22c55e)
      .setTitle('Payout address saved')
      .setDescription(`Daily payouts for your payable balance will go to **${saved.emailMasked}**.\nA payout to a wrong address cannot be recovered, so double-check the masked form above matches the account you meant.`)
      .addFields(rulesField())
      .setFooter({ text: 'Stored encrypted. Only the masked form is ever displayed.' });
    return submitted.editReply({ embeds: [embed] });
  } catch (error) {
    return submitted.editReply(`Could not save the address: ${String(error.message || error).slice(0, 200)}`);
  }
}
