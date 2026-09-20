import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { dashboardUrl } from '../utils/onboarding.js';
import { paypalPayoutStatus, paypalSetupText } from '../utils/paypalStatus.js';

function payoutDashboardUrl(guild) {
  const url = new URL(dashboardUrl(guild?.name || '', guild?.id || ''));
  url.searchParams.set('tab', 'payouts');
  url.searchParams.set('connect', 'paypal');
  return url.toString();
}

export const data = new SlashCommandBuilder()
  .setName('paypal')
  .setDescription('Open the secure PayPal payout setup page.')
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Run this inside the payout Discord server.', ephemeral: true });
  }
  const url = payoutDashboardUrl(interaction.guild);
  const status = paypalPayoutStatus();
  const embed = new EmbedBuilder()
    .setColor(status.connected ? 0x22c55e : 0xf59e0b)
    .setTitle(status.connected ? 'PayPal payouts connected' : 'PayPal payouts not connected yet')
    .setDescription(`${paypalSetupText(status)}\n\nUse the dashboard for payout setup/status. Do not post PayPal emails, passwords, cookies, or payment credentials in Discord.`)
    .setURL(url);
  return interaction.reply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open PayPal setup').setURL(url),
    )],
    ephemeral: true,
  });
}
