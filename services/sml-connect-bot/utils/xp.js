export const XP = Object.freeze({
  share: 10,
  boost: 5,
  comment: 8,
  upvote: 6,
  repost: 12,
});

export function levelFor(xp) {
  return Math.floor(Math.max(0, Number(xp) || 0) / 100) + 1;
}
