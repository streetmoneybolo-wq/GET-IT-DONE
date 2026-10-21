'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSeatsBilling, checkoutParams, readSubscription, GRACE_HOURS, DEFAULT_MIN_SEATS } = require('./academy-seats-billing');
const { createSeats, refFor } = require('./academy-seats');
const { createPassStore } = require('./academy-passes');
const { sign } = require('./stripe-webhook');

const OWNER = '258456581000000000';
const A = '111111111111111111';
const B = '222222222222222222';
const NOW = Date.parse('2026-10-21T12:00:00Z');
const PERIOD_END = Math.floor(Date.parse('2026-11-21T12:00:00Z') / 1000);
const WITH_GRACE = new Date((PERIOD_END + GRACE_HOURS * 3600) * 1000).toISOString();
const PRICE = 'price_1SeatMonthly';
const SECRET = 'whsec_seats_test_secret';

const ENV = {
  SML_ACADEMY_SEATS_PRICE_ID: PRICE,
  SML_ACADEMY_SEATS_STRIPE_KEY: 'rk_test_seats',
  SML_ACADEMY_SEATS_WEBHOOK_SECRET: SECRET,
  SML_ACADEMY_SEATS_RETURN_URL: 'https://stockmarketloop.com/academy/'
};

function stripeSub({ id = 'sub_1', quantity = 3, status = 'active', ownerId = OWNER, customer = 'cus_1', periodEnd = PERIOD_END } = {}) {
  return {
    id, status, customer,
    metadata: { sml_kind: 'mem_academy_seats', mem_seats_discord_owner: ownerId },
    current_period_end: periodEnd,
    items: { data: [{ quantity, price: { id: PRICE } }] }
  };
}

