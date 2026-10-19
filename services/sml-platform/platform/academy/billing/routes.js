'use strict';

/* =============================================================================
 * MEM Academy billing: HTTP routes under /v1/academy/billing/.
 *
 *   POST stripe/webhook   raw body (<= 256 KiB) -> utf8 string -> verify with
 *                         the ACADEMY endpoint secret -> parse -> dedupe insert
 *                         -> 200 {status: pending|deferred|ignored|duplicate}.
 *                         503 when the secret is unset or the DB/schema is not
 *                         there (Stripe retries). Works while ENABLED=0 (rows
 *                         are stored 'deferred', nothing is acted on).
 *   GET  packages         public JSON of sellable packages (10 min cache)
 *   GET  start            ?h=<one-time hand-off code> | ?purpose=buy|manage|join|trial&package=
 *   GET  oauth/callback   Discord OAuth return
 *   GET  buy              package chooser + disclosure + consent
 *   GET  trial            ?plan=monthly|weekly|yearly  the one-link free trial:
 *                         sign in (auto-join when AUTO_JOIN=1) -> one offer,
 *                         consent and button -> Stripe
 *   POST checkout         guards -> Customer -> intent -> Checkout Session -> 303
 *   GET  success          idempotent settle -> status page
 *   GET  status           JSON for the success page poll (no PII)
 *   GET  manage           Billing Portal (dedicated configuration) -> 303
 *   GET  assets/<name>    the pages' own images, hero video and intro audio (assets.js)
 *
 * Everything except the webhook answers 404 unless SML_ACADEMY_BILLING_ENABLED=1
 * and schema 028 is present. Cookies: HttpOnly; Secure; SameSite=Lax;
 * Path=/v1/academy/billing.
 *
 * Buyers who are not in the server (ALLOW_NON_MEMBER=1): /buy and /success
 * show the invite (and "Add me" with AUTO_JOIN=1) to anyone not known to be
 * in the guild. Their grants wait as awaiting_member; the "Add me" join, a
 * member's /buy or /success visit and the /status poll (checkout.js, once a
 * minute) call onMemberSeen, which makes those grants due at once. An account
 * BANNED from the server is never sold anything (/buy and POST checkout ask
 * the bot's ban lookup for every buyer who is not in the server).
 * ========================================================================== */

const crypto = require('node:crypto');
const { verifySignature, parseEvent, MAX_BODY_BYTES } = require('../../stripe-webhook');
const { redeemHandoff } = require('./handoff');
const { createRateLimiter } = require('./checkout');
const { PACKAGES } = require('./config');
const pages = require('./pages');
const assets = require('./assets');
const audit = require('./audit');

const PREFIX = '/v1/academy/billing/';
const COOKIE_PATH = '/v1/academy/billing';
const BIND_COOKIE = 'mab_bind';
const STATE_COOKIE = 'mab_state';
const FORM_MAX_BYTES = 8 * 1024;
/* Per-IP budgets for the public, unauthenticated pages (10-minute window).
   /success reaches Stripe only for a stored intent (checkout.settle); the
   limit is a second fence. /status is polled by the success page up to 120
   times per visit. */
const SUCCESS_PER_IP = 60;
const STATUS_PER_IP = 600;

/**
 * Client address for rate limits. Proxies APPEND the address they received
 * the request from to X-Forwarded-For, so every entry left of the ones our
 * own proxies added is whatever the client chose to send. With proxyHops
 * appending proxies in front of the service (1 on Render), the client is the
 * proxyHops-th entry from the RIGHT.
 */
function clientAddress(request, proxyHops = 1) {
  const hops = String(request.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean);
  const socket = (request.socket && request.socket.remoteAddress) || '';
  if (!hops.length) return socket;
  const at = hops.length - Math.max(1, proxyHops);
  return at >= 0 ? hops[at] : hops[0];
}

async function readBody(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) return { ok: false, status: 413 };
    chunks.push(chunk);
  }
  return { ok: true, raw: Buffer.concat(chunks) };
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    const key = part.slice(0, at).trim();
    if (key) out[key] = part.slice(at + 1).trim();
  }
  return out;
}

