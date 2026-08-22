/* Module 10 tests.  Run: node --test news-engine/src/moderation/ */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const mod = require('./index.js');

const goodArticle = {
  title: 'NVDA Options Flow Spikes Into Friday Expiry',
  body: [
    'Nvidia call volume ran roughly four times its twenty-day average on Tuesday.',
    'Most of the premium landed in contracts expiring at the end of the week.',
    'Dealers who sold those calls typically hedge by buying the underlying shares.',
    'That hedging flow can amplify moves as the position gets closer to expiry.',
    'Volume in the weekly strikes above the current price was unusually heavy.',
    'Open interest built steadily through the session rather than in one block.',
    'The broader semiconductor group traded firm but without comparable activity.',
    'Traders watching this setup tend to focus on where dealer exposure flips.',
    'A close above the heaviest strike would leave dealers shorter than before.',
    'Positioning data through the afternoon showed continued call accumulation.'
  ].join(' '),
  key_points: ['Call volume 4x the 20-day average', 'Premium concentrated in Friday weeklies'],
  why_this_matters: 'Concentrated weekly premium can force dealer hedging.',
  market_reaction: 'Shares rose 2.1% on the session.',
  what_happens_next: 'Friday expiry is the level to watch.',
  trader_takeaway: 'Watch gamma into expiry.',
  tickers: ['NVDA'],
  enhanced_data_modules: { options_flow: {}, gamma: {}, unusual_volume: {} }
};

/* ---------- fingerprinting ---------- */

test('identical text produces identical simhash', () => {
  assert.equal(mod.simhash('the quick brown fox jumps over the lazy dog today'),
               mod.simhash('the quick brown fox jumps over the lazy dog today'));
});

test('near-identical text is a small Hamming distance apart', () => {
  const a = mod.simhash(goodArticle.body);
  const b = mod.simhash(goodArticle.body.replace('Nvidia', 'Broadcom').replace('four times', 'five times'));
  const d = mod.hammingDistance(a, b);
  assert.ok(d <= mod.constants.SIMILAR_HAMMING_MAX, `expected near-duplicate, distance was ${d}`);
});

test('unrelated text is far apart', () => {
  const a = mod.simhash(goodArticle.body);
  const b = mod.simhash('The central bank held rates steady and signalled patience on inflation for the remainder of the year ahead.');
  assert.ok(mod.hammingDistance(a, b) > mod.constants.SIMILAR_HAMMING_MAX);
});

test('simhash survives the round trip through a signed Postgres BIGINT', () => {
  const h = mod.simhash(goodArticle.body);
  const signed = BigInt(mod.toSignedBigInt(h));
  const back = signed < 0n ? signed + (1n << 64n) : signed;
  assert.equal(back, h);
  assert.ok(signed >= -(2n ** 63n) && signed < 2n ** 63n, 'outside BIGINT range');
});

test('bands are four 16-bit values inside INTEGER range', () => {
  const b = mod.simhashBands(mod.simhash(goodArticle.body));
  assert.equal(b.length, 4);
  for (const x of b) assert.ok(Number.isInteger(x) && x >= 0 && x <= 0xffff, `band out of range: ${x}`);
});

test('empty text does not throw', () => {
  assert.equal(mod.simhash(''), 0n);
  assert.equal(mod.fingerprint('').token_count, 0);
});

/* ---------- duplicate detection ---------- */

test('a near-identical candidate is flagged at severity 5', () => {
  const existing = { entity_type: 'article', entity_id: 1, simhash: mod.simhash(goodArticle.body).toString() };
  const r = mod.detectDuplicate(goodArticle.body, [existing]);
  assert.equal(r.flags[0].flag_type, 'duplicate');
  assert.equal(r.flags[0].severity, 5);
});

test('an unrelated candidate raises nothing', () => {
  const other = { entity_type: 'article', entity_id: 2, simhash: mod.simhash('Completely different subject matter about bond auctions and yields.').toString() };
  assert.equal(mod.detectDuplicate(goodArticle.body, [other]).flags.length, 0);
});