function harness({ env = ENV, subs = {}, clock = () => NOW } = {}) {
  const doc = { subs: {} };
  const store = { read: async () => doc, write: async (s) => { Object.assign(doc, s); } };
  const passStore = createPassStore();
  const seats = createSeats({ store, passes: passStore, now: clock });
  const calls = [];
  const stripe = {
    createCheckoutSession: async (params, idempotencyKey) => { calls.push(['checkout', params, idempotencyKey]); return { id: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' }; },
    createPortalSession: async (params, idempotencyKey) => { calls.push(['portal', params, idempotencyKey]); return { id: 'bps_1', url: 'https://billing.stripe.com/p/session/bps_1' }; },
    retrieveSubscription: async (id) => { calls.push(['retrieve', id]); return subs[id] || stripeSub({ id }); }
  };
  const logs = [];
  const billing = createSeatsBilling({ env, seats, stripe, now: clock, logger: (lvl, ev, d) => logs.push([ev, d]) });
  return { billing, seats, passStore, calls, logs, doc };
}

const deliver = (billing, event, { secret = SECRET, at = Math.floor(NOW / 1000) } = {}) => {
  const rawBody = JSON.stringify(event);
  return billing.webhook({ rawBody, signature: `t=${at},v1=${sign(secret, String(at), rawBody)}` });
};
const envelope = (type, object, created = Math.floor(NOW / 1000)) =>
  ({ id: `evt_${Math.random().toString(36).slice(2, 10)}`, type, created, livemode: false, data: { object } });
const activeFor = (passStore, memberId, at = new Date(NOW)) => passStore.active(memberId, at, 'academy');

test('the Checkout Session sells the seat count as the quantity, and can be resized before paying', () => {
  const params = checkoutParams({ priceId: PRICE, ownerId: OWNER, seats: 5, minSeats: 5, maxSeats: 1000, returnUrl: 'https://x.test/a', nowSeconds: 1000 });
  assert.equal(params.mode, 'subscription');
  assert.deepEqual(params.line_items, [{ price: PRICE, quantity: 5, adjustable_quantity: { enabled: true, minimum: 5, maximum: 1000 } }],
    'Stripe enforces the floor on its own page, so the quantity that comes back is always valid');
  assert.equal(params.metadata.mem_seats_discord_owner, OWNER);
  assert.equal(params.subscription_data.metadata.mem_seats_discord_owner, OWNER, 'the binding must live on the subscription, which is what the webhook sees');
  assert.equal(params.metadata.sml_kind, 'mem_academy_seats', 'never the Academy engine\'s own sml_kind');
  assert.equal(params.allow_promotion_codes, false);
  assert.ok(params.expires_at > 1000);
  assert.ok(params.success_url.startsWith('https://x.test/a?seats='));
});

test('a subscription reads as seats, with grace on the period end so a late renewal never locks a team out', () => {
  const read = readSubscription(stripeSub({ quantity: 4 }));
  assert.equal(read.ownerId, OWNER);
  assert.equal(read.seats, 4);
  assert.equal(read.status, 'active');
  assert.equal(read.periodEnd, WITH_GRACE);
  assert.equal(read.customerId, 'cus_1');

  /* a failed card is still a paying team while Stripe retries */
  assert.equal(readSubscription(stripeSub({ status: 'past_due' })).status, 'active');
  assert.equal(readSubscription(stripeSub({ status: 'trialing' })).status, 'active');
  /* and these are not */
  for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
    const read = readSubscription(stripeSub({ status }));
    assert.equal(read.status, 'ended', status);
    assert.equal(read.seats, 0, status);
  }
  /* somebody else's subscription on the same endpoint is not seats */
  assert.equal(readSubscription({ id: 'sub_x', status: 'active', metadata: {}, items: { data: [{ quantity: 1 }] } }), null);
  assert.equal(readSubscription(null), null);
});

test('the period can arrive on the item instead of the subscription (newer API versions)', () => {
  const sub = stripeSub({ periodEnd: null });
  sub.current_period_end = null;
  sub.items.data[0].current_period_end = PERIOD_END;
  assert.equal(readSubscription(sub).periodEnd, WITH_GRACE);
});

test('a completed Checkout grants the seats the owner paid for', async () => {
  const { billing, seats, calls } = harness({ subs: { sub_7: stripeSub({ id: 'sub_7', quantity: 2 }) } });
  const out = await deliver(billing, envelope('checkout.session.completed', {
    id: 'cs_1', mode: 'subscription', subscription: 'sub_7',
    metadata: { sml_kind: 'mem_academy_seats', mem_seats_discord_owner: OWNER }
  }));
  assert.equal(out.ok, true);
  assert.equal(out.ownerId, OWNER);
  assert.ok(calls.some(([kind, id]) => kind === 'retrieve' && id === 'sub_7'), 'the session carries only the id, so the subscription is fetched');

  const held = await seats.get(OWNER);
  assert.equal(held.seats, 2);
  assert.equal(held.live, true);
  assert.equal(held.billing, true, 'the owner can now be sent to the billing portal');
  assert.equal(held.customerId, undefined, 'the Stripe customer id never reaches a client');
});

test('an unsigned or wrongly signed delivery changes nothing', async () => {
  const { billing, seats } = harness();
  const event = envelope('customer.subscription.created', stripeSub());
  const bad = await billing.webhook({ rawBody: JSON.stringify(event), signature: 't=1,v1=' + 'a'.repeat(64) });
  assert.equal(bad.ok, false);
  const wrongSecret = await deliver(billing, event, { secret: 'whsec_not_ours' });
  assert.equal(wrongSecret.ok, false);
  assert.equal(wrongSecret.code, 'signature_mismatch');
  assert.equal((await seats.get(OWNER)).seats, 0, 'nothing was granted');
});

test('a seat count change in the portal resizes the team, releasing the newest seats', async () => {
  let clock = NOW;
  const { billing, seats, passStore } = harness({ clock: () => clock });
  await deliver(billing, envelope('customer.subscription.created', stripeSub({ quantity: 2 })));
  await seats.assign(OWNER, A); clock += 1000;
  await seats.assign(OWNER, B);
  assert.ok(await activeFor(passStore, A, new Date(clock)));
  assert.ok(await activeFor(passStore, B, new Date(clock)));

  await deliver(billing, envelope('customer.subscription.updated', stripeSub({ quantity: 1 })), { at: Math.floor(clock / 1000) });
  const held = await seats.get(OWNER);
  assert.equal(held.seats, 1);
  assert.equal(held.used, 1);
  assert.deepEqual(held.members.map((m) => m.memberId), [A], 'the longest-held seat stays');
  assert.equal(await activeFor(passStore, B, new Date(clock)), null, 'the released member loses access at once');
});

test('cancelling ends every seat even though Stripe still reports the old status', async () => {
  const { billing, seats, passStore } = harness();
  await deliver(billing, envelope('customer.subscription.created', stripeSub({ quantity: 1 })));
  await seats.assign(OWNER, A);
  assert.ok(await activeFor(passStore, A));

  /* Stripe sends the deleted subscription with status 'active' on some API versions */
  const out = await deliver(billing, envelope('customer.subscription.deleted', stripeSub({ quantity: 1, status: 'active' }), Math.floor(NOW / 1000) + 10));
  assert.equal(out.ok, true);
  const held = await seats.get(OWNER);
  assert.equal(held.live, false);
  assert.equal(held.used, 0);
  assert.equal(await activeFor(passStore, A), null);
});

test('a late update arriving after a cancellation does not hand the seats back', async () => {
  const { billing, seats } = harness();
  const created = Math.floor(NOW / 1000);
  await deliver(billing, envelope('customer.subscription.created', stripeSub({ quantity: 2 }), created));
  await deliver(billing, envelope('customer.subscription.deleted', stripeSub({ quantity: 2 }), created + 100), { at: created + 100 });
  assert.equal((await seats.get(OWNER)).live, false);

  /* Stripe does not guarantee order; this one was generated BEFORE the cancellation */
  const late = await deliver(billing, envelope('customer.subscription.updated', stripeSub({ quantity: 2 }), created + 50), { at: created + 100 });
  assert.equal(late.ok, true);
  assert.equal(late.applied, false, 'recognised as stale');
  assert.equal((await seats.get(OWNER)).live, false, 'still cancelled');
});

test('the same delivery twice is one grant, not two passes', async () => {
  const { billing, seats, passStore } = harness();
  const event = envelope('customer.subscription.created', stripeSub({ quantity: 1 }));
  await deliver(billing, event);
  await seats.assign(OWNER, A);
  const first = await activeFor(passStore, A);
  await deliver(billing, event);              /* Stripe retries on a slow 200 */
  const second = await activeFor(passStore, A);
  assert.equal(second.ref, first.ref);
  assert.equal(second.ref, refFor(OWNER, A, WITH_GRACE));
  assert.deepEqual((await seats.get(OWNER)).members.map((m) => m.memberId), [A]);
});

test('another product on the same webhook endpoint is ignored, not failed', async () => {
  const { billing } = harness();
  const other = await deliver(billing, envelope('customer.subscription.updated', {
    id: 'sub_other', status: 'active', metadata: { sml_kind: 'mem_academy' }, items: { data: [{ quantity: 1 }] }
  }));
  assert.equal(other.ok, true);
  assert.equal(other.ignored, 'not_a_seats_subscription');

  const unrelated = await deliver(billing, envelope('invoice.paid', { id: 'in_1' }));
  assert.equal(unrelated.ok, true);
  assert.equal(unrelated.ignored, 'invoice.paid');

  const oneOff = await deliver(billing, envelope('checkout.session.completed', { id: 'cs_2', mode: 'payment' }));
  assert.equal(oneOff.ignored, 'not_subscription_mode');
});

test('checkout refuses a second subscription and points at the portal instead', async () => {
  const { billing, seats } = harness();
  const fresh = await billing.checkout(OWNER, 5);
  assert.equal(fresh.ok, true);
  assert.ok(fresh.url.startsWith('https://checkout.stripe.com/'));

  await deliver(billing, envelope('customer.subscription.created', stripeSub({ quantity: 6 })));
  const again = await billing.checkout(OWNER, 9);
  assert.equal(again.ok, false);
  assert.equal(again.code, 'already_subscribed');
  assert.equal(again.seats, 6, 'and says what they already have');
  assert.equal((await seats.get(OWNER)).seats, 6);
});

test('checkout and the portal refuse nonsense', async () => {
  const { billing } = harness();
  assert.equal((await billing.checkout('nope', 5)).code, 'invalid_owner');
  assert.equal((await billing.checkout(OWNER, 0)).code, 'invalid_seats');
  assert.equal((await billing.checkout(OWNER, 5.5)).code, 'invalid_seats');
  assert.equal((await billing.checkout(OWNER, 99999)).code, 'invalid_seats');
  assert.equal((await billing.portal(OWNER)).code, 'no_subscription', 'nobody to send to Stripe yet');
});

test('seats are a team product: a team smaller than the floor cannot be bought, and the floor is configurable', async () => {
  const { billing } = harness();
  assert.equal(billing.minSeats, DEFAULT_MIN_SEATS);
  assert.equal(DEFAULT_MIN_SEATS, 5, 'five is the shipped floor');

  /* one or two seats would undercut an individual Trader plan, so Stripe is never asked */
  for (const n of [1, 2, 3, 4]) {
    const out = await billing.checkout(OWNER, n);
    assert.equal(out.ok, false, String(n));
    assert.equal(out.code, 'invalid_seats');
    assert.equal(out.minSeats, 5, 'the refusal says what the floor is, so the panel can too');
  }
  assert.equal((await billing.checkout(OWNER, 5)).ok, true);

  /* and it moves without a deploy */
  const ten = harness({ env: { ...ENV, SML_ACADEMY_SEATS_MIN: '10' } });
  assert.equal(ten.billing.minSeats, 10);
  assert.equal((await ten.billing.checkout(OWNER, 9)).code, 'invalid_seats');
  assert.equal((await ten.billing.checkout(OWNER, 10)).ok, true);
  const [, params] = ten.calls.find(([kind]) => kind === 'checkout');
  assert.equal(params.line_items[0].adjustable_quantity.minimum, 10);

  /* a bad value falls back to the shipped floor rather than letting anything through */
  for (const bad of ['0', '-3', 'lots', '2.5', '999999']) {
    const h = harness({ env: { ...ENV, SML_ACADEMY_SEATS_MIN: bad } });
    assert.equal(h.billing.minSeats, DEFAULT_MIN_SEATS, bad);
    assert.ok(h.logs.some(([event]) => event === 'academy_seats_min_invalid'), bad);
  }
});

test('the portal opens on the customer Stripe told us about', async () => {
  const { billing, calls } = harness();
  await deliver(billing, envelope('customer.subscription.created', stripeSub({ customer: 'cus_team' })));
  const out = await billing.portal(OWNER);
  assert.equal(out.ok, true);
  const [, params] = calls.find(([kind]) => kind === 'portal');
  assert.equal(params.customer, 'cus_team');
  assert.equal(params.return_url, ENV.SML_ACADEMY_SEATS_RETURN_URL);
});

test('a resync repairs state from Stripe when a webhook was missed', async () => {
  const { billing, seats } = harness({ subs: { sub_1: stripeSub({ quantity: 9 }) } });
  await deliver(billing, envelope('customer.subscription.created', stripeSub({ quantity: 2 })));
  assert.equal((await seats.get(OWNER)).seats, 2);

  const out = await billing.resync(OWNER);
  assert.equal(out.ok, true);
  assert.equal(out.seats, 9, 'Stripe is the authority');
  assert.equal((await billing.resync(A)).code, 'no_subscription');
});

test('with nothing configured it is inert rather than broken', async () => {
  const { billing } = harness({ env: {} });
  assert.equal(billing.configured, false);
  assert.equal(billing.webhookConfigured, false);
  assert.equal(billing.priceId, null);
  assert.equal((await billing.checkout(OWNER, 1)).code, 'seats_billing_unconfigured');
  assert.equal((await billing.portal(OWNER)).code, 'seats_billing_unconfigured');
  assert.equal((await billing.webhook({ rawBody: '{}', signature: 't=1,v1=x' })).code, 'stripe_unconfigured');

  /* a price set but malformed is refused, not sent to Stripe */
  const bad = harness({ env: { ...ENV, SML_ACADEMY_SEATS_PRICE_ID: 'prod_notaprice' } });
  assert.equal(bad.billing.configured, false);
  assert.ok(bad.logs.some(([event]) => event === 'academy_seats_price_invalid'));
  /* but the webhook still works, so an existing team is not cut off by a bad price edit */
  assert.equal(bad.billing.webhookConfigured, true);
});

test('a Stripe outage during checkout is reported, not swallowed as success', async () => {
  const doc = { subs: {} };
  const store = { read: async () => doc, write: async (s) => { Object.assign(doc, s); } };
  const seats = createSeats({ store, passes: createPassStore(), now: () => NOW });
  const logs = [];
  const billing = createSeatsBilling({
    env: ENV, seats, now: () => NOW, logger: (lvl, ev) => logs.push(ev),
    stripe: {
      createCheckoutSession: async () => { throw new Error('stripe down'); },
      createPortalSession: async () => ({ url: null }),
      retrieveSubscription: async () => stripeSub()
    }
  });
  const out = await billing.checkout(OWNER, 6);
  assert.equal(out.ok, false);
  assert.equal(out.code, 'checkout_failed');
  assert.ok(logs.includes('academy_seats_checkout_failed'));
});
