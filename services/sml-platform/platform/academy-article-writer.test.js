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

test('the house writer: every angle validates, four story-led sections plus a close, with a stance, a question, a conditional call and an invalidation, no two seeds alike, no sentence twice', () => {
  for (const angle of ['gamma', 'short', 'earnings', 'tape', 'structure']) {
    const st = { ...story(), angle, lean: angle === 'earnings' ? 'bearish' : 'bullish', facts: story().facts, scenario: story().scenario, timeframe: '1 to 2 weeks' };
    const s = W.factSheet({ story: st, c: base, dossier });
    const a = W.housePiece(s, 7), b = W.housePiece(s, 8);
    const v = W.validate(a, s); assert.deepEqual(v, { ok: true, reasons: [] }, angle + ' ' + v.reasons.join(','));
    assert.equal(a.sections.length, 4); assert.ok(a.lede.length >= 2 && a.bottom && a.bull.length >= 1 && a.bear.length >= 1 && a.kill.length >= 3);
    assert.ok(/\b(I|my)\b/.test([...a.lede, ...a.sections.flatMap((x) => x.paragraphs), a.bottom].join(' ')), angle + ': Grandmaster-Obi gives an opinion'); assert.ok(W.STANCES.includes(a.stance) && /\?$/.test(a.question) && /\bif\b/i.test(a.ifRight) && /wrong/i.test(a.wrongIf), angle + ': stance, question, conditional call, invalidation');
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
    assert.notEqual(out.source, 'house+model'); assert.equal(out.source, 'house'); assert.equal(out.sections.length, 4);
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

test('the house writer handles the narrative angle: four sections (key details, context, scenario, limits), passes the same checks, no banned phrase, names the ticker', () => {
  const bars = []; let p0 = 20; for (let i = 0; i < 80; i++) { const o = p0, c = p0 * (1 + Math.sin(i / 5) * 0.004); bars.push({ t: Date.UTC(2026, 6, 1) + i * 86_400_000, o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: 900_000 }); p0 = c; }
  const c = { symbol: 'QUIE', name: 'Quiet Corp', price: bars[bars.length - 1].c, changePct: 0.2, relVol: 0.9, adv: 900_000, daily: bars };
  const st = E.rankStories([c], { force: true })[0];
  const sh = W.factSheet({ story: st, c, dossier: {} });
  assert.equal(sh.angle, 'narrative'); assert.equal(sh.angleLabel, 'market narrative');
  for (let seed = 0; seed < 6; seed++) {
    const piece = W.housePiece(sh, seed);
    assert.equal(piece.sections.length, 4); assert.ok(piece.title.includes('$QUIE'));
    const v = W.validate(piece, sh, { minWords: 0 });
    assert.ok(!v.reasons.some((r) => /banned|dash|repeated|meta/.test(r)), v.reasons.join(','));
  }
});

test('the banned list now carries the cliches and exaggerations a news desk would cut', () => {
  for (const phrase of ['It remains to be seen.', 'Only time will tell.', 'a rapidly evolving market', 'This underscores the importance of', 'a testament to the move', 'a stunning rally', 'an unprecedented run', 'a massive squeeze']) assert.match(phrase, W.BANNED, phrase);
});

test('the Grandmaster-Obi engine prompt: story first, fact vs interpretation vs speculation, a stance, a conditional call, the invalidation, a curiosity-gap headline, original synthesis, no invented past', () => {
  for (const must of [/MARKET NARRATIVE ENGINE/, /Grandmaster-Obi/, /not summarize market data/i, /ONE central narrative/i, /FACT, INTERPRETATION, SPECULATION/, /Never invent evidence/i, /"Lean bullish"/, /"Binary, event-driven"/, /Never end on "it could go either way"/, /conditional/i, /proves it wrong|proves him wrong/i, /curiosity gap/i, /Original information gain/i, /Do NOT invent mistakes, slang, anecdotes, memories/i, /never mention the Academy/i, /"stance"/, /"question"/, /"ifRight"/, /"wrongIf"/, /no "Reading the data/i]) assert.match(W.SYSTEM, must);
});

test('Grandmaster-Obi has an opinion and no invented past: a draft needs a stance, a question, a conditional call and an invalidation, and may not invent experience, memories or feelings', () => {
  const s = sheet(); const good = W.housePiece(s, 1);
  assert.deepEqual(W.validate(good, s, { minWords: 0 }).reasons.filter((r) => /stance|question|conditional|invalidation|opinion|experience/.test(r)), []);
  const reasons = (patch) => W.validate({ ...good, ...patch }, s, { minWords: 0 }).reasons;
  assert.ok(reasons({ stance: 'Could go either way' }).includes('no_stance'));
  assert.ok(reasons({ question: 'This is a statement.' }).includes('no_question'));
  assert.ok(reasons({ ifRight: 'NVIDIA is going to $200.' }).includes('no_conditional_call'));
  assert.ok(reasons({ wrongIf: 'It might fall.' }).includes('no_invalidation'));
  for (const bad of ['In my experience this setup works.', 'Years ago I traded this exact pattern.', 'It reminds me of 2021.', 'I remember when this happened last time.', "I'm excited about this one.", 'Last week I bought the dip.']) assert.ok(reasons({ lede: [bad, ...good.lede.slice(1)] }).includes('invented_experience'), bad);
  assert.ok(!reasons({}).includes('invented_experience'));
  for (const st of W.STANCES) assert.ok(!reasons({ stance: st }).includes('no_stance'), st);
});

test('the craft rules: the machine cadence and textbook asides are refused, the prompts carry the rules, and the house body has uneven paragraphs with a plain statement of stakes', () => {
  const s = sheet(); const good = W.housePiece(s, 2);
  assert.ok(W.validate({ ...good, lede: ['Dealers hedge as price rises, which means they must buy more shares, and that causes a feedback loop in the stock.', ...good.lede.slice(1)] }, s).reasons.includes('ai_cadence'));
  for (const bad of ['Gamma refers to the rate of change of delta.', 'Short interest is defined as the number of shares sold short.', 'Put simply, the stock is cheap.']) assert.ok(W.validate({ ...good, lede: [bad, ...good.lede.slice(1)] }, s).reasons.includes('glossary_aside'), bad);
  assert.ok(!W.validate(good, s).reasons.some((r) => /cadence|glossary/.test(r)));
  for (const must of [/one disclaimer at most/i, /symmetrical/i, /consistent voice/i, /no filler, no padding/i, /glossary/i]) assert.match(W.SYSTEM, must);
  const lens = good.sections[0].paragraphs.map((p) => p.split(/\s+/).length); assert.ok(new Set(lens).size >= 2, 'paragraph lengths vary: ' + lens);
  assert.ok(good.sections[0].paragraphs.join(' ').length > 100);
  assert.ok(good.sections.length <= 6 && good.sections.length >= 3);
});

test('no brand in the prose: a data line or a model draft that names the Academy is cleaned or refused', () => {
  const d = { ...dossier, intent: { ok: true, intent: { phase: 'accumulation', side: 'buyers', strength: 64, evidence: [], read: "The Academy's data desk reads smart money accumulating." } } };
  const s = W.factSheet({ story: story(), c: base, dossier: d });
  assert.doesNotMatch(s.lines.map((l) => l.text).join(' '), /academy/i);
  const good = W.housePiece(s, 1);
  assert.doesNotMatch(JSON.stringify(good), /academy/i);
  const cleaned = W.normalize({ ...good, lede: ['The Making Easy Money Academy sees buyers here and the stock may run.', 'Academy tools show the Academy\'s scanner flagged it.'] });
  assert.doesNotMatch(JSON.stringify(cleaned), /academy/i); assert.match(cleaned.lede[0], /^The desk sees buyers/);
  assert.match(W.SYSTEM, /never mention the Academy/i); assert.match(W.SYSTEM, /Grandmaster-Obi/);
});

test('context from the price history: range, recent sessions, volume and the largest move come from the bars, carry their own numbers, and become the context section', () => {
  const bars = []; let p0 = 20; for (let i = 0; i < 90; i++) { const o = p0, c = p0 * (1 + Math.sin(i / 5) * 0.01 + 0.001); bars.push({ t: Date.UTC(2026, 6, 1) + i * 86_400_000, o, h: Math.max(o, c) * 1.004, l: Math.min(o, c) * 0.996, c, v: 900_000 + (i > 84 ? 400_000 : 0) }); p0 = c; }
  const c = { symbol: 'CTXA', name: 'Context Corp', price: bars[bars.length - 1].c, changePct: 1.1, relVol: 1.3, adv: 900_000, daily: bars };
  const st = E.rankStories([c], { force: true })[0];
  const sh = W.factSheet({ story: st, c, dossier: {} });
  const L = Object.fromEntries(sh.lines.map((l) => [l.k, l.text]));
  for (const k of ['ctxrange', 'ctxstreak', 'ctxvol', 'ctxmove']) assert.ok(L[k], k);
  assert.match(L.ctxrange, /60-session range.*below the high of \$[\d.]+ \((?:[A-Z][a-z]{2} \d+)\).*above the low of \$[\d.]+/);
  assert.match(L.ctxstreak, /closed (?:higher|lower) in (?:each of its last 9|\d+ of its last 9) sessions/); assert.match(L.ctxvol, /averaged \d\.\dx the twenty sessions before them/); assert.match(L.ctxmove, /largest one-day move in the past twenty sessions/);
  for (const k of ['ctxrange', 'ctxvol']) for (const m of L[k].matchAll(/\d[\d.]*/g)) assert.ok(sh.numbers.has(m[0]) || sh.numbers.has(m[0].replace(/\.?0+$/, '')) || Number(m[0]) <= 30, 'carried: ' + m[0]);
  for (let seed = 0; seed < 6; seed++) {
    const piece = W.housePiece(sh, seed);
    const ctx = piece.sections[0]; assert.match(ctx.paragraphs.join(' '), /60-session range/); assert.ok(ctx.paragraphs.length >= 2);
    assert.ok(!/^(Reading the data|The context|Bull case|Bear case|Risks and limits)$/i.test(ctx.heading), 'the heading follows the story, not the template: ' + ctx.heading);
    const v = W.validate(piece, sh, { minWords: 0 }); assert.ok(!v.reasons.some((r) => /new_number|cadence|glossary|person|banned|repeated/.test(r)), v.reasons.join(','));
    const words = [piece.title, piece.dek, ...piece.lede, ...piece.sections.flatMap((x) => x.paragraphs), piece.bottom].join(' ').split(/\s+/).length;
    assert.ok(words >= 350 && words <= 1100, 'a full piece, not padded: ' + words);
  }
  const lens = W.housePiece(sh, 3).sections.flatMap((x) => x.paragraphs).map((x) => x.split(/\s+/).length);
  assert.ok(Math.max(...lens) >= 2 * Math.min(...lens), 'paragraph lengths vary: ' + lens.join(','));
  assert.match(W.SYSTEM, /context lines/i); assert.match(W.SYSTEM, /single sentence/);
});

test('the narrative is built from an anomaly in the data: the stance follows volume and distance, the headline delivers on what the letter contains, the facts are quotable and the opinion is separate', () => {
  const mk = (vol, closes, extra = {}) => { const bars = []; let p0 = 100; for (let i = 0; i < 80; i++) { const o = p0, c = closes(i, p0); bars.push({ t: Date.UTC(2026, 6, 1) + i * 86_400_000, o, h: Math.max(o, c) * 1.003, l: Math.min(o, c) * 0.997, c, v: vol(i) }); p0 = c; } return { symbol: 'ANOM', name: 'Anomaly Inc', price: bars[bars.length - 1].c, changePct: 0.3, relVol: 0.9, adv: 1_000_000, daily: bars, ...extra }; };
  /* a steady climb on flat volume: the quiet climb */
  const quiet = mk(() => 1_000_000, (i, p) => (i < 60 ? p * (1 + Math.sin(i / 3) * 0.004) : p * 1.004));
  const sq = E.rankStories([quiet], { force: true })[0]; const sh = W.factSheet({ story: sq, c: quiet, dossier: {} });
  assert.ok(sh.metrics.upRun >= 5 && sh.metrics.volRatio <= 1.05, JSON.stringify(sh.metrics));
  assert.equal(W.anomalyFor(sh).kind, 'quietclimb');
  const piece = W.housePiece(sh, 0);
  assert.match(piece.title, /Volume|Rising Without a Crowd/); assert.match(piece.lede.join(' '), /volume/i);
  assert.ok(['Lean bullish', 'Neutral, waiting on confirmation', 'Bullish'].includes(piece.stance));
  /* the quotable fact is its own sentence, with the numbers, and the opinion comes after it as a separate sentence */
  const fact = piece.lede.find((l) => /20-day high of \$[\d.]+ and \$[\d.]+ above its 20-day low/.test(l)); assert.ok(fact, 'a clean factual passage: ' + piece.lede.join(' | '));
  assert.ok(!/\b(I|my)\b/.test(fact), 'the fact has no opinion in it'); assert.match(piece.lede[piece.lede.length - 1], /^My read: /);
  assert.match(piece.ifRight, /^If \$ANOM .* and volume expands, I think \$[\d.]+ becomes the next serious test\.$/); assert.match(piece.wrongIf, /^(Under|Above) \$[\d.]+, I'm wrong\.$/);
  assert.equal(W.validate(piece, sh, { minWords: 0 }).reasons.filter((r) => /new_number|stance|question|conditional|invalidation|opinion|experience|brand|cadence/.test(r)).length, 0);
  /* stance rules: event inside a week is binary; unconfirmed and far from the level is neutral */
  assert.equal(W.stanceFor({ ...sh, earningsDays: 3 }), 'Binary, event-driven');
  assert.equal(W.stanceFor({ lean: 'bullish', metrics: { distHighPct: 9, volRatio: 0.8, relVol: 0.9 } }), 'Neutral, waiting on confirmation');
  assert.equal(W.stanceFor({ lean: 'bullish', metrics: { distHighPct: 1.2, volRatio: 1.3, relVol: 1.5 } }), 'Bullish');
  assert.equal(W.stanceFor({ lean: 'bearish', metrics: { distLowPct: 1.2, volRatio: 1.3, relVol: 1.5 } }), 'Bearish');
  assert.equal(W.stanceFor({ lean: 'bearish', metrics: { distLowPct: 2, volRatio: 0.8, relVol: 0.9 } }), 'Lean bearish');
  /* no template headings, and the sections differ from article to article only by story */
  for (const seed of [0, 1, 2, 3]) for (const sec of W.housePiece(sh, seed).sections) assert.ok(!/^(Reading the data|The context|The key details|The scenario|Risks and limits|Bull case|Bear case)$/i.test(sec.heading), sec.heading);
});
