'use strict';

/* Smart alert routing: which Discord channels suit an alert, and how long an alert stays tracked.
   Channel names are read for what they are for (options, stocks, day trades, swings, long holds) and for who may see them
   (free and open to any trader, or paid). An options contract suggests the options channels, a stock the stock channels, and the
   time the move should take (day, swing, mid, long) narrows it further. Free channels open to every kind of trader (stocks or
   options) are always a fit. Nothing here posts; it only ranks. */

const TRACK_TRADING_DAYS = 5;
const DAY = 86_400_000;

const OPTIONS = /(option|opt\b|opts\b|call|put|0dte|\bdte\b|flow|contract|spread|premium|leap|gamma|unusual)/i;
const STOCKS = /(stock|equit|share|ticker|penny|small-?cap|momentum|breakout|runner|gapper|movers?|watch ?list|\bpt\b|price-?target|setup)/i;
const DAY_TRADE = /(day-?trad|intraday|scalp|0dte|quick|gapper|premarket|pre-?market|live)/i;
const SWING = /(swing|multi-?day|week)/i;
const LONG = /(long-?term|invest|hold|leaps?|position|core|portfolio|month)/i;
const FREE = /(free|public|open|everyone|all-?traders|community|general|lounge|welcome|trial|guest|new-?member)/i;
const PAID = /(vip|premium|paid|pro\b|elite|inner|private|member(s)?-?only|gold|platinum|exclusive|mentorship)/i;
const NOT_ALERTS = /(rules|welcome|announce|faq|support|ticket|bot-?command|music|meme|off-?topic|intro|verify|log|admin|mod\b|staff)/i;
const ALERTISH = /(alert|signal|pick|call|trade|play|idea|setup|watch|plays|entry|flow|scan|move)/i;

const squash = (s) => String(s || '').replace(/[\u{1F000}-\u{1FFFF}☀-➿️|│┃・•·_]+/gu, '-').replace(/\s+/g, '-').toLowerCase();

/* what one channel is for, from its name and its category's name */
function classifyChannel(name, category = '') {
  const n = squash(name), c = squash(category), both = n + ' ' + c;
  const options = OPTIONS.test(n) || (OPTIONS.test(c) && !STOCKS.test(n));
  const stocks = STOCKS.test(n) || (STOCKS.test(c) && !OPTIONS.test(n));
  const paid = PAID.test(n) || (PAID.test(c) && !FREE.test(n));
  const free = FREE.test(n) || (FREE.test(c) && !PAID.test(n)) || (!paid && /alerts?|signals?|picks?/.test(n) && !PAID.test(c));
  const horizons = [];
  if (DAY_TRADE.test(both)) horizons.push('day');
  if (SWING.test(both)) horizons.push('swing');
  if (LONG.test(both)) horizons.push('long');
  return { options, stocks, general: !options && !stocks, free: !!free && !paid, paid: !!paid, horizons, alertish: ALERTISH.test(both) || options || stocks, skip: NOT_ALERTS.test(n) && !ALERTISH.test(n) };
}

/* rank a member's channels for an alert of this kind ('stock' | 'option') and horizon ('day' | 'swing' | 'mid' | 'long').
   Returns every channel with { kinds, free, score, suggested, reason }, best first. */
function suggest(channels, { kind = 'stock', horizon = 'swing', saved = [] } = {}) {
  const want = kind === 'option' ? 'options' : 'stocks';
  const savedSet = new Set((saved || []).map(String));
  const rows = (channels || []).map((ch) => {
    const k = classifyChannel(ch.name, ch.category);
    let score = 0; const why = [];
    if (k.skip) score -= 6;
    if (k[want]) { score += 6; why.push(kind === 'option' ? 'an options channel' : 'a stocks channel'); }
    else if (k.options || k.stocks) { score -= 3; why.push('for ' + (k.options ? 'options' : 'stocks') + ' only'); }
    else if (k.alertish) { score += 2; why.push('open to stocks and options'); }
    if (k.free) { score += 3; why.push('free for any trader'); }
    if (k.paid) { score -= 1; why.push('paid members'); }
    const h = horizon === 'mid' ? 'swing' : horizon;
    if (k.horizons.includes(h)) { score += 3; why.push('matches a ' + horizon + ' alert'); }
    else if (k.horizons.length && !k.horizons.includes(h)) score -= 2;
    if (savedSet.has(String(ch.id))) { score += 4; why.push('you picked it before'); }
    return { ...ch, kinds: [k.options ? 'options' : '', k.stocks ? 'stocks' : '', k.general ? 'general' : ''].filter(Boolean), free: k.free, paid: k.paid, score, reason: why.join(', ') };
  });
  rows.sort((a, b) => b.score - a.score);
  /* suggest every channel that clearly fits, never more than three, at least the best one when anything is alert-like */
  let n = 0;
  for (const r of rows) { r.suggested = r.score >= 5 && n < 3; if (r.suggested) n++; }
  if (!n && rows[0] && rows[0].score >= 2) rows[0].suggested = true;
  return rows;
}

/* ---------- tracking: an alert stays live for 5 trading days or until it is sold ---------- */
const isWeekend = (ms) => { const d = new Date(ms).getUTCDay(); return d === 0 || d === 6; };
/* the moment 5 trading days (Mon-Fri) before `nowMs`, counted on UTC dates: the start of the window an alert is still tracked in */
function trackingSince(nowMs, days = TRACK_TRADING_DAYS) {
  let t = nowMs, left = days;
  while (left > 0) { t -= DAY; if (!isWeekend(t)) left--; }
  return t;
}
/* is this alert (posted at atMs) still tracked? it is when it is within 5 trading days and nothing has closed it since */
const isTracked = (atMs, nowMs, soldAtMs = null) => Number.isFinite(atMs) && atMs >= trackingSince(nowMs) && !(Number.isFinite(soldAtMs) && soldAtMs >= atMs);

module.exports = { classifyChannel, suggest, trackingSince, isTracked, TRACK_TRADING_DAYS };
