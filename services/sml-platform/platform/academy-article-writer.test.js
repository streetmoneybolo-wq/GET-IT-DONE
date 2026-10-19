'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./academy-story-engine');
const W = require('./academy-article-writer');

function daily(n, start = 10) { const out = []; let p = start; for (let i = 0; i < n; i++) { const o = p, c = p * (1 + Math.sin(i / 4) * 0.02 + 0.002); out.push({ t: Date.UTC(2026, 7, 1) + i * 86_400_000, o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c, v: 2e6 }); p = c; } return out; }
const base = { symbol: 'ABCD', name: 'Abcd Robotics', price: 12.4, changePct: 6.2, relVol: 2.8, adv: 4e6, daily: daily(90), direction: { label: 'Lean bullish', bias: 28 }, gamma: { available: true, regime: 'negative', pressurePct: 31, pressure: 'high', flipStrike: 11.8, flipDistancePct: -4.8, flipIsApproximate: false, callWall: { strike: 13, distancePct: 4.8 }, zeroDteShare: 0.35 }, short: { ratio: 0.52, daysToCover: 4.2 }, tape: { sweepBuy: 5, sweepSell: 1, blockBuy: 2, blockSell: 0, offSharePct: 58, typicalSharePct: 42, absorption: true }, smc: { structure: [{ type: 'BOS', dir: 1, level: 12.1 }], sweeps: [{ kind: 'EQL', level: 10.9 }], fvgs: [], orderBlocks: [], range: { hi: 13.2, lo: 10.5, pos: 0.7 }, vwap: { level: 11.9, above: true }, openLiquidity: [{ kind: 'EQH', level: 13.4, count: 2 }] }, earnings: { daysAway: 6, date: '2026-10-27', timing: 'AMC', impliedPct: 9.5, histAvgMovePct: 12 } };
const dossier = { intent: { ok: true, intent: { phase: 'accumulation', side: 'buyers', strength: 64, evidence: [{ w: 1, text: 'Absorption at 12.10: 3x displayed size refilled.' }], read: 'Smart money is accumulating: absorbing sells, refilling bids.' }, map: { levels: [{ price: 12.1, labels: ['iceberg bid'] }] } }, shortInsight: { ok: true, model: { score: 71 }, pressing: { score: 22 }, interest: { daysToCover: 4.2, shortInterest: 9_500_000 }, verdict: { long: { call: 'squeeze candidate: fuel and a spark' } } }, darkPool: { available: true, read: { headline: 'HEAVY: $4.1M block at $12.05', steps: [{ text: 'Biggest print 340,000 shares at $12.05.' }] } }, sentiment: { available: true, scorePct: 66, label: 'lean bullish' }, filings: { available: true, label: 'insiders buying', insiders: { buys: 3, sells: 1 } } };
const story = () => E.rankStories([base])[0];
const sheet = () => W.factSheet({ story: story(), c: base, dossier });

test('the fact sheet carries every read once and every number the writer may use', () => {
  const s = sheet();
  const kinds = s.lines.map((l) => l.k);
  for (const k of ['price', 'fact', 'scenario', 'trigger', 'kill', 'market', 'intent', 'levels', 'dark', 'shortscore', 'dtc', 'verdictlong', 'gamma', 'earnings', 'crowd', 'insiders']) assert.ok(kinds.includes(k), k);
  for (const n of ['12.40', '13.00', '11.68', '4.8', '31', '64', '4.1', '340000', '9.5', '66']) assert.ok(s.numbers.has(n), 'number ' + n);
  assert.equal(s.S, '$ABCD'); assert.equal(s.lean, 'bullish'); assert.equal(s.angle, 'gamma');
});

test('the checks: new numbers, dashes, repeats, template headings, FAQ and disclaimers, too many sections, no ticker in the title are all refused', () => {
  const s = sheet();
  const good = W.housePiece(s, 1);
  assert.deepEqual(W.validate(good, s), { ok: true, reasons: [] });
  const withNumber = { ...good, sections: good.sections.map((x, i) => (i ? x : { ...x, paragraphs: [...x.paragraphs, 'The stock could run to $19.99 by Friday.'] })) };
  assert.ok(W.validate(withNumber, s).reasons.some((r) => r.startsWith('new_number_')), 'a number the sheet does not carry');
  assert.ok(W.validate({ ...good, dek: 'A dek — with a dash.' }, s).reasons.includes('dash'));
  assert.ok(W.validate({ ...good, bottom: good.sections[0].paragraphs[0] + ' ' + good.bottom }, s).reasons.includes('repeated_sentence'));
  assert.ok(W.validate({ ...good, sections: [{ heading: 'What the data says', paragraphs: ['x'] }, ...good.sections] }, s).reasons.includes('template_heading'));
  assert.ok(W.validate({ ...good, bottom: good.bottom + ' This is not financial advice.' }, s).reasons.includes('meta_or_disclaimer'));
  assert.ok(W.validate({ ...good, sections: [...good.sections, ...good.sections, ...good.sections] }, s).reasons.some((r) => r.startsWith('sections_')));
  assert.ok(W.validate({ ...good, title: 'A piece with no ticker in it at all' }, s).reasons.includes('title_symbol'));
  assert.ok(W.validate({ ...good, lede: ['Let us delve into the landscape.'] }, s).reasons.includes('banned_phrase'));
  assert.ok(W.validate({ ...good, lede: ['Short.'], sections: [{ heading: 'a', paragraphs: ['b'] }, { heading: 'c', paragraphs: ['d'] }, { heading: 'e', paragraphs: ['f'] }], bottom: 'g' }, s).reasons.some((r) => r.startsWith('too_short_')));
});