test('templated re-runs of the same story are caught', () => {
  /* the exact failure mode of auto-generation: same template, new ticker */
  const t = (tk) => `Why did ${tk} options flow spike today? ${tk} saw unusual call activity with premium concentrated in weekly contracts and dealers hedging into expiry across the session.`;
  const first = {
    entity_type: 'article', entity_id: 9,
    simhash: mod.simhash(t('NVDA')).toString(),
    template_simhash: mod.templateSimhash(t('NVDA')).toString()
  };
  const r = mod.detectDuplicate(t('AMD'), [first]);
  assert.ok(r.flags.length >= 1,
    `template reuse not detected (content ${r.closest && r.closest.distance}, template ${r.closestTemplate && r.closestTemplate.distance})`);
  assert.equal(r.flags[0].detector, 'template_reuse_detector');
});

/* ---------- self-repetition ---------- */

test('padded content is flagged', () => {
  const padded = ('Nvidia saw unusual options activity across the session today. ').repeat(6);
  assert.ok(mod.detectSelfRepetition(padded).flags.length >= 1);
});

test('normal prose is not', () => {
  assert.equal(mod.detectSelfRepetition(goodArticle.body).flags.length, 0);
});

/* ---------- spam ---------- */

test('link farms are flagged', () => {
  const body = 'Check these out. ' + Array.from({ length: 12 }, (_, i) => `https://example${i}.com/promo`).join(' ');
  assert.ok(mod.detectSpam({ body }).flags.some((f) => f.flag_type === 'spam'));
});

test('promotional stacking is flagged, a single phrase is only a nudge', () => {
  const heavy = mod.detectSpam({ body: 'This is guaranteed easy money, get in now before it explodes.' });
  assert.ok(heavy.flags.some((f) => f.severity >= 4));
  const light = mod.detectSpam({ body: 'Some analysts called it a sure thing, which is worth treating sceptically given the risks involved here.' });
  assert.ok(light.flags.every((f) => f.severity <= 2));
});

test('a clean article raises no spam flags', () => {
  assert.equal(mod.detectSpam(goodArticle).flags.length, 0);
});

/* ---------- manipulation ---------- */

test('a full pump pattern on a microcap is severity 5', () => {
  const r = mod.detectManipulation(
    { body: 'This is going to $50, the squeeze is coming and shorts are trapped. Load up right now before it explodes.' },
    { market_cap: 40e6, price: 0.8, no_verifiable_catalyst: true }
  );
  assert.equal(r.flags[0].severity, 5);
});

test('being a microcap alone is not manipulation', () => {
  const r = mod.detectManipulation(
    { body: 'The company reported quarterly revenue of $4.2 million, up from $3.1 million a year earlier.' },
    { market_cap: 40e6, price: 0.8 }
  );
  assert.equal(r.flags.length, 0, 'false positive on ordinary microcap coverage');
});

test('meme-stock vocabulary in legitimate coverage does not alone trigger', () => {
  const r = mod.detectManipulation(
    { body: 'Retail traders on forums invoked diamond hands, echoing the next GME comparisons made in 2021.' },
    { market_cap: 5e9 }
  );
  assert.ok(r.flags.every((f) => f.severity < 5));
});

/* ---------- bot detection ---------- */

test('metronomic posting is flagged', () => {
  const base = Date.parse('2026-08-22T10:00:00Z');
  const timestamps = Array.from({ length: 8 }, (_, i) => new Date(base + i * 600000).toISOString());
  assert.ok(mod.detectBot({ timestamps }).flags.some((f) => f.flag_type === 'bot'));
});

test('irregular human posting is not', () => {
  const base = Date.parse('2026-08-22T10:00:00Z');
  const offsets = [0, 431000, 1500000, 1780000, 5400000, 9100000, 9500000];
  const timestamps = offsets.map((o) => new Date(base + o).toISOString());
  assert.equal(mod.detectBot({ timestamps }).flags.length, 0);
});

