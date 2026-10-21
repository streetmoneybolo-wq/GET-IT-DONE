'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./academy-story-engine');

const base = { symbol: 'ABCD', name: 'Abcd Robotics', price: 12.4, changePct: 6.2, relVol: 2.8, adv: 4_000_000, direction: { label: 'Lean bullish', bias: 28 } };

test('gamma squeeze: short-gamma dealers, high hedge pressure and a close call wall make the angle; a far or approximate flip is not a fact', () => {
  const far = E.gammaAngle({ ...base, price: 201, gamma: { available: true, regime: 'negative', pressurePct: 31, pressure: 'high', flipStrike: 35, flipDistancePct: -82, callWall: { strike: 220, distancePct: 9.4 }, zeroDteShare: 0.1 } });
  assert.ok(far && !far.facts.some((f) => /gamma flip/.test(f)), far && far.facts.join(' | '));
  const approx = E.gammaAngle({ ...base, gamma: { available: true, regime: 'negative', pressurePct: 31, pressure: 'high', flipStrike: 12, flipIsApproximate: true, callWall: { strike: 13, distancePct: 4.8 } } });
  assert.ok(approx && !approx.facts.some((f) => /gamma flip/.test(f)));
  const a = E.gammaAngle({ ...base, gamma: { available: true, regime: 'negative', pressurePct: 31, pressure: 'high', flipStrike: 11.8, flipDistancePct: -4.8, callWall: { strike: 13, distancePct: 4.8 }, zeroDteShare: 0.35 }, short: { ratio: 0.52 } });
  assert.ok(a && a.score >= 70, JSON.stringify(a && a.score));
  assert.equal(a.pt, 13); assert.equal(a.lean, 'bullish'); assert.ok(a.facts.length >= 4); assert.match(a.scenario.target, /\$13\.00/);
  assert.equal(E.gammaAngle({ ...base, gamma: { available: true, regime: 'positive', pressurePct: 3 } }), null, 'a pinned name is not a squeeze story');
});

test('short squeeze: FINRA short volume, days to cover and a running stock', () => {
  const a = E.shortAngle({ ...base, short: { ratio: 0.58, baselineRatio: 0.41, daysToCover: 6.2, shortInterestPct: 24 }, runner: { phase: 2 }, smc: { structure: [{ type: 'BOS', dir: 1, level: 12 }], range: { hi: 14.5, lo: 9 } } });
  assert.ok(a && a.score >= 80); assert.equal(a.pt, 14.5); assert.ok(a.facts.some((f) => /Days to cover: 6\.2/.test(f)));
  assert.equal(E.shortAngle({ ...base, short: { ratio: 0.3, daysToCover: 1 } }), null);
});

test('earnings speculation reads the map into the print and picks a lean', () => {
  const a = E.earningsAngle({ ...base, earnings: { daysAway: 3, date: '2026-10-18', timing: 'AMC', impliedPct: 9.5, histAvgMovePct: 14 }, smc: { fvgs: [{ dir: 1, top: 12, bottom: 11.4, filled: false }], range: { pos: 0.3 }, sweeps: [{ kind: 'EQL', level: 11.1 }], vwap: { level: 11.9 } }, institutional: { bias: 40, label: 'institutional buy' } });
  assert.ok(a && a.lean === 'bullish' && a.pt > base.price);
  assert.ok(a.facts.some((f) => /underpriced/.test(f)));
  assert.equal(E.earningsAngle({ ...base, earnings: { daysAway: 20, date: '2026-11-05' } }), null);
  assert.equal(E.earningsAngle({ ...base, earnings: { daysAway: 2 } }), null, 'no date, no story');
  assert.ok(a.facts[0].includes('Oct 18') && a.facts[0].includes('in 3 days'));
});

test('unusual tape and structure stories', () => {
  const t = E.tapeAngle({ ...base, tape: { sweepBuy: 5, sweepSell: 1, blockBuy: 3, blockSell: 0, offSharePct: 58, typicalSharePct: 42, absorption: true }, smc: { openLiquidity: [{ kind: 'EQH', level: 13.6 }] } });
  assert.ok(t && t.lean === 'bullish' && t.pt === 13.6);
  const s = E.structureAngle({ ...base, smc: { structure: [{ type: 'BOS', dir: 1, level: 12.1 }], sweeps: [{ kind: 'EQL', level: 10.9 }], orderBlocks: [{ dir: 1, top: 11.2, bottom: 10.8 }], fvgs: [], openLiquidity: [{ kind: 'EQH', level: 14 }] } });
  assert.ok(s && s.pt === 14 && /sweep/i.test(s.facts.join(' ')));
});

