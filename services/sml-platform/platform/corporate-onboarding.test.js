/* Corporate onboarding.  Run: node --test  (services/sml-platform/platform)
 *
 * The expensive failures here are the cap (corporate taking over the screen),
 * identity (keying on anything but a user id), and the bot fallback — all three
 * are first impressions a new user only gets once.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('./corporate-onboarding.js');

const ANSWERS = Object.freeze({
  instrument: 'options', holdPeriod: 'days', riskAppetite: 'balanced',
  experience: 'one_to_five', watchlist: ['aapl', '$TSLA'], sectors: ['technology', 'macro'],
  learningStyle: 'written_letters', participation: 'read_quietly',
  intent: 'follow_pros', newsAppetite: 'a_few_a_day'
});

const creators = (n, from = 1000) =>
  Array.from({ length: n }, (_, i) => ({ wpUserId: from + i, handle: `creator${i}`, followers: 100 - i }));

/* ------------------------------------------------------------ the questions */

test('there are exactly ten questions and every one declares what it drives', () => {
  assert.equal(O.QUESTIONS.length, 10);
  for (const q of O.QUESTIONS) {
    assert.ok(q.drives && q.drives.length > 3, `${q.id} drives nothing`);
    /* The ticker picker is an instruction ("Pick up to 5..."), by design. */
    if (q.type !== 'tickers') assert.ok(q.prompt.endsWith('?'), `${q.id} is not phrased as a question`);
  }
});

test('question ids are unique and options are non-empty', () => {
  const ids = O.QUESTIONS.map((q) => q.id);
  assert.equal(new Set(ids).size, 10);
  for (const q of O.QUESTIONS) {
    if (q.type === 'tickers') continue;
    assert.ok(Array.isArray(q.options) && q.options.length >= 2, `${q.id} has no real choice`);
  }
});

/* ------------------------------------------------------------- validation */

test('a complete submission validates clean', () => {
  const r = O.validateAnswers(ANSWERS);
  assert.equal(r.complete, true);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(r.rejected, []);
});

test('unknown questions and unknown options are dropped, not stored', () => {
  const r = O.validateAnswers({ ...ANSWERS, instrument: 'forex', favouriteColour: 'blue' });
  assert.equal(r.answers.instrument, undefined, 'an invented option is never written');
  assert.equal(r.answers.favouriteColour, undefined);
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ['unknown_option', 'unknown_question']);
  assert.deepEqual(r.missing, ['instrument']);
  assert.equal(r.complete, false);
});

test('a partial submission reports what is missing instead of throwing', () => {
  const r = O.validateAnswers({ instrument: 'stocks' });
  assert.equal(r.complete, false);
  assert.equal(r.missing.length, 7, 'eight are required; one was answered');
  assert.ok(!r.missing.includes('watchlist'), 'optional questions are not "missing"');
});

test('tickers are normalized, deduped and truncated at five', () => {
  assert.deepEqual(O.normalizeTickers(['aapl', ' $tsla ', 'AAPL']), ['AAPL', 'TSLA']);
  assert.equal(O.normalizeTickers(['A', 'B', 'C', 'D', 'E', 'F']).length, 5, 'truncated, not rejected');
  assert.deepEqual(O.normalizeTickers(['<script>', '', null, '123']), []);
  assert.deepEqual(O.normalizeTickers('AAPL'), [], 'a bare string is not a list');
  assert.deepEqual(O.normalizeTickers(['BRK.B']), ['BRK.B'], 'real tickers carry dots');
});

test('multi-select keeps only known values', () => {
  const r = O.validateAnswers({ ...ANSWERS, sectors: ['technology', 'tulips', 'technology'] });
  assert.deepEqual(r.answers.sectors, ['technology']);
});

test('a non-object submission is refused outright', () => {
  for (const bad of [null, 'answers', 42]) assert.throws(() => O.validateAnswers(bad), TypeError);
});

/* ---------------------------------------------------------------- profile */

test('the profile carries exactly what the feed reads', () => {
  const p = O.buildProfile(O.validateAnswers(ANSWERS).answers);
  assert.deepEqual(p.watchlist, ['AAPL', 'TSLA']);
  assert.ok(p.categoryAffinity.finance > 0, 'trading options implies finance');
  assert.ok(p.categoryAffinity.research > 0, 'letters + macro imply research');
  assert.equal(p.prefersLetters, true);
  assert.equal(p.wantsVoiceRooms, false);
});

