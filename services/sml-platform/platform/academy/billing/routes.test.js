'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyServer } = require('../server');
const { createRoutes, clientAddress } = require('./routes');
const { createEvents } = require('./events');
const { createCheckout } = require('./checkout');
const { createResync } = require('./resync');
const { createCatalog } = require('./catalog');
const { createLinkTokens } = require('./link-token');
const { createBillingOAuth } = require('./oauth');
const { issueHandoff } = require('./handoff');
const k = require('./testkit');

const { USER, GUILD } = k;

async function withApp(options, run) {
  const now = k.clock(Date.now());
  const config = k.config(options.overrides || {});
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe(options.fixtures || {});
  const bot = k.createFakeBot({ members: options.members || { [USER]: [] } });
  const catalog = createCatalog({ config, stripeApi: stripe, now });
  const tokens = createLinkTokens({ secret: config.clientSecret, now });
  const core = createResync({ config, store, stripeApi: stripe, catalog, bot, now });
  const preflight = { ok: () => true, stripeAccountOk: () => true };
  const checkout = createCheckout({ config, store, stripeApi: stripe, catalog, bot, tokens, resync: core.resync, takeSnapshot: core.takeSnapshot, preflight, now });
  const discordCalls = [];
  const fetchImpl = async (url, init) => {
    discordCalls.push({ url: String(url), init });
    if (String(url).endsWith('/oauth2/token')) return new Response(JSON.stringify({ access_token: 'user-access-token' }), { status: 200 });
    if (String(url).endsWith('/users/@me')) return new Response(JSON.stringify({ id: USER, username: 'buyer' }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
  const oauth = createBillingOAuth({ config, fetchImpl });
  const state = { enabled: options.enabled !== false, schemaReady: true };
  const events = createEvents({ config, store, stripeApi: stripe, resync: core.resync, now });
  const routes = createRoutes({ config, state: () => state, events, checkout, tokens, oauth, bot, store, catalog, now });
  const server = createAcademyServer({ interactions: null, checkDatabase: async () => true, academyBilling: { handle: routes.handle } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run({ base: `http://127.0.0.1:${port}`, store, stripe, bot, tokens, config, discordCalls, now });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const cookieFrom = (response, name) => {
  const all = response.headers.getSetCookie();
  const hit = all.find((c) => c.startsWith(`${name}=`));
  return hit ? hit.split(';')[0] : null;
};

test('every billing route except the webhook is a 404 while disabled; /health is unchanged', async () => {
  await withApp({ enabled: false }, async ({ base }) => {
    for (const path of ['buy', 'start', 'packages', 'manage', 'status', 'success', 'oauth/callback']) {
      const response = await fetch(`${base}/v1/academy/billing/${path}`, { redirect: 'manual' });
      assert.equal(response.status, 404, path);
    }
    assert.equal((await fetch(`${base}/v1/academy/billing/checkout`, { method: 'POST', body: 'x=1' })).status, 404);
    assert.deepEqual(await (await fetch(`${base}/health`)).json(), { ok: true, service: 'making-easy-money-academy', database: 'connected' });
  });
});

test('/start sends the buyer to Discord with a signed state bound to an HttpOnly nonce cookie', async () => {
  await withApp({}, async ({ base, tokens }) => {
    const response = await fetch(`${base}/v1/academy/billing/start?package=monthly`, { redirect: 'manual' });
    assert.equal(response.status, 302);
    const location = new URL(response.headers.get('location'));
    assert.equal(location.origin + location.pathname, 'https://discord.com/oauth2/authorize');
    assert.equal(location.searchParams.get('client_id'), k.APP);
    assert.equal(location.searchParams.get('scope'), 'identify');
    assert.equal(location.searchParams.get('redirect_uri'), 'https://making-easy-money-academy.onrender.com/v1/academy/billing/oauth/callback');
    const set = response.headers.getSetCookie()[0];
    assert.match(set, /^mab_state=[^;]+; Path=\/v1\/academy\/billing; HttpOnly; Secure; SameSite=Lax; Max-Age=600$/);
    const nonce = set.split(';')[0].split('=')[1];
    assert.equal(tokens.readState(location.searchParams.get('state'), nonce).pkg, 'monthly');
  });
});

test('the OAuth callback binds the verified Discord id in a cookie and discards the user token', async () => {
  await withApp({}, async ({ base, tokens, discordCalls }) => {
    const start = await fetch(`${base}/v1/academy/billing/start?package=yearly`, { redirect: 'manual' });
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const stateCookie = cookieFrom(start, 'mab_state');
    const response = await fetch(`${base}/v1/academy/billing/oauth/callback?code=abc&state=${encodeURIComponent(state)}`, { redirect: 'manual', headers: { cookie: stateCookie } });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/v1/academy/billing/buy?package=yearly');
    const bind = cookieFrom(response, 'mab_bind');
    assert.ok(bind.startsWith('mab_bind=mab1.'));
    const claims = tokens.readBind(bind.slice('mab_bind='.length));
    assert.deepEqual([claims.userId, claims.source, claims.purpose], [USER, 'web_oauth', 'buy']);
    assert.equal(JSON.stringify(response.headers.getSetCookie()).includes('user-access-token'), false);
    assert.ok(discordCalls.some((c) => c.url.endsWith('/oauth2/token')));
    /* a state without its cookie is refused */
    const forged = await fetch(`${base}/v1/academy/billing/oauth/callback?code=abc&state=${encodeURIComponent(state)}`, { redirect: 'manual' });
    assert.equal(forged.status, 400);
  });
});

test('a hand-off code works once, sets a buy-only cookie and leaves the URL', async () => {
  await withApp({}, async ({ base, store, tokens }) => {
    const { code } = await issueHandoff(store.pool, { discordUserId: USER, guildId: GUILD, source: 'activity', publicUrl: 'https://making-easy-money-academy.onrender.com' });
    const response = await fetch(`${base}/v1/academy/billing/start?h=${code}`, { redirect: 'manual' });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/v1/academy/billing/buy');
    const claims = tokens.readBind(cookieFrom(response, 'mab_bind').slice('mab_bind='.length));
    assert.deepEqual([claims.userId, claims.source, claims.purpose], [USER, 'activity', 'buy']);
    const again = await fetch(`${base}/v1/academy/billing/start?h=${code}`, { redirect: 'manual' });
    assert.equal(again.status, 410);
  });
});

test('/buy renders escaped package cards with an unticked renewal checkbox and strict headers', async () => {
  await withApp({ members: { [USER]: [] } }, async ({ base, tokens, bot }) => {
    bot.getUser = async () => ({ id: USER, username: '<script>alert(1)</script>', globalName: '' });
    const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const response = await fetch(`${base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    const html = await response.text();
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    for (const price of ['$2.99', '$9.99', '$29.99', '$79.99', '$149.99', '$199.99', '$1,299.99']) assert.ok(html.includes(price), price);
    assert.ok(html.includes('renews automatically every month at $29.99 until you cancel'));
    assert.ok(html.includes('renews at most 2 times (3 charges in total, $8.97)'));
    assert.ok(html.includes('buying Lifetime sets that plan to cancel at the end of its current paid period'));
    assert.ok(html.includes('name="consent_renewal" value="1" required'));
    assert.equal(/checked/.test(html), false);
    assert.equal(/earn|profit|guarantee|income/i.test(html.replace(/pro-rata/g, '')), false);
  });
});

test('/buy for a member with no bound Customer: the trial offer after a Stripe lookup, or "could not check" (button disabled) when it fails', async () => {
  const pages = require('./pages');
  await withApp({ overrides: k.memEnv() }, async ({ base, tokens, stripe }) => {
    const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const get = async () => (await fetch(`${base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    const offered = await get();
    assert.ok(offered.includes('7-day free trial, then $89.90/month; one free trial per Discord account'));
    assert.equal(offered.includes(pages.esc(pages.TRIAL_UNKNOWN_NOTE)), false);
    assert.equal(stripe.callsOf('searchCustomersByDiscordId').length, 1, 'the member\'s Academy Customers are looked up once');
    stripe.fail('searchCustomersByDiscordId', Object.assign(new Error('stripe 500'), { statusCode: 500 }));
    const unknown = await get();
    assert.ok(unknown.includes(pages.esc(pages.TRIAL_UNKNOWN_NOTE)));
    assert.equal(unknown.includes('7-day free trial'), false);
    assert.equal(unknown.includes(pages.TRIAL_USED_NOTE), false);
  });
});

test('/buy without a sign-in offers Discord sign-in; a non-member sees the invite first', async () => {
  await withApp({ members: {} }, async ({ base, tokens }) => {
    const signIn = await (await fetch(`${base}/v1/academy/billing/buy?package=monthly`)).text();
    assert.ok(signIn.includes('/v1/academy/billing/start?purpose=buy&amp;package=monthly'));
    const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const html = await (await fetch(`${base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    assert.ok(html.includes('Join the server first'));
    assert.ok(html.includes('https://discord.gg/makingeasymoney'));
    assert.equal(html.includes('consent_renewal'), false);
  });
});

test('POST /checkout -> 303 to Stripe; refusals render a page', async () => {
  await withApp({}, async ({ base, tokens, stripe }) => {
    const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const buy = await (await fetch(`${base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    const form = buy.split('<form').find((chunk) => chunk.includes('value="weekly"'));
    const field = (name) => new RegExp(`name="${name}" value="([^"]+)"`).exec(form)[1];
    const body = new URLSearchParams({ package: 'weekly', csrf: field('csrf'), disclosure_sha: field('disclosure_sha'), consent_renewal: '1' });
    const response = await fetch(`${base}/v1/academy/billing/checkout`, { method: 'POST', redirect: 'manual', body, headers: { cookie: `mab_bind=${bind}`, 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(response.status, 303);
    assert.match(response.headers.get('location'), /^https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_/);
    assert.equal(stripe.callsOf('createCheckoutSession')[0].args[0].mode, 'subscription');
    const noConsent = new URLSearchParams({ package: 'weekly', csrf: field('csrf'), disclosure_sha: field('disclosure_sha') });
    const refused = await fetch(`${base}/v1/academy/billing/checkout`, { method: 'POST', redirect: 'manual', body: noConsent, headers: { cookie: `mab_bind=${bind}` } });
    assert.equal(refused.status, 400);
    assert.ok((await refused.text()).includes('Please tick the box'));
  });
});

test('ALLOW_NON_MEMBER=1: /buy and POST /checkout refuse an account banned from the server with a clear page; nothing reaches Stripe', async () => {
  await withApp({ members: {}, overrides: { SML_ACADEMY_BILLING_ALLOW_NON_MEMBER: '1', SML_ACADEMY_BILLING_AUTO_JOIN: '1' } }, async ({ base, tokens, stripe, bot }) => {
    const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const headers = { cookie: `mab_bind=${bind}` };
    /* not banned: the plans, with the join card */
    const open = await fetch(`${base}/v1/academy/billing/buy`, { headers });
    assert.equal(open.status, 200);
    const html = await open.text();
    assert.ok(html.includes('consent_renewal'));
    const form = html.split('<form').find((chunk) => chunk.includes('value="weekly"'));
    const field = (name) => new RegExp(`name="${name}" value="([^"]+)"`).exec(form)[1];
    bot.state.bans.add(USER);
    const buy = await fetch(`${base}/v1/academy/billing/buy`, { headers });
    assert.equal(buy.status, 403);
    const page = await buy.text();
    assert.ok(page.includes('This Discord account cannot join the server'));
    assert.equal(page.includes('consent_renewal'), false, 'nothing is offered');
    const body = new URLSearchParams({ package: 'weekly', csrf: field('csrf'), disclosure_sha: field('disclosure_sha'), consent_renewal: '1' });
    const post = await fetch(`${base}/v1/academy/billing/checkout`, { method: 'POST', redirect: 'manual', body, headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' } });
    assert.equal(post.status, 403);
    assert.ok((await post.text()).includes('banned from the Making Easy Money server'));
    assert.equal(stripe.callsOf('createCheckoutSession').length, 0);
  });
});

test('/manage with a buy cookie goes back through Discord OAuth for purpose=manage', async () => {
  await withApp({}, async ({ base, tokens }) => {
    const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'hub', purpose: 'buy' });
    const response = await fetch(`${base}/v1/academy/billing/manage`, { redirect: 'manual', headers: { cookie: `mab_bind=${bind}` } });
    assert.equal(response.status, 303);
    assert.equal(response.headers.get('location'), '/v1/academy/billing/start?purpose=manage');
  });
});

test('/success settles from the session id only; /status answers without PII', async () => {
  await withApp({ fixtures: { customers: { cus_s: k.academyCustomer('cus_s', USER) } } }, async ({ base, store, stripe, now }) => {
    k.bindMember(store, USER, 'cus_s');
    stripe.data.sessions.cs_test_successsess1 = { id: 'cs_test_successsess1', customer: 'cus_s', mode: 'subscription', status: 'complete', payment_status: 'unpaid',
      metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: USER } };
    await store.insertIntent(null, { id: '0b9f1f64-6a3c-4d7b-9a44-00000000a001', discordId: USER, package: 'monthly', priceId: 'price_monthly1', customerId: 'cus_s',
      bindSource: 'web_oauth', consentKind: 'auto_renewal', consentVersion: 'v', consentSha256: 'a'.repeat(64), consentedAt: now(), expiresAt: now() + 1 });
    await store.markIntentOpen(null, { id: '0b9f1f64-6a3c-4d7b-9a44-00000000a001', sessionId: 'cs_test_successsess1' });
    const page = await fetch(`${base}/v1/academy/billing/success?session_id=cs_test_successsess1&payment_status=paid&entitled=1`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.ok(html.includes('Your payment is processing'));
    assert.ok(html.includes('data-session="cs_test_successsess1"'));
    assert.match(page.headers.get('content-security-policy'), /script-src 'nonce-/);
    const status = await fetch(`${base}/v1/academy/billing/status?session_id=cs_test_successsess1`);
    assert.equal(status.status, 200);
    assert.deepEqual(await status.json(), { entitled: false, intent: 'open', lifetimePending: false, lifetime: false, awaitingMember: false, roles: [] });
    assert.equal((await fetch(`${base}/v1/academy/billing/status?session_id=cs_test_unknownsess01`)).status, 404);
    const unknown = await fetch(`${base}/v1/academy/billing/success?session_id=cs_test_unknownsess01`);
    assert.equal(unknown.status, 400);
    assert.equal(stripe.callsOf('retrieveCheckoutSession').length, 1, 'only the stored session reached Stripe');
  });
});

test('/packages lists sellable packages from Stripe in ladder order', async () => {
  await withApp({}, async ({ base }) => {
    const body = await (await fetch(`${base}/v1/academy/billing/packages`)).json();
    assert.deepEqual(body.packages.map((p) => [p.key, p.amount]), [['daily', 299], ['weekly', 999], ['monthly', 2999], ['quarterly', 7999], ['semiannual', 14999], ['yearly', 19999], ['lifetime', 129999]]);
    assert.deepEqual(body.packages[3], { key: 'quarterly', amount: 7999, currency: 'usd', interval: 'month', interval_count: 3,
      trial_days: null, trial_no_card: false, cancel_after_days: null });
    assert.equal(body.packages[0].cancel_after_days, 3, 'the Day plan stops after 3 charges');
  });
});

test('there is no HTTP hand-off minting route (the API writes codes over the shared database)', async () => {
  await withApp({ overrides: { SML_ACADEMY_BILLING_IN_DISCORD_LINKS: '1' } }, async ({ base }) => {
    const response = await fetch(`${base}/v1/academy/billing/handoff`, { method: 'POST', body: '{}' });
    assert.equal(response.status, 405);
    assert.equal((await fetch(`${base}/v1/academy/billing/handoff`)).status, 404);
  });
});

test('interop: the API client in academy-oauth.js mints a link that /start redeems once', async (t) => {
  const oauthModule = require('../../academy-oauth');
  if (typeof oauthModule.createBillingHandoff !== 'function') { t.skip('API handoff client not present'); return; }
  await withApp({}, async ({ base, store, tokens }) => {
    const client = oauthModule.createBillingHandoff({ pool: store.pool, publicUrl: 'https://making-easy-money-academy.onrender.com' });
    const minted = await client.mint({ discordUserId: USER, guildId: GUILD, source: 'activity' });
    assert.equal(minted.ok, true, JSON.stringify(minted));
    const parsed = new URL(minted.url);
    assert.equal(`${parsed.origin}${parsed.pathname}`, 'https://making-easy-money-academy.onrender.com/v1/academy/billing/start');
    const start = await fetch(`${base}${parsed.pathname}${parsed.search}`, { redirect: 'manual' });
    assert.equal(start.status, 303);
    const bind = start.headers.getSetCookie()[0].split(';')[0].slice('mab_bind='.length);
    assert.deepEqual([tokens.readBind(bind).userId, tokens.readBind(bind).source, tokens.readBind(bind).purpose], [USER, 'activity', 'buy']);
    assert.equal((await fetch(`${base}${parsed.pathname}${parsed.search}`, { redirect: 'manual' })).status, 410);
  });
});

test('a hand-off code minted for another guild is refused at /start', async () => {
  await withApp({}, async ({ base, store }) => {
    const { code } = await issueHandoff(store.pool, { discordUserId: USER, guildId: '938894329076940821', source: 'activity', publicUrl: 'https://making-easy-money-academy.onrender.com' });
    assert.equal((await fetch(`${base}/v1/academy/billing/start?h=${code}`, { redirect: 'manual' })).status, 410);
  });
});

/* ---------------------------------------------------------------------------
 * Public-page abuse: direct handler calls, no network.
 * ------------------------------------------------------------------------ */

function directRoutes(overrides = {}) {
  const now = k.clock();
  const config = k.config(overrides);
  const store = k.createFakeStore({ now });
  const stripe = k.createFakeStripe({});
  const bot = k.createFakeBot({});
  const catalog = createCatalog({ config, stripeApi: stripe, now });
  const tokens = createLinkTokens({ secret: config.clientSecret, now });
  const checkout = createCheckout({ config, store, stripeApi: stripe, catalog, bot, tokens, resync: async () => ({}),
    takeSnapshot: async () => ({ complete: true, subscriptions: [], lifetime: [], charges: new Map(), disputes: [] }),
    preflight: { ok: () => true, stripeAccountOk: () => true }, now });
  const routes = createRoutes({ config, state: () => ({ enabled: true, schemaReady: true }), events: null, checkout, tokens,
    oauth: null, bot, store, catalog, now });
  return { now, config, store, stripe, tokens, routes };
}

function fakeResponse() {
  return { status: 0, body: '', headersSent: false, writeHead(code) { this.status = code; this.headersSent = true; }, end(body) { this.body = String(body || ''); }, destroy() {} };
}

test('GET /success with random session ids from one client cannot drive Stripe API calls', async () => {
  const t = directRoutes();
  const statuses = [];
  for (let i = 0; i < 100; i += 1) {
    const sid = `cs_test_${String(i).padStart(4, '0')}abcdefghijklmnopqrstuv`;
    const request = { method: 'GET', url: `/v1/academy/billing/success?session_id=${sid}`, headers: { 'x-forwarded-for': '203.0.113.9' },
      socket: { remoteAddress: '10.0.0.1' } };
    const response = fakeResponse();
    await t.routes.handle(request, response, '/v1/academy/billing/success');
    statuses.push(response.status);
  }
  assert.equal(t.stripe.callsOf('retrieveCheckoutSession').length, 0, 'unknown session ids are answered from the database alone');
  assert.equal(statuses.filter((s) => s === 400).length, 60);
  assert.equal(statuses.filter((s) => s === 429).length, 40, 'and the page is rate limited per client address');
});

test('GET /status is rate limited per client address', async () => {
  const t = directRoutes();
  const statuses = [];
  for (let i = 0; i < 605; i += 1) {
    const request = { method: 'GET', url: '/v1/academy/billing/status?session_id=cs_test_unknownsess01', headers: { 'x-forwarded-for': '203.0.113.9' },
      socket: { remoteAddress: '10.0.0.1' } };
    const response = fakeResponse();
    await t.routes.handle(request, response, '/v1/academy/billing/status');
    statuses.push(response.status);
  }
  assert.equal(statuses.filter((s) => s === 404).length, 600);
  assert.equal(statuses.filter((s) => s === 429).length, 5);
});

test('the per-IP checkout rate limit cannot be dodged by sending a different X-Forwarded-For each time', async () => {
  const { Readable } = require('node:stream');
  const t = directRoutes();
  const statuses = [];
  for (let i = 0; i < 40; i += 1) {
    const userId = String(310000000000000000n + BigInt(i));
    const token = t.tokens.issueBind({ userId, guildId: GUILD, source: 'web_oauth', purpose: 'buy' });
    const bind = t.tokens.readBind(token);
    const body = new URLSearchParams({ package: 'no_such_package', csrf: t.tokens.csrfFor(bind) }).toString();
    const request = Object.assign(Readable.from([Buffer.from(body)]), {
      method: 'POST', url: '/v1/academy/billing/checkout',
      /* Render appends the real client address; the FIRST hop is whatever the client sent. */
      headers: { cookie: `mab_bind=${token}`, 'x-forwarded-for': `198.51.100.${i}, 203.0.113.77` },
      socket: { remoteAddress: '10.0.0.1' }
    });
    const response = fakeResponse();
    await t.routes.handle(request, response, '/v1/academy/billing/checkout');
    statuses.push(response.status);
  }
  assert.equal(statuses.filter((s) => s === 400).length, 30);
  assert.equal(statuses.filter((s) => s === 429).length, 10, `40 checkout attempts from one client were not IP-limited: ${[...new Set(statuses)].join(',')}`);
});

test('clientAddress takes the proxy-appended entry, never a client-supplied one', () => {
  const req = (xff, remote = '10.0.0.1') => ({ headers: xff === null ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } });
  assert.equal(clientAddress(req('203.0.113.77')), '203.0.113.77');
  assert.equal(clientAddress(req('198.51.100.1, 203.0.113.77')), '203.0.113.77');
  assert.equal(clientAddress(req('198.51.100.1,203.0.113.77 , 172.16.0.9'), 2), '203.0.113.77');
  assert.equal(clientAddress(req('203.0.113.77'), 2), '203.0.113.77', 'fewer entries than hops: the only one there');
  assert.equal(clientAddress(req(null)), '10.0.0.1');
  assert.equal(clientAddress(req('')), '10.0.0.1');
});

test('/buy says a renewing plan voided by a lost dispute needs attention, never "Access active"', async () => {
  const CUS = 'cus_void';
  const T = Math.floor(Date.now() / 1000);
  await withApp({ fixtures: {
    customers: { [CUS]: k.academyCustomer(CUS, USER) },
    subscriptions: [k.subscription({ id: 'sub_v', customer: CUS, created: T - 70 * 86400, periodStart: T - 3600, periodEnd: T + 29 * 86400 })],
    invoices: [k.invoice({ id: 'in_v', subscription: 'sub_v', charge: 'ch_v', created: T - 3600 }), k.invoice({ id: 'in_o', subscription: 'sub_v', charge: 'ch_o', created: T - 60 * 86400 })],
    charges: [k.charge({ id: 'ch_v', customer: CUS, invoiceId: 'in_v', created: T - 3600 }), k.charge({ id: 'ch_o', customer: CUS, invoiceId: 'in_o', disputed: true, created: T - 60 * 86400 })],
    disputes: [{ id: 'du_o', object: 'dispute', charge: 'ch_o', status: 'lost' }]
  } }, async ({ base, store, tokens }) => {
    k.bindMember(store, USER, CUS);
    const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const html = await (await fetch(`${base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    assert.equal(html.includes('Access active'), false);
    assert.ok(html.includes('Your plan needs attention'));
    assert.ok(html.includes('/v1/academy/billing/start?purpose=manage'));
  });
});

/* ---------------------------------------------------------------------------
 * Lifetime by bank debit (ACH).
 * ------------------------------------------------------------------------ */

const { consentSha, disclosureFor } = require('./pages');
const BANK_TEXT = 'Bank payments (ACH) take a few business days to clear. Your access starts when the payment clears.';
const cardFor = (html, pkg) => html.split('<section class="card">').find((chunk) => chunk.includes(`name="package" value="${pkg}"`)) || '';

test('/buy tells a lifetime buyer that bank payments take days and access starts when they clear (outside the hashed disclosure)', async () => {
  await withApp({ overrides: k.BANK_LIFETIME_ENV }, async ({ base, tokens, config }) => {
    const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const html = await (await fetch(`${base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    const lifetime = cardFor(html, 'lifetime');
    assert.ok(lifetime.includes('<p class="notice">You can pay by card or US bank account. Bank payments (ACH) take a few business days to clear. Your access starts when the payment clears. Card payments are confirmed right away.</p>'), lifetime);
    for (const pkg of ['daily', 'weekly', 'monthly', 'quarterly', 'semiannual', 'yearly']) assert.equal(cardFor(html, pkg).includes('Bank payments'), false, pkg);
    /* the approved consent text (and so its hash) is unchanged by the note */
    const sha = /name="disclosure_sha" value="([^"]+)"/.exec(lifetime)[1];
    assert.equal(sha, consentSha(config.consentVersion, disclosureFor({ pkg: 'lifetime', amount: 129999, termsUrl: config.termsUrl, privacyUrl: config.privacyUrl }).text));
    assert.equal(/earn|profit|guarantee|income/i.test(html), false);
  });
  /* without a bank method the note is absent */
  await withApp({}, async ({ base, tokens }) => {
    const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const html = await (await fetch(`${base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    assert.equal(html.includes('Bank payments'), false);
  });
});

const achFixtures = (piStatus = 'processing') => ({
  customers: { cus_ach: k.academyCustomer('cus_ach', USER) },
  paymentIntents: [k.lifetimePi({ id: 'pi_ach', customer: 'cus_ach', status: piStatus, latestCharge: 'ch_ach', amount: 1000000 })],
  charges: [k.charge({ id: 'ch_ach', customer: 'cus_ach', amount: 1000000, paymentIntent: 'pi_ach', status: piStatus === 'processing' ? 'pending' : 'failed' })]
});

test('/buy while a lifetime bank payment clears: a processing notice and nothing for sale; POST /checkout is refused', async () => {
  await withApp({ overrides: k.BANK_LIFETIME_ENV, fixtures: achFixtures() }, async ({ base, store, tokens, stripe, config }) => {
    k.bindMember(store, USER, 'cus_ach');
    const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const html = await (await fetch(`${base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    assert.ok(html.includes('MEM Lifetime: bank payment processing'));
    assert.ok(html.includes(`Your bank payment for MEM Lifetime is processing. ${BANK_TEXT} You do not need to pay again.`));
    assert.equal(html.includes('consent_final'), false);
    assert.equal(html.includes('consent_renewal'), false);
    assert.equal(html.includes('Access active'), false);
    const csrf = tokens.csrfFor(tokens.readBind(bind));
    const d = disclosureFor({ pkg: 'lifetime', amount: 129999, termsUrl: config.termsUrl, privacyUrl: config.privacyUrl });
    const body = new URLSearchParams({ package: 'lifetime', csrf, disclosure_sha: consentSha(config.consentVersion, d.text), consent_final: '1' });
    const response = await fetch(`${base}/v1/academy/billing/checkout`, { method: 'POST', redirect: 'manual', body, headers: { cookie: `mab_bind=${bind}` } });
    assert.equal(response.status, 409);
    assert.ok((await response.text()).includes('Your MEM Lifetime payment is processing'));
    assert.equal(stripe.callsOf('createCheckoutSession').length, 0);
  });
});

test('/success for a bank-debit lifetime: "processing, a few business days" and slow polling; a failed debit says so', async () => {
  await withApp({ overrides: k.BANK_LIFETIME_ENV, fixtures: achFixtures() }, async ({ base, store, stripe, now }) => {
    k.bindMember(store, USER, 'cus_ach');
    const sessionId = 'cs_test_achsuccess0001';
    const intentId = '0b9f1f64-6a3c-4d7b-9a44-00000000ac03';
    stripe.data.sessions[sessionId] = { id: sessionId, customer: 'cus_ach', mode: 'payment', status: 'complete', payment_status: 'unpaid', client_reference_id: intentId,
      metadata: { sml_kind: 'mem_academy', mem_academy_discord_user: USER, mem_academy_package: 'lifetime' } };
    await store.insertIntent(null, { id: intentId, discordId: USER, package: 'lifetime', priceId: 'price_life1', customerId: 'cus_ach', bindSource: 'web_oauth',
      consentKind: 'final_sale', consentVersion: 'v', consentSha256: 'a'.repeat(64), consentedAt: now(), expiresAt: now() + 1 });
    await store.markIntentOpen(null, { id: intentId, sessionId });
    const html = await (await fetch(`${base}/v1/academy/billing/success?session_id=${sessionId}`)).text();
    const lead = /<p id="status"[^>]*>([^<]*)<\/p>/.exec(html);
    assert.equal(lead[1], `Your payment is processing. ${BANK_TEXT} You can close this page.`);
    assert.ok(lead[0].includes('data-delayed="1"'));
    assert.equal(store.db.roles.size, 0);
    /* the debit fails: the webhook marks the intent failed */
    await store.markIntentStatus(null, { id: intentId, status: 'failed' });
    now.advance(11_000);
    const failed = await (await fetch(`${base}/v1/academy/billing/success?session_id=${sessionId}`)).text();
    assert.ok(failed.includes('<h1>Payment not completed</h1>'));
    assert.equal(/<p id="status"[^>]*>([^<]*)<\/p>/.exec(failed)[1], 'Your bank payment did not go through, so no access was granted. You can start a new purchase from the plans page.');
    assert.equal(failed.includes('data-delayed="1"'), false);
  });
});

test('the success-page poll never reports a bank-paid Lifetime as active from an older plan role, and reports a failed debit', async () => {
  const pagesModule = require('./pages');
  async function poll(delayed, response) {
    const html = pagesModule.successPage({ config: { termsUrl: 'https://x.test/t', privacyUrl: 'https://x.test/p' }, nonce: 'n', sessionId: 'cs_test_pollsession1',
      paid: !delayed, processing: delayed });
    const script = /<script nonce="n">([\s\S]*)<\/script>/.exec(html)[1];
    const el = { textContent: 'initial', getAttribute: (key) => ({ 'data-session': 'cs_test_pollsession1', 'data-delayed': delayed ? '1' : null }[key]) };
    const scheduled = [];
    const run = new Function('document', 'fetch', 'setTimeout', script);
    run({ getElementById: () => el }, async () => ({ json: async () => response }), (fn, ms) => scheduled.push(ms));
    for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setImmediate(resolve));
    return { text: el.textContent, scheduled };
  }
  const plan = [{ key: 'academy', state: 'synced' }];
  const oldPlan = await poll(true, { entitled: true, intent: 'open', lifetimePending: false, roles: plan });
  assert.equal(oldPlan.text, 'initial', 'an older plan role is not the Lifetime access');
  assert.deepEqual(oldPlan.scheduled, [15000], 'a bank payment is polled slowly');
  assert.match((await poll(true, { entitled: true, intent: 'open', lifetimePending: true, roles: plan })).text, /^Your payment is processing\. Bank payments \(ACH\) take a few business days/);
  assert.equal((await poll(true, { entitled: true, intent: 'completed', lifetimePending: false, lifetime: true,
    roles: [...plan, { key: 'mem_lifetime', state: 'synced' }] })).text, 'Access active. Open the Academy in Discord.');
  /* the owner set-up has no MEM Lifetime role: the Lifetime grants Monarch (an external role) */
  assert.equal((await poll(true, { entitled: true, intent: 'completed', lifetimePending: false, lifetime: true,
    roles: [...plan, { key: 'external', state: 'synced' }] })).text, 'Access active. Open the Academy in Discord.');
  assert.equal((await poll(true, { entitled: true, intent: 'completed', lifetimePending: false, lifetime: false,
    roles: [...plan, { key: 'external', state: 'synced' }] })).text, 'initial', 'no Lifetime source yet: an older plan role is not it');
  assert.match((await poll(true, { entitled: false, intent: 'failed', lifetimePending: false, roles: [] })).text, /^Your bank payment did not go through/);
  assert.equal((await poll(false, { entitled: true, intent: 'completed', lifetimePending: false, roles: plan })).text, 'Access active. Open the Academy in Discord.');
});

test('/buy never says "Access active" for a Lifetime paused by an open dispute; the owned page makes no permanence claim', async () => {
  const fixtures = (status) => ({
    customers: { cus_ach: k.academyCustomer('cus_ach', USER) },
    paymentIntents: [k.lifetimePi({ id: 'pi_ach', customer: 'cus_ach', status: 'succeeded', latestCharge: 'py_ach', amount: 1000000 })],
    charges: [k.charge({ id: 'py_ach', customer: 'cus_ach', amount: 1000000, paymentIntent: 'pi_ach', disputed: true })],
    disputes: [{ id: 'du_ach', object: 'dispute', charge: 'py_ach', status }]
  });
  await withApp({ overrides: k.BANK_LIFETIME_ENV, fixtures: fixtures('needs_response') }, async ({ base, store, tokens, config, stripe }) => {
    k.bindMember(store, USER, 'cus_ach');
    const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const html = await (await fetch(`${base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    assert.equal(html.includes('Access active'), false);
    assert.ok(html.includes('MEM Lifetime: paused while a payment dispute is open'));
    assert.ok(html.includes('It comes back if the dispute closes in your favor.'));
    assert.equal(html.includes('consent_final'), false);
    assert.equal(html.includes('consent_renewal'), false);
    const csrf = tokens.csrfFor(tokens.readBind(bind));
    const d = disclosureFor({ pkg: 'lifetime', amount: 129999, termsUrl: config.termsUrl, privacyUrl: config.privacyUrl });
    const body = new URLSearchParams({ package: 'lifetime', csrf, disclosure_sha: consentSha(config.consentVersion, d.text), consent_final: '1' });
    const response = await fetch(`${base}/v1/academy/billing/checkout`, { method: 'POST', redirect: 'manual', body, headers: { cookie: `mab_bind=${bind}` } });
    assert.equal(response.status, 409);
    const owned = await response.text();
    assert.ok(owned.includes('MEM Lifetime is already on this Discord account, so there is nothing more to buy.'));
    assert.equal(/permanent/i.test(owned), false);
    assert.equal(stripe.callsOf('createCheckoutSession').length, 0);
  });
  /* a won dispute: active again */
  await withApp({ overrides: k.BANK_LIFETIME_ENV, fixtures: fixtures('won') }, async ({ base, store, tokens }) => {
    k.bindMember(store, USER, 'cus_ach');
    const bind = tokens.issueBind({ userId: USER, guildId: GUILD, source: 'web_oauth' });
    const html = await (await fetch(`${base}/v1/academy/billing/buy`, { headers: { cookie: `mab_bind=${bind}` } })).text();
    assert.ok(html.includes('Access active: MEM Lifetime'));
    assert.equal(html.includes('paused'), false);
  });
});
