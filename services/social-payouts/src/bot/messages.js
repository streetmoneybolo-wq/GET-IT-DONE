/* Routes every guild message to the flow that owns it. */
import { readSettings } from '../../utils/storage.js';
import { processLinkWorkflow } from '../../utils/linkWorkflow.js';
import { handlePaypalInfoMessage, handleSocialApplicationMessage } from '../features/socialApplications.js';
import { handleDiscordComment, handleProofScreenshot, handleReturnedLink } from '../features/messageFlows.js';

export async function handleMessage(message) {
  if (!message.guild || message.author?.bot) return;
  const settings = await readSettings();
  if (await handlePaypalInfoMessage(message, settings)) return;
  if (await handleSocialApplicationMessage(message, settings)) return;
  if (await handleReturnedLink(message, settings)) return;
  if (await processLinkWorkflow(message)) return;
  if (!message.reference?.messageId) return;
  const referenced = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
  if (await handleProofScreenshot(message, referenced)) return;
  await handleDiscordComment(message);
}
