'use strict';

/* Trade setup breakdown: for one ticker, a card per horizon (day trade, swing, mid-term hold, long-term hold) showing which side the Academy's own models lean
 * (long or short), a stop and targets from the chart's structure, the risk-to-reward, a 0-100 setup score with its grade, the evidence for and against (MEM ALGO,
 * chart pattern, market structure, order book, absorption, short interest, sentiment, earnings date) and exactly what would invalidate it.
 * It reuses the same engines as the alerts desk and Click-to-Alert so a number means the same thing everywhere. Nothing is predicted and nothing is traded:
 * every card is an educational read of current data, with the reasons visible so a member can disagree with it. */
const SM = require('./academy-smart-money');
const { horizonRead } = require('./academy-screener');
const { chooseStop, riskFor, HORIZON_TEXT, DISCLAIMER } = require('./academy-click-alert');

const fin = Number.isFinite;
const r2 = (v) => Math.round(v * 100) / 100;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const HORIZONS = ['day', 'swing', 'mid', 'long'];
const ATR_MULT = { day: 1.5, swing: 3, mid: 6, long: 10 };

const cleanBars = (bars) => (Array.isArray(bars) ? bars : []).map((b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 })).filter((b) => [b.t, b.o, b.h, b.l, b.c].every(fin));

function barsFor(horizon, bars) {
  if (horizon === 'day') return bars.m15 && bars.m15.length >= 60 ? bars.m15 : (bars.m5 && bars.m5.length >= 60 ? bars.m5 : null);
  if (horizon === 'long') return bars.weekly && bars.weekly.length >= 60 ? bars.weekly : null;
  return bars.daily && bars.daily.length >= 60 ? bars.daily : null;
}

/* structural levels beyond the entry in the trade direction, nearest first */
function levelsBeyond(a, entry, side) {
  if (!a) return [];
  const up = side === 'long', out = [];
  const add = (price, why) => { if (fin(price) && (up ? price > entry * 1.004 : price < entry * 0.996)) out.push({ price: r2(price), why }); };
  for (const p of (up ? a.pivots.highs : a.pivots.lows) || []) add(p.price, up ? 'prior swing high' : 'prior swing low');
  for (const l of a.liquidity || []) if (l.takenAt == null && (up ? l.kind === 'EQH' : l.kind === 'EQL')) add(l.level, up ? 'equal highs (liquidity)' : 'equal lows (liquidity)');
  for (const o of (a.structure && a.structure.orderBlocks) || []) if (o.invalidAt == null && (up ? o.dir < 0 : o.dir > 0)) add(up ? o.bottom : o.top, up ? 'supply block' : 'demand block');
  if (a.vwap && fin(a.vwap.upper1) && up) add(a.vwap.upper1, 'VWAP upper band');
  return out.sort((x, y) => (up ? x.price - y.price : y.price - x.price));
}

function gradeOf(score) { return score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : 'D'; }