test('affinity is clamped to 1 however many signals pile up', () => {
  const p = O.buildProfile({
    instrument: 'options', learningStyle: 'written_letters', newsAppetite: 'everything',
    sectors: ['technology', 'macro', 'financials', 'healthcare', 'crypto']
  });
  for (const [k, v] of Object.entries(p.categoryAffinity)) {
    assert.ok(v >= 0 && v <= 1, `${k} = ${v} is out of range`);
  }
});

test('question 10 sets the user\'s own ceiling on promoted slots', () => {
  assert.equal(O.buildProfile({ newsAppetite: 'headlines_only' }).corporateSlotCap, 1);
  assert.equal(O.buildProfile({ newsAppetite: 'a_few_a_day' }).corporateSlotCap, 2);
  assert.equal(O.buildProfile({ newsAppetite: 'everything' }).corporateSlotCap, 3);
});

test('an unanswered question 10 gets the middle setting, not the largest', () => {
  assert.equal(O.buildProfile({}).corporateSlotCap, 2);
});

test('the slot cap is never zero — it tunes volume, it is not an opt-out', () => {
  /* A silent opt-out would be sold as inventory that can never deliver. */
  for (const cap of Object.values(O.SLOT_CAP_BY_APPETITE)) assert.ok(cap >= 1);
});

test('an empty profile is still a usable profile', () => {
  const p = O.buildProfile({});
  assert.deepEqual(p.watchlist, []);
  assert.deepEqual(p.categoryAffinity, {});
  assert.equal(p.isBeginner, false);
});

/* -------------------------------------------------------------- the pool */

test('the pool is 15 cards with the right composition', () => {
  const r = O.buildCardPool({
    corporate: [{ wpUserId: 1, category: 'news' }, { wpUserId: 2, category: 'finance' }],
    news: [{ wpUserId: 10 }, { wpUserId: 11 }],
    creators: creators(20),
    profile: O.buildProfile(O.validateAnswers(ANSWERS).answers)
  });
  assert.equal(r.cards.length, 15);
  assert.equal(r.corporateCount, 2);
  assert.equal(r.cards.filter((c) => c.source === 'news').length, 2);
  assert.equal(r.cards.filter((c) => c.source === 'creator').length, 11);
  assert.equal(r.short, false);
});

test('corporate is capped at 3 however many are supplied', () => {
  const r = O.buildCardPool({
    corporate: Array.from({ length: 12 }, (_, i) => ({ wpUserId: i + 1, category: 'news' })),
    creators: creators(20)
  });
  assert.equal(r.corporateCount, 3, 'above 3 it stops being a recommendation screen');
  assert.equal(r.cards.filter((c) => c.source === 'corporate').length, 3);
  assert.equal(r.cards.length, 15);
});

test('the corporate slots go to the categories the user asked about', () => {
  const profile = { categoryAffinity: { research: 0.9, news: 0.1 } };
  const r = O.buildCardPool({
    corporate: [
      { wpUserId: 1, category: 'news' },
      { wpUserId: 2, category: 'research' },
      { wpUserId: 3, category: 'other' }
    ],
    creators: creators(20), profile
  }, { maxCorporate: 1 });
  assert.equal(r.cards[0].wpUserId, 2, 'best fit first, not first registered');
});

test('a suspended corporate account never appears', () => {
  const r = O.buildCardPool({
    corporate: [{ wpUserId: 1, category: 'news', active: false }],
    creators: creators(20)
  });
  assert.equal(r.corporateCount, 0);
});

test('creators backfill a corporate or news shortfall', () => {
  const r = O.buildCardPool({ corporate: [], news: [], creators: creators(20) });
  assert.equal(r.cards.length, 15);
  assert.equal(r.corporateCount, 0, 'zero corporate is a fine pool');
  assert.equal(r.short, false);
});

test('a corporate shortfall is never filled by a fourth corporate card', () => {
  const r = O.buildCardPool({
    corporate: Array.from({ length: 12 }, (_, i) => ({ wpUserId: i + 1, category: 'news' })),
    news: [], creators: []
  });
  assert.equal(r.cards.length, 3, 'the cap holds even when it leaves the pool short');
  assert.equal(r.short, true, 'and the shortfall is reported rather than hidden');
});

