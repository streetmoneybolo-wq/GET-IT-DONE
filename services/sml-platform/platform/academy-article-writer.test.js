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

test('the house writer: every angle validates, three sections plus a close, third person only, no two seeds alike, no sentence twice', () => {
  for (const angle of ['gamma', 'short', 'earnings', 'tape', 'structure']) {
    const st = { ...story(), angle, lean: angle === 'earnings' ? 'bearish' : 'bullish', facts: story().facts, scenario: story().scenario, timeframe: '1 to 2 weeks' };
    const s = W.factSheet({ story: st, c: base, dossier });
    const a = W.housePiece(s, 7), b = W.housePiece(s, 8);
    const v = W.validate(a, s); assert.deepEqual(v, { ok: true, reasons: [] }, angle + ' ' + v.reasons.join(','));
    assert.equal(a.sections.length, 3); assert.ok(a.lede.length >= 2 && a.bottom && a.bull.length >= 1 && a.bear.length >= 1 && a.kill.length >= 3);
    assert.ok(!/\b(I|me|my|we|our|you|your)\b/.test([a.title, a.dek, ...a.lede, ...a.sections.flatMap((x) => x.paragraphs), a.bottom].join(' ')), angle + ': news has no voice, so no first or second person');
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

/* ---------- the fast path: the house piece is the body, the model writes only the front, and a clock decides ---------- */
const frontReply = (front) => async (url, opts) => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(front) }], stop_reason: 'end_turn' }), _body: JSON.parse(opts.body) });
const goodFront = (s) => ({ title: `${s.S}: dealers have to buy and $13.00 is where it shows`, dek: 'Hedging flows have a deadline here, and the strike is already known.', lede: [`${s.S} may run, according to the desk's scenario. The target is $13.00 and the scenario fails below $11.68.`, 'The options book is doing the work, not the chart. Dealers hedge, and hedging is not optional.'] });

test('fast write: the model rewrites only the front, in one small call, and the body stays the house body', async () => {
  const s = sheet(); const calls = [];
  const w = W.createArticleWriter({ ai: { apiKey: 'k' }, fetchImpl: async (u, o) => { calls.push(JSON.parse(o.body)); return frontReply(goodFront(s))(u, o); } });
  const out = await w.write(s, { fast: true });
  assert.equal(calls.length, 1); assert.ok(calls[0].max_tokens <= 800, 'a small reply, not a whole piece'); assert.match(calls[0].model, /haiku/);
  assert.equal(out.source, 'house+model'); assert.equal(out.title, goodFront(s).title);
  const house = W.housePiece(s, 0);
  assert.equal(out.sections.length, house.sections.length); assert.ok(out.sections.every((x) => x.paragraphs.length));
  assert.deepEqual(out.checked.reasons, ['fast_front']);
});

test('fast write: a front with a number the sheet does not carry, a dash, or a wrong shape falls back to the house front', async () => {
  const s = sheet();
  for (const bad of [{ ...goodFront(s), lede: [`${s.S} will hit $19.99 by Friday and I am sure.`, 'Second paragraph about the setup in plain words.'] }, { ...goodFront(s), dek: 'A dek — with a dash in it.' }, { title: 'only a title' }]) {
    const w = W.createArticleWriter({ ai: { apiKey: 'k' }, fetchImpl: frontReply(bad) });
    const out = await w.write(s, { fast: true });
    assert.notEqual(out.source, 'house+model'); assert.equal(out.source, 'house'); assert.equal(out.sections.length, 3);
    assert.ok(out.checked.reasons[0] === 'house_front');
  }
});

test('fast write: a model that never answers loses to the clock, and the piece is still whole and quick', async () => {
  const s = sheet();
  const hang = (u, o) => new Promise((_, reject) => { o.signal.addEventListener('abort', () => reject(new Error('The operation was aborted due to timeout'))); });
  const w = W.createArticleWriter({ ai: { apiKey: 'k' }, fetchImpl: hang });
  const t0 = Date.now(); const out = await w.write(s, { fast: true, deadlineMs: 150 });
  assert.ok(Date.now() - t0 < 1500, 'returned near the deadline, not after a minute');
  assert.equal(out.source, 'house'); assert.equal(W.validate({ ...out }, s, { minWords: 0 }).ok, true);
});

test('fast write: with the model off it is the house writer at once, and the default (slow) path is unchanged', async () => {
  const s = sheet(); let n = 0;
  const off = W.createArticleWriter({ ai: null, fetchImpl: async () => { n += 1; } });
  const t0 = Date.now(); const out = await off.write(s, { fast: true }); assert.ok(Date.now() - t0 < 200); assert.equal(n, 0); assert.equal(out.source, 'house');
  let full = null;
  const w = W.createArticleWriter({ ai: { apiKey: 'k' }, fetchImpl: async (u, o) => { full = JSON.parse(o.body); return { ok: false, status: 500, json: async () => ({}) }; } });
  await w.write(s, { attempts: 1 }); assert.equal(full.max_tokens, 6000, 'a scheduled piece still asks for the whole thing');
});

