'use strict';

/* PRE-ALERT CHECK: what a careful second pair of eyes would say before an alert goes out.
 *
 * It reads the alert about to be sent (stock, side, entry, first target, stop) against the candles, the other tools and the calendar, and
 * answers GO, CAUTION or WAIT with the reasons in plain words and a suggested first target and stop:
 *   - Is this a chase? A volume burst (academy-ignition.js) that started long ago, or a stock already far from its close, is the pattern
 *     behind late alerts: the entry is paid after the move.
 *   - Is the first target realistic? How often this stock's own history reached that target before the stop over the same horizon
 *     (academy-target-engine.js), and how many normal daily ranges away it is.
 *   - Is the stop sane? Missing, inside the stock's normal pull-back, or so wide the first target pays less than the stop risks.
 *   - Is the stock thin or in extended hours, do MEM ALGO's horizons lean against the side, is earnings inside two days.
 * It advises and never blocks: the member decides. A WAIT says what would make the setup cleaner (a pull-back level, a nearer first
 * target). Pure function; nothing is fetched or posted. Educational analysis, not advice. */

const E = require('./academy-target-engine');
const F = require('./academy-alert-forensics');
const I = require('./academy-ignition');

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r1 = (v) => Math.round(v * 10) / 10;
const px = (p) => (p >= 10 ? p.toFixed(2) : p >= 1 ? p.toFixed(3) : p.toFixed(4));
const horizonKey = (h) => { const x = String(h || '').toLowerCase(); return /day|intra|scalp/.test(x) ? 'day' : /swing|week/.test(x) ? 'swing' : x ? 'position' : 'swing'; };

