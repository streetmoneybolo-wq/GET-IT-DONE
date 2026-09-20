export const DEFAULT_GAIN_MILESTONES = Object.freeze([100, 200, 500, 700, 900, 1200]);

export function gainPercent(entryPrice, highPrice) {
  const entry = Number(entryPrice);
  const high = Number(highPrice);
  if (!(entry > 0) || !(high >= 0)) return null;
  return ((high - entry) / entry) * 100;
}

export function priceForGain(entryPrice, gain) {
  const entry = Number(entryPrice);
  const percent = Number(gain);
  if (!(entry > 0) || !(percent >= 0)) return null;
  return entry * (1 + percent / 100);
}

export function newlyCrossedMilestones({ entryPrice, highPrice, milestones = DEFAULT_GAIN_MILESTONES, completed = [] }) {
  const gain = gainPercent(entryPrice, highPrice);
  if (gain === null) return [];
  const done = new Set(completed.map(Number));
  return [...new Set(milestones.map(Number))]
    .filter((milestone) => Number.isFinite(milestone) && milestone >= 0 && gain + 1e-9 >= milestone && !done.has(milestone))
    .sort((a, b) => a - b)
    .map((milestone) => ({
      milestoneGainPercent: milestone,
      thresholdPrice: priceForGain(entryPrice, milestone),
      observedHigh: Number(highPrice),
      observedGainPercent: gain,
      articleType: 'milestone-update',
    }));
}

export function planMilestoneArticle(crossings) {
  if (!crossings?.length) return null;
  const ordered = [...crossings].sort((a, b) => a.milestoneGainPercent - b.milestoneGainPercent);
  const highest = ordered.at(-1);
  return {
    ...highest,
    crossedMilestones: ordered.map((row) => row.milestoneGainPercent),
    articleType: 'milestone-update',
  };
}

function zonedParts(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const get = (type) => parts.find((part) => part.type === type)?.value || '';
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

export function endOfDayRecapDue({ now, firstMilestoneArticleAt, alreadyCompleted = false, time = '19:10', timeZone = 'America/Chicago' }) {
  if (alreadyCompleted || !firstMilestoneArticleAt) return false;
  const current = zonedParts(now, timeZone);
  const first = zonedParts(firstMilestoneArticleAt, timeZone);
  return current.date === first.date && current.time >= time;
}
