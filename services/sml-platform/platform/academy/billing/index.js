'use strict';

/* =============================================================================
 * MEM Academy billing engine: composition root and job lifecycle.
 *
 * createAcademyBilling() is safe to call with ANY env:
 *   - nothing configured              -> fully inert (no pool, no timers; the
 *                                        server's own 404 answers the paths)
 *   - only the webhook secret set     -> the webhook stores signed events as
 *                                        'deferred'; every other route 404s
 *   - SML_ACADEMY_BILLING_ENABLED=1   -> routes and jobs, but only once schema
 *                                        028 is present (both services deploy
 *                                        the same commit; the API applies the
 *                                        migration), re-checked every 5 min
 *
 * Jobs (started by start(), stopped by stop()):
 *   events       setImmediate kick + 5 s poll -> classify + resync
 *   applier      kick after each queued change + 5 s poll (enforce mode only)
 *   due-scan     60 s: members whose next_check_at passed (grace end, period
 *                end + 2 h, comp expiry, incomplete snapshots, failed Discord
 *                reads, and every member with access once a day for drift
 *                repair); prunes old rows. On start in ROLE_MODE=enforce every
 *                member whose last resync did not queue roles (off / dry_run)
 *                is made due once.
 *   reconcile    SML_ACADEMY_BILLING_RECONCILE_INTERVAL_MS when mode != off
 *   preflight    at start and hourly
 *
 * The engine has its OWN small pool (max 3) so a burst can never starve the
 * Discord hub interactions, and at most two resyncs run at once.
 * ========================================================================== */

const { Pool } = require('pg');
const { parseBillingConfig, describeConfig, PACKAGES } = require('./config');
const { createStore } = require('./store');
const { createStripeApi } = require('./stripe-client');
const { createDiscordBot } = require('./discord');
const { createCatalog } = require('./catalog');
const { createPreflight } = require('./preflight');
const { createResync } = require('./resync');
const { createApplier } = require('./applier');
const { createEvents } = require('./events');
const { createCheckout } = require('./checkout');
const { createLinkTokens } = require('./link-token');
const { createBillingOAuth } = require('./oauth');
const { createRoutes, PREFIX } = require('./routes');
const { createReconciler } = require('./reconciler');
const { createUcChecker } = require('./external');
const { createUpgradeChatClient } = require('../../upgrade-chat');
const handoff = require('./handoff');

const POLL_MS = 5000;
const DUE_SCAN_MS = 60_000;
const PREFLIGHT_MS = 3600_000;
const PREFLIGHT_RETRY_MS = 5 * 60_000;
const SCHEMA_RECHECK_MS = 5 * 60_000;
const PRUNE_EVERY_MS = 3600_000;
const MAX_CONCURRENT_RESYNCS = 2;
/* Every Upgrade.Chat request gives up after this (the checker's own deadline
   is external.UC_CHECK_DEADLINE_MS). */
const UC_REQUEST_TIMEOUT_MS = 8000;
/* A member seen again (hub click, /buy, the "Add me" join) whose roles the
   engine already delivered is resynced at most this often: Discord drops
   every role when a member leaves, so a member who rejoined gets them back. */
const SEEN_RESYNC_MS = 10 * 60_000;

function sslConfig(connectionString, mode) {
  if (mode === 'off') return false;
  let host = '';
  try { host = new URL(connectionString).hostname; } catch (_) { /* handled by pg */ }
  if (!mode && (host === 'localhost' || host === '127.0.0.1')) return false;
  return { rejectUnauthorized: mode === 'verify' };
}