function checkAlert({ symbol = '', side = 'long', entry, target, stop = null, price = null, bars5 = [], daily = [], alignment = null, earningsDays = null, horizon = 'swing', learned = null, now = Date.now() } = {}) {
  const dir = side === 'short' ? -1 : 1, sideName = dir > 0 ? 'long' : 'short';
  const p = num(price) > 0 ? Number(price) : num(entry);
  const e = num(entry) > 0 ? Number(entry) : p;
  const tg = num(target), st = num(stop);
  if (!(p > 0) || !(e > 0)) return { ok: false, reason: 'no_price' };
  const findings = [];
  const add = (level, code, text) => findings.push({ level, code, text });
  const hz = horizonKey(horizon);
  const b5 = (Array.isArray(bars5) ? bars5 : []).filter((b) => b && num(b.c) > 0), d1 = (Array.isArray(daily) ? daily : []).filter((b) => b && num(b.c) > 0);

  /* the target is on the wrong side of the entry */
  if (tg > 0 && (tg - e) * dir <= 0) add('stop', 'target_wrong_side', 'The target ' + px(tg) + ' is ' + (dir > 0 ? 'below' : 'above') + ' the entry ' + px(e) + ' for a ' + sideName + '. Check the side and the target.');

  /* is it a chase? */
  const ig = b5.length >= 30 ? I.read(b5, { now }) : null;
  if (ig && ig.active) {
    if (ig.direction === sideName) {
      if (ig.state === 'fresh') add('ok', 'fresh_burst', 'A fresh volume burst ' + ig.minutesAgo + ' minutes ago (' + ig.rvol + 'x normal): you are early, which is where these alerts win.');
      else if (ig.state === 'running') add('warn', 'burst_running', 'A volume burst started ' + ig.minutesAgo + ' minutes ago and price is ' + ig.fromClosePct + '% from the close: part of the move is already paid. Keep the first target near.');
      else if (ig.state === 'extended') add('stop', 'chase', 'This is a chase: the burst started ' + ig.minutesAgo + ' minutes ago and price is already ' + ig.fromClosePct + '% from the close (' + ig.chasePct + '% past the first burst candle). Late alerts like this are the ones that stall. Wait for a pull-back to a level, or alert with a near first target.');
      else add('warn', 'burst_fading', 'The burst is fading (volume has dried up and price is off its extreme): the easy part is behind it.');
    } else add('warn', 'burst_against', 'A volume burst ' + (ig.direction === 'long' ? 'up' : 'down') + ' is under way against your side.');
  } else if (d1.length) {
    const prior = num(d1[d1.length - 1].c), fromClose = prior > 0 ? (p / prior - 1) * dir * 100 : 0;
    if (fromClose >= 20) add('warn', 'already_ran', 'Price is already ' + r1(fromClose) + '% from the last close.');
  }

  /* the target against the stock's own range and history */
  const atr = F.atrPct(d1, now);
  let odds = null, targetPct = null;
  if (tg > 0 && (tg - e) * dir > 0) {
    targetPct = r1((tg / e - 1) * dir * 100);
    const inAtr = atr > 0 ? targetPct / atr : null;
    odds = E.oddsFor({ direction: sideName, horizon: hz, price: e, targetPrice: tg, stopPrice: st, bars5: b5, daily: d1 });
    if (odds && odds.p != null) {
      const pc = Math.round(odds.p * 100);
      if (pc < 10) add('stop', 'target_unrealistic', 'In this stock\'s own history, price reached a target ' + targetPct + '% away' + (st > 0 ? ' before the stop' : '') + ' only ' + pc + '% of the time over this horizon: it is out of reach for this setup. Pick a nearer first target and keep this one as a later step.');
      else if (pc < 20) add('warn', 'target_unlikely', 'In this stock\'s own history, ' + pc + '% of the time price reached a target ' + targetPct + '% away' + (st > 0 ? ' before the stop' : '') + ' over this horizon. A nearer first target wins far more often.');
      else if (pc < 40) add('warn', 'target_stretched', 'This target (' + targetPct + '% away) was reached ' + pc + '% of the time in this stock\'s history' + (st > 0 ? ' before the stop' : '') + '. Not bad, but a nearer first target would win more often.');
      else add('ok', 'target_realistic', 'This stock\'s own history reached a target this far away ' + pc + '% of the time' + (st > 0 ? ' before the stop' : '') + '.');
    } else if (inAtr != null) {
      if (inAtr > 3) add('warn', 'target_far', 'The target is ' + r1(inAtr) + ' normal daily ranges away: far beyond a typical day for this stock.');
      else add('ok', 'target_range_ok', 'The target is ' + r1(inAtr) + ' normal daily ranges away.');
    }
  }

  /* the stop */
  if (!(st > 0)) add('warn', 'no_stop', 'No stop is set. Say where the idea is wrong before you send it.');
  else if ((e - st) * dir <= 0) add('stop', 'stop_wrong_side', 'The stop ' + px(st) + ' is on the wrong side of the entry for a ' + sideName + '.');
  else {
    const stopPct = (1 - st / e) * dir * 100;
    if (atr > 0 && stopPct < atr * 0.35) add('warn', 'stop_tight', 'The stop is only ' + r1(stopPct) + '% away, inside this stock\'s normal movement (about ' + r1(atr) + '% a day): a routine wiggle can knock it out.');
    if (tg > 0 && (tg - e) * dir > 0 && targetPct / stopPct < 0.9) add('warn', 'bad_rr', 'The first target pays ' + r1(targetPct / stopPct) + 'x what the stop risks. Size it small, or tighten the stop to a level.');
  }

  /* thin stock, extended hours, the other tools, earnings */
  const sess = F.sessionAt(now);
  const regular = b5.filter((b) => F.sessionAt(b.t) === 'regular').slice(-390);
  const med = regular.length >= 20 ? F.median(regular.map((b) => num(b.v, 0))) : null;
  if (med != null && med < 500) add('warn', 'thin', 'This stock normally trades only about ' + Math.round(med) + ' shares per 5 minutes: spreads are wide and one order moves it. Use limit orders.');
  if (sess !== 'regular') add('warn', 'extended_hours', 'It is ' + (sess === 'post' ? 'after hours' : sess === 'pre' ? 'pre-market' : 'outside trading hours') + ': volume is thin, so treat the levels as zones.');
  if (num(alignment) != null && alignment * 1 <= -0.35) add('warn', 'against_algo', 'MEM ALGO\'s horizons lean against this side right now.');
  if (num(earningsDays) != null && earningsDays >= 0 && earningsDays <= 2) add('warn', 'earnings_soon', 'Earnings are ' + (earningsDays === 0 ? 'today' : earningsDays === 1 ? 'tomorrow' : 'in 2 days') + ': the print can gap past any level.');

  /* the engine's own ladder for this stock and side, to compare */
  let suggested = null;
  try {
    const s = E.suggestTargets({ symbol, direction: sideName, horizon: hz, price: p, bars5: b5, daily: d1, align: alignment, learned, now });
    if (s && s.ok) suggested = { horizon: s.horizonLabel, targets: s.targets.map((t) => ({ price: t.price, pct: t.pct, prob: t.prob })), stop: { price: s.stop.price, pct: s.stop.pct }, notes: s.notes };
  } catch (_) { suggested = null; }
  if (suggested && tg > 0 && (tg - e) * dir > 0) {
    const far = findings.some((f) => f.code === 'target_unrealistic' || f.code === 'target_unlikely' || f.code === 'target_stretched' || f.code === 'target_far' || f.code === 'chase' || f.code === 'burst_running');
    if (far) add('tip', 'use_first_target', 'A first target of ' + px(suggested.targets[0].price) + ' (' + suggested.targets[0].pct + '%, ' + suggested.targets[0].prob + '% odds) with the farther ones as follow-ups is the version of this alert that wins most often.');
  }

  let score = 100;
  for (const f of findings) score -= f.level === 'stop' ? 30 : f.level === 'warn' ? 10 : 0;
  score = Math.max(0, Math.min(100, score));
  const verdict = findings.some((f) => f.level === 'stop') ? 'wait' : findings.some((f) => f.level === 'warn') ? 'caution' : 'go';
  const headline = verdict === 'wait' ? 'WAIT: ' + findings.find((f) => f.level === 'stop').text.split(/[:.]/)[0] : verdict === 'caution' ? 'CAUTION: ' + findings.filter((f) => f.level === 'warn').length + ' thing' + (findings.filter((f) => f.level === 'warn').length === 1 ? '' : 's') + ' to look at before you send' : 'GO: nothing flagged';
  return { ok: true, symbol: String(symbol).toUpperCase(), side: sideName, verdict, score, headline, findings, odds: odds ? { p: odds.p == null ? null : Math.round(odds.p * 100), n: odds.n, targetPct: odds.targetPct, stopPct: odds.stopPct } : null, ignition: ig && ig.active ? { state: ig.state, minutesAgo: ig.minutesAgo, fromClosePct: ig.fromClosePct, chasePct: ig.chasePct } : null, suggested, advice: 'This check advises; it never blocks an alert. Educational analysis, not investment advice.' };
}

module.exports = { checkAlert, horizonKey };
