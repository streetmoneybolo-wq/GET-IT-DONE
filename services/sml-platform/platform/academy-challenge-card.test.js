'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const card = require('./academy-challenge-card');

const snap = { progressPct: 1.3, rules: { minScore: 70, riskPerTrade: { swing: 0.03, day: 0.015 }, weeklyDeposit: 250 },
  ideas: [{ status: 'closed', symbol: 'NVDA', mode: 'swing', grade: 'A', score: 82, realized: 41.2, exitReason: 'target' }],
  paper: { summary: { equity: 1301.5, deposited: 1250, pnl: 51.5, returnPct: 4.12, today: { change: -3.2 }, closedTrades: 3, winRate: 66.67, maxDrawdownPct: 2.1, positions: [{ symbol: 'AAPL', qty: 1.5, avg: 230.1, mark: 235.4, pnl: 7.95, pnlPct: 2.3 }, { symbol: 'AMD <script>', qty: 2, avg: 150, mark: 148, pnl: -4, pnlPct: -1.33 }] }, equity: [{ t: 1, value: 1000 }, { t: 2, value: 1250 }, { t: 3, value: 1301.5 }] } };

test('the card says SIMULATED, carries the numbers, escapes text, draws the curve', () => {
  const svg = card.svgFor(snap, { now: Date.UTC(2026, 9, 15, 20, 0, 0) });
  assert.ok(svg.startsWith('<svg') && svg.includes('SIMULATED · NOT REAL MONEY · NOT ADVICE'));
  assert.ok(svg.includes('$1,301.50') && svg.includes('+4.12%') && svg.includes('-$3.20') && svg.includes('1.3%'));
  assert.ok(svg.includes('AMD &lt;script&gt;') && !svg.includes('<script>'));
  assert.ok(svg.includes('<path d="M') && svg.includes('Closed NVDA (swing, grade A 82) $41.20 · target'));
  assert.ok(/Oct 15, 2026, 4:00 PM ET/.test(svg));
  const flat = card.svgFor({ ...snap, ideas: [], paper: { ...snap.paper, summary: { ...snap.paper.summary, positions: [] }, equity: [] } });
  assert.ok(flat.includes('OPEN POSITIONS · FLAT') && flat.includes('No ideas taken yet.') && flat.includes('The curve starts with the first trade.'));
});

test('render returns a PNG when resvg is available, and never throws without it', () => {
  const out = card.render(snap, { now: Date.UTC(2026, 9, 15, 20, 0, 0) });
  assert.ok(out.svg && out.name === 'challenge-2026-10-15.png');
  assert.ok(out.png === null || (Buffer.isBuffer(out.png) && out.png.length > 1000 && out.png[0] === 0x89));
});