function buildOne({ horizon, symbol, price, bars, ctx }) {
  const hb = barsFor(horizon, bars);
  const T = HORIZON_TEXT[horizon];
  if (!hb) return { horizon, label: T.label, span: T.span, available: false, reason: 'not_enough_history' };
  const read = horizonRead(hb, horizon, {});
  if (!read) return { horizon, label: T.label, span: T.span, available: false, reason: 'not_enough_history' };
  const entry = price;
  const a = SM.analyze(cleanBars(hb));
  const atr = a && a.atr > 0 ? a.atr : entry * 0.02;
  const side = read.dir > 0 ? 'long' : read.dir < 0 ? 'short' : 'neutral';
  const card = { horizon, label: T.label, span: T.span, available: true, side, bias: read.bias, grade: read.grade, strength: read.strength, mode: read.mode, tf: read.tf };
  const evidence = [];
  const ev = (label, tone, detail) => evidence.push({ label, tone, detail });
  const dirTxt = side === 'long' ? 'bullish' : side === 'short' ? 'bearish' : 'neutral';

  ev('MEM ALGO', side === 'neutral' ? 'neutral' : 'for', `${read.mode} model reads ${read.bias}${read.grade ? ', grade ' + read.grade : ''}${read.signalAgo != null ? `, signal ${read.signalAgo} bars ago` : ''}`);
  if (read.pattern) ev('Chart pattern', (read.pattern.dir === 'bull') === (side === 'long') && side !== 'neutral' ? 'for' : 'against', `${read.pattern.name} (${read.pattern.status || 'forming'})`);
  if (a && a.structure) {
    const last = (a.structure.events || []).slice(-1)[0];
    if (last) { const bullEvt = last.dir > 0; ev('Structure', side === 'neutral' ? 'neutral' : (bullEvt === (side === 'long') ? 'for' : 'against'), `last ${last.kind || 'break'} was ${bullEvt ? 'bullish' : 'bearish'}`); }
    if (a.structure.trend) ev('Trend structure', side === 'neutral' ? 'neutral' : ((a.structure.trend > 0) === (side === 'long') ? 'for' : 'against'), a.structure.trend > 0 ? 'higher highs and higher lows' : a.structure.trend < 0 ? 'lower highs and lower lows' : 'sideways');
  }
  if (horizon === 'day' && a && a.vwap && fin(a.vwap.value ?? a.vwap.vwap)) {
    const v = a.vwap.value ?? a.vwap.vwap; const above = entry >= v;
    ev('Session VWAP', side === 'neutral' ? 'neutral' : (above === (side === 'long') ? 'for' : 'against'), `price is ${above ? 'above' : 'below'} VWAP ${r2(v)}`);
  }
  if (ctx.flow && ctx.flow.ready && (horizon === 'day' || horizon === 'swing')) {
    const b = ctx.flow.bias; ev('Order book', b === 'neutral' || side === 'neutral' ? 'neutral' : ((b === 'bullish') === (side === 'long') ? 'for' : 'against'), `Level 2 leans ${b} (${ctx.flow.score})`);
  }
  if (ctx.absorption && ctx.absorption.available && (horizon === 'day' || horizon === 'swing')) {
    const buy = ctx.absorption.score > 0;
    ev('Absorption', ctx.absorption.state === 'none' || side === 'neutral' ? 'neutral' : (buy === (side === 'long') ? 'for' : 'against'), ctx.absorption.label);
  }
  if (ctx.shortData && fin(ctx.shortData.avgRatio)) {
    const hi = ctx.shortData.avgRatio >= 50;
    if (side === 'short') ev('Short interest', hi ? 'against' : 'neutral', hi ? `${Math.round(ctx.shortData.avgRatio)}% of volume is short selling: crowded shorts can squeeze` : `${Math.round(ctx.shortData.avgRatio)}% short volume is not extreme`);
    else if (side === 'long' && hi) ev('Short interest', 'for', `${Math.round(ctx.shortData.avgRatio)}% short volume: shorts would have to buy back if price rises`);
  }
  if (ctx.sentiment && ctx.sentiment.available) {
    const sc = ctx.sentiment.score;
    ev('Sentiment', Math.abs(sc) < 0.12 || side === 'neutral' ? 'neutral' : ((sc > 0) === (side === 'long') ? 'for' : 'against'), `${ctx.sentiment.label} (${ctx.sentiment.scorePct >= 0 ? '+' : ''}${ctx.sentiment.scorePct})`);
  }
  if (ctx.earnings && fin(ctx.earnings.daysAway)) {
    const d = ctx.earnings.daysAway, near = (horizon === 'day' && d <= 1) || (horizon === 'swing' && d <= 7) || (horizon === 'mid' && d <= 14);
    if (near) ev('Earnings', 'against', d <= 0 ? 'reports today: expect a gap either way' : `reports in ${d} day${d === 1 ? '' : 's'}: a gap can jump over a stop`);
  }
  card.evidence = evidence;

  if (side === 'neutral') {
    card.score = 0; card.scoreGrade = '-'; card.summary = `${T.label}: no clear lean right now (${read.bias}). Nothing to set up on this horizon.`;
    return card;
  }

  const stopPick = chooseStop({ entry, side, a, atr, type: horizon });
  const stop = stopPick.stop;
  const risk = Math.abs(entry - stop);
  const levels = levelsBeyond(a, entry, side);
  const atrTarget = side === 'long' ? entry + ATR_MULT[horizon] * atr : entry - ATR_MULT[horizon] * atr;
  const t1 = levels.find((l) => risk > 0 && Math.abs(l.price - entry) / risk >= 1.5) || null;
  const targets = [];
  if (t1) targets.push({ price: t1.price, why: t1.why });
  if (!t1 || Math.abs(atrTarget - entry) > Math.abs(t1.price - entry) * 1.15) targets.push({ price: r2(atrTarget), why: `${ATR_MULT[horizon]} ATR move` });
  for (const t of targets) { t.rr = risk > 0 ? r2(Math.abs(t.price - entry) / risk) : null; t.pct = r2(((t.price - entry) / entry) * 100); }
  const rr = targets[0] ? targets[0].rr : null;
  card.entry = r2(entry); card.stop = stop; card.stopBasis = stopPick.basis; card.stopPct = r2(((stop - entry) / entry) * 100); card.targets = targets; card.riskReward = rr;
  card.risk = riskFor(atr / entry, entry);
  card.levelsInTheWay = levels.slice(0, 3);
  card.invalidation = `A ${horizon === 'day' ? 'move' : 'close'} ${side === 'long' ? 'below' : 'above'} ${stop} (${stopPick.basis}) means the idea is wrong; get out rather than hope.`;

  const forN = evidence.filter((e) => e.tone === 'for').length, againstN = evidence.filter((e) => e.tone === 'against').length;
  let score = 45 * clamp(read.strength / 6, 0, 1) + 25 * clamp(((rr || 1) - 1) / 2, 0, 1) + 6 * Math.min(4, Math.max(0, forN - 1)) - 7 * againstN;
  score = Math.round(clamp(score, 0, 100));
  card.score = score; card.scoreGrade = gradeOf(score);
  card.forCount = forN; card.againstCount = againstN;
  const shortWord = side === 'short' ? 'Short setup' : 'Long setup';
  card.summary = `${T.label} (${T.span}): ${shortWord}, grade ${card.scoreGrade}. Entry ${r2(entry)}, stop ${stop}, first target ${targets[0] ? targets[0].price : '-'}${rr ? ` for about ${rr}R` : ''}. ${forN} signal${forN === 1 ? '' : 's'} agree, ${againstN} disagree.`;
  if (side === 'short') card.shortNote = 'Short selling has unlimited upside risk, needs a margin account and available shares to borrow, and can be squeezed. Defined-risk alternatives: a bear put spread or a long put.';
  return card;
}