function createLimiter(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active += 1;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active -= 1; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

function inert(reason, config) {
  return {
    enabled: false,
    reason,
    config,
    async handle() { return false; },
    async start() {},
    async stop() {},
    onMemberSeen() {},
    async issueHandoff() { return null; },
    handoff: { configured: false, async mint() { return { ok: false, code: 'handoff_unconfigured' }; } }
  };
}

function createAcademyBilling({ env = process.env, pool = null, databaseUrl = '', databaseSsl = '', logger = () => {},
  fetchImpl = globalThis.fetch, stripeApi = null, bot = null, now = Date.now, sleep, timers = globalThis, upgradeChat = null } = {}) {
  let config;
  try {
    config = parseBillingConfig(env);
  } catch (error) {
    logger('error', 'academy_billing_config_invalid', { errors: error.errors || [String(error.message)] });
    config = parseBillingConfig(env, { throwOnInvalid: false });
  }
  if (!config.requested && !config.webhookSecrets.length) return inert('disabled', config);

  let ownPool = null;
  if (!pool) {
    if (!databaseUrl) return inert('no_database', config);
    ownPool = new Pool({ connectionString: databaseUrl, ssl: sslConfig(databaseUrl, databaseSsl), max: 3,
      idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000, application_name: 'sml-academy-billing' });
    ownPool.on('error', (error) => logger('error', 'academy_billing_pool_error', { error: String(error && error.message || 'error').slice(0, 80) }));
    pool = ownPool;
  }

  const store = createStore({ pool, livemode: config.livemode, guildId: config.guildId });
  const stripe = stripeApi || (config.stripeKey ? createStripeApi({ key: config.stripeKey }) : null);
  const discord = bot || (config.botToken && config.guildId ? createDiscordBot({ token: config.botToken, guildId: config.guildId, fetchImpl, sleep }) : null);
  const state = { enabled: config.enabled, schemaReady: false, started: false };
  const timersList = [];
  const inflight = new Set();
  const limit = createLimiter(MAX_CONCURRENT_RESYNCS);
  let lastPruneAt = 0;
  let kickScheduled = false;
  let listenClient = null;

  const catalog = stripe ? createCatalog({ config, stripeApi: stripe, now }) : null;
  const preflight = stripe && discord
    ? createPreflight({ config, stripeApi: stripe, bot: discord, catalog, store, logger, now })
    : { run: async () => null, last: () => null, ok: () => false, stripeOk: () => false, stripeAccountOk: () => false, discordOk: () => false };
  const applier = config.enabled && discord
    ? createApplier({ config, store, bot: discord, fetchImpl, sleep, logger, now, preflightOk: () => preflight.discordOk(),
      revokesAllowed: () => preflight.stripeAccountOk() })
    : null;

  function track(promise) {
    inflight.add(promise);
    promise.finally(() => inflight.delete(promise)).catch(() => {});
    return promise;
  }

  function kickApplier() {
    if (!applier || !state.started) return;
    setImmediate(() => { track(applier.run().catch((error) => logger('error', 'academy_billing_applier_failed', { error: String(error && error.message || 'error').slice(0, 120) }))); });
  }

  /* External-role revokes need the Upgrade.Chat check (external.js). The
     platform's UPGRADE_CHAT_CLIENT_ID / UPGRADE_CHAT_CLIENT_SECRET; without
     them every engine-granted external role is parked as needs_review
     instead of being removed. */
  const ucClient = upgradeChat || (config.ucConfigured
    ? createUpgradeChatClient({ clientId: config.ucClientId, clientSecret: config.ucClientSecret, fetchImpl, now, timeoutMs: UC_REQUEST_TIMEOUT_MS })
    : null);
  const ucChecker = createUcChecker({ config, client: ucClient, logger, now });

  const resyncCore = stripe && discord && catalog ? createResync({
    config, store, stripeApi: stripe, catalog, bot: discord, logger, now, kickApplier, ucChecker,
    stripeWritesAllowed: () => config.enabled && preflight.stripeAccountOk(),
    /* A key on the wrong Stripe account reads every Customer as deleted:
       no revoke is decided until preflight confirms the account. */
    revokeGate: () => preflight.stripeAccountOk()
  }) : null;
  const resync = (discordId, options) => {
    if (!resyncCore) return Promise.reject(new Error('academy_billing_not_configured'));
    return limit(() => resyncCore.resync(discordId, options));
  };

  const events = createEvents({ config, store, stripeApi: stripe, resync, logger, now, isEnabled: () => state.enabled && state.schemaReady });
  const tokens = config.clientSecret ? createLinkTokens({ secret: config.clientSecret, now }) : null;
  const checkout = resyncCore ? createCheckout({ config, store, stripeApi: stripe, catalog, bot: discord, tokens, resync,
    takeSnapshot: resyncCore.takeSnapshot, preflight, logger, now, onMemberSeen: (userId) => onMemberSeen(userId) }) : null;
  const oauth = config.publicUrl && config.appId ? createBillingOAuth({ config, fetchImpl }) : null;
  const reconciler = resyncCore ? createReconciler({ config, store, stripeApi: stripe, bot: discord, resync, preflight, logger, now }) : null;

  function kick() {
    if (kickScheduled || !state.started) return;
    kickScheduled = true;
    setImmediate(() => {
      kickScheduled = false;
      track(processEvents());
    });
  }

  async function processEvents() {
    try {
      const outcome = await events.processDue();
      if (outcome.claimed) logger('info', 'academy_billing_events_processed', outcome);
    } catch (error) {
      logger('error', 'academy_billing_events_failed', { error: String(error && error.message || 'error').slice(0, 120) });
    }
  }

  async function dueScan() {
    try {
      /* A failed preflight blocks every write; retry it every 5 min rather
         than waiting for the hourly run. */
      const last = preflight.last();
      if (!preflight.ok() && (!last || now() - last.checkedAt > PREFLIGHT_RETRY_MS)) await preflight.run();
      const ids = await store.dueMemberIds(store.pool, 25);
      for (const id of ids) {
        try { await resync(id, { actor: 'due_scan' }); } catch (error) {
          logger('warn', 'academy_billing_due_resync_failed', { discordUserId: id, error: String(error && (error.kind || error.code || error.message) || 'error').slice(0, 80) });
          await store.setNextCheck(store.pool, id, now() + 5 * 60_000).catch(() => {});
        }
      }
      if (now() - lastPruneAt > PRUNE_EVERY_MS) {
        lastPruneAt = now();
        await store.pruneEvents(store.pool);
        await handoff.pruneHandoffs(store.pool);
      }
    } catch (error) {
      logger('error', 'academy_billing_due_scan_failed', { error: String(error && error.message || 'error').slice(0, 120) });
    }
  }

  /* One-time buy links for the hub, in process. Same result shape as
     createBillingHandoff().mint in platform/academy-oauth.js, which the API
     uses (with handoff.issueHandoff over the shared database) for the
     Activity. */
  const handoffMinter = {
    get configured() { return Boolean(state.enabled && state.schemaReady && config.inDiscordLinks); },
    async mint({ discordUserId = '', guildId = '', source = 'hub', package: pkg = '' } = {}) {
      if (!handoffMinter.configured) return { ok: false, code: 'handoff_unconfigured' };
      if (!/^[0-9]{15,24}$/.test(String(discordUserId)) || !['activity', 'hub'].includes(source)
        || (guildId && String(guildId) !== config.guildId) || (pkg && !PACKAGES.includes(pkg))) return { ok: false, code: 'handoff_invalid_request' };
      try {
        const issued = await handoff.issueHandoff(store.pool, { discordUserId: String(discordUserId), guildId: config.guildId, source, publicUrl: config.publicUrl });
        return { ok: true, url: pkg ? `${issued.url}&package=${pkg}` : issued.url };
      } catch (error) {
        logger('warn', 'academy_billing_handoff_failed', { error: String(error && error.message || 'error').slice(0, 80) });
        return { ok: false, code: 'handoff_unavailable' };
      }
    }
  };

  const routes = createRoutes({ config, state: () => ({ ...state }), events, checkout, tokens, oauth, bot: discord, store, catalog, kick, logger, now,
    onMemberSeen: (userId) => onMemberSeen(userId) });

  function every(ms, fn) {
    let busy = false;
    const handle = timers.setInterval(() => {
      if (busy) return;
      busy = true;
      track(Promise.resolve().then(fn).catch(() => {}).finally(() => { busy = false; }));
    }, ms);
    if (handle && typeof handle.unref === 'function') handle.unref();
    timersList.push(handle);
  }

  async function startJobs() {
    if (state.started) return;
    if (!config.enabled) {
      logger('info', 'academy_billing_disabled', { reason: config.reason, webhookStoresDeferred: config.webhookSecrets.length > 0 });
      return;
    }
    if (!resyncCore) { logger('error', 'academy_billing_disabled', { reason: 'missing_clients' }); return; }
    state.started = true;
    logger('info', 'academy_billing_started', describeConfig(config));
    await preflight.run().catch((error) => logger('error', 'academy_billing_preflight_failed', { error: String(error && error.message || 'error').slice(0, 120) }));
    if (config.roleMode === 'enforce') await markRoleSyncDue();
    every(POLL_MS, processEvents);
    if (applier) every(POLL_MS, () => applier.run());
    every(DUE_SCAN_MS, dueScan);
    every(PREFLIGHT_MS, () => preflight.run());
    if (config.reconcileMode !== 'off') every(config.reconcileIntervalMs, () => reconciler.run());
    if (config.seenNotify) await listenSeen();
    kick();
  }

  /* SML_ACADEMY_BILLING_SEEN_NOTIFY=1: the API's Activity token exchange runs
     pg_notify('mem_academy_seen', <discord id>) on a role miss; a member who
     just joined the server gets their waiting grant immediately. */
  async function listenSeen() {
    try {
      listenClient = await store.pool.connect();
      listenClient.on('notification', (message) => {
        if (message && message.channel === 'mem_academy_seen') onMemberSeen(message.payload);
      });
      listenClient.on('error', (error) => {
        logger('warn', 'academy_billing_seen_listener_error', { error: String(error && error.message || 'error').slice(0, 80) });
      });
      await listenClient.query('LISTEN mem_academy_seen');
    } catch (error) {
      logger('warn', 'academy_billing_seen_listener_failed', { error: String(error && error.message || 'error').slice(0, 80) });
      if (listenClient) { try { listenClient.release(true); } catch (_) { /* already gone */ } }
      listenClient = null;
    }
  }

  /* Members last resynced while roles were not enforced (ROLE_MODE off or
     dry_run, or an unreadable Discord member) get one role pass now instead
     of at their next renewal. */
  async function markRoleSyncDue() {
    try {
      const n = await store.markRoleSyncDue(store.pool);
      if (n) logger('info', 'academy_billing_role_sync_due', { members: n });
    } catch (error) {
      logger('warn', 'academy_billing_role_sync_due_failed', { error: String(error && error.message || 'error').slice(0, 80) });
    }
  }

  async function checkSchema() {
    try { state.schemaReady = await store.schemaPresent(); } catch (_) { state.schemaReady = false; }
    return state.schemaReady;
  }

  async function start() {
    if (await checkSchema()) return startJobs();
    logger('warn', 'academy_billing_schema_missing', { version: '028' });
    const handle = timers.setInterval(() => {
      track(checkSchema().then(async (ready) => {
        if (!ready) return;
        timers.clearInterval(handle);
        logger('info', 'academy_billing_schema_ready', { version: '028' });
        await startJobs();
      }).catch(() => {}));
    }, SCHEMA_RECHECK_MS);
    if (handle && typeof handle.unref === 'function') handle.unref();
    timersList.push(handle);
    return undefined;
  }

  async function stop() {
    for (const handle of timersList.splice(0)) timers.clearInterval(handle);
    state.started = false;
    if (listenClient) {
      try { await listenClient.query('UNLISTEN mem_academy_seen'); } catch (_) { /* connection may be gone */ }
      try { listenClient.release(); } catch (_) { /* already released */ }
      listenClient = null;
    }
    const pending = [...inflight];
    if (pending.length) {
      await Promise.race([Promise.allSettled(pending), new Promise((resolve) => { const t = setTimeout(resolve, 5000); if (t.unref) t.unref(); })]);
    }
    if (ownPool) await ownPool.end().catch(() => {});
  }

  /**
   * A hub click (or other sign of life): waiting grants for this user (and
   * grants that gave up while they were away) are due now. A member with
   * nothing waiting whose roles the engine already delivered is resynced (at
   * most once per SEEN_RESYNC_MS): after a leave and rejoin Discord has
   * dropped every role, and the resync's drift repair queues them again.
   */
  const seenResyncAt = new Map();
  function onMemberSeen(userId) {
    if (!state.started || !state.schemaReady || config.roleMode !== 'enforce' || !/^[0-9]{15,24}$/.test(String(userId || ''))) return;
    const id = String(userId);
    track(store.kickAwaiting(store.pool, id)
      .then(async (n) => {
        if (n) { kickApplier(); return; }
        const last = seenResyncAt.get(id);
        if (last !== undefined && now() - last < SEEN_RESYNC_MS) return;
        seenResyncAt.set(id, now());
        if (seenResyncAt.size > 5000) for (const [key, at] of seenResyncAt) if (now() - at >= SEEN_RESYNC_MS) seenResyncAt.delete(key);
        const rows = await store.roleStatusFor(store.pool, id);
        if (!rows.some((row) => row.desired && row.state === 'synced')) return;
        await resync(id, { actor: 'resync' });
      })
      .catch((error) => logger('warn', 'academy_billing_member_seen_failed', { error: String(error && (error.kind || error.message) || 'error').slice(0, 80) })));
  }

  /** One-time /start?h= link (null unless enabled with IN_DISCORD_LINKS=1). */
  async function issueHandoff({ discordUserId, source = 'hub', package: pkg = '' }) {
    const minted = await handoffMinter.mint({ discordUserId, source, package: pkg });
    return minted.ok ? { url: minted.url } : null;
  }

  async function handle(request, response, path) {
    if (!path.startsWith(PREFIX)) return false;
    return routes.handle(request, response, path);
  }

  return {
    enabled: config.enabled,
    reason: config.reason,
    config,
    state: () => ({ ...state }),
    handle,
    start,
    stop,
    onMemberSeen,
    issueHandoff,
    handoff: handoffMinter,
    /* exposed for the CLI and tests */
    store,
    stripe,
    bot: discord,
    catalog,
    preflight,
    resync,
    applier,
    events,
    checkout,
    reconciler,
    ucChecker,
    tokens,
    processEvents,
    dueScan,
    checkSchema
  };
}

module.exports = { createAcademyBilling, PREFIX };