test('the house writer handles the narrative angle: three sections, passes the same checks, no banned phrase, names the ticker', () => {
  const bars = []; let p0 = 20; for (let i = 0; i < 80; i++) { const o = p0, c = p0 * (1 + Math.sin(i / 5) * 0.004); bars.push({ t: Date.UTC(2026, 6, 1) + i * 86_400_000, o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: 900_000 }); p0 = c; }
  const c = { symbol: 'QUIE', name: 'Quiet Corp', price: bars[bars.length - 1].c, changePct: 0.2, relVol: 0.9, adv: 900_000, daily: bars };
  const st = E.rankStories([c], { force: true })[0];
  const sh = W.factSheet({ story: st, c, dossier: {} });
  assert.equal(sh.angle, 'narrative'); assert.equal(sh.angleLabel, 'market narrative');
  for (let seed = 0; seed < 6; seed++) {
    const piece = W.housePiece(sh, seed);
    assert.equal(piece.sections.length, 3); assert.ok(piece.title.includes('$QUIE'));
    const v = W.validate(piece, sh, { minWords: 0 });
    assert.ok(!v.reasons.some((r) => /banned|dash|repeated|meta/.test(r)), v.reasons.join(','));
  }
});

test('the banned list now carries the cliches and exaggerations a news desk would cut', () => {
  for (const phrase of ['It remains to be seen.', 'Only time will tell.', 'a rapidly evolving market', 'This underscores the importance of', 'a testament to the move', 'a stunning rally', 'an unprecedented run', 'a massive squeeze']) assert.match(phrase, W.BANNED, phrase);
});

test('the prompts carry the newsroom rules: facts vs interpretation vs uncertainty, no invented causes or quotes, a provocative but supported headline', () => {
  for (const text of [W.SYSTEM]) for (const must of [/verified facts/i, /interpretation/i, /uncertainty/i, /caused/i, /never invent quotes/i, /contrarian/i, /edit your draft once/i, /what investors may watch next/i]) assert.match(text, must);
});

test('news has no voice: a model draft in the first or second person is refused, and the prompts say so', () => {
  const s = sheet(); const good = W.housePiece(s, 1);
  for (const bad of ['I think this runs.', 'We expect a move.', 'My read is long.', 'You should watch the wall.', 'Your edge is the tape.']) assert.ok(W.validate({ ...good, lede: [bad, ...good.lede.slice(1)] }, s).reasons.includes('first_or_second_person'), bad);
  assert.ok(!W.validate(good, s).reasons.includes('first_or_second_person'));
  assert.match(W.SYSTEM, /never use I, me, my, we, our or you/i); assert.match(W.SYSTEM, /verified facts/i); assert.match(W.SYSTEM, /never invent quotes/i);
  for (const phrase of ['It remains to be seen.', 'a stunning rally']) assert.match(phrase, W.BANNED);
});

test('the craft rules: the machine cadence and textbook asides are refused, the prompts carry the rules, and the house body has uneven paragraphs with a plain statement of stakes', () => {
  const s = sheet(); const good = W.housePiece(s, 2);
  assert.ok(W.validate({ ...good, lede: ['Dealers hedge as price rises, which means they must buy more shares, and that causes a feedback loop in the stock.', ...good.lede.slice(1)] }, s).reasons.includes('ai_cadence'));
  for (const bad of ['Gamma refers to the rate of change of delta.', 'Short interest is defined as the number of shares sold short.', 'Put simply, the stock is cheap.']) assert.ok(W.validate({ ...good, lede: [bad, ...good.lede.slice(1)] }, s).reasons.includes('glossary_aside'), bad);
  assert.ok(!W.validate(good, s).reasons.some((r) => /cadence|glossary/.test(r)));
  for (const must of [/compress raw data into insight/i, /each number once|use each number once/i, /no more than six sections/i, /one disclaimer at most/i, /symmetrical/i, /consistent voice/i, /never through invented personal experience/i]) assert.match(W.SYSTEM, must);
  const lens = good.sections[0].paragraphs.map((p) => p.split(/\s+/).length); assert.ok(new Set(lens).size >= 2, 'paragraph lengths vary: ' + lens);
  assert.ok(good.sections[0].paragraphs.join(' ').length > 100);
  assert.ok(good.sections.length <= 6 && good.sections.length >= 3);
});
