'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const AC = require('./alert-chart-billing');
const B = require('./billing');
const M = require('./marketplace-events');

const T0 = Date.UTC(2026, 9, 19, 14, 0, 0);
const ME = '100000000000000001', ACE = '200000000000000002';

function fakeClient(handler) {
  const calls = [];
  return { calls, async query(sql, values) { const text = String(sql).replace(/\s+/g, ' ').trim(); calls.push({ text, values }); return (handler && handler(text, values, calls)) || { rowCount: 1, rows: [] }; } };
}
const SUB = { id: 7, checkout_key: 'ac_' + 'a'.repeat(32), subscriber_discord_id: ME, trader_discord_id: ACE, seller_id: 4, connected_account_id: 'acct_4', plan: 'month', price_cents: 1999, currency: 'usd', status: 'checkout_open', access_until: null, canceled_at: null };

test('checkout builder: recurring plans are 6% destination-charge subscriptions, day and lifetime are one-time payments', () => {
  const month = B.buildAlertChartCheckout({ plan: 'month', priceCents: 1999, checkoutKey: SUB.checkout_key, sellerId: 4, connectedAccountId: 'acct_4', traderName: 'Ace', successUrl: 'https://sml-platform-api.onrender.com/academy-activity/alert-chart/paid?k=x', cancelUrl: 'https://stockmarketloop.com/', extraHosts: ['sml-platform-api.onrender.com'] });
  assert.equal(month.mode, 'subscription');
  assert.equal(month.line_items[0].price_data.recurring.interval, 'month');
  assert.equal(month.line_items[0].price_data.unit_amount, 1999);
  assert.equal(month.subscription_data.application_fee_percent, 6);
  assert.equal(month.subscription_data.transfer_data.destination, 'acct_4');
  assert.equal(month.subscription_data.metadata.sml_kind, 'alert_chart');
  assert.equal(month.metadata.alert_chart_key, SUB.checkout_key);
  assert.match(month.line_items[0].price_data.product_data.name, /^Ace's Alert Chart · 1 month$/);
  const day = B.buildAlertChartCheckout({ plan: 'day', priceCents: 500, checkoutKey: SUB.checkout_key, sellerId: 4, connectedAccountId: 'acct_4', successUrl: 'https://stockmarketloop.com/a', cancelUrl: 'https://stockmarketloop.com/b', onBehalfOf: true });
  assert.equal(day.mode, 'payment');
  assert.equal(day.line_items[0].price_data.recurring, undefined);
  assert.equal(day.payment_intent_data.application_fee_amount, 30, '6% of $5.00');
  assert.equal(day.payment_intent_data.on_behalf_of, 'acct_4');
  const life = B.buildAlertChartCheckout({ plan: 'lifetime', priceCents: 9900, checkoutKey: SUB.checkout_key, sellerId: 4, connectedAccountId: 'acct_4', successUrl: 'https://stockmarketloop.com/a', cancelUrl: 'https://stockmarketloop.com/b' });
  assert.equal(life.mode, 'payment'); assert.equal(life.payment_intent_data.application_fee_amount, 594);
  assert.throws(() => B.buildAlertChartCheckout({ plan: 'month', priceCents: 50, checkoutKey: SUB.checkout_key, sellerId: 4, connectedAccountId: 'acct_4', successUrl: 'https://stockmarketloop.com/a', cancelUrl: 'https://stockmarketloop.com/b' }), /at least \$1/);
  assert.throws(() => B.buildAlertChartCheckout({ plan: 'month', priceCents: 1999, checkoutKey: SUB.checkout_key, sellerId: 4, connectedAccountId: 'acct_4', successUrl: 'https://evil.example/a', cancelUrl: 'https://stockmarketloop.com/b' }), /StockMarketLoop or Academy URL/);
  assert.equal(B.disputeFeeFor(10_000, 'alert_chart'), 1500, '15% on an Alert Chart');
  assert.equal(B.disputeFeeFor(10_000, 'membership'), 1250, '12.5% on a membership');
});

test('a paid checkout grants the subscriber access: a month gets the period plus 3 days of grace, lifetime never ends, 1 day ends tomorrow', async () => {
  for (const [plan, days, grace] of [['month', 30, 3], ['lifetime', null, 0], ['day', 1, 0]]) {
    const db = fakeClient((text) => text.startsWith('SELECT * FROM alert_chart_subscriptions WHERE checkout_key') ? { rows: [{ ...SUB, plan }] } : null);
    const event = { type: 'checkout.session.completed', created: Math.floor(T0 / 1000), data: { object: { id: 'cs_1', payment_status: 'paid', currency: 'usd', amount_subtotal: 1999, amount_total: 1999, payment_intent: plan === 'month' ? null : 'pi_1', subscription: plan === 'month' ? 'sub_1' : null, customer: 'cus_1', metadata: { sml_kind: 'alert_chart', alert_chart_key: SUB.checkout_key } } } };
    assert.equal(await M.applyMarketplaceEvent(db, event), 'processed', plan);
    const grant = db.calls.find((c) => c.text.startsWith('INSERT INTO academy_alert_access'));
    assert.deepEqual(grant.values.slice(0, 3), [ME, ACE, plan]);
    if (days == null) assert.equal(grant.values[3], null, 'lifetime has no end');
    else assert.equal(grant.values[3].getTime(), T0 + (days + grace) * 86_400_000, plan + ' end');
    assert.equal(grant.values[4], SUB.checkout_key);
    const upd = db.calls.find((c) => c.text.startsWith('UPDATE alert_chart_subscriptions SET status = \'active\''));
    assert.equal(upd.values[2], plan === 'month' ? 'sub_1' : null);
    if (plan !== 'month') assert.ok(db.calls.some((c) => c.text.startsWith('INSERT INTO alert_chart_charges') && c.values[0] === 'pi_1'), 'one-time payment recorded for disputes');
  }
});

test('a checkout that is not paid yet waits; a wrong amount fails closed and grants nothing', async () => {
  const db = fakeClient((text) => text.startsWith('SELECT * FROM alert_chart_subscriptions WHERE checkout_key') ? { rows: [SUB] } : null);
  const pending = { type: 'checkout.session.completed', created: 1, data: { object: { id: 'cs_1', payment_status: 'unpaid', metadata: { sml_kind: 'alert_chart', alert_chart_key: SUB.checkout_key } } } };
  assert.equal(await M.applyMarketplaceEvent(db, pending), 'waiting');
  const wrong = { type: 'checkout.session.completed', created: 1, data: { object: { id: 'cs_1', payment_status: 'paid', currency: 'usd', amount_subtotal: 1, amount_total: 1, metadata: { sml_kind: 'alert_chart', alert_chart_key: SUB.checkout_key } } } };
  await assert.rejects(() => M.applyMarketplaceEvent(db, wrong), /does not match/);
  assert.equal(db.calls.some((c) => c.text.startsWith('INSERT INTO academy_alert_access')), false);
});

test('invoice.paid on a renewal extends access to the new period end plus grace and records the charge; an unrelated invoice is ignored', async () => {
  const end = Math.floor(T0 / 1000) + 30 * 86_400;
  const db = fakeClient((text) => text.startsWith('SELECT * FROM alert_chart_subscriptions WHERE stripe_subscription_id') ? { rows: [{ ...SUB, status: 'active', stripe_subscription_id: 'sub_1' }] } : null);
  const event = { type: 'invoice.paid', created: Math.floor(T0 / 1000), data: { object: { id: 'in_2', status: 'paid', subscription: 'sub_1', customer: 'cus_1', payment_intent: 'pi_9', charge: 'ch_9', amount_paid: 1999, currency: 'usd', lines: { data: [{ period: { start: end - 30 * 86_400, end } }] } } } };
  assert.equal(await M.applyMarketplaceEvent(db, event), 'processed');
  const grant = db.calls.find((c) => c.text.startsWith('INSERT INTO academy_alert_access'));
  assert.equal(grant.values[3].getTime(), end * 1000 + 3 * 86_400_000);
  const charge = db.calls.find((c) => c.text.startsWith('INSERT INTO alert_chart_charges'));
  assert.deepEqual(charge.values.slice(0, 4), ['pi_9', 'ch_9', 7, 1999]);
  const other = fakeClient(() => ({ rows: [] }));
  assert.equal(await M.applyMarketplaceEvent(other, { type: 'invoice.paid', created: 1, data: { object: { id: 'in_3', subscription: 'sub_other' } } }), 'ignored');
});

test('a deleted subscription ends only the access this sale granted', async () => {
  const db = fakeClient((text) => text.startsWith('SELECT * FROM alert_chart_subscriptions WHERE checkout_key') ? { rows: [{ ...SUB, status: 'active', stripe_subscription_id: 'sub_1' }] } : null);
  const event = { type: 'customer.subscription.deleted', created: Math.floor(T0 / 1000), data: { object: { id: 'sub_1', status: 'canceled', customer: 'cus_1', metadata: { sml_kind: 'alert_chart', alert_chart_key: SUB.checkout_key } } } };
  assert.equal(await M.applyMarketplaceEvent(db, event), 'processed');
  const end = db.calls.find((c) => c.text.startsWith('UPDATE academy_alert_access SET until = LEAST'));
  assert.deepEqual(end.values, [ME, ACE, SUB.checkout_key, Math.floor(T0 / 1000)]);
  assert.ok(db.calls.some((c) => c.text.includes("SET status = 'canceled'")));
  /* a membership's deleted event stays with the lifecycle engine */
  const member = fakeClient(() => ({ rows: [] }));
  assert.equal(await M.applyMarketplaceEvent(member, { type: 'customer.subscription.deleted', created: 1, data: { object: { id: 'sub_m', metadata: { sml_kind: 'membership', subscription_key: 'k' } } } }), 'ignored');
  assert.equal(member.calls.some((c) => c.text.startsWith('UPDATE subscriptions')), false);
});

test('a dispute on an Alert Chart sale: the trader\'s seller account, a 15% fee when lost, the inactivity record, access paused then restored on a win', async () => {
  const quietSince = new Date(Date.now() - 45 * 86_400_000 - 60_000).toISOString();
  const mk = (state) => fakeClient((text) => {
    if (text.startsWith('SELECT s.* FROM alert_chart_charges')) return { rows: [{ ...SUB, status: 'active', access_until: new Date(T0 + 86_400_000) }] };
    if (text.startsWith('SELECT max(created_at)')) return { rows: [{ last: quietSince }] };
    if (text.startsWith('SELECT * FROM marketplace_sellers WHERE id')) return { rows: [{ id: 4, connected_account_id: 'acct_4', dispute_debit_consent_at: '2026-08-30T00:00:00Z', currency: 'usd' }] };
    if (text.startsWith('INSERT INTO marketplace_disputes')) return { rows: [{ stripe_dispute_id: 'dp_1', seller_id: 4, stripe_charge_id: 'ch_9', disputed_principal_cents: 1999, platform_dispute_fee_cents: 300, currency: 'usd', state }] };
    return null;
  });
  const created = mk('needs_response');
  assert.equal(await M.applyMarketplaceEvent(created, { type: 'charge.dispute.created', account: null, data: { object: { id: 'dp_1', charge: 'ch_9', payment_intent: 'pi_9', amount: 1999, currency: 'usd', status: 'needs_response' } } }), 'processed');
  const ins = created.calls.find((c) => c.text.startsWith('INSERT INTO marketplace_disputes'));
  assert.equal(ins.values[4], 300, '15% of $19.99');
  assert.ok(ins.text.includes("'alert_chart'"));
  const ctx = JSON.parse(ins.values[7]);
  assert.equal(ctx.creatorInactiveDays, 45); assert.equal(ctx.creatorInactive, true); assert.equal(ctx.disputeFeeBps, 1500); assert.equal(ctx.traderDiscordId, ACE);
  assert.ok(created.calls.some((c) => c.text.includes("SET status = 'disputed'")), 'access paused while the money is pulled');
  assert.ok(created.calls.some((c) => c.values && c.values[0] === 'seller-recover-principal:dp_1'));
  const lost = mk('lost');
  assert.equal(await M.applyMarketplaceEvent(lost, { type: 'charge.dispute.closed', account: null, data: { object: { id: 'dp_1', charge: 'ch_9', amount: 1999, currency: 'usd', status: 'lost' } } }), 'processed');
  const fee = lost.calls.find((c) => c.values && c.values[1] === 'dispute-fee:dp_1'); assert.equal(fee.values[2], -300);
  assert.equal(JSON.parse(lost.calls.find((c) => c.values && c.values[0] === 'seller-recover-fee:dp_1').values[2]).reason, 'platform_dispute_fee_15_percent');
  const won = mk('won');
  assert.equal(await M.applyMarketplaceEvent(won, { type: 'charge.dispute.closed', account: null, data: { object: { id: 'dp_1', charge: 'ch_9', amount: 1999, currency: 'usd', status: 'won' } } }), 'processed');
  assert.ok(won.calls.some((c) => c.text.startsWith('INSERT INTO academy_alert_access')), 'access restored on a win');
  assert.equal(won.calls.some((c) => c.values && c.values[1] === 'dispute-fee:dp_1'), false);
});

/* ---------- the service side ---------- */
function world({ linked = true, ready = true, consented = true, rooms = null } = {}) {
  const rows = { sellers: consented ? [{ trader_discord_id: ACE, terms_accepted_at: new Date(T0) }] : [], subs: [] };
  const pool = { calls: [], async query(sql, values) {
    const text = String(sql).replace(/\s+/g, ' ').trim(); this.calls.push({ text, values });
    if (text.startsWith('SELECT wordpress_user_id FROM billing_identities')) return { rows: linked && values[0] === ACE ? [{ wordpress_user_id: 55 }] : [] };
    if (text.startsWith('SELECT user_id FROM discord_identities')) return { rows: [] };
    if (text.startsWith('SELECT * FROM alert_chart_sellers') || text.startsWith('SELECT terms_accepted_at FROM alert_chart_sellers')) return { rows: rows.sellers.filter((s) => s.trader_discord_id === values[0]) };
    if (text.startsWith('SELECT id, charges_enabled')) return { rows: ready ? [{ id: 4, charges_enabled: true, details_submitted: true, payouts_enabled: true, card_payments_enabled: false }] : [] };
    if (text.startsWith('SELECT * FROM marketplace_sellers WHERE owner_user_id = $1 AND charges_enabled')) return { rows: ready ? [{ id: 4, connected_account_id: 'acct_4', charges_enabled: true, details_submitted: true, card_payments_enabled: true, membership_fee_accepted_at: new Date(T0), membership_fee_bps_accepted: 600 }] : [] };
    if (text.startsWith('INSERT INTO alert_chart_subscriptions')) { rows.subs.push(values); return { rows: [{ id: 9 }] }; }
    if (text.startsWith('INSERT INTO alert_chart_sellers')) { rows.sellers.push({ trader_discord_id: values[0], terms_accepted_at: new Date(T0) }); return { rows: [] }; }
    return { rows: [], rowCount: 1 };
  } };
  const stripe = { created: [], checkout: { sessions: { create: async (params, opts) => { stripe.created.push({ params, opts }); return { id: 'cs_9', url: 'https://checkout.stripe.com/c/pay/cs_9' }; } } } };
  const billingService = {
    readySeller: async (p, ownerUserId) => { const r = await p.query('SELECT * FROM marketplace_sellers WHERE owner_user_id = $1 AND charges_enabled = true AND details_submitted = true', [ownerUserId]); if (!r.rows[0]) throw new Error('seller Stripe account is not ready'); return r.rows[0]; },
    createSellerOnboarding: async (p, s, input) => { billingService.onboarded = input; return { sellerId: 4, onboardingUrl: 'https://connect.stripe.com/setup/e/acct_4/x' }; }
  };
  const traderAlerts = { settingsOf: async (id) => (id === ACE ? { premium: true, prices: { day: 0, week: 0, month: 1999, year: 0, lifetime: 9900 } } : { premium: false, prices: {} }) };
  const billing = AC.createAlertChartBilling({ pool, stripe, billingService, traderAlerts, rooms, names: async (id) => (id === ACE ? 'Ace' : ''), publicBase: 'https://sml-platform-api.onrender.com', logger: () => {}, now: () => T0,
    loopKickConnect: { connectUrl: ({ discordUserId }) => ({ ok: true, url: 'https://stockmarketloop.com/connect-discord/?lk=' + discordUserId }) } });
  return { pool, stripe, billingService, billing, rows };
}

test('seller status: linked, consented and Stripe-ready make a chart sellable; an unlinked trader gets the site connect link', async () => {
  const w = world();
  const s = await w.billing.sellerStatus(ACE);
  assert.equal(s.ready, true); assert.equal(s.linked, true); assert.equal(s.consented, true); assert.equal(s.stripe.ready, true); assert.equal(s.feeBps, 600); assert.equal(s.disputeFeeBps, 1500);
  const u = world({ linked: false });
  const s2 = await u.billing.sellerStatus(ACE);
  assert.equal(s2.ready, false); assert.equal(s2.linked, false); assert.match(s2.connectUrl, /connect-discord/);
});

test('onboarding needs every consent and a linked site account, then opens the site\'s Stripe Express onboarding', async () => {
  const w = world({ consented: false, ready: false });
  assert.equal((await w.billing.onboardSeller(ACE, { terms: true, fee: true })).error, 'consent_required');
  const r = await w.billing.onboardSeller(ACE, { terms: true, fee: true, disputes: true, activity: true });
  assert.equal(r.ok, true); assert.match(r.url, /connect\.stripe\.com/);
  assert.equal(w.billingService.onboarded.ownerUserId, 55); assert.equal(w.billingService.onboarded.acceptedMembershipFeeBps, 600); assert.equal(w.billingService.onboarded.acceptedDisputeDebits, true);
  assert.match(w.billingService.onboarded.returnUrl, /academy-activity\/alert-chart\/stripe\?done=1$/);
  assert.ok(w.pool.calls.some((c) => c.text.startsWith('INSERT INTO alert_chart_sellers') && c.values[4] === 1500));
  const u = world({ linked: false });
  const r2 = await u.billing.onboardSeller(ACE, { terms: true, fee: true, disputes: true, activity: true });
  assert.equal(r2.error, 'site_not_linked'); assert.match(r2.connectUrl, /connect-discord/);
});

test('checkout: the trader\'s stored price, a Stripe session with the 6% destination charge, and a record keyed for the webhook', async () => {
  const w = world();
  const r = await w.billing.checkout({ memberId: ME, traderId: ACE, plan: 'month' });
  assert.equal(r.ok, true); assert.match(r.url, /checkout\.stripe\.com/); assert.match(r.checkoutKey, /^ac_[a-f0-9]{32}$/); assert.equal(r.priceCents, 1999);
  const { params, opts } = w.stripe.created[0];
  assert.equal(opts.idempotencyKey, r.checkoutKey);
  assert.equal(params.mode, 'subscription'); assert.equal(params.line_items[0].price_data.unit_amount, 1999);
  assert.equal(params.subscription_data.transfer_data.destination, 'acct_4'); assert.equal(params.subscription_data.on_behalf_of, 'acct_4', 'card payments active: the trader is the merchant of record');
  assert.match(params.success_url, /^https:\/\/sml-platform-api\.onrender\.com\/academy-activity\/alert-chart\/paid\?k=ac_/);
  assert.equal(params.client_reference_id, undefined, 'the subscriber has no site account; the sale still goes through');
  const row = w.rows.subs[0];
  assert.deepEqual([row[1], row[3], row[4], row[5], row[6], row[7], row[8]], [ME, ACE, 55, 4, 'acct_4', 'month', 1999]);
  assert.equal((await w.billing.checkout({ memberId: ME, traderId: ACE, plan: 'week' })).error, 'plan_not_offered');
  assert.equal((await w.billing.checkout({ memberId: ME, traderId: ACE, plan: 'forever' })).error, 'invalid_plan');
  assert.equal((await w.billing.checkout({ memberId: ACE, traderId: ACE, plan: 'month' })).error, 'own_chart');
  assert.equal((await w.billing.checkout({ memberId: ME, traderId: '300000000000000003', plan: 'month' })).error, 'not_premium');
  assert.equal((await world({ ready: false }).billing.checkout({ memberId: ME, traderId: ACE, plan: 'month' })).error, 'seller_not_ready');
  assert.equal((await world({ consented: false }).billing.checkout({ memberId: ME, traderId: ACE, plan: 'month' })).error, 'seller_not_ready');
  const lifetime = await w.billing.checkout({ memberId: ME, traderId: ACE, plan: 'lifetime' });
  assert.equal(lifetime.ok, true); assert.equal(w.stripe.created[1].params.mode, 'payment'); assert.equal(w.stripe.created[1].params.payment_intent_data.application_fee_amount, 594);
});

test('without Stripe or a database the service reports itself unconfigured', async () => {
  const b = AC.createAlertChartBilling({ logger: () => {} });
  assert.equal(b.configured, false);
  assert.equal((await b.checkout({ memberId: ME, traderId: ACE, plan: 'month' })).error, 'checkout_unavailable');
  assert.equal((await b.onboardSeller(ACE, { terms: true, fee: true, disputes: true, activity: true })).error, 'billing_unconfigured');
  const s = await b.sellerStatus(ACE); assert.equal(s.ok, true); assert.equal(s.configured, false); assert.equal(s.ready, false);
});

test('trading room tiers: the room sets the price, the tier is recorded on the sale and carried onto the access grant', async () => {
  const rooms = { offerFor: async (trader, tier, plan) => (trader === ACE && tier === 'vip' && plan === 'month' ? { ok: true, priceCents: 7900 } : { ok: false, error: tier === 'vip' ? 'plan_not_offered' : 'no_tier' }) };
  const w = world({ rooms });
  const r = await w.billing.checkout({ memberId: ME, traderId: ACE, plan: 'month', tier: 'vip' });
  assert.equal(r.ok, true); assert.equal(r.priceCents, 7900, 'the tier price, not the chart\u2019s own price list'); assert.equal(r.tier, 'vip');
  assert.equal(w.stripe.created[0].params.line_items[0].price_data.unit_amount, 7900);
  const row = w.rows.subs[0]; assert.equal(row[8], 7900); assert.equal(row[10], 'vip', 'the tier is stored with the sale');
  assert.equal((await w.billing.checkout({ memberId: ME, traderId: ACE, plan: 'week', tier: 'vip' })).error, 'plan_not_offered');
  assert.equal((await w.billing.checkout({ memberId: ME, traderId: ACE, plan: 'month', tier: 'ghost' })).error, 'not_premium');
  const db = fakeClient((text) => text.startsWith('SELECT * FROM alert_chart_subscriptions WHERE checkout_key') ? { rows: [{ ...SUB, plan: 'month', tier: 'vip', price_cents: 7900 }] } : null);
  const event = { type: 'checkout.session.completed', created: Math.floor(T0 / 1000), data: { object: { id: 'cs_1', payment_status: 'paid', currency: 'usd', amount_subtotal: 7900, amount_total: 7900, subscription: 'sub_1', customer: 'cus_1', metadata: { sml_kind: 'alert_chart', alert_chart_key: SUB.checkout_key } } } };
  assert.equal(await M.applyMarketplaceEvent(db, event), 'processed');
  const grant = db.calls.find((c) => c.text.startsWith('INSERT INTO academy_alert_access')); assert.equal(grant.values[5], 'vip');
});
