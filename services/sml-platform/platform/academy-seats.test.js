'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeats, refFor } = require('./academy-seats');
const { ENTITLED_TIERS, ANALYST_TIERS } = require('./academy-access');
const { withPasses, createPassStore, createPassService } = require('./academy-passes');

const OWNER = '258456581000000000';
const A = '111111111111111111';
const B = '222222222222222222';
const C = '333333333333333333';
const NOW = Date.parse('2026-10-21T12:00:00Z');
const PERIOD = '2026-11-21T12:00:00Z';
const PERIOD_ISO = new Date(PERIOD).toISOString(); /* the module normalises timestamps */

function harness({ clock = () => NOW } = {}) {
  const doc = { subs: {} };
  const store = { read: async () => doc, write: async (s) => { Object.assign(doc, s); } };
  const passStore = createPassStore();
  const seats = createSeats({ store, passes: passStore, now: clock });
  return { seats, passStore, doc };
}
const activeFor = (passStore, memberId, at = new Date(NOW)) => passStore.active(memberId, at, 'academy');

test('a seat grants an Academy pass, which is the Trader level and never Analyst', async () => {
  const { seats, passStore } = harness();
  await seats.setSubscription(OWNER, { seats: 2, periodEnd: PERIOD });
  const r = await seats.assign(OWNER, A);
  assert.equal(r.ok, true);
  assert.equal(r.used, 1);
  assert.equal(r.free, 1);

  const pass = await activeFor(passStore, A);
  assert.ok(pass, 'the member holds a live pass');
  assert.equal(pass.plan, 'seat');
  assert.equal(pass.ref, refFor(OWNER, A, PERIOD_ISO), 'the pass is scoped to this billing period');
  assert.equal(pass.expiresAt, PERIOD_ISO, 'the seat expires with the billing period');

  /* and that pass admits them at trader level through the existing access path */
  const refused = { verify: async () => ({ ok: false, code: 'academy_role_required', userId: A }) };
  const svc = createPassService({ store: passStore, now: () => new Date(NOW) });
  const session = await withPasses(refused, svc).verify('Bearer x');
  assert.equal(session.tier, 'trader');
  assert.ok(ENTITLED_TIERS.includes(session.tier), 'a seat clears the content gate');
  assert.equal(ANALYST_TIERS.includes(session.tier), false, 'a seat never grants the publishing side');
});

test('seats run out, and assigning the same member twice is not a second seat', async () => {
  const { seats } = harness();
  await seats.setSubscription(OWNER, { seats: 2, periodEnd: PERIOD });
  assert.equal((await seats.assign(OWNER, A)).ok, true);
  assert.equal((await seats.assign(OWNER, A)).already, true, 'idempotent');
  assert.equal((await seats.assign(OWNER, B)).used, 2);

  const full = await seats.assign(OWNER, C);
  assert.equal(full.ok, false);
  assert.equal(full.code, 'no_seats_free');
  assert.equal(full.used, 2, 'the refusal still reports the real counts');
});

test('releasing a seat ends that member\'s pass and frees the seat', async () => {
  const { seats, passStore } = harness();
  await seats.setSubscription(OWNER, { seats: 1, periodEnd: PERIOD });
  await seats.assign(OWNER, A);
  assert.ok(await activeFor(passStore, A));

  const out = await seats.release(OWNER, A);
  assert.equal(out.ok, true);
  assert.equal(out.used, 0);
  assert.equal(await activeFor(passStore, A), null, 'access stops at once');
  assert.equal((await seats.release(OWNER, A)).already, true);
  assert.equal((await seats.assign(OWNER, B)).ok, true, 'the freed seat can be reused');
});

test('with no live subscription nobody can be seated', async () => {
  const { seats } = harness();
  assert.equal((await seats.assign(OWNER, A)).code, 'no_active_subscription');

  await seats.setSubscription(OWNER, { seats: 1, periodEnd: '2026-10-01T00:00:00Z' });
  assert.equal((await seats.assign(OWNER, A)).code, 'no_active_subscription', 'an expired period seats nobody');

  await seats.setSubscription(OWNER, { seats: 1, periodEnd: PERIOD, status: 'ended' });
  assert.equal((await seats.assign(OWNER, A)).code, 'no_active_subscription', 'a cancelled subscription seats nobody');
});

test('cancelling releases every seat and stops every pass', async () => {
  const { seats, passStore } = harness();
  await seats.setSubscription(OWNER, { seats: 2, periodEnd: PERIOD });
  await seats.assign(OWNER, A);
  await seats.assign(OWNER, B);

  const ended = await seats.setSubscription(OWNER, { seats: 2, periodEnd: PERIOD, status: 'ended' });
  assert.equal(ended.used, 0);
  assert.deepEqual(ended.dropped.sort(), [A, B].sort());
  assert.equal(await activeFor(passStore, A), null);
  assert.equal(await activeFor(passStore, B), null);
});

test('shrinking the seat count drops the newest members, keeping the longest-held seats', async () => {
  let clock = NOW;
  const { seats, passStore } = harness({ clock: () => clock });
  await seats.setSubscription(OWNER, { seats: 3, periodEnd: PERIOD });
  await seats.assign(OWNER, A); clock += 1000;
  await seats.assign(OWNER, B); clock += 1000;
  await seats.assign(OWNER, C);

  const smaller = await seats.setSubscription(OWNER, { seats: 1, periodEnd: PERIOD });
  assert.equal(smaller.used, 1);
  assert.deepEqual(smaller.dropped.sort(), [B, C].sort(), 'the two newest lose their seats');
  assert.ok(await activeFor(passStore, A, new Date(clock)), 'the first member keeps theirs');
  assert.equal(await activeFor(passStore, C, new Date(clock)), null);
});

