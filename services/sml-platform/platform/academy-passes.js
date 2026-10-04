'use strict';

/* Academy passes bought with Loop Bucks. A member with a StockMarketLoop account (linked, email-verified, profile complete, two-step on)
 * loads Loop Bucks on the site, then spends them here for daily / weekly / monthly / 3-month / 6-month / yearly / lifetime access.
 * The WordPress wallet (academy-wallet.js, mu-plugins/sml-academy-wallet.php) does the charge; this file keeps the passes and decides access.
 * Prices come from SML_ACADEMY_LB_PRICES; nothing is for sale until the owner sets them. */

const crypto = require('node:crypto');

const DAY_MS = 86_400_000;
const PLANS = Object.freeze({
  daily: { label: 'Daily', days: 1 },
  weekly: { label: 'Weekly', days: 7 },
  monthly: { label: 'Monthly', days: 30 },
  quarterly: { label: '3 months', days: 90 },
  semiannual: { label: '6 months', days: 180 },
  yearly: { label: 'Yearly', days: 365 },
  lifetime: { label: 'Lifetime', days: null }
});
const SNOWFLAKE = /^\d{15,24}$/;

/* '{"daily":50,"weekly":250,...}' -> { daily: 50, ... } keeping only known plans with a whole positive price; null when none. */
function parsePrices(raw) {
  let obj; try { obj = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {}); } catch (_) { return null; }
  const out = {};
  for (const [plan, v] of Object.entries(obj || {})) { const n = Number(v); if (PLANS[plan] && Number.isInteger(n) && n > 0 && n <= 1_000_000) out[plan] = n; }
  return Object.keys(out).length ? out : null;
}