test('repeated templates across posts are flagged', () => {
  /* detectBot expects TEMPLATE fingerprints — raw content hashes would differ
     on the ticker alone, which is precisely what a bot varies. */
  const fps = ['NVDA moved on volume today', 'AMD moved on volume today', 'INTC moved on volume today']
    .map((t) => mod.templateSimhash(t));
  assert.ok(mod.detectBot({ fingerprints: fps }).flags.some((f) => /template/i.test(f.reason)));
});

/* ---------- honesty of the degraded detectors ---------- */

test('toxicity fallback marks itself degraded and stays low severity', () => {
  const r = mod.detectToxicity({ body: 'you are an idiot and a moron' });
  assert.equal(r.degraded, true);
  assert.ok(r.flags.every((f) => f.severity <= 1), 'lexical fallback must not assert high confidence');
});

test('a supplied classifier replaces the fallback entirely', () => {
  const r = mod.detectToxicity({ body: 'anything' },
    () => ({ flags: [{ flag_type: 'toxicity', severity: 5, reason: 'model', evidence: {}, detector: 'perspective' }] }));
  assert.equal(r.flags[0].detector, 'perspective');
  assert.equal(r.degraded, undefined);
});

test('fact consistency catches a price that contradicts the feed', () => {
  const r = mod.checkFactConsistency({ body: 'Shares changed hands at $42.10 through the afternoon.' }, { price: 12.5 });
  assert.ok(r.flags.some((f) => f.flag_type === 'misinformation'));
});

test('fact consistency stays silent when the numbers agree', () => {
  const r = mod.checkFactConsistency({ body: 'Shares changed hands at $12.60 through the afternoon.' }, { price: 12.5 });
  assert.equal(r.flags.length, 0);
});

/* ---------- quality ---------- */

test('a complete article scores well', () => {
  const q = mod.scoreQuality(goodArticle);
  assert.ok(q.quality_score >= 70, `got ${q.quality_score}: ${q.recommended_improvements.join('; ')}`);
});

test('thin content with no proprietary data scores badly', () => {
  const q = mod.scoreQuality({ body: 'Stock went up today.', tickers: [] });
  assert.ok(q.quality_score < 40, `got ${q.quality_score}`);
  assert.ok(q.recommended_improvements.some((r) => /thin/i.test(r)));
  assert.ok(q.recommended_improvements.some((r) => /data module/i.test(r)));
});

test('readability is computed and plausible', () => {
  assert.ok(mod.fleschReadingEase('The cat sat on the mat. The dog ran fast.') > 80);
  assert.ok(mod.fleschReadingEase('Notwithstanding the aforementioned considerations, the counterparty obligations remain contractually indeterminate.') < 40);
});

/* ---------- orchestration ---------- */

test('a clean article passes with no review required', () => {
  const r = mod.moderate(goodArticle);
  assert.equal(r.moderation_status, 'clean');
  assert.equal(r.requires_review, false);
  assert.ok(r.fingerprint.simhash);
});

test('a duplicate routes to human review rather than silent deletion', () => {
  const r = mod.moderate(goodArticle, {
    duplicateCandidates: [{ entity_type: 'article', entity_id: 1, simhash: mod.simhash(goodArticle.body).toString() }]
  });
  assert.equal(r.requires_review, true);
  assert.ok(r.recommended_actions.includes('noindex'));
});

test('low quality is auto-noindexed without a human', () => {
  const r = mod.moderate({ body: 'Up today.', tickers: [] });
  assert.equal(r.moderation_status, 'auto_noindex');
  assert.ok(r.recommended_actions.includes('noindex'));
});

test('degraded detectors are reported, never hidden', () => {
  assert.deepEqual(mod.moderate(goodArticle).degraded_detectors, ['toxicity']);
});

test('moderate rejects malformed input', () => {
  assert.throws(() => mod.moderate(null), TypeError);
});

test('moderation is deterministic', () => {
  assert.deepEqual(mod.moderate(goodArticle), mod.moderate(goodArticle));
});
