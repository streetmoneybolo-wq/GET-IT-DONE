'use strict';

/* Buyers who are NOT in the Making Easy Money server yet
   (SML_ACADEMY_BILLING_ALLOW_NON_MEMBER=1, optionally AUTO_JOIN=1), and the
   pure membership offers (academy:false), through the real HTTP routes:
   /buy -> POST /checkout -> /success -> /status -> join -> role applied. */

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyServer } = require('../server');
const { createRoutes } = require('./routes');
const { createEvents } = require('./events');
const { createCheckout } = require('./checkout');
const { createResync } = require('./resync');
const { createApplier } = require('./applier');
const { createCatalog } = require('./catalog');
const { createLinkTokens } = require('./link-token');
const { createBillingOAuth } = require('./oauth');
const { createUcChecker } = require('./external');
const pages = require('./pages');
const k = require('./testkit');

const { USER, GUILD, ACADEMY_ROLE, MONARCH, PREMIUM } = k;
const INVITE = 'https://discord.gg/makingeasymoney';

async function withApp({ overrides = {}, members = {}, fixtures = {} } = {}, run) {
  const now = k.clock(Date.now());
  const config = k.config(overrides);
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe(fixtures);
  const bot = k.createFakeBot({ members });
  const catalog = createCatalog({ config, stripeApi: stripe, now });
  const tokens = createLinkTokens({ secret: config.clientSecret, now });
  const ucChecker = createUcChecker({ config, client: k.createFakeUc(), now });
  const inflight = [];
  let applier = null;
  /* index.js: every queued role change kicks the applier */
  const kickApplier = () => { inflight.push(Promise.resolve().then(() => applier.runOnce())); };
  const core = createResync({ config, store, stripeApi: stripe, catalog, bot, now, ucChecker, kickApplier, stripeWritesAllowed: () => true });
  const discordCalls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    discordCalls.push({ url: u, method: init.method || 'GET' });
    if (u.endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'user-access-token' }), { status: 200 });
    if (u.endsWith('/users/@me')) return new Response(JSON.stringify({ id: USER, username: 'buyer' }), { status: 200 });
    const m = /\/guilds\/\d+\/members\/(\d+)\/roles\/(\d+)$/.exec(u);
    if (m) {
      const held = bot.state.members[m[1]];
      if (held == null) return new Response(JSON.stringify({ code: 10007, message: 'Unknown Member' }), { status: 404 });
      if (init.method === 'PUT' && !held.includes(m[2])) bot.state.members[m[1]] = [...held, m[2]];
      if (init.method === 'DELETE') bot.state.members[m[1]] = held.filter((r) => r !== m[2]);
      return new Response(null, { status: 204 });
    }
    return new Response('{}', { status: 404 });
  };
  applier = createApplier({ config, store, bot, fetchImpl, sleep: async () => {}, now });
  /* index.js: onMemberSeen = kickAwaiting + kick the applier */
  const seen = [];
  const onMemberSeen = (id) => {
    seen.push(id);
    inflight.push(store.kickAwaiting(null, id).then((n) => (n ? applier.runOnce() : null)));
  };
  const preflight = { ok: () => true, stripeAccountOk: () => true };
  const checkout = createCheckout({ config, store, stripeApi: stripe, catalog, bot, tokens, resync: core.resync, takeSnapshot: core.takeSnapshot,
    preflight, now, onMemberSeen });
  const oauth = createBillingOAuth({ config, fetchImpl });
  const events = createEvents({ config, store, stripeApi: stripe, resync: core.resync, now });
  const routes = createRoutes({ config, state: () => ({ enabled: true, schemaReady: true }), events, checkout, tokens, oauth, bot, store, catalog, now, onMemberSeen });
  const server = createAcademyServer({ interactions: null, checkDatabase: async () => true, academyBilling: { handle: routes.handle } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const settle = async () => { await Promise.all(inflight.splice(0)); };
    await run({ base: `http://127.0.0.1:${server.address().port}`, store, stripe, bot, tokens, config, now, discordCalls, seen, settle, applier, checkout });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const cookieFrom = (response, name) => {
  const hit = response.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(';')[0] : null;
};
const formFields = (html, marker) => {
  const form = html.split('<form').find((chunk) => chunk.includes(marker));
  const field = (name) => { const m = new RegExp(`name="${name}" value="([^"]+)"`).exec(form); return m ? m[1] : null; };
  return { form, field };
};

/** Buy `pkg` through the routes and pay it in the fake Stripe; returns the session id. */
async function buyAndPay(t, { bind, marker = 'value="monthly"', price = 'price_monthly1', pkg = 'monthly', subId = 'sub_join' }) {
  const buy = await (await fetch(`${t.base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
  const { field } = formFields(buy, marker);
  const body = new URLSearchParams({ package: pkg, csrf: field('csrf'), disclosure_sha: field('disclosure_sha'), consent_renewal: '1' });
  if (field('price')) body.set('price', field('price'));
  const response = await fetch(`${t.base}/v1/academy/billing/checkout`, { method: 'POST', redirect: 'manual', body, headers: { cookie: `mab_bind=${bind}` } });
  assert.equal(response.status, 303, await response.text());
  const call = t.stripe.callsOf('createCheckoutSession').pop();
  const params = call.args[0];
  const session = t.stripe.data.sessions[Object.keys(t.stripe.data.sessions).pop()];
  session.status = 'complete';
  session.payment_status = 'paid';
  t.stripe.data.subscriptions.push(k.subscription({ id: subId, customer: params.customer, price }));
  t.stripe.data.invoices.push(k.invoice({ id: `in_${subId}`, subscription: subId, charge: `ch_${subId}` }));
  t.stripe.data.charges.push(k.charge({ id: `ch_${subId}`, customer: params.customer }));
  return { sessionId: session.id, params };
}

test('ALLOW_NON_MEMBER + AUTO_JOIN: a non-member buys, sees the invite, joins with Discord and gets the role', async () => {
  await withApp({ overrides: { SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1', SML_ACADEMY_BILLING_AUTO_JOIN: '1' } }, async (t) => {
    const bind = t.tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const buy = await (await fetch(`${t.base}/v1/academy/billing/buy?package=monthly`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    assert.ok(buy.includes('You are not in the Making Easy Money Discord server yet. You can pay now'));
    assert.ok(buy.includes(INVITE));
    assert.ok(buy.includes('/v1/academy/billing/start?purpose=join&amp;package=monthly'));
    assert.ok(buy.includes('name="consent_renewal"'), 'the plans are on sale to a non-member');

    const { sessionId } = await buyAndPay(t, { bind });
    const success = await fetch(`${t.base}/v1/academy/billing/success?session_id=${sessionId}`);
    const html = await success.text();
    assert.ok(html.includes(pages.AWAITING_TEXT));
    assert.ok(html.includes(INVITE));
    assert.ok(html.includes('<section class="card" id="join">'), 'the join card is visible (not hidden)');
    assert.deepEqual([...t.store.db.roles.values()].map((r) => [r.role_key, r.state]), [['academy', 'awaiting_member']]);
    const waiting = await (await fetch(`${t.base}/v1/academy/billing/status?session_id=${sessionId}`)).json();
    assert.deepEqual([waiting.entitled, waiting.awaitingMember, waiting.roles], [true, true, [{ key: 'academy', state: 'awaiting_member' }]]);

    /* "Add me to the server with Discord" */
    const start = await fetch(`${t.base}/v1/academy/billing/start?purpose=join&package=monthly`, { redirect: 'manual' });
    const authorize = new URL(start.headers.get('location'));
    assert.equal(authorize.searchParams.get('scope'), 'identify guilds.join');
    assert.equal(authorize.searchParams.get('prompt'), null);
    const callback = await fetch(`${t.base}/v1/academy/billing/oauth/callback?code=abc&state=${encodeURIComponent(authorize.searchParams.get('state'))}`,
      { redirect: 'manual', headers: { cookie: cookieFrom(start, 'mab_state') } });
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get('location'), '/v1/academy/billing/buy?package=monthly');
    assert.deepEqual(t.bot.state.calls.filter((c) => c[0] === 'addMember'), [['addMember', USER]]);
    assert.ok(k.actions(t.store).includes('member_auto_joined'));
    await t.settle();
    assert.deepEqual(t.bot.state.members[USER], [ACADEMY_ROLE], 'the waiting role landed as soon as they joined');
    const done = await (await fetch(`${t.base}/v1/academy/billing/status?session_id=${sessionId}`)).json();
    assert.deepEqual([done.awaitingMember, done.roles], [false, [{ key: 'academy', state: 'synced' }]]);
    assert.ok(k.actions(t.store).includes('role_granted'));
  });
});

test('a non-member who joins through the invite link: the success-page poll notices and the role lands', async () => {
  await withApp({ overrides: { SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1' } }, async (t) => {
    const bind = t.tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const buy = await (await fetch(`${t.base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    assert.ok(buy.includes(INVITE));
    assert.equal(buy.includes('purpose=join'), false, 'no "Add me" without AUTO_JOIN');
    const { sessionId } = await buyAndPay(t, { bind });
    await fetch(`${t.base}/v1/academy/billing/success?session_id=${sessionId}`);
    assert.equal((await (await fetch(`${t.base}/v1/academy/billing/status?session_id=${sessionId}`)).json()).awaitingMember, true);
    await t.settle();
    assert.deepEqual(t.seen, [], 'not in the server yet: nothing to kick');
    /* they join by the invite; the next poll (at most once a minute) notices */
    t.bot.state.members[USER] = [];
    await fetch(`${t.base}/v1/academy/billing/status?session_id=${sessionId}`);
    await t.settle();
    assert.deepEqual(t.seen, [], 'the membership re-check is throttled to once a minute');
    t.now.advance(61_000);
    await fetch(`${t.base}/v1/academy/billing/status?session_id=${sessionId}`);
    await t.settle();
    assert.deepEqual(t.seen, [USER]);
    assert.deepEqual(t.bot.state.members[USER], [ACADEMY_ROLE]);
    /* "I have joined, continue" (/buy) also kicks waiting grants */
    await fetch(`${t.base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } });
    assert.deepEqual(t.seen, [USER, USER]);
  });
});

test('without AUTO_JOIN, purpose=join falls back to a plain sign-in (identify only)', async () => {
  await withApp({ overrides: { SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1' } }, async (t) => {
    const start = await fetch(`${t.base}/v1/academy/billing/start?purpose=join`, { redirect: 'manual' });
    assert.equal(new URL(start.headers.get('location')).searchParams.get('scope'), 'identify');
  });
});

test('strict mode (ALLOW_NON_MEMBER=0): the non-member page offers the invite and, with AUTO_JOIN, "Add me"', async () => {
  await withApp({ overrides: { SML_ACADEMY_BILLING_AUTO_JOIN: '1' } }, async (t) => {
    const bind = t.tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const html = await (await fetch(`${t.base}/v1/academy/billing/buy?package=yearly`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    assert.ok(html.includes('Join the server first'));
    assert.ok(html.includes(INVITE));
    assert.ok(html.includes('/v1/academy/billing/start?purpose=join&amp;package=yearly'));
    assert.equal(html.includes('consent_renewal'), false);
  });
});

test('a member who pays sees no invite card (hidden), and the page says the role is being added', async () => {
  await withApp({ members: { [USER]: [] } }, async (t) => {
    const bind = t.tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const { sessionId } = await buyAndPay(t, { bind });
    const html = await (await fetch(`${t.base}/v1/academy/billing/success?session_id=${sessionId}`)).text();
    assert.ok(html.includes('<section class="card" id="join" hidden>'));
    assert.ok(html.includes('Payment received. Adding your Discord role...'));
    await t.settle();
    assert.deepEqual(t.seen, [USER, USER], '/buy and /success both let waiting grants land (a no-op here)');
    assert.deepEqual(t.bot.state.members[USER], [ACADEMY_ROLE]);
  });
});

test('the success-page poll reveals the join card while a role waits for the member', async () => {
  const html = pages.successPage({ config: { termsUrl: 'https://x.test/t', privacyUrl: 'https://x.test/p', inviteUrl: INVITE }, nonce: 'n',
    sessionId: 'cs_test_pollsession1', paid: true, inGuild: true });
  const script = /<script nonce="n">([\s\S]*)<\/script>/.exec(html)[1];
  const el = { textContent: 'initial', getAttribute: (key) => ({ 'data-session': 'cs_test_pollsession1' }[key]) };
  const card = { hidden: true };
  const run = new Function('document', 'fetch', 'setTimeout', script);
  run({ getElementById: (id) => (id === 'join' ? card : el) }, async () => ({ json: async () => ({ entitled: true, intent: 'completed', lifetimePending: false,
    lifetime: false, awaitingMember: true, roles: [{ key: 'academy', state: 'awaiting_member' }] }) }), () => {});
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(card.hidden, false);
  assert.equal(el.textContent, pages.AWAITING_TEXT);
});

/* ---------------------------------------------------------------------------
 * Pure memberships (academy:false) on the same /buy page.
 * ------------------------------------------------------------------------ */

test('/buy lists the Premium membership next to the Academy; the consent texts say what each grants', async () => {
  await withApp({ overrides: k.ownerEnv(), members: { [USER]: [] } }, async (t) => {
    const bind = t.tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const html = await (await fetch(`${t.base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    assert.ok(html.includes('Memberships (without MEM Academy)'));
    const premium = formFields(html, 'value="price_premium1"').form;
    assert.ok(premium.includes('the Premium Member membership costs $49.99'));
    assert.ok(premium.includes('the Premium Member role in the Making Easy Money Discord server'));
    assert.ok(premium.includes('It does not include MEM Academy.'));
    const lifetime = formFields(html, 'value="price_life1"').form;
    assert.ok(lifetime.includes('the Academy Student role (MEM Academy and paid access to the Making Easy Money Discord server) and the Monarch role.'));
    assert.equal(lifetime.includes('MEM Lifetime role'), false, 'no separate MEM Lifetime role in the owner set-up');
    const monthly = formFields(html, 'value="price_monthly1"').form;
    assert.ok(monthly.includes('While the plan is active it gives this Discord account the Academy Student role (MEM Academy and paid access to the Making Easy Money Discord server).'));
  });
});

test('a membership is bought by price id; an active Premium plan never blocks the Academy, and vice versa', async () => {
  await withApp({ overrides: k.ownerEnv(), members: { [USER]: [] } }, async (t) => {
    const bind = t.tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const { params } = await buyAndPay(t, { bind, marker: 'value="price_premium1"', price: 'price_premium1', subId: 'sub_prem' });
    assert.deepEqual(params.line_items, [{ price: 'price_premium1', quantity: 1 }]);
    assert.equal(params.mode, 'subscription');
    assert.equal(params.metadata.mem_academy_package, 'monthly');
    const intent = [...t.store.db.intents.values()].pop();
    assert.deepEqual([intent.package, intent.stripe_price_id, intent.consent_kind], ['monthly', 'price_premium1', 'auto_renewal']);
    /* with Premium active, the page still sells the Academy plans, and marks Premium as held */
    const html = await (await fetch(`${t.base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    assert.ok(html.includes('Premium Member: you already have this plan'));
    assert.ok(html.includes('value="price_monthly1"'), 'the Academy monthly is still on sale');
    /* buying Premium again goes to Manage billing; the Academy monthly goes to Stripe */
    const again = formFields((await (await fetch(`${t.base}/v1/academy/billing/buy?x=1`, { headers: { cookie: `mab_bind=${bind}` } })).text()), 'value="price_monthly1"');
    const csrf = again.field('csrf');
    const premiumSha = pages.disclosureFor({ pkg: 'monthly', amount: 4999, termsUrl: t.config.termsUrl, privacyUrl: t.config.privacyUrl,
      grants: { academy: false, roleNames: ['Premium Member'], label: 'Premium Member' } });
    const blocked = await fetch(`${t.base}/v1/academy/billing/checkout`, { method: 'POST', redirect: 'manual', headers: { cookie: `mab_bind=${bind}` },
      body: new URLSearchParams({ package: 'monthly', price: 'price_premium1', csrf, consent_renewal: '1',
        disclosure_sha: require('./pages').consentSha(t.config.consentVersion, premiumSha.text) }) });
    assert.equal(blocked.status, 303);
    assert.equal(blocked.headers.get('location'), '/v1/academy/billing/manage');
    t.now.advance(30_000);
    const academy = await fetch(`${t.base}/v1/academy/billing/checkout`, { method: 'POST', redirect: 'manual', headers: { cookie: `mab_bind=${bind}` },
      body: new URLSearchParams({ package: 'monthly', price: 'price_monthly1', csrf, consent_renewal: '1', disclosure_sha: again.field('disclosure_sha') }) });
    assert.equal(academy.status, 303);
    assert.match(academy.headers.get('location'), /^https:\/\/checkout\.stripe\.com\//);
    assert.deepEqual(t.stripe.callsOf('createCheckoutSession').pop().args[0].line_items, [{ price: 'price_monthly1', quantity: 1 }]);
  });
});

test('an Academy lifetime that includes Monarch makes a Monarch-only membership "owned"', async () => {
  const MONARCH_ONLY = { price_monarch1: { package: 'monthly', academy: false, roles: [MONARCH] } };
  const fixtures = { customers: { cus_own: k.academyCustomer('cus_own', USER) },
    paymentIntents: [k.lifetimePi({ id: 'pi_own', customer: 'cus_own', latestCharge: 'ch_own' })],
    charges: [k.charge({ id: 'ch_own', customer: 'cus_own', paymentIntent: 'pi_own' })],
    prices: { price_monarch1: k.stripePrice('price_premium1', { id: 'price_monarch1', product: { id: 'prod_monarch', active: true, name: 'Monarch', metadata: { sml_kind: 'mem_academy' } } }) } };
  await withApp({ overrides: k.ownerEnv({ extraPrices: MONARCH_ONLY }), members: { [USER]: [] }, fixtures }, async (t) => {
    k.bindMember(t.store, USER, 'cus_own');
    const bind = t.tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const html = await (await fetch(`${t.base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    assert.ok(html.includes('Monarch: active'));
    assert.equal(html.includes('value="price_monarch1"'), false);
    assert.ok(html.includes('value="price_premium1"'), 'Premium is not covered by the lifetime');
    const csrf = t.tokens.csrfFor(t.tokens.readBind(bind));
    const d = pages.disclosureFor({ pkg: 'monthly', amount: 4999, termsUrl: t.config.termsUrl, privacyUrl: t.config.privacyUrl,
      grants: { academy: false, roleNames: ['Monarch'], label: 'Monarch' } });
    const owned = await fetch(`${t.base}/v1/academy/billing/checkout`, { method: 'POST', redirect: 'manual', headers: { cookie: `mab_bind=${bind}` },
      body: new URLSearchParams({ package: 'monthly', price: 'price_monarch1', csrf, consent_renewal: '1', disclosure_sha: pages.consentSha(t.config.consentVersion, d.text) }) });
    assert.equal(owned.status, 409);
    assert.ok((await owned.text()).includes('You already have Monarch'));
  });
});

test('/packages lists the memberships separately from the Academy packages', async () => {
  await withApp({ overrides: k.ownerEnv() }, async (t) => {
    const body = await (await fetch(`${t.base}/v1/academy/billing/packages`)).json();
    assert.deepEqual(body.packages.map((p) => p.key), ['daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly', 'lifetime']);
    assert.deepEqual(body.memberships.map((m) => [m.price, m.key, m.label, m.roles]).sort(),
      [['price_premium1', 'monthly', 'Premium Member', [PREMIUM]], ['price_premlife1', 'lifetime', 'Premium Member Lifetime', [PREMIUM]]]);
  });
});