/* input: { symbol, price, bars: { daily, weekly, m15, m5 }, flow, absorption, shortData: { avgRatio }, sentiment, earnings: { daysAway } } */
function buildSetups(input = {}) {
  const symbol = String(input.symbol || '').toUpperCase();
  const price = Number(input.price);
  if (!(price > 0)) return { ok: false, available: false, reason: 'no_live_price', symbol };
  const bars = input.bars || {};
  const ctx = { flow: input.flow || null, absorption: input.absorption || null, shortData: input.shortData || null, sentiment: input.sentiment || null, earnings: input.earnings || null };
  const cards = HORIZONS.map((h) => buildOne({ horizon: h, symbol, price, bars, ctx }));
  const live = cards.filter((c) => c.available && c.side !== 'neutral');
  const best = live.slice().sort((x, y) => y.score - x.score)[0] || null;
  const short = live.filter((c) => c.side === 'short').sort((x, y) => y.score - x.score)[0] || null;
  if (!cards.some((c) => c.available)) return { ok: true, available: false, reason: 'not_enough_history', symbol, price: r2(price), cards };
  return {
    ok: true, available: true, symbol, price: r2(price), asOf: Date.now(), cards,
    bestFit: best ? { horizon: best.horizon, side: best.side, score: best.score, grade: best.scoreGrade } : null,
    bestShort: short ? { horizon: short.horizon, score: short.score, grade: short.scoreGrade } : null,
    summary: best ? `Best fit right now: ${best.label.toLowerCase()} ${best.side} (grade ${best.scoreGrade}).` : 'No horizon has a clear lean right now.',
    disclaimer: DISCLAIMER
  };
}

module.exports = { buildSetups, levelsBeyond, gradeOf, ATR_MULT };
