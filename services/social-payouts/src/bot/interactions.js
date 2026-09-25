/* Routes every interaction to the feature that owns it. Handlers return false when the interaction is not theirs. */
import { readSettings } from '../../utils/storage.js';
import { linkWorkflowForShareChannel } from '../../utils/linkWorkflow.js';
import { recruitPost, recruitRandom } from '../interactions/recruitment.js';
import { proofButtons, proofLinkModal, proofReview } from '../interactions/proofs.js';
import { commentIdeaButton, engagementButtons, reshareButtons } from '../interactions/engagement.js';
import { externalLinkModal, shareButton, submitLinkButton } from '../interactions/sharing.js';

/* Order matters only where two patterns could overlap; each handler checks its own custom-id pattern first. */
const HANDLERS = [recruitRandom, recruitPost, proofReview, proofLinkModal, proofButtons, engagementButtons, reshareButtons, externalLinkModal, submitLinkButton, commentIdeaButton, shareButton];

export async function handleInteraction(interaction, client) {
  for (const handler of HANDLERS) {
    if ((await handler(interaction)) !== false) return;
  }
  if (interaction.isButton()) {
    // A button from the retired StockMarketLoop Connect share cards: point the member at the current card instead of failing silently.
    const settings = await readSettings().catch(() => ({}));
    const linksToPostChannelId = settings.workerChannels?.linksToPostChannelId || settings.linkWorkflow?.shareChannelId;
    if ((linksToPostChannelId && interaction.channelId === linksToPostChannelId) || linkWorkflowForShareChannel(settings, interaction.channelId, interaction.guildId)) {
      await interaction.reply({
        content: [
          'That old StockMarketLoop Connect button is no longer active.',
          '',
          'Use the newest article card at the bottom of this channel. The working buttons are labeled:',
          '**Reddit · X · Stocktwits · Bluesky · Threads · Facebook**',
          '',
          'If you still see the error, ask an admin to repost the article link in the intake channel so the bot creates a fresh card.',
        ].join('\n'),
        ephemeral: true,
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
    return;
  }
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) return;
  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    const payload = { content: 'The command failed safely. Nothing was posted externally.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => {});
    else await interaction.reply(payload).catch(() => {});
  }
}
