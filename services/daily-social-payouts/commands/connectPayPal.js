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
  .setName('connect-paypal')
  .setDescription('Open the secure PayPal payout setup page for Daily Social Payouts.')
  .setDMPermission(false);

export async function execute(interaction) {
  if (!interaction.inGuild()) {
    return interaction.reply({ content: 'Run this inside the payout Discord server.', ephemeral: true });
  }
  const url = payoutDashboardUrl(interaction.guild);
  const status = paypalPayoutStatus();
  const embed = new EmbedBuilder()
    .setColor(status.connected ? 0x22c55e : 0xf59e0b)
    .setTitle(status.connected ? 'PayPal payouts connected' : 'Connect PayPal for payouts')
    .setDescription(
      `${paypalSetupText(status)}\n\n` +
      'Use the secure dashboard to connect payout details. Do not post PayPal emails, passwords, cookies, screenshots with private details, or payment credentials in Discord.\n\n' +
      'After PayPal payout setup is enabled on the dashboard, approved payable balances from `/earnings` can be paid from the admin payout screen.'
    )
    .setURL(url)
    .setFooter({ text: 'PayPal payout details must stay on the secure website dashboard.' });
  return interaction.reply({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open PayPal payout setup').setURL(url),
    )],
    ephemeral: true,
  });
}
