/* Discord reactions on tracked share packages become engagement records and XP. */
import { postByMessage, recordEngagement } from '../../utils/tracking.js';
import { reportWorkEvent } from '../../utils/workReport.js';
import { XP } from '../../utils/xp.js';

const reactionTypes = new Map([['🚀', 'boost'], ['⬆️', 'upvote'], ['👍', 'upvote'], ['🔁', 'repost']]);

export async function onReaction(reaction, user, remove) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const type = reactionTypes.get(reaction.emoji.name);
  if (!type) return;
  const post = await postByMessage(reaction.message.id);
  if (!post) return;
  const changed = await recordEngagement({
    postID: post.postID,
    userId: user.id,
    userName: user.username,
    type,
    eventId: `${reaction.message.id}:${reaction.emoji.name}:${user.id}`,
    remove,
  });
  if (changed) {
    const displayType = reaction.emoji.name === '👍' ? 'like' : type;
    await reportWorkEvent(reaction.message.client, {
      type: remove ? `${displayType}_removed` : displayType,
      eventKey: `reaction:${remove ? 'remove' : 'add'}:${reaction.message.id}:${reaction.emoji.name}:${user.id}`,
      userId: user.id, userName: user.username, post, articleUrl: post.link,
    });
    const amount = XP[type] || 0;
    await user.send(`# ${remove ? '↩️ ACTIVITY REMOVED' : '✅ ACTIVITY COMPLETE'}\nYour Discord ${displayType} reaction was recorded and **${remove ? '-' : '+'}${amount} internal XP** was ${remove ? 'removed' : 'applied'}.\n\nInternal XP has no cash value. This confirms the Discord reaction only; it does not independently verify an external-platform action.`).catch(() => {});
  }
}



