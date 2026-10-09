'use strict';

/* Catalyst check for Click-to-Alert: the next earnings date and the week's news for the stock, read against the alert's own window.
 *
 * It answers two questions a trader asks before posting: is there an earnings report inside the time this alert needs (or before the
 * contract expires), and does this week's news lean with the idea or against it? The answer is a verdict (supports / caution /
 * against / quiet), the reasons in plain sentences for the panel, a one-line note for the alert text, and whether the risk grade
 * should step up a notch. Pure: everything is passed in, nothing is fetched. Missing data is reported as unknown, never as "no risk".
 * Educational analysis, not advice. */

const { extractNextEarnings } = require('./academy-earnings-date');
const { CHATTER_ALARM } = require('./academy-alert-risk');

const POSITIVE = /\b(beat|beats|tops|raises? (?:guidance|outlook|forecast|dividend)|upgrade[sd]?|record (?:revenue|sales|quarter|high|profit)|approv(?:al|ed|es)|wins?|awarded|contract|partnership|buyback|surge[sd]?|soars?|rall(?:y|ies|ied)|breakout|expands?|strong demand|outperform|price target raised|profit (?:rises|jumps|climbs)|revenue (?:rises|jumps|climbs|grows))\b/i;
const NEGATIVE = /\b(miss(?:es|ed)?|cuts? (?:guidance|outlook|forecast|jobs|dividend)|downgrade[sd]?|lawsuit|investigation|probe|recall|offering|dilution|dilutive|bankrupt\w*|delist\w*|halt\w*|going concern|reverse split|fraud|short report|plunge[sd]?|sinks?|tumbles?|slumps?|underperform|price target cut|layoffs?|warns?|warning|weak demand|resign(?:s|ed|ation))\b/i;
const WINDOW_DAYS = { day: 2, swing: 14, mid: 180, long: 365 };
const NEWS_DAYS = 7;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const dateText = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || '')); return m ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) : String(iso || ''); };
const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);

/** +1 when a headline reads bullish, -1 bearish, 0 neutral. Red-flag wording (offerings, halts, probes) always reads bearish. */
function toneOf(text) {
  const t = String(text || '');
  if (CHATTER_ALARM.test(t)) return -1;
  const pos = (t.match(POSITIVE) || []).length, neg = (t.match(NEGATIVE) || []).length;
  return pos > neg ? 1 : neg > pos ? -1 : 0;
}