test('ranking rewards a strong setup on a name in the news with no coverage of the angle, and drafts a full piece', () => {
  const hot = { ...base, gamma: { available: true, regime: 'negative', pressurePct: 31, pressure: 'high', flipStrike: 11.8, flipDistancePct: -4.8, callWall: { strike: 13, distancePct: 4.8 }, zeroDteShare: 0.35 }, heat: { google24h: 18, bing24h: 9, coverage: { gamma: 0, short: 3 } } };
  const cold = { ...base, symbol: 'ZZZZ', gamma: hot.gamma, heat: { google24h: 0, bing24h: 0, coverage: { gamma: 4 } } };
  const illiquid = { ...base, symbol: 'TINY', adv: 20_000, gamma: hot.gamma };
  const ranked = E.rankStories([cold, hot, illiquid]);
  assert.equal(ranked[0].symbol, 'ABCD'); assert.equal(ranked[0].angle, 'gamma'); assert.ok(ranked[0].rank > ranked[1].rank);
  assert.ok(!ranked.some((r) => r.symbol === 'TINY'), 'illiquid names are skipped');
  const d = E.draftArticle(ranked[0], hot, { asOf: Date.UTC(2026, 9, 15, 14, 30) });
  assert.match(d.title, /\$ABCD/); assert.ok(d.title.length <= 120); assert.ok(d.meta.length <= 155); assert.match(d.slug, /^abcd-/);
  assert.match(d.html, /What the data says/); assert.match(d.html, /Why it matters: the mechanism/); assert.match(d.html, /The speculation/); assert.match(d.html, /The path to \$13\.00/); assert.match(d.html, /The case against/); assert.match(d.html, /What kills it/); assert.match(d.html, /not financial advice/);
  assert.ok(!/—/.test(d.html), 'no em dashes'); assert.ok(d.wordCount >= 600, 'words: ' + d.wordCount);
  assert.ok(d.title.length <= 95, 'headline fits a results page: ' + d.title.length);
  assert.ok(d.dek && d.dek.length <= 160 && !/—/.test(d.dek)); assert.equal(d.subtitle, d.dek);
  assert.equal(d.parts.kicker, 'OPTIONS POSITIONING'); assert.equal(d.parts.takeaways.length, 3); assert.equal(d.parts.ladder.length, 4); assert.deepEqual(d.parts.keyStat, { label: 'CALL WALL', value: '$13.00' });
  assert.ok(!/\b(delve|landscape|tapestry|in conclusion)\b/i.test(d.html), 'no AI tells');
  assert.ok(d.tags.includes('ABCD') && d.tags.includes('gamma squeeze'));
  assert.ok(d.alternates.length === 2);
});

test('RSS items are counted inside the window', () => {
  const xml = '<rss><channel><item><title>a</title><pubDate>Thu, 15 Oct 2026 10:00:00 GMT</pubDate></item><item><title>b</title><pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate></item><item><title>c</title></item></channel></rss>';
  assert.equal(E.parseRssCount(xml, Date.UTC(2026, 9, 14)), 2);
  assert.equal(E.slugify('$ABCD Gamma Squeeze Watch: Dealers Are Short Gamma!'), 'abcd-gamma-squeeze-watch-dealers-are-short-gamma');
});

test('the narrative angle: a quiet name still gets a story with a measured scenario, and only a piece asked for by name forces it', () => {
  const E2 = require('./academy-story-engine');
  const bars = []; let px0 = 20; for (let i = 0; i < 80; i++) { const o = px0, c = px0 * (1 + Math.sin(i / 5) * 0.004); bars.push({ t: Date.UTC(2026, 6, 1) + i * 86_400_000, o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: 900_000 }); px0 = c; }
  const quiet = { symbol: 'QUIE', name: 'Quiet Corp', price: bars[bars.length - 1].c, changePct: 0.2, relVol: 0.9, adv: 900_000, daily: bars };
  assert.equal(E2.rankStories([quiet]).length, 0, 'unforced, a quiet name is skipped (the scheduled run stays selective)');
  const out = E2.rankStories([quiet], { force: true });
  assert.equal(out.length, 1); const st = out[0];
  assert.equal(st.angle, 'narrative'); assert.equal(st.variant, 'buildup');
  assert.ok(st.pt !== quiet.price && st.stop !== quiet.price && Math.sign(st.pt - quiet.price) === -Math.sign(st.stop - quiet.price));
  assert.ok(st.facts.length >= 3 && st.facts.every((f) => typeof f === 'string' && f.length > 20));
  assert.ok(st.scenario.trigger && st.scenario.confirm && st.scenario.target && st.scenario.invalidation && st.path.length === 2);
  const hl = E2.headlineFor(st, quiet); assert.ok(hl.title.includes('$QUIE') && hl.title.length <= 95 && hl.meta.length <= 155);
  const small = E2.rankStories([{ ...quiet, price: 0.8, adv: 1000 }], { force: true });
  assert.equal(small.length, 1, 'price and volume floors do not stop a piece asked for by name');
  assert.equal(E2.rankStories([{ symbol: 'NEW', price: 5, daily: bars.slice(0, 5) }], { force: true }).length, 0, 'but with no price history there is nothing to read');
  const spec = E2.narrativeAngle({ ...quiet, relVol: 2.4, changePct: 5 }); assert.equal(spec.variant, 'speculation');
  assert.equal(E2.narrativeAngle(quiet, { headline: 'Company X in talks' }).variant, 'rumor');
});