test('a renewal pushes every seat out to the new period end', async () => {
  const { seats, passStore } = harness();
  await seats.setSubscription(OWNER, { seats: 1, periodEnd: PERIOD });
  await seats.assign(OWNER, A);
  assert.equal((await activeFor(passStore, A)).expiresAt, PERIOD_ISO);

  const next = new Date('2026-12-21T12:00:00Z').toISOString();
  await seats.setSubscription(OWNER, { seats: 1, periodEnd: next });
  const pass = await activeFor(passStore, A);
  assert.equal(pass.expiresAt, next, 'the seat follows the subscription');
  assert.equal(pass.ref, refFor(OWNER, A, next), 'a new period means a new pass, so the store is never asked for a duplicate ref');
  assert.equal((await seats.get(OWNER)).used, 1, 'and the member keeps their seat across the renewal');
});

test('bad input is refused rather than guessed at', async () => {
  const { seats } = harness();
  assert.equal((await seats.setSubscription('nope', { seats: 1 })).code, 'invalid_owner');
  assert.equal((await seats.setSubscription(OWNER, { seats: -1 })).code, 'invalid_seats');
  assert.equal((await seats.setSubscription(OWNER, { seats: 1.5 })).code, 'invalid_seats');
  assert.equal((await seats.setSubscription(OWNER, { seats: 99999 })).code, 'invalid_seats');
  await seats.setSubscription(OWNER, { seats: 1, periodEnd: PERIOD });
  assert.equal((await seats.assign(OWNER, 'not-a-snowflake')).code, 'invalid_member');
  assert.equal((await seats.get('nope')).code, 'invalid_owner');
});

test('seatOf reports who is covering a member, and only while the subscription is live', async () => {
  const { seats } = harness();
  await seats.setSubscription(OWNER, { seats: 1, periodEnd: PERIOD });
  await seats.assign(OWNER, A);
  assert.equal((await seats.seatOf(A)).ownerId, OWNER);
  assert.equal(await seats.seatOf(B), null);

  await seats.setSubscription(OWNER, { seats: 1, periodEnd: PERIOD, status: 'ended' });
  assert.equal(await seats.seatOf(A), null);
});

test('an owner with no subscription reads as zero seats rather than an error', async () => {
  const { seats } = harness();
  const r = await seats.get(OWNER);
  assert.equal(r.ok, true);
  assert.equal(r.seats, 0);
  assert.equal(r.used, 0);
  assert.equal(r.live, false);
  assert.deepEqual(r.members, []);
});

test('re-issuing inside one period never asks the store for a duplicate ref', async () => {
  /* the pass store keeps one pass per ref and throws duplicate_ref; a seat must not trip that on
     a repeated webhook, a resync, or two renewals landing on the same period */
  const doc = { subs: {} };
  const store = { read: async () => doc, write: async (s) => { Object.assign(doc, s); } };
  const raw = createPassStore();
  const seen = [];
  const passes = {
    active: (...a) => raw.active(...a),
    byRef: (...a) => raw.byRef(...a),
    markRefunded: (...a) => raw.markRefunded(...a),
    add: (...a) => { seen.push(a[0].ref); return raw.add(...a); }
  };
  const problems = [];
  const seats = createSeats({ store, passes, now: () => NOW, logger: (lvl, ev) => { if (ev === 'academy_seat_grant_failed') problems.push(ev); } });

  await seats.setSubscription(OWNER, { seats: 1, periodEnd: PERIOD });
  await seats.assign(OWNER, A);
  await seats.setSubscription(OWNER, { seats: 1, periodEnd: PERIOD });
  await seats.setSubscription(OWNER, { seats: 1, periodEnd: PERIOD });
  await seats.assign(OWNER, A);

  assert.deepEqual(problems, [], 'no grant was refused');
  assert.equal(seen.length, 1, 'one pass written, however many times the period is re-stated');
  assert.ok(await activeFor(raw, A), 'and the member still holds it');
});

test('a billing event older than the last one applied is ignored, but a direct read is not', async () => {
  const { seats } = harness();
  await seats.setSubscription(OWNER, { seats: 3, periodEnd: PERIOD, eventAt: 1000 });
  await seats.assign(OWNER, A);

  const late = await seats.setSubscription(OWNER, { seats: 0, periodEnd: null, status: 'ended', eventAt: 999 });
  assert.equal(late.stale, true);
  assert.equal(late.seats, 3, 'the out-of-order event changed nothing');
  assert.equal((await seats.get(OWNER)).used, 1);

  /* eventAt absent means "read straight from the source", which is never out of order.
     Number(null) is 0, so an absent time must not be compared as a number. */
  const read = await seats.setSubscription(OWNER, { seats: 1, periodEnd: PERIOD });
  assert.equal(read.stale, undefined);
  assert.equal(read.seats, 1);
});

test('the Stripe binding is kept for the portal and never leaves in a response', async () => {
  const { seats } = harness();
  await seats.setSubscription(OWNER, { seats: 1, periodEnd: PERIOD, customerId: 'cus_9', subscriptionId: 'sub_9' });
  const view = await seats.get(OWNER);
  assert.equal(view.billing, true);
  assert.equal(view.customerId, undefined);
  assert.equal(view.subscriptionId, undefined);
  assert.deepEqual(await seats.billingOf(OWNER), { customerId: 'cus_9', subscriptionId: 'sub_9' });
  assert.equal(await seats.billingOf(A), null);
});