test('cards are deduped by user id across every source', () => {
  const r = O.buildCardPool({
    corporate: [{ wpUserId: 7, category: 'news' }],
    news: [{ wpUserId: 7 }],
    creators: [{ wpUserId: 7 }, ...creators(20)]
  });
  assert.equal(r.cards.filter((c) => c.wpUserId === 7).length, 1);
  assert.equal(r.corporateCount, 1, 'the first source to claim the id keeps it');
});

test('cards without a usable user id are dropped', () => {
  /* Handles collide on this site — a pool keyed on anything but the id would
   * silently drop or double a real person. */
  const r = O.buildCardPool({
    corporate: [{ handle: 'bloomberg' }],
    creators: [{ wpUserId: 0 }, { wpUserId: 'abc' }, { wpUserId: null }, ...creators(20)]
  });
  assert.equal(r.corporateCount, 0);
  assert.ok(r.cards.every((c) => Number.isSafeInteger(c.wpUserId) && c.wpUserId > 0));
});

/* ------------------------------------------------------- the personalized 5 */

test('friends come first, then trader suggestions, then creators', () => {
  const r = O.personalizedFive({
    friends: [{ wpUserId: 1 }], traderSuggest: [{ wpUserId: 2 }], creators: creators(10)
  });
  assert.deepEqual(r.cards.map((c) => c.source),
    ['friends', 'trader_suggest', 'creator_backfill', 'creator_backfill', 'creator_backfill']);
});

test('a cold start still shows five, from creators', () => {
  /* Both upstream routes fail closed and return [] with no data. */
  const r = O.personalizedFive({ friends: [], traderSuggest: [], creators: creators(10) });
  assert.equal(r.cards.length, 5);
  assert.equal(r.short, false);
});

test('an automated account is never recommended as a person', () => {
  const r = O.personalizedFive({
    friends: [{ wpUserId: 1, isAutomated: true }],
    traderSuggest: [{ wpUserId: 2, isAutomated: true }],
    creators: [{ wpUserId: 3, isAutomated: true }, ...creators(10)]
  });
  assert.equal(r.cards.length, 5);
  assert.ok(r.cards.every((c) => ![1, 2, 3].includes(c.wpUserId)), 'no bots');
});

test('cards already in the pool are not offered again', () => {
  const r = O.personalizedFive({ creators: creators(10, 1000), exclude: [1000, 1001, 1002] });
  assert.ok(r.cards.every((c) => c.wpUserId >= 1003));
});

test('genuinely nothing to show reports short rather than inventing cards', () => {
  const r = O.personalizedFive({});
  assert.deepEqual(r.cards, []);
  assert.equal(r.short, true);
});

/* ------------------------------------------------------------- selection */

test('five of the offered cards is enough to continue', () => {
  const pool = creators(15);
  const r = O.validateSelection([1000, 1001, 1002, 1003, 1004], pool);
  assert.equal(r.ok, true);
  assert.equal(r.selected.length, 5);
});

test('four is not enough', () => {
  const pool = creators(15);
  assert.equal(O.validateSelection([1000, 1001, 1002, 1003], pool).ok, false);
});

test('a selection outside the pool is discarded, not followed', () => {
  /* Otherwise the selection step is an arbitrary "make me follow this user"
   * endpoint that happens to live in onboarding. */
  const pool = creators(15);
  const r = O.validateSelection([1000, 1001, 1002, 1003, 1004, 258456543], pool);
  assert.ok(!r.selected.includes(258456543));
  assert.equal(r.selected.length, 5);
});

test('duplicates do not count twice toward the five', () => {
  const pool = creators(15);
  assert.equal(O.validateSelection([1000, 1000, 1000, 1000, 1000], pool).ok, false);
});

test('junk selections are refused rather than coerced', () => {
  const pool = creators(15);
  const r = O.validateSelection(['1000', null, -1, 1.5, {}], pool);
  assert.deepEqual(r.selected, [1000], 'a numeric string is a legitimate form value');
  assert.equal(r.ok, false);
});