function assessCatalysts({ symbol = '', side = 'long', horizon = 'swing', expectedDays = null, dte = null, earnings = null, news = null, now = Date.now() } = {}) {
  const sym = String(symbol || '').toUpperCase();
  const long = side !== 'short';
  const reasons = [], warnings = [];
  let score = 0, riskBump = false;

  /* the alert's own window in calendar days: the slow case of the horizon estimate, else the horizon band */
  const slow = expectedDays && Number(expectedDays.high) > 0 ? Number(expectedDays.high) * 1.4 : null;
  const windowDays = Math.max(1, Math.round(slow || WINDOW_DAYS[horizon] || WINDOW_DAYS.swing));
  const contractDays = Number(dte) > 0 ? Number(dte) : null;

  /* ---- earnings ---- */
  const next = earnings && typeof earnings === 'object' && typeof earnings.date === 'string' && Number.isFinite(Number(earnings.daysAway))
    ? { date: earnings.date.slice(0, 10), daysAway: Number(earnings.daysAway), confirmedEstimate: !!earnings.confirmedEstimate }
    : (earnings ? extractNextEarnings(earnings, now) : null);
  let earningsOut = null, riskNote = '';
  if (next) {
    const d = next.daysAway, when = dateText(next.date) + ' (' + (d <= 0 ? 'today' : d === 1 ? 'tomorrow' : 'in ' + d + ' days') + ')';
    const beforeExpiry = contractDays != null && d <= contractDays;
    const inWindow = d <= windowDays;
    earningsOut = { date: next.date, daysAway: d, confirmedEstimate: next.confirmedEstimate, beforeExpiry, inWindow, windowDays, contractDays };
    if (beforeExpiry) {
      score -= 0.6; riskBump = true;
      reasons.push('Earnings ' + when + ' land before this contract expires. The report can move ' + sym + ' either way, and the premium usually deflates right after it (volatility crush).');
      warnings.push('earnings_before_expiry');
      riskNote = 'Earnings ' + when + ' before expiry — expect a gap either way and a volatility drop after the report.';
    } else if (inWindow) {
      score -= d <= 7 ? 0.5 : 0.3; if (d <= 7) riskBump = true;
      reasons.push('Earnings ' + when + ' fall inside this alert\'s window (about ' + windowDays + ' days). The report can gap the stock through the target or the stop.');
      warnings.push('earnings_in_window');
      riskNote = 'Earnings ' + when + ' inside the window — a gap either way is possible.';
    } else {
      score += 0.2;
      reasons.push('No earnings inside the window: the next report is ' + dateText(next.date) + ', ' + d + ' days out' + (contractDays != null ? ', after the contract expires' : '') + '.');
    }
  } else reasons.push('No upcoming earnings date was found for ' + sym + ', so an earnings gap cannot be ruled out.');

  /* ---- news ---- */
  const cutoff = now - NEWS_DAYS * 86_400_000;
  const items = (Array.isArray(news) ? news : [])
    .map((n) => ({ title: clip(n && (n.title || n.headline), 140), excerpt: clip(n && (n.excerpt || n.summary || n.description), 200), url: String((n && n.url) || ''), date: String((n && (n.date || n.published || n.publishedAt)) || '') }))
    .filter((n) => n.title && (!n.date || !Number.isFinite(Date.parse(n.date)) || Date.parse(n.date) >= cutoff))
    .slice(0, 12)
    .map((n) => ({ ...n, tone: toneOf(n.title + ' ' + n.excerpt), alarm: CHATTER_ALARM.test(n.title + ' ' + n.excerpt) }));
  const pos = items.filter((n) => n.tone > 0).length, neg = items.filter((n) => n.tone < 0).length, alarm = items.filter((n) => n.alarm).length;
  const net = pos - neg, aligned = long ? net : -net;
  const tone = !items.length ? 'quiet' : alarm ? 'red_flag' : net > 0 ? 'positive' : net < 0 ? 'negative' : 'mixed';
  let setupNote = '';
  const lead = items.find((n) => (long ? n.tone > 0 : n.tone < 0)) || items.find((n) => n.tone !== 0) || items[0];
  if (alarm) {
    score -= 0.5; riskBump = true;
    reasons.push('Red-flag wording in this week\'s news (' + items.filter((n) => n.alarm).slice(0, 2).map((n) => '"' + n.title + '"').join(', ') + '): offerings, halts or probes can gap a stock regardless of the chart.');
    warnings.push('news_red_flag');
    setupNote = 'Red-flag news this week: ' + clip(items.find((n) => n.alarm).title, 70) + '.';
  } else if (!items.length) reasons.push('No news on ' + sym + ' in the last ' + NEWS_DAYS + ' days: the move is about the chart, not a headline.');
  else if (aligned > 0) {
    score += Math.min(0.5, 0.25 + aligned * 0.1);
    reasons.push('This week\'s news leans ' + (long ? 'bullish' : 'bearish') + ' (' + pos + ' positive, ' + neg + ' negative of ' + items.length + '), the same way as the alert' + (lead ? ': "' + lead.title + '"' : '') + '.');
    setupNote = 'News leans with the trade this week' + (lead ? ': ' + clip(lead.title, 70) : '') + '.';
  } else if (aligned < 0) {
    score -= 0.5;
    reasons.push('This week\'s news leans ' + (long ? 'bearish' : 'bullish') + ' (' + pos + ' positive, ' + neg + ' negative of ' + items.length + '), against the alert' + (lead ? ': "' + lead.title + '"' : '') + '.');
    warnings.push('news_against');
    setupNote = 'News leans against the trade this week' + (lead ? ': ' + clip(lead.title, 70) : '') + '.';
  } else {
    reasons.push(items.length + ' news item' + (items.length === 1 ? '' : 's') + ' this week with no clear lean' + (lead ? ' (latest: "' + lead.title + '")' : '') + '.');
    setupNote = 'News this week is mixed' + (lead ? ': ' + clip(lead.title, 70) : '') + '.';
  }

  const available = !!(next || items.length);
  const verdict = !available ? 'quiet' : score >= 0.3 ? 'supports' : score <= -0.6 ? 'against' : warnings.length ? 'caution' : 'supports';
  const headline = verdict === 'supports' ? 'Earnings and news back this alert' : verdict === 'caution' ? 'Worth knowing before you post' : verdict === 'against' ? 'Earnings or news cut against this alert' : 'No earnings date or news found';
  /* one line for the alert itself: the earnings situation first, then the news lean */
  const note = clip([riskNote || (next ? 'Next earnings ' + dateText(next.date) + ', outside the window.' : ''), setupNote].filter(Boolean).join(' '), 180);
  return {
    available, verdict, headline, score: Math.round(score * 100) / 100, riskBump, warnings, reasons, note, riskNote, setupNote,
    earnings: earningsOut, news: { count: items.length, positive: pos, negative: neg, alarm, tone, items: items.slice(0, 6).map((n) => ({ title: n.title, date: n.date, url: n.url, tone: n.tone })) }
  };
}

module.exports = { assessCatalysts, toneOf, POSITIVE, NEGATIVE, WINDOW_DAYS };
