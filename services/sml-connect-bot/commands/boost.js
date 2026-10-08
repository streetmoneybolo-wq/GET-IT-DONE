import { SlashCommandBuilder } from 'discord.js';
import { mutateJson, paths, readSettings } from '../utils/storage.js';

export const data = new SlashCommandBuilder()
  .setName('boost')
  .setDescription('Opt in or out of the configured new-content notification role.')
  .addStringOption((option) => option.setName('state').setDescription('Notification preference').setRequired(true)
    .addChoices({ name: 'On', value: 'on' }, { name: 'Off', value: 'off' }));

export async function execute(interaction) {
  if (!interaction.guild || !interaction.member) return interaction.reply({ content: 'This command must be used inside the configured server.', ephemeral: true });
  const on = interaction.options.getString('state', true) === 'on';
  const roleId = process.env.BOOST_ROLE_ID;
  const settings = await readSettings();
  await mutateJson(paths.settings, settings, (value) => {
    value.subscribers ||= [];
    value.subscribers = value.subscribers.filter((id) => id !== interaction.user.id);
    if (on) value.subscribers.push(interaction.user.id);
  });
  if (!roleId) return interaction.reply({ content: `Preference saved (${on ? 'on' : 'off'}), but BOOST_ROLE_ID is not configured.`, ephemeral: true });
  const role = interaction.guild.roles.cache.get(roleId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!role || !interaction.guild.members.me?.permissions.has('ManageRoles') || role.position >= interaction.guild.members.me.roles.highest.position) {
    return interaction.reply({ content: 'Preference saved, but the bot cannot manage the configured notification role. Check role order and Manage Roles permission.', ephemeral: true });
  }
  if (on) await member.roles.add(role, 'Member opted into StockMarketLoop content alerts');
  else await member.roles.remove(role, 'Member opted out of StockMarketLoop content alerts');
  return interaction.reply({ content: `Content notifications are now ${on ? 'on' : 'off'}.`, ephemeral: true });
}
