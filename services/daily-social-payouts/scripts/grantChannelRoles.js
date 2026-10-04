/* Give everyone who can see a channel a set of roles (the Verified and Free Member roles for the Making Easy Money server).
 *
 * Usage (dry run is the default and changes nothing):
 *   DISCORD_BOT_TOKEN=... node scripts/grantChannelRoles.js --channel 938894329542479964 --roles 1553704513070960651,1553281948527362100
 *   ... add --apply to really grant them.
 *
 * The bot needs Manage Roles, its top role must sit ABOVE both roles, and the Server Members intent must be on.
 * Roles that are missing are added one member at a time, slowly, so Discord's rate limits are respected. Nothing is removed. */
import { Client, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { planChannelRoleGrants, cleanIds } from '../utils/channelRoleGrant.js';

const arg = (name) => { const i = process.argv.indexOf('--' + name); return i >= 0 ? process.argv[i + 1] : ''; };
const apply = process.argv.includes('--apply');
const channelId = String(arg('channel') || '').replace(/\D/g, '');
const roleIds = cleanIds(String(arg('roles') || '').split(','));
const token = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
if (!token || !channelId || !roleIds.length) {
  console.error('Need DISCORD_BOT_TOKEN in the environment, --channel <id> and --roles <id,id>.');
  process.exit(2);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

client.once('ready', async () => {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.guild) throw new Error('That channel was not found in a server the bot is in.');
    const guild = channel.guild;
    const me = guild.members.me || await guild.members.fetchMe();
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) throw new Error('The bot lacks Manage Roles in ' + guild.name + '.');
    const roles = roleIds.map((id) => guild.roles.cache.get(id) || null);
    const missingRole = roleIds.filter((id, i) => !roles[i]);
    if (missingRole.length) throw new Error('These roles are not in ' + guild.name + ': ' + missingRole.join(', '));
    const tooHigh = roles.filter((r) => r.position >= me.roles.highest.position).map((r) => r.name);
    if (tooHigh.length) throw new Error('Move the bot role above: ' + tooHigh.join(', ') + ' (Discord only lets a bot grant roles below its own).');

    const all = await guild.members.fetch();
    const plan = planChannelRoleGrants([...all.values()].map((m) => ({
      id: m.id, bot: m.user.bot, roleIds: [...m.roles.cache.keys()],
      canView: channel.permissionsFor(m)?.has(PermissionFlagsBits.ViewChannel) === true
    })), roleIds);

    console.log(`${guild.name}: ${all.size} members, ${plan.cannotView} cannot see #${channel.name}, ${plan.skippedBots} bots, ${plan.alreadyComplete} already have both roles.`);
    console.log(`${plan.grants.length} members need roles: ${roles.map((r) => r.name).join(' + ')}.`);
    if (!apply) { console.log('Dry run. Nothing was changed. Add --apply to grant them.'); return; }

    let done = 0, failed = 0;
    for (const g of plan.grants) {
      try {
        await all.get(g.id).roles.add(g.missing, 'Roles for everyone who can see #' + channel.name);
        done += 1;
      } catch (error) { failed += 1; console.error('Could not update ' + g.id + ': ' + (error.message || error)); }
      await sleep(350);
    }
    console.log(`Done. ${done} updated, ${failed} failed.`);
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});
client.login(token);