test('the house writer: every angle validates, three sections plus a close, first person, no two seeds alike, no sentence twice', () => {
  for (const angle of ['gamma', 'short', 'earnings', 'tape', 'structure']) {
    const st = { ...story(), angle, lean: angle === 'earnings' ? 'bearish' : 'bullish', facts: story().facts, scenario: story().scenario, timeframe: '1 to 2 weeks' };
    const s = W.factSheet({ story: st, c: base, dossier });
    const a = W.housePiece(s, 7), b = W.housePiece(s, 8);
    const v = W.validate(a, s); assert.deepEqual(v, { ok: true, reasons: [] }, angle + ' ' + v.reasons.join(','));
    assert.equal(a.sections.length, 3); assert.ok(a.lede.length >= 2 && a.bottom && a.bull.length >= 1 && a.bear.length >= 1 && a.kill.length >= 3);
    assert.ok(/\bI\b/.test([...a.lede, ...a.sections.flatMap((x) => x.paragraphs)].join(' ')), angle + ' first person');
    assert.notEqual(a.title + a.dek + a.sections[0].heading, b.title + b.dek + b.sections[0].heading, angle + ' varies by seed');
    assert.ok(a.title.includes('$ABCD'));
  }
});

test('the model writer: a good draft is used, a draft that invents a number is retried then replaced by the house piece, and no key means the house piece', async () => {
  const s = sheet();
  const house = W.housePiece(s, 1);
  const ai = (text) => W.createArticleWriter({ ai: { apiKey: 'k', model: 'm' }, fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text }] }) }) });
  const good = { ...house, title: '$ABCD: dealers are short gamma and $13.00 is the strike that matters', source: 'ai' };
  const out = await ai('```json\n' + JSON.stringify(good) + '\n```').write(s);
  assert.equal(out.source, 'ai'); assert.equal(out.title, good.title); assert.deepEqual(out.checked, { ok: true, reasons: [] });
  const calls = [];
  const bad = W.createArticleWriter({ ai: { apiKey: 'k' }, logger: (l, e, f) => calls.push([e, f && f.reasons]), fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ ...good, bottom: 'It runs to $42.00 next week.' }) }] }) }) });
  const fallback = await bad.write(s);
  assert.equal(fallback.source, 'house'); assert.equal(calls.filter((c) => c[0] === 'article_writer_rejected').length, 2); assert.ok(fallback.checked.reasons.includes('house_fallback') && fallback.checked.reasons.some((r) => r.startsWith('new_number_')));
  const down = W.createArticleWriter({ ai: { apiKey: 'k' }, fetchImpl: async () => { throw new Error('boom'); } });
  assert.equal((await down.write(s)).source, 'house');
  const off = W.createArticleWriter({ ai: null }); assert.equal(off.enabled, false); assert.equal((await off.write(s)).checked.reasons[0], 'ai_off');
  assert.equal(W.parseJson('no json here'), null); assert.equal(W.normalize(null), null);
});

test('the model gets room to finish, a rejected draft is retried with its reasons, and a cut-off reply is logged with its stop reason', async () => {
  const s = sheet();
  const house = W.housePiece(s, 1);
  const good = { ...house, title: '$ABCD: dealers are short gamma and $13.00 is the strike that matters', source: 'ai' };
  const sent = [], logs = [];
  let n = 0;
  const w = W.createArticleWriter({
    ai: { apiKey: 'k', model: 'm' }, logger: (l, e, f) => logs.push([e, f]),
    fetchImpl: async (u, o) => {
      const b = JSON.parse(o.body); sent.push(b); n++;
      return { ok: true, json: async () => (n === 1 ? { stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"title":"$ABCD: cut off mid' }] } : { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(good) }] }) };
    }
  });
  const out = await w.write(s);
  assert.equal(out.source, 'ai', 'the retry succeeds');
  assert.ok(sent[0].max_tokens >= 6000, 'room for a full piece: ' + sent[0].max_tokens);
  assert.doesNotMatch(sent[0].messages[0].content, /rejected for/);
  assert.match(sent[1].messages[0].content, /rejected for: not_an_object/, 'the retry is told why');
  const rej = logs.find((x) => x[0] === 'article_writer_rejected');
  assert.equal(rej[1].stop, 'max_tokens'); assert.ok(rej[1].chars > 0);
});