function cookie(name, value, maxAgeSeconds) {
  return `${name}=${value}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function sendJson(response, status, payload, extra = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body), ...extra });
  response.end(body);
}

function sendHtml(response, status, html, nonce, extra = {}) {
  response.writeHead(status, { ...pages.securityHeaders(nonce), 'content-length': Buffer.byteLength(html), ...extra });
  response.end(html);
}

function redirect(response, status, location, extra = {}) {
  response.writeHead(status, { location, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', ...extra });
  response.end();
}

const ERROR_TEXT = Object.freeze({
  checkout_disabled: 'Checkout is not open right now.',
  preflight_not_passed: 'Checkout is paused while we check the payment setup. Please try again later.',
  sign_in_required: 'Please sign in with Discord first.',
  csrf_failed: 'This form expired. Please reload the plans page.',
  too_many_attempts: 'Too many attempts. Please wait a few minutes.',
  package_unavailable: 'That plan is not on sale right now.',
  consent_required: 'Please tick the box to confirm the terms before paying.',
  binding_conflict: 'This Discord account needs staff help before it can buy. Please contact support.',
  stripe_unavailable: 'We could not reach the payment provider. Please try again shortly.',
  checkout_in_progress: 'A checkout was just started. Please wait a few seconds and try again.',
  stripe_checkout_failed: 'We could not start checkout. Please try again shortly.',
  portal_unconfigured: 'Manage billing is not available yet. Please contact support.',
  discord_unavailable: 'We could not check your Discord account. Nothing was charged. Please try again shortly.',
  free_trial_used: pages.FREE_TRIAL_USED_NOTE,
  winback_not_eligible: 'This welcome-back price is only for former Making Easy Money monthly members.',
  winback_used: 'This Discord account already used its welcome-back price.'
});

const BANNED_TITLE = 'This Discord account cannot join the server';
const BANNED_TEXT = 'This Discord account is banned from the Making Easy Money server, so it could never receive the roles a plan includes. Nothing was charged. Please contact support if you think this is a mistake.';

/* The bot could not read the server. A dead or wrong bot token (401) and a
   bot thrown out of the server (403) are OUR problem, so the page says so
   instead of "busy, try again" (which sent members in circles for hours);
   anything else (429, 5xx, a timeout) really is transient. */
const DISCORD_SETUP_KINDS = Object.freeze(['unauthorized', 'forbidden', 'unknown_guild']);
const DISCORD_SETUP_TITLE = 'Our Discord connection needs a fix';
const DISCORD_SETUP_TEXT = 'The Making Easy Money bot could not read the server just now. That is a setup problem on our side, not yours, and staff have been alerted. Nothing was charged. Please try again in a little while.';

function createRoutes({ config, state, events, checkout, tokens, oauth, bot, store, catalog, kick = () => {},
  logger = () => {}, now = Date.now, onMemberSeen = () => {}, preflightOk = () => true } = {}) {
  /* A buyer who is (now) in the server: any grant that waits for them
     (awaiting_member) is due now. Never throws. */
  const memberSeen = (userId) => { try { onMemberSeen(String(userId)); } catch (_) { /* best effort */ } };
  const ipSalt = crypto.randomBytes(16);
  const ipKey = (request) => {
    const ip = clientAddress(request, config.proxyHops || 1);
    return crypto.createHmac('sha256', ipSalt).update(ip).digest('hex').slice(0, 24);
  };
  const allowPublic = createRateLimiter({ now });

  function page(response, status, render) {
    const nonce = pages.newNonce();
    sendHtml(response, status, render(nonce), nonce);
  }
  function message(response, status, title, text, links) {
    page(response, status, (nonce) => pages.messagePage({ config, nonce, title, text, links }));
  }
  const bindFrom = (request) => tokens.readBind(parseCookies(request.headers.cookie)[BIND_COOKIE]);

  /* The bot's member read failed on a page: log the kind (it was silent
     before) and answer honestly. */
  function discordFailed(response, url, error, route) {
    const kind = String(error && error.kind || 'error').slice(0, 40);
    logger('error', 'academy_billing_page_discord_failed', { route, kind, status: error && error.status ? Number(error.status) : null });
    const retry = [{ href: url.pathname + url.search, label: 'Try again' }];
    if (DISCORD_SETUP_KINDS.includes(kind)) message(response, 503, DISCORD_SETUP_TITLE, DISCORD_SETUP_TEXT, retry);
    else message(response, 503, 'Discord is busy', 'We could not check your server membership. Please try again shortly.', retry);
  }

  /* ------------------------------ webhook ------------------------------ */

  async function webhook(request, response) {
    if (request.method !== 'POST') { sendJson(response, 405, { ok: false, error: 'method_not_allowed' }); return; }
    if (!config.webhookSecrets.length) { sendJson(response, 503, { ok: false, error: 'stripe_unconfigured' }); return; }
    if (!store || !state().schemaReady) { sendJson(response, 503, { ok: false, error: 'schema_unavailable' }); return; }
    const body = await readBody(request, MAX_BODY_BYTES);
    if (!body.ok) { sendJson(response, 413, { ok: false, error: 'payload_too_large' }); return; }
    const raw = body.raw.toString('utf8');
    const verified = verifySignature({ secret: config.webhookSecrets, header: request.headers['stripe-signature'], rawBody: raw, now: now() });
    if (!verified.ok) { sendJson(response, verified.status, { ok: false, error: verified.error }); return; }
    const parsed = parseEvent(raw);
    if (!parsed.ok) { sendJson(response, parsed.status, { ok: false, error: parsed.error }); return; }
    let result;
    try {
      result = await events.record(parsed.event);
    } catch (error) {
      logger('error', 'academy_billing_webhook_store_failed', { eventId: parsed.event.id, error: String(error && (error.code || error.message) || 'error').slice(0, 120) });
      sendJson(response, 503, { ok: false, error: 'database_unavailable' });
      return;
    }
    sendJson(response, 200, { received: true, status: result.status });
    if (result.status === 'pending') setImmediate(kick);
  }

  /* ------------------------------ identity ------------------------------ */

  async function start(request, response, url) {
    const q = url.searchParams;
    const code = q.get('h');
    if (code) {
      const identity = await redeemHandoff(store.pool, code);
      if (!identity || identity.guildId !== config.guildId) {
        message(response, 410, 'This link has expired', 'Buy links from Discord work once and only for five minutes. Sign in with Discord to continue.',
          [{ href: '/v1/academy/billing/start', label: 'Sign in with Discord' }]);
        return;
      }
      const bind = tokens.issueBind({ userId: identity.userId, guildId: identity.guildId, source: identity.source, purpose: 'buy' });
      const pkg = PACKAGES.includes(q.get('package')) ? q.get('package') : '';
      redirect(response, 303, `/v1/academy/billing/buy${pkg ? `?package=${pkg}` : ''}`, { 'set-cookie': cookie(BIND_COOKIE, bind, 1800) });
      return;
    }
    let purpose = ['buy', 'manage', 'join', 'trial'].includes(q.get('purpose')) ? q.get('purpose') : 'buy';
    if (purpose === 'join' && !config.autoJoin) purpose = 'buy';
    const pkg = PACKAGES.includes(q.get('package')) ? q.get('package') : '';
    /* The trial link adds the member to the server in the same sign-in (with
       AUTO_JOIN=1): one Discord screen, no invite hunting. */
    const join = purpose === 'join' || (purpose === 'trial' && config.autoJoin);
    const issued = tokens.issueState({ purpose, pkg, autoJoin: join });
    redirect(response, 302, oauth.authorizeUrl({ state: issued.state, join }), {
      'set-cookie': cookie(STATE_COOKIE, issued.nonce, 600)
    });
  }

  async function callback(request, response, url) {
    const q = url.searchParams;
    if (q.get('error')) {
      message(response, 400, 'Discord sign-in was cancelled', 'Nothing was charged. You can try again any time.',
        [{ href: '/v1/academy/billing/start', label: 'Try again' }]);
      return;
    }
    const st = tokens.readState(q.get('state'), parseCookies(request.headers.cookie)[STATE_COOKIE]);
    if (!st) {
      message(response, 400, 'Sign-in expired', 'Please start again from the plans page.', [{ href: '/v1/academy/billing/start', label: 'Start again' }]);
      return;
    }
    let accessToken = await oauth.exchange(q.get('code'));
    const user = accessToken ? await oauth.me(accessToken) : null;
    if (!user) {
      message(response, 401, 'Discord sign-in failed', 'Please try again.', [{ href: '/v1/academy/billing/start', label: 'Try again' }]);
      return;
    }
    if (st.autoJoin && config.autoJoin) {
      try {
        const joined = await bot.addMember(user.id, accessToken);
        if (joined.added) {
          await audit.appendStandalone(store.pool, { actor: 'checkout', livemode: config.livemode, discordUserId: user.id,
            action: 'member_auto_joined', outcome: 'applied', httpStatus: joined.status }, { now });
          /* Bought before joining: the waiting roles land now. */
          memberSeen(user.id);
        }
      } catch (error) {
        logger('warn', 'academy_billing_auto_join_failed', { error: String(error && error.kind || 'error') });
      }
    }
    accessToken = null;
    const purpose = st.purpose === 'manage' ? 'manage' : 'buy';
    const bind = tokens.issueBind({ userId: user.id, guildId: config.guildId, source: 'web_oauth', purpose });
    const target = purpose === 'manage' ? '/v1/academy/billing/manage'
      : st.purpose === 'trial' ? `/v1/academy/billing/trial${st.pkg ? `?plan=${encodeURIComponent(st.pkg)}` : ''}`
        : `/v1/academy/billing/buy${st.pkg ? `?package=${encodeURIComponent(st.pkg)}` : ''}`;
    redirect(response, 303, target, { 'set-cookie': [cookie(BIND_COOKIE, bind, 1800), cookie(STATE_COOKIE, '', 0)] });
  }

  /* ------------------------------ buying ------------------------------ */

  async function buy(request, response, url) {
    const bind = bindFrom(request);
    const pkg = PACKAGES.includes(url.searchParams.get('package')) ? url.searchParams.get('package') : '';
    if (!bind) {
      /* Not signed in: the plans with their prices, each a link into the
         Discord sign-in with its package. The sign-in-only page stays the
         fallback when the catalog cannot be read. */
      let catalogState = null;
      try { catalogState = await catalog.get(); } catch (error) { logger('warn', 'academy_billing_plans_catalog_failed', { error: String(error && error.message || error) }); }
      const packages = catalogState ? PACKAGES.filter((key) => catalogState.sellable.has(key)).map((key) => catalogState.sellable.get(key)) : [];
      const memberships = catalogState && catalogState.memberships ? [...catalogState.memberships.values()]
        .sort((a, b) => a.line.localeCompare(b.line) || PACKAGES.indexOf(a.key) - PACKAGES.indexOf(b.key)) : [];
      /* An incomplete read with nothing in it (Stripe unreachable) must not
         read as "nothing on sale": the sign-in page is shown instead. */
      if (!catalogState || (!catalogState.complete && !packages.length && !memberships.length)) {
        if (catalogState) logger('warn', 'academy_billing_plans_catalog_failed', { error: 'incomplete_empty' });
        page(response, 200, (nonce) => pages.signInPage({ config, nonce, pkg }));
        return;
      }
      page(response, 200, (nonce) => pages.plansPage({ config, nonce, packages, memberships, pkg, paused: !preflightOk() }));
      return;
    }
    const observed = await memberOrPage(request, response, url, bind, pkg, 'buy');
    if (!observed) return;
    const user = observed.user;
    const catalogState = await catalog.get();
    const packages = PACKAGES.filter((key) => catalogState.sellable.has(key)).map((key) => catalogState.sellable.get(key));
    const memberships = catalogState.memberships ? [...catalogState.memberships.values()]
      .sort((a, b) => a.line.localeCompare(b.line) || PACKAGES.indexOf(a.key) - PACKAGES.indexOf(b.key)) : [];
    const winback = catalogState.winback ? [...catalogState.winback.values()]
      .sort((a, b) => Number(a.academy) - Number(b.academy) || a.amount - b.amount) : [];
    let view;
    try { view = await checkout.readAccess(bind.userId); } catch (_) {
      message(response, 503, 'Payments are busy', 'We could not reach the payment provider. Please try again shortly.', []);
      return;
    }
    page(response, 200, (nonce) => pages.buyPage({ config, nonce, userId: bind.userId, user, packages, memberships, winback, csrf: tokens.csrfFor(bind),
      inGuild: observed.inGuild, pkg, paused: !preflightOk(), state: viewState(view) }));
  }

  function viewState(view) {
    return { entitled: view.entitled, recurring: view.recurring, lifetime: view.lifetime, lifetimeSuspended: view.lifetimeSuspended,
      lifetimePending: view.lifetimePending, blockingLines: [...(view.blockingLines || [])], ownedExternal: [...(view.ownedExternal || [])],
      trialUsed: Boolean(view.trialUsed), trialUnknown: Boolean(view.trialUnknown), winbackEligible: Boolean(view.winbackEligible) };
  }

  /* The membership read every signed-in page starts with. Returns
     { inGuild, user } or null after answering the page itself (bot failure,
     a non-member while ALLOW_NON_MEMBER=0, a banned account). */
  async function memberOrPage(request, response, url, bind, pkg, route) {
    const user = await bot.getUser(bind.userId).catch(() => null);
    let observed;
    try { observed = await bot.getMember(bind.userId); } catch (error) {
      discordFailed(response, url, error, route);
      return null;
    }
    if (!observed.inGuild && !config.allowNonMember) {
      page(response, 200, (nonce) => pages.nonMemberPage({ config, nonce, userId: bind.userId, user, pkg }));
      return null;
    }
    if (!observed.inGuild && checkout && typeof checkout.banState === 'function') {
      const ban = await checkout.banState(bind.userId);
      if (ban === 'banned') { message(response, 403, BANNED_TITLE, BANNED_TEXT, []); return null; }
      if (ban === 'error') {
        logger('error', 'academy_billing_page_discord_failed', { route, kind: 'ban_lookup' });
        message(response, 503, 'Discord is busy', 'We could not check your Discord account. Please try again shortly.', [{ href: url.pathname + url.search, label: 'Try again' }]);
        return null;
      }
    }
    /* "I have joined, continue": roles bought before joining land now. */
    if (observed.inGuild) memberSeen(bind.userId);
    return { inGuild: observed.inGuild, user };
  }

  /* /trial?plan=: the plan is in the link, the sign-in adds the member to the
     server, and the page holds one offer with its consent box. */
  async function trial(request, response, url) {
    const plan = pages.TRIAL_PLANS.includes(url.searchParams.get('plan')) ? url.searchParams.get('plan') : 'monthly';
    const bind = bindFrom(request);
    const catalogState = await catalog.get();
    const memberships = catalogState.memberships ? [...catalogState.memberships.values()] : [];
    const desc = pages.trialOffer(memberships, plan);
    if (!bind) { page(response, 200, (nonce) => pages.trialSignInPage({ config, nonce, plan, days: desc && Number.isInteger(desc.trialDays) ? desc.trialDays : 7 })); return; }
    const observed = await memberOrPage(request, response, url, bind, '', 'trial');
    if (!observed) return;
    let view;
    try { view = await checkout.readAccess(bind.userId); } catch (_) {
      message(response, 503, 'Payments are busy', 'We could not reach the payment provider. Please try again shortly.', [{ href: url.pathname + url.search, label: 'Try again' }]);
      return;
    }
    const others = memberships.filter((d) => d.academy === false && Number.isInteger(d.trialDays) && !d.winback && pages.TRIAL_PLANS.includes(d.key));
    page(response, 200, (nonce) => pages.trialPage({ config, nonce, userId: bind.userId, user: observed.user, desc, csrf: tokens.csrfFor(bind),
      inGuild: observed.inGuild, paused: !preflightOk(), plan, others, state: viewState(view) }));
  }

  async function postCheckout(request, response) {
    if (request.method !== 'POST') { sendJson(response, 405, { ok: false, error: 'method_not_allowed' }); return; }
    const body = await readBody(request, FORM_MAX_BYTES);
    if (!body.ok) { sendJson(response, 413, { ok: false, error: 'payload_too_large' }); return; }
    const form = Object.fromEntries(new URLSearchParams(body.raw.toString('utf8')));
    const bind = bindFrom(request);
    const result = await checkout.start({ bind, form, ipKey: ipKey(request) });
    if (result.redirect) { redirect(response, 303, result.redirect); return; }
    if (result.page === 'non_member') {
      const user = await bot.getUser(bind.userId).catch(() => null);
      page(response, result.status, (nonce) => pages.nonMemberPage({ config, nonce, userId: bind.userId, user, pkg: result.data && result.data.pkg }));
      return;
    }
    if (result.page === 'banned') {
      message(response, result.status, BANNED_TITLE, BANNED_TEXT, []);
      return;
    }
    if (result.page === 'owned' && result.data && result.data.label) {
      message(response, result.status, `You already have ${result.data.label}`, 'A lifetime purchase on this Discord account already includes it, so there is nothing more to buy.',
        [{ href: '/v1/academy/billing/buy', label: 'Back to plans' }]);
      return;
    }
    if (result.page === 'owned') {
      message(response, result.status, 'You already own MEM Lifetime', 'MEM Lifetime is already on this Discord account, so there is nothing more to buy.', []);
      return;
    }
    if (result.page === 'lifetime_pending') {
      message(response, result.status, 'Your MEM Lifetime payment is processing',
        `Your bank payment for MEM Lifetime has not cleared yet. ${pages.BANK_PAYMENT_NOTE} You do not need to pay again.`,
        [{ href: '/v1/academy/billing/buy', label: 'Back to plans' }]);
      return;
    }
    if (result.page === 'prices_changed') {
      message(response, result.status, 'Prices were updated', 'Please review the plans and terms again before paying.', [{ href: '/v1/academy/billing/buy', label: 'Review plans' }]);
      return;
    }
    message(response, result.status || 500, 'Checkout could not start', ERROR_TEXT[result.error] || 'Please try again.',
      [{ href: '/v1/academy/billing/buy', label: 'Back to plans' }]);
  }

  async function success(request, response, url) {
    const sessionId = String(url.searchParams.get('session_id') || '');
    if (!allowPublic(`success:${ipKey(request)}`, SUCCESS_PER_IP)) {
      message(response, 429, 'Too many requests', 'Please wait a few minutes. Stripe emails your receipt, and your role is added without this page.', []);
      return;
    }
    let settled = null;
    try { settled = await checkout.settle(sessionId); } catch (error) {
      logger('warn', 'academy_billing_settle_failed', { error: String(error && (error.code || error.message) || 'error').slice(0, 120) });
    }
    if (settled && !settled.ok && settled.reason !== 'binding_mismatch') {
      message(response, 400, 'Unknown checkout', 'We could not find that checkout.', [{ href: '/v1/academy/billing/buy', label: 'Back to plans' }]);
      return;
    }
    /* Anyone not known to be in the server sees the invite (success and
       pending page alike); roles bought before joining wait for them. */
    let inGuild = null;
    if (settled && settled.ok && settled.discordId) {
      try {
        inGuild = Boolean((await bot.getMember(settled.discordId)).inGuild);
        if (inGuild) memberSeen(settled.discordId);
      } catch (_) { inGuild = null; }
    }
    page(response, 200, (nonce) => pages.successPage({ config, nonce, sessionId, paid: Boolean(settled && settled.paid),
      processing: Boolean(settled && settled.processing), failed: Boolean(settled && settled.failed),
      lifetimeWithPlan: Boolean(settled && settled.lifetimeWithPlan), inGuild, trial: Boolean(settled && settled.trial) }));
  }

  async function statusJson(request, response, url) {
    if (!allowPublic(`status:${ipKey(request)}`, STATUS_PER_IP)) { sendJson(response, 429, { ok: false, error: 'too_many_requests' }); return; }
    const result = await checkout.status(String(url.searchParams.get('session_id') || ''));
    if (!result) { sendJson(response, 404, { ok: false, error: 'not_found' }); return; }
    sendJson(response, 200, result);
  }

  async function manage(request, response) {
    const result = await checkout.portal(bindFrom(request));
    if (result.redirect) { redirect(response, 303, result.redirect); return; }
    if (result.page === 'no_customer') {
      message(response, 404, 'No billing account yet', 'You have no Academy purchase to manage.', [{ href: '/v1/academy/billing/buy', label: 'See plans' }]);
      return;
    }
    message(response, result.status || 503, 'Manage billing is unavailable', ERROR_TEXT[result.error] || 'Please try again later.', []);
  }

  async function packagesJson(request, response) {
    const catalogState = await catalog.get();
    const list = PACKAGES.filter((key) => catalogState.sellable.has(key)).map((key) => {
      const d = catalogState.sellable.get(key);
      return { key, amount: d.amount, currency: d.currency, interval: d.interval, interval_count: d.interval_count,
        trial_days: d.trialDays, trial_no_card: d.trialNoCard, cancel_after_days: d.cancelAfterDays };
    });
    /* trial_days is what an account that never had a free trial is offered
       (one free trial per Discord account). */
    const memberships = catalogState.memberships ? [...catalogState.memberships.values()].map((d) => ({
      price: d.priceId, key: d.key, label: d.label, roles: d.roles, amount: d.amount, currency: d.currency, interval: d.interval, interval_count: d.interval_count,
      trial_days: d.trialDays, trial_no_card: d.trialNoCard, cancel_after_days: d.cancelAfterDays
    })) : [];
    sendJson(response, 200, { packages: list, memberships }, { 'cache-control': 'public, max-age=600' });
  }

  /** Returns true when the path belongs to billing (handled), false otherwise. */
  async function handle(request, response, path) {
    if (!path.startsWith(PREFIX)) return false;
    const route = path.slice(PREFIX.length);
    if (route === 'stripe/webhook') { await webhook(request, response); return true; }
    const current = state();
    if (!current.enabled || !current.schemaReady) { sendJson(response, 404, { ok: false, error: 'not_found' }); return true; }
    const url = new URL(request.url || '/', 'http://localhost');
    const method = request.method;
    if ((method === 'GET' || method === 'HEAD') && route.startsWith('assets/')) { assets.sendAsset(request, response, route.slice('assets/'.length)); return true; }
    try {
      if (route === 'checkout') { await postCheckout(request, response); return true; }
      if (method !== 'GET') { sendJson(response, 405, { ok: false, error: 'method_not_allowed' }); return true; }
      switch (route) {
        case 'packages': await packagesJson(request, response); return true;
        case 'start': await start(request, response, url); return true;
        case 'oauth/callback': await callback(request, response, url); return true;
        case 'buy': await buy(request, response, url); return true;
        case 'trial': await trial(request, response, url); return true;
        case 'success': await success(request, response, url); return true;
        case 'status': await statusJson(request, response, url); return true;
        case 'manage': await manage(request, response); return true;
        default: sendJson(response, 404, { ok: false, error: 'not_found' }); return true;
      }
    } catch (error) {
      logger('error', 'academy_billing_route_failed', { route, error: String(error && (error.code || error.kind || error.message) || 'error').slice(0, 120) });
      if (!response.headersSent) message(response, 500, 'Something went wrong', 'Nothing was charged by this step. Please try again.', []);
      else response.destroy();
      return true;
    }
  }

  return { handle, parseCookies };
}

module.exports = { createRoutes, parseCookies, clientAddress, PREFIX, BIND_COOKIE, STATE_COOKIE };
