/* Creates the Discord client and connects every event to the module that handles it. */
import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { readSettings } from '../../utils/storage.js';
import { buildCommandCollection, registerCommandsInGuild } from './commands.js';
import { handleInteraction } from './interactions.js';
import { handleMessage } from './messages.js';
import { onReady } from './ready.js';
import { onReaction } from '../features/reactions.js';
import { sendDailySocialWelcome } from '../features/socialApplications.js';

/* Message Content and Server Members are privileged intents: both must also be switched on in the Discord Developer Portal.
   Members is needed for the join welcome and role grants; set MEMBERS_INTENT=0 to run without it. */
export function buildIntents(env = process.env) {
  const intents = [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent,
  ];
  if (env.MEMBERS_INTENT !== '0') intents.push(GatewayIntentBits.GuildMembers);
  return intents;
}

const guard = (label, fn) => (...args) => Promise.resolve(fn(...args)).catch((error) => console.error(`${label} failed safely:`, error?.message || error));

export function createBotClient() {
  const client = new Client({ intents: buildIntents(), partials: [Partials.Message, Partials.Channel, Partials.Reaction] });
  client.commands = buildCommandCollection();
  client.stopBackgroundJobs = () => {};

  client.once('clientReady', async () => {
    try {
      client.stopBackgroundJobs = await onReady(client);
    } catch (error) {
      console.error('Startup failed:', error);
    }
  });
  client.on('guildCreate', guard('Guild registration', (guild) => registerCommandsInGuild(client, guild)));
  client.on('guildMemberAdd', guard('Join welcome', async (member) => sendDailySocialWelcome(member, await readSettings())));
  client.on('interactionCreate', guard('Interaction', (interaction) => handleInteraction(interaction, client)));
  client.on('messageCreate', guard('Message', handleMessage));
  client.on('messageReactionAdd', guard('Reaction add', (reaction, user) => onReaction(reaction, user, false)));
  client.on('messageReactionRemove', guard('Reaction remove', (reaction, user) => onReaction(reaction, user, true)));
  client.on('error', (error) => console.error('Discord client error:', error));
  return client;
}