function createPassStore({ pool = null } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = [];
  const out = (r) => ({ id: String(r.id), product: String(r.product || 'academy'), discordId: String(r.discord_id), wpUserId: r.wp_user_id == null ? null : Number(r.wp_user_id), plan: String(r.plan), amount: Number(r.amount), ref: String(r.ref), status: String(r.status), startsAt: new Date(r.starts_at).toISOString(), expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null });
  /* the pass that grants access right now, preferring lifetime then the latest expiry */
  async function active(discordId, at = new Date(), product = 'academy') {
    if (db) {
      const r = (await db.query("SELECT * FROM academy_lb_passes WHERE discord_id=$1 AND product=$3 AND status='active' AND starts_at <= $2 AND (expires_at IS NULL OR expires_at > $2) ORDER BY expires_at DESC NULLS FIRST LIMIT 1", [discordId, at, product])).rows[0];
      return r ? out(r) : null;
    }
    const live = mem.filter((p) => p.discord_id === discordId && (p.product || 'academy') === product && p.status === 'active' && new Date(p.starts_at) <= at && (!p.expires_at || new Date(p.expires_at) > at));
    live.sort((a, b) => (a.expires_at ? new Date(a.expires_at).getTime() : Infinity) - (b.expires_at ? new Date(b.expires_at).getTime() : Infinity)).reverse();
    return live[0] ? out(live[0]) : null;
  }
  async function byRef(ref) {
    if (db) { const r = (await db.query('SELECT * FROM academy_lb_passes WHERE ref=$1', [ref])).rows[0]; return r ? out(r) : null; }
    const r = mem.find((p) => p.ref === ref); return r ? out(r) : null;
  }
  async function add({ discordId, wpUserId = null, plan, amount, ref, startsAt, expiresAt, product = 'academy' }) {
    if (db) {
      const r = (await db.query('INSERT INTO academy_lb_passes (discord_id, wp_user_id, plan, amount, ref, starts_at, expires_at, product) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [discordId, wpUserId, plan, amount, ref, startsAt, expiresAt, product])).rows[0];
      return out(r);
    }
    if (mem.some((p) => p.ref === ref)) throw new Error('duplicate_ref');
    const row = { id: mem.length + 1, product, discord_id: discordId, wp_user_id: wpUserId, plan, amount, ref, status: 'active', starts_at: startsAt, expires_at: expiresAt };
    mem.push(row); return out(row);
  }
  async function markRefunded(ref) {
    if (db) { await db.query("UPDATE academy_lb_passes SET status='refunded' WHERE ref=$1", [ref]); return; }
    const r = mem.find((p) => p.ref === ref); if (r) r.status = 'refunded';
  }
  return { active, byRef, add, markRefunded };
}

/* product: 'academy' (Academy access) or 'click_alert' (the Click-to-Alert add-on). Each has its own prices and its own passes. */
function createPassService({ store = createPassStore(), wallet, prices = null, product = 'academy', subscribeUrl = '', now = () => new Date(), logger = () => {} } = {}) {
  const refPrefix = product === 'click_alert' ? 'ca-lb' : 'acad-lb';
  const configured = !!(prices && wallet);
  const catalog = () => Object.keys(PLANS).filter((k) => prices && prices[k]).map((k) => ({ plan: k, label: PLANS[k].label, days: PLANS[k].days, price: prices[k] }));
  const clean = (id) => (SNOWFLAKE.test(String(id || '')) ? String(id) : '');

  async function hasActive(discordId) { const id = clean(discordId); return id ? !!(await store.active(id, now(), product).catch(() => null)) : false; }

  async function status(discordId) {
    const id = clean(discordId);
    if (!configured) return { ok: false, status: 503, code: 'passes_not_configured' };
    if (!id) return { ok: false, status: 400, code: 'invalid_user' };
    const [w, pass] = await Promise.all([wallet.status(id), store.active(id, now(), product).catch(() => null)]);
    if (!w.ok) return { ok: false, status: w.status || 503, code: w.error || 'wallet_unavailable' };
    return { ok: true, product, subscribeUrl: String(subscribeUrl || ''), catalog: catalog(), pass, linked: !!w.linked, eligible: !!w.eligible, blocked: w.blocked || '', url: w.url || '', balance: Number.isFinite(w.balance) ? w.balance : null };
  }

  /* orderKey makes a double click or a retry safe: the same key never charges twice. */
  async function buy({ discordId, plan, orderKey }) {
    const id = clean(discordId);
    if (!configured) return { ok: false, status: 503, code: 'passes_not_configured' };
    if (!id) return { ok: false, status: 400, code: 'invalid_user' };
    if (!PLANS[plan] || !prices[plan]) return { ok: false, status: 400, code: 'unknown_plan' };
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(String(orderKey || ''))) return { ok: false, status: 400, code: 'order_key_required' };
    const ref = `${refPrefix}:${id}:${orderKey}`;
    const again = await store.byRef(ref);
    if (again) return { ok: true, pass: again, duplicate: true };
    const current = await store.active(id, now(), product);
    if (current && !current.expiresAt) return { ok: false, status: 409, code: 'already_lifetime' };

    const amount = prices[plan];
    const charge = await wallet.spend({ discordId: id, amount, ref, plan });
    if (!charge.ok) return { ok: false, status: charge.status || 402, code: charge.error || 'charge_failed', ...(charge.url ? { url: charge.url } : {}), ...(charge.balance != null ? { balance: charge.balance, needed: charge.needed } : {}) };

    /* extending an active pass starts where it ends; lifetime never expires */
    const start = current && current.expiresAt ? new Date(current.expiresAt) : now();
    const days = PLANS[plan].days;
    const expiresAt = days == null ? null : new Date(start.getTime() + days * DAY_MS);
    try {
      const pass = await store.add({ discordId: id, product, plan, amount, ref, startsAt: new Date(Math.min(start.getTime(), now().getTime())), expiresAt });
      logger('info', 'academy_pass_bought', { plan });
      return { ok: true, pass, balance: charge.balance };
    } catch (error) {
      logger('error', 'academy_pass_record_failed', { error: String(error && error.message) });
      const back = await wallet.refund({ discordId: id, ref }).catch(() => ({ ok: false }));
      return { ok: false, status: 503, code: back && back.ok ? 'temporarily_unavailable_refunded' : 'temporarily_unavailable_contact_support' };
    }
  }

  /* operator refund: the pass stops granting access and the Loop Bucks go back */
  async function refund({ ref }) {
    const pass = await store.byRef(ref);
    if (!pass) return { ok: false, status: 404, code: 'not_found' };
    const back = await wallet.refund({ discordId: pass.discordId, ref });
    if (!back.ok) return { ok: false, status: back.status || 503, code: back.error || 'refund_failed' };
    await store.markRefunded(ref);
    return { ok: true };
  }
  return { configured, product, catalog, status, buy, refund, hasActive };
}

/* Wraps the Discord-role access check: a member without the Academy role who holds a live Loop Bucks pass gets in as tier 'academy'.
   The member's Discord id comes from the base check's refusal (it needs identityAccess to name a non-member). */
function withPasses(base, passes) {
  return {
    async verify(authorization) {
      const r = await base.verify(authorization);
      if (r.ok || r.code !== 'academy_role_required' || !r.userId || !passes || !passes.configured) return r;
      if (await passes.hasActive(r.userId)) return { ok: true, userId: r.userId, tier: 'academy' };
      return r;
    }
  };
}

function createWalletClient({ baseUrl = '', secret = '', fetchImpl = fetch, now = Date.now } = {}) {
  const root = String(baseUrl || '').trim().replace(/\/+$/, '');
  const configured = /^https:\/\//i.test(root) && String(secret).length >= 32;
  async function call(payload) {
    if (!configured) return { ok: false, status: 503, error: 'wallet_unconfigured' };
    const path = '/wp-json/sml-loop-kick/v1/academy-wallet';
    const body = JSON.stringify(payload);
    const ts = String(Math.floor(now() / 1000));
    const sig = crypto.createHmac('sha256', String(secret)).update(`${ts}.${path}.${crypto.createHash('sha256').update(body).digest('hex')}`).digest('hex');
    let res;
    try { res = await fetchImpl(`${root}${path}`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'x-sml-lk-timestamp': ts, 'x-sml-lk-signature': `sha256=${sig}` }, body, signal: AbortSignal.timeout(10_000) }); }
    catch (_) { return { ok: false, status: 503, error: 'wallet_unavailable' }; }
    let data = null; try { data = await res.json(); } catch (_) { data = null; }
    if (res.ok && data && data.ok === true) return { ...data, status: 200 };
    if (data && typeof data.error === 'string' && [402, 403].includes(res.status)) return { ok: false, status: res.status, ...data };
    return { ok: false, status: res.status === 409 ? 409 : 503, error: 'wallet_unavailable' };
  }
  return {
    configured,
    status: (discordId) => call({ action: 'status', discord_user_id: discordId }),
    spend: ({ discordId, amount, ref, plan }) => call({ action: 'spend', discord_user_id: discordId, amount, ref, plan }),
    refund: ({ discordId, ref }) => call({ action: 'refund', discord_user_id: discordId, ref })
  };
}

module.exports = { PLANS, parsePrices, createPassStore, createPassService, createWalletClient, withPasses };
