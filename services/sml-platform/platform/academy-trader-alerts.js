'use strict';

/* ALERT CHART: a trader's own alerts inside the Academy, as threads. A trader posts an alert on a ticker (side, entry,
 * price targets, stop, a note) to a channel of their Alert Chart; later posts in the thread say a target was smashed,
 * a partial sell, or the position closed. Every alert carries live numbers read from the market: the peak gain since
 * the alert, the gain right now, how long the peak took, and which targets were hit. Members follow a trader's chart
 * (and may ask for a push the moment a new alert or update lands); a trader may set channels to premium, in which
 * case members buy access on stockmarketloop.com (one day, a week, a month, a year, or for life) and the grant is
 * recorded here. Educational posts by members, not advice; nothing here places a trade. */

const SNOWFLAKE = /^\d{15,25}$/;
const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const KINDS = new Set(['update', 'pt_hit', 'sell', 'close']);
const PLANS = { day: 1, week: 7, month: 30, year: 365, lifetime: null };
const MAX_TARGETS = 6, MAX_NOTE = 1200, MAX_CHANNELS = 6, METRICS_TTL_MS = 60_000;
const INACTIVE_DAYS = 30;

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => Math.round(v * 100) / 100;
const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f]/g, '').trim().slice(0, max);
const key = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);

/** A premium channel opens for an active grant; when the channel names tiers, the grant's tier must be one of them (a grant with no tier, from the owner or from before tiers existed, opens everything). */
function tierAllows(channel, acc) {
  if (!acc || !acc.ok) return false;
  const tiers = channel && Array.isArray(channel.tiers) ? channel.tiers : [];
  return !tiers.length || !acc.tier || acc.own === true || tiers.includes(acc.tier);
}

function defaultSettings() { return { channels: [{ key: 'main', name: 'Main', premium: false }], prices: { day: 0, week: 0, month: 0, year: 0, lifetime: 0 }, about: '', updatedAt: 0 }; }
function cleanSettings(input, base = defaultSettings()) {
  const out = JSON.parse(JSON.stringify(base));
  if (input && typeof input === 'object') {
    if (Array.isArray(input.channels)) {
      const seen = new Set();
      out.channels = input.channels.map((c) => ({ key: key(c && c.key) || key(c && c.name), name: text(c && c.name, 40), premium: Boolean(c && c.premium), tiers: Array.isArray(c && c.tiers) ? c.tiers.map((t) => key(t)).filter(Boolean).slice(0, 4) : [] })).filter((c) => c.key && c.name && !seen.has(c.key) && seen.add(c.key)).slice(0, MAX_CHANNELS);
      if (!out.channels.length) out.channels = defaultSettings().channels;
    }
    if (input.prices && typeof input.prices === 'object') for (const p of Object.keys(PLANS)) if (input.prices[p] !== undefined) out.prices[p] = Math.max(0, Math.min(100_000_00, Math.round(num(input.prices[p], 0))));
    if (input.about !== undefined) out.about = text(input.about, 400);
  }
  out.premium = out.channels.some((c) => c.premium);
  return out;
}

/* peak and current gain from candles since the alert, sign-adjusted for shorts; a stored peak is a floor (history windows end) */
function measure(alert, bars, now) {
  const entry = num(alert.entry); if (!entry || !Array.isArray(bars)) return null;
  const since = Date.parse(alert.createdAt), short = alert.side === 'short';
  const gain = (price) => r2(((short ? entry - price : price - entry) / entry) * 100);
  let peakPx = null, peakAt = null, last = null, lastAt = null;
  /* the bar that contains the alert counts too: bar spacing is read from the data (5m, 1h or 1D bars) */
  const ts = bars.map((b) => Number(b.t)).filter(Number.isFinite).sort((a, b) => a - b);
  const gaps = ts.slice(1).map((t, i) => t - ts[i]).filter((g) => g > 0).sort((a, b) => a - b);
  const spacing = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 60_000;
  for (const b of bars) {
    const t = Number(b.t); if (!Number.isFinite(t) || t + spacing <= since) continue;
    const hi = num(b.h, num(b.c)), lo = num(b.l, num(b.c)), cl = num(b.c); if (cl == null) continue;
    const best = short ? lo : hi;
    if (peakPx == null || (short ? best < peakPx : best > peakPx)) { peakPx = best; peakAt = t; }
    last = cl; lastAt = t;
  }
  if (alert.status === 'closed' && num(alert.closePrice) != null) { last = num(alert.closePrice); lastAt = Date.parse(alert.closedAt) || lastAt; }
  const stored = num(alert.peakPct);
  let peakPct = peakPx == null ? stored : gain(peakPx), peakTime = peakPx == null ? (alert.peakAt ? Date.parse(alert.peakAt) : null) : peakAt;
  if (stored != null && (peakPct == null || stored > peakPct)) { peakPct = stored; peakTime = alert.peakAt ? Date.parse(alert.peakAt) : peakTime; }
  const targets = (alert.targets || []).map((tp, i) => {
    const hitPx = short ? Math.min(peakPx == null ? Infinity : peakPx, tp) : Math.max(peakPx == null ? -Infinity : peakPx, tp);
    const hit = peakPx != null && (short ? peakPx <= tp : peakPx >= tp);
    return { index: i, price: tp, pct: gain(tp), hit, hitAt: hit ? (alert.hits && alert.hits[i]) || null : null, hitPx };
  });
  return {
    entry, side: alert.side, last, lastAt, currentPct: last == null ? null : gain(last), peakPct: peakPct == null ? null : r2(peakPct), peakAt: peakTime || null,
    timeToPeakMs: peakTime ? Math.max(0, peakTime - since) : null, ageMs: Math.max(0, now - since), targets, stopPct: num(alert.stop) == null ? null : gain(num(alert.stop)), asOf: now
  };
}

function createTraderAlerts({ pool = null, candles = null, push = null, names = null, now = Date.now, logger = () => {} } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = { alerts: new Map(), updates: new Map(), settings: new Map(), follows: new Map(), access: new Map(), seq: 1 };
  const metricsCache = new Map();
  let schemaReady = null;

  async function ensureSchema() {
    if (!db) return;
    if (schemaReady) return schemaReady;
    schemaReady = (async () => {
      try {
        await db.query('CREATE TABLE IF NOT EXISTS academy_trader_alerts (id BIGSERIAL PRIMARY KEY, author_id TEXT NOT NULL, symbol TEXT NOT NULL, side TEXT NOT NULL, entry NUMERIC NOT NULL, targets JSONB NOT NULL DEFAULT \'[]\', stop NUMERIC, note TEXT NOT NULL DEFAULT \'\', channel TEXT NOT NULL DEFAULT \'main\', status TEXT NOT NULL DEFAULT \'open\', close_price NUMERIC, closed_at TIMESTAMPTZ, peak_pct NUMERIC, peak_at TIMESTAMPTZ, hits JSONB NOT NULL DEFAULT \'{}\', created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
        await db.query('CREATE INDEX IF NOT EXISTS academy_trader_alerts_author_idx ON academy_trader_alerts (author_id, created_at DESC)');
        await db.query('CREATE INDEX IF NOT EXISTS academy_trader_alerts_created_idx ON academy_trader_alerts (created_at DESC)');
        await db.query('CREATE TABLE IF NOT EXISTS academy_trader_alert_updates (id BIGSERIAL PRIMARY KEY, alert_id BIGINT NOT NULL, author_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL DEFAULT \'\', price NUMERIC, target_index INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
        await db.query('CREATE INDEX IF NOT EXISTS academy_trader_alert_updates_alert_idx ON academy_trader_alert_updates (alert_id, created_at)');
        await db.query('CREATE TABLE IF NOT EXISTS academy_alert_chart_settings (discord_id TEXT PRIMARY KEY, settings JSONB NOT NULL DEFAULT \'{}\', updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
        await db.query('CREATE TABLE IF NOT EXISTS academy_alert_follows (follower_id TEXT NOT NULL, trader_id TEXT NOT NULL, push BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (follower_id, trader_id))');
        await db.query('CREATE TABLE IF NOT EXISTS academy_alert_access (member_id TEXT NOT NULL, trader_id TEXT NOT NULL, plan TEXT NOT NULL, until TIMESTAMPTZ, source TEXT NOT NULL DEFAULT \'\', reference TEXT NOT NULL DEFAULT \'\', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (member_id, trader_id))');
        await db.query('ALTER TABLE academy_alert_access ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT \'\'');
      } catch (error) { logger('warn', 'academy_trader_alerts_schema_failed', { error: String((error && error.message) || error) }); }
    })();
    return schemaReady;
  }

  const rowOut = (r) => ({
    id: String(r.id), authorId: String(r.author_id), symbol: String(r.symbol), side: String(r.side), entry: num(r.entry), targets: (Array.isArray(r.targets) ? r.targets : []).map((t) => num(t)).filter((t) => t != null),
    stop: num(r.stop), note: String(r.note || ''), channel: String(r.channel || 'main'), status: String(r.status || 'open'), closePrice: num(r.close_price), closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
    peakPct: num(r.peak_pct), peakAt: r.peak_at ? new Date(r.peak_at).toISOString() : null, hits: r.hits && typeof r.hits === 'object' ? r.hits : {}, createdAt: new Date(r.created_at).toISOString()
  });
  const updOut = (u) => ({ id: String(u.id), alertId: String(u.alert_id), authorId: String(u.author_id), kind: String(u.kind), body: String(u.body || ''), price: num(u.price), targetIndex: u.target_index == null ? null : Number(u.target_index), createdAt: new Date(u.created_at).toISOString() });

  /* ---------- settings (channels, prices) ---------- */
  async function settingsOf(traderId) {
    const id = String(traderId);
    if (db) { await ensureSchema(); try { const r = await db.query('SELECT settings FROM academy_alert_chart_settings WHERE discord_id = $1', [id]); return cleanSettings(r.rows[0] ? r.rows[0].settings : null); } catch (_) { /* fall through */ } }
    return cleanSettings(mem.settings.get(id) || null);
  }
  async function saveSettings(traderId, patch) {
    const id = String(traderId); if (!SNOWFLAKE.test(id)) return { ok: false, error: 'invalid_user' };
    const next = cleanSettings(patch, await settingsOf(id)); next.updatedAt = now();
    if (db) { await ensureSchema(); try { await db.query('INSERT INTO academy_alert_chart_settings (discord_id, settings, updated_at) VALUES ($1,$2,now()) ON CONFLICT (discord_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = now()', [id, JSON.stringify(next)]); } catch (error) { logger('warn', 'academy_trader_alerts_settings_failed', { error: String((error && error.message) || error) }); } }
    else mem.settings.set(id, next);
    return { ok: true, settings: next };
  }

  /* ---------- follows (and the push opt-in) and paid access ---------- */
  async function follow(followerId, traderId, { on = true, push: wantPush = null } = {}) {
    const a = String(followerId), b = String(traderId);
    if (!SNOWFLAKE.test(a) || !SNOWFLAKE.test(b) || a === b) return { ok: false, error: 'invalid_user' };
    if (db) {
      await ensureSchema();
      if (!on) await db.query('DELETE FROM academy_alert_follows WHERE follower_id = $1 AND trader_id = $2', [a, b]);
      else if (wantPush == null) await db.query('INSERT INTO academy_alert_follows (follower_id, trader_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [a, b]);
      else await db.query('INSERT INTO academy_alert_follows (follower_id, trader_id, push) VALUES ($1,$2,$3) ON CONFLICT (follower_id, trader_id) DO UPDATE SET push = EXCLUDED.push', [a, b, Boolean(wantPush)]);
    } else {
      const k = a + '>' + b;
      if (!on) mem.follows.delete(k); else mem.follows.set(k, { push: wantPush == null ? (mem.follows.get(k) || {}).push === true : Boolean(wantPush), at: now() });
    }
    return { ok: true, following: Boolean(on), push: on ? Boolean(wantPush == null ? await pushOn(a, b) : wantPush) : false, followers: await followerCount(b) };
  }
  async function pushOn(a, b) {
    if (db) { const r = await db.query('SELECT push FROM academy_alert_follows WHERE follower_id = $1 AND trader_id = $2', [String(a), String(b)]); return Boolean(r.rows[0] && r.rows[0].push); }
    const f = mem.follows.get(String(a) + '>' + String(b)); return Boolean(f && f.push);
  }
  async function followState(a, b) {
    if (!a) return { following: false, push: false };
    if (db) { await ensureSchema(); const r = await db.query('SELECT push FROM academy_alert_follows WHERE follower_id = $1 AND trader_id = $2', [String(a), String(b)]); return { following: r.rows.length > 0, push: Boolean(r.rows[0] && r.rows[0].push) }; }
    const f = mem.follows.get(String(a) + '>' + String(b)); return { following: Boolean(f), push: Boolean(f && f.push) };
  }
  async function followerCount(b) {
    if (db) { await ensureSchema(); const r = await db.query('SELECT count(*)::int AS n FROM academy_alert_follows WHERE trader_id = $1', [String(b)]); return r.rows[0] ? Number(r.rows[0].n) : 0; }
    let n = 0; for (const k of mem.follows.keys()) if (k.endsWith('>' + String(b))) n += 1; return n;
  }
  async function followersOf(b, { pushOnly = false } = {}) {
    if (db) { await ensureSchema(); const r = await db.query('SELECT follower_id, push FROM academy_alert_follows WHERE trader_id = $1' + (pushOnly ? ' AND push = true' : ''), [String(b)]); return r.rows.map((x) => ({ id: String(x.follower_id), push: Boolean(x.push) })); }
    const out = []; for (const [k, v] of mem.follows) { const [a, t] = k.split('>'); if (t === String(b) && (!pushOnly || v.push)) out.push({ id: a, push: Boolean(v.push) }); } return out;
  }
  async function followingOf(a) {
    if (db) { await ensureSchema(); const r = await db.query('SELECT trader_id FROM academy_alert_follows WHERE follower_id = $1', [String(a)]); return r.rows.map((x) => String(x.trader_id)); }
    const out = []; for (const k of mem.follows.keys()) { const [f, t] = k.split('>'); if (f === String(a)) out.push(t); } return out;
  }
  async function access(memberId, traderId) {
    const a = String(memberId || ''), b = String(traderId);
    if (!a) return { ok: false };
    if (a === b) return { ok: true, own: true, plan: 'owner', until: null };
    let row = null;
    if (db) { await ensureSchema(); const r = await db.query('SELECT plan, until, source, tier FROM academy_alert_access WHERE member_id = $1 AND trader_id = $2', [a, b]); row = r.rows[0] || null; }
    else row = mem.access.get(a + '>' + b) || null;
    if (!row) return { ok: false };
    const until = row.until ? new Date(row.until).getTime() : null;
    if (until != null && until < now()) return { ok: false, expired: true, until: new Date(until).toISOString(), plan: String(row.plan), tier: String(row.tier || '') };
    return { ok: true, plan: String(row.plan), until: until == null ? null : new Date(until).toISOString(), source: String(row.source || ''), tier: String(row.tier || '') };
  }
  /* recorded when stockmarketloop.com confirms a payment (or the owner grants it); a renewal extends from the later of now and the current end */
  async function grantAccess(memberId, traderId, { plan = 'month', source = '', reference = '', tier = '' } = {}) {
    const a = String(memberId), b = String(traderId);
    if (!SNOWFLAKE.test(a) || !SNOWFLAKE.test(b) || !(plan in PLANS)) return { ok: false, error: 'invalid_grant' };
    const days = PLANS[plan];
    const current = await access(a, b);
    const base = current.ok && current.until ? Math.max(now(), Date.parse(current.until)) : now();
    const until = days == null || (current.ok && current.until == null && !current.own) ? null : new Date(base + days * 86_400_000);
    if (db) { await ensureSchema(); await db.query('INSERT INTO academy_alert_access (member_id, trader_id, plan, until, source, reference, tier) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (member_id, trader_id) DO UPDATE SET plan = EXCLUDED.plan, until = EXCLUDED.until, source = EXCLUDED.source, reference = EXCLUDED.reference, tier = EXCLUDED.tier, created_at = now()', [a, b, plan, until, text(source, 40), text(reference, 120), key(tier)]); }
    else mem.access.set(a + '>' + b, { plan, until: until ? until.toISOString() : null, source: text(source, 40), tier: key(tier) });
    return { ok: true, plan, until: until ? until.toISOString() : null };
  }
  /* who holds an active paid grant on this trader's room, newest first (the owner's member list) */
  async function paidMembers(traderId, { limit = 200 } = {}) {
    const b = String(traderId), lim = Math.max(1, Math.min(500, Number(limit) || 200));
    let rows = [];
    if (db) { await ensureSchema(); const r = await db.query('SELECT member_id, plan, until, source, tier, created_at FROM academy_alert_access WHERE trader_id = $1 AND (until IS NULL OR until > now()) ORDER BY created_at DESC LIMIT $2', [b, lim]); rows = r.rows.map((x) => ({ memberId: String(x.member_id), plan: String(x.plan), until: x.until ? new Date(x.until).toISOString() : null, source: String(x.source || ''), tier: String(x.tier || '') })); }
    else for (const [k, v] of mem.access.entries()) { const [m, t] = k.split('>'); if (t === b && (!v.until || Date.parse(v.until) > now())) rows.push({ memberId: m, plan: v.plan, until: v.until, source: v.source || '', tier: v.tier || '' }); }
    return rows.slice(0, lim);
  }
  async function revokeAccess(memberId, traderId) {
    const a = String(memberId), b = String(traderId);
    if (db) { await ensureSchema(); await db.query('DELETE FROM academy_alert_access WHERE member_id = $1 AND trader_id = $2', [a, b]); } else mem.access.delete(a + '>' + b);
    return { ok: true };
  }

  /* ---------- alerts and their threads ---------- */
  async function post(authorId, input = {}) {
    const id = String(authorId); if (!SNOWFLAKE.test(id)) return { ok: false, error: 'invalid_author' };
    const symbol = String(input.symbol || '').toUpperCase().trim(); if (!SYMBOL.test(symbol)) return { ok: false, error: 'invalid_symbol' };
    const side = input.side === 'short' ? 'short' : 'long';
    const entry = num(input.entry); if (!(entry > 0)) return { ok: false, error: 'invalid_entry' };
    const targets = (Array.isArray(input.targets) ? input.targets : String(input.targets || '').split(/[,\s]+/)).map((t) => num(t)).filter((t) => t != null && t > 0).slice(0, MAX_TARGETS);
    if (!targets.length) return { ok: false, error: 'targets_required' };
    if (targets.some((t) => (side === 'long' ? t <= entry : t >= entry))) return { ok: false, error: 'targets_wrong_side' };
    const stop = num(input.stop); if (stop != null && (stop <= 0 || (side === 'long' ? stop >= entry : stop <= entry))) return { ok: false, error: 'stop_wrong_side' };
    const settings = await settingsOf(id);
    const channel = settings.channels.find((c) => c.key === key(input.channel)) ? key(input.channel) : settings.channels[0].key;
    const note = text(input.note, MAX_NOTE);
    const at = new Date(now());
    let row;
    if (db) {
      await ensureSchema();
      const r = await db.query('INSERT INTO academy_trader_alerts (author_id, symbol, side, entry, targets, stop, note, channel, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *', [id, symbol, side, entry, JSON.stringify(targets), stop, note, channel, at]);
      row = rowOut(r.rows[0]);
    } else {
      row = { id: String(mem.seq++), authorId: id, symbol, side, entry, targets, stop, note, channel, status: 'open', closePrice: null, closedAt: null, peakPct: null, peakAt: null, hits: {}, createdAt: at.toISOString() };
      mem.alerts.set(row.id, row);
    }
    logger('info', 'academy_trader_alert_posted', { symbol, side, channel, premium: settings.channels.find((c) => c.key === channel).premium });
    void notify(row, null).catch(() => {});
    return { ok: true, alert: await decorate(row, { viewerId: id, settings }) };
  }
  async function get(alertId) {
    const aid = String(alertId || ''); if (!/^\d{1,18}$/.test(aid)) return null;
    if (db) { await ensureSchema(); const r = await db.query('SELECT * FROM academy_trader_alerts WHERE id = $1', [aid]); return r.rows[0] ? rowOut(r.rows[0]) : null; }
    return mem.alerts.get(aid) || null;
  }
  async function updatesOf(alertIds) {
    const ids = alertIds.map(String); if (!ids.length) return new Map();
    const out = new Map(); for (const i of ids) out.set(i, []);
    if (db) { await ensureSchema(); const r = await db.query('SELECT * FROM academy_trader_alert_updates WHERE alert_id = ANY($1::bigint[]) ORDER BY created_at ASC', [ids]); for (const u of r.rows) { const o = updOut(u); if (out.has(o.alertId)) out.get(o.alertId).push(o); } }
    else for (const i of ids) out.set(i, (mem.updates.get(i) || []).slice());
    return out;
  }
  async function update(authorId, alertId, input = {}) {
    const id = String(authorId); const alert = await get(alertId);
    if (!alert) return { ok: false, error: 'not_found' };
    if (alert.authorId !== id) return { ok: false, error: 'not_yours' };
    const kind = KINDS.has(String(input.kind)) ? String(input.kind) : 'update';
    const body = text(input.body, MAX_NOTE), price = num(input.price);
    let targetIndex = kind === 'pt_hit' ? Number(input.targetIndex) : null;
    if (kind === 'pt_hit' && !(Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < alert.targets.length)) return { ok: false, error: 'invalid_target' };
    if (kind === 'close' && alert.status === 'closed') return { ok: false, error: 'already_closed' };
    if (!body && kind === 'update') return { ok: false, error: 'body_required' };
    const at = new Date(now());
    let row;
    if (db) {
      const r = await db.query('INSERT INTO academy_trader_alert_updates (alert_id, author_id, kind, body, price, target_index, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [alert.id, id, kind, body, price, targetIndex, at]);
      row = updOut(r.rows[0]);
      if (kind === 'close') await db.query('UPDATE academy_trader_alerts SET status = \'closed\', close_price = $2, closed_at = $3 WHERE id = $1', [alert.id, price, at]);
      if (kind === 'pt_hit') await db.query('UPDATE academy_trader_alerts SET hits = hits || $2::jsonb WHERE id = $1', [alert.id, JSON.stringify({ [targetIndex]: at.toISOString() })]);
    } else {
      row = { id: String(mem.seq++), alertId: alert.id, authorId: id, kind, body, price, targetIndex, createdAt: at.toISOString() };
      if (!mem.updates.has(alert.id)) mem.updates.set(alert.id, []); mem.updates.get(alert.id).push(row);
      if (kind === 'close') { alert.status = 'closed'; alert.closePrice = price; alert.closedAt = at.toISOString(); }
      if (kind === 'pt_hit') alert.hits = { ...(alert.hits || {}), [targetIndex]: at.toISOString() };
    }
    metricsCache.delete(alert.id);
    void notify(await get(alert.id), row).catch(() => {});
    return { ok: true, update: row };
  }

  /* ---------- the live numbers ---------- */
  async function metrics(alert) {
    const hit = metricsCache.get(alert.id); if (hit && now() - hit.at < METRICS_TTL_MS && hit.status === alert.status) return hit.value;
    let bars = [];
    if (typeof candles === 'function') {
      const ageDays = (now() - Date.parse(alert.createdAt)) / 86_400_000;
      const tf = alert.status === 'closed' ? '1D' : ageDays <= 2 ? '5m' : ageDays <= 20 ? '1h' : '1D';
      try { const c = await Promise.race([candles(alert.symbol, tf), new Promise((r) => setTimeout(() => r(null), 6_000))]); bars = c && Array.isArray(c.bars) ? c.bars : Array.isArray(c) ? c : []; } catch (_) { bars = []; }
    }
    const m = measure(alert, bars, now());
    if (m && m.peakPct != null && (num(alert.peakPct) == null || m.peakPct > num(alert.peakPct)) && db) {
      try { await db.query('UPDATE academy_trader_alerts SET peak_pct = $2, peak_at = $3 WHERE id = $1', [alert.id, m.peakPct, m.peakAt ? new Date(m.peakAt) : null]); } catch (_) { /* a peak that does not persist is recomputed next time */ }
    } else if (m && m.peakPct != null && !db) { alert.peakPct = m.peakPct; alert.peakAt = m.peakAt ? new Date(m.peakAt).toISOString() : alert.peakAt; }
    metricsCache.set(alert.id, { at: now(), status: alert.status, value: m }); if (metricsCache.size > 2000) metricsCache.delete(metricsCache.keys().next().value);
    return m;
  }

  /* an alert as a viewer may see it: a premium alert without access keeps its numbers and hides the ticker, the levels and the thread */
  async function decorate(alert, { viewerId = '', settings = null, thread = null, name = '' } = {}) {
    const s = settings || await settingsOf(alert.authorId);
    const channel = s.channels.find((c) => c.key === alert.channel) || { key: alert.channel, name: alert.channel, premium: false };
    const locked = channel.premium && !tierAllows(channel, await access(viewerId, alert.authorId));
    const m = await metrics(alert);
    const base = { id: alert.id, authorId: alert.authorId, authorName: name || '', channel: channel.key, channelName: channel.name, premium: Boolean(channel.premium), locked, side: alert.side, status: alert.status, createdAt: alert.createdAt, closedAt: alert.closedAt,
      metrics: m ? { currentPct: m.currentPct, peakPct: m.peakPct, timeToPeakMs: m.timeToPeakMs, ageMs: m.ageMs, targetsHit: m.targets.filter((t) => t.hit).length, targetsTotal: m.targets.length, asOf: m.asOf } : null };
    if (locked) return { ...base, symbol: null, entry: null, targets: [], stop: null, note: '', updates: [], updateCount: (thread || []).length };
    return { ...base, symbol: alert.symbol, entry: alert.entry, targets: m ? m.targets : alert.targets.map((price, index) => ({ index, price, hit: false })), stop: alert.stop, stopPct: m ? m.stopPct : null, note: alert.note, closePrice: alert.closePrice, last: m ? m.last : null, updates: thread || [] };
  }
  async function nameOf(id) { if (typeof names !== 'function') return ''; try { return text(await names(id), 60); } catch (_) { return ''; } }

  async function list(traderId, { viewerId = '', limit = 30, status = 'all' } = {}) {
    const id = String(traderId); if (!SNOWFLAKE.test(id)) return { ok: false, error: 'invalid_user' };
    const lim = Math.max(1, Math.min(100, Number(limit) || 30));
    let rows = [];
    if (db) { await ensureSchema(); const r = await db.query('SELECT * FROM academy_trader_alerts WHERE author_id = $1' + (status === 'open' || status === 'closed' ? ' AND status = $3' : '') + ' ORDER BY created_at DESC LIMIT $2', status === 'open' || status === 'closed' ? [id, lim, status] : [id, lim]); rows = r.rows.map(rowOut); }
    else rows = [...mem.alerts.values()].filter((a) => a.authorId === id && (status === 'all' || a.status === status)).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, lim);
    const [settings, threads, name, fstate, followers, acc] = await Promise.all([settingsOf(id), updatesOf(rows.map((a) => a.id)), nameOf(id), followState(viewerId, id), followerCount(id), access(viewerId, id)]);
    const alerts = []; for (const a of rows) alerts.push(await decorate(a, { viewerId, settings, thread: threads.get(a.id) || [], name }));
    return { ok: true, trader: { id, name, settings: { channels: settings.channels, prices: settings.prices, about: settings.about, premium: settings.premium }, followers, ...(await stats(id, rows)) }, viewer: { id: String(viewerId || ''), own: String(viewerId) === id, ...fstate, access: acc }, alerts, asOf: now() };
  }
  /* the record a trader shows and a dispute looks at: counts, hit rate, average peak, and whether the chart is active (a post within thirty days) */
  async function stats(traderId, rowsIn = null) {
    const id = String(traderId);
    let rows = rowsIn;
    if (!rows) { if (db) { await ensureSchema(); const r = await db.query('SELECT * FROM academy_trader_alerts WHERE author_id = $1 ORDER BY created_at DESC LIMIT 200', [id]); rows = r.rows.map(rowOut); } else rows = [...mem.alerts.values()].filter((a) => a.authorId === id); }
    let lastPostAt = rows.length ? Math.max(...rows.map((a) => Date.parse(a.createdAt))) : 0;
    const upd = await updatesOf(rows.slice(0, 50).map((a) => a.id)); for (const u of upd.values()) for (const x of u) lastPostAt = Math.max(lastPostAt, Date.parse(x.createdAt));
    const peaks = rows.map((a) => num(a.peakPct)).filter((v) => v != null);
    const closed = rows.filter((a) => a.status === 'closed'), wins = closed.filter((a) => num(a.peakPct) != null && num(a.peakPct) > 0);
    return { alerts: rows.length, open: rows.filter((a) => a.status === 'open').length, closed: closed.length, winRatePct: closed.length ? Math.round((wins.length / closed.length) * 100) : null, avgPeakPct: peaks.length ? r2(peaks.reduce((a, b) => a + b, 0) / peaks.length) : null, lastPostAt: lastPostAt ? new Date(lastPostAt).toISOString() : null, active: lastPostAt ? now() - lastPostAt <= INACTIVE_DAYS * 86_400_000 : false, inactiveDays: lastPostAt ? Math.floor((now() - lastPostAt) / 86_400_000) : null };
  }
  /* what a member sees on the Traders tab: alerts from the charts they follow, then recent free alerts from everyone */
  async function feed(viewerId, { limit = 40 } = {}) {
    const me = String(viewerId || ''); const lim = Math.max(1, Math.min(100, Number(limit) || 40));
    const following = me ? await followingOf(me) : [];
    let rows = [];
    if (db) { await ensureSchema(); const r = await db.query('SELECT * FROM academy_trader_alerts ORDER BY created_at DESC LIMIT $1', [lim * 3]); rows = r.rows.map(rowOut); }
    else rows = [...mem.alerts.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, lim * 3);
    const mine = rows.filter((a) => following.includes(a.authorId) || a.authorId === me), rest = rows.filter((a) => !mine.includes(a));
    const pick = mine.concat(rest).slice(0, lim);
    const threads = await updatesOf(pick.map((a) => a.id));
    const settingsBy = new Map(), nameBy = new Map();
    const out = [];
    for (const a of pick) {
      if (!settingsBy.has(a.authorId)) settingsBy.set(a.authorId, await settingsOf(a.authorId));
      if (!nameBy.has(a.authorId)) nameBy.set(a.authorId, await nameOf(a.authorId));
      out.push({ ...(await decorate(a, { viewerId: me, settings: settingsBy.get(a.authorId), thread: threads.get(a.id) || [], name: nameBy.get(a.authorId) })), followed: following.includes(a.authorId) });
    }
    return { ok: true, alerts: out, following, asOf: now() };
  }
  /* the push: followers who asked for it, and for a premium channel only those with access */
  async function notify(alert, upd) {
    if (!push || typeof push.sendTo !== 'function' || !alert) return;
    const settings = await settingsOf(alert.authorId);
    const channel = settings.channels.find((c) => c.key === alert.channel) || { premium: false };
    const followers = await followersOf(alert.authorId, { pushOnly: true });
    if (!followers.length) return;
    const allowed = new Set();
    for (const f of followers) if (!channel.premium || tierAllows(channel, await access(f.id, alert.authorId))) allowed.add(f.id);
    if (!allowed.size) return;
    const name = (await nameOf(alert.authorId)) || 'A trader you follow';
    const title = upd ? `${name}: ${upd.kind === 'pt_hit' ? 'target smashed' : upd.kind === 'close' ? 'closed' : upd.kind === 'sell' ? 'sell update' : 'update'} on $${alert.symbol}` : `${name}: new ${alert.side} alert on $${alert.symbol}`;
    const body = upd ? (upd.body || (upd.price != null ? 'at ' + upd.price : '')) : `Entry ${alert.entry} · targets ${alert.targets.join(', ')}${alert.stop ? ' · stop ' + alert.stop : ''}`;
    try { await push.sendTo((uid) => allowed.has(String(uid)), { title: title.slice(0, 100), body: String(body).slice(0, 180), tag: 'trader-alert-' + alert.id, url: '/academy-activity/?symbol=' + encodeURIComponent(alert.symbol) }); }
    catch (error) { logger('warn', 'academy_trader_alert_push_failed', { error: String((error && error.message) || error) }); }
  }

  return { ensureSchema, settingsOf, saveSettings, post, update, get, list, feed, stats, metrics, follow, followState, followersOf, followingOf, followerCount, access, grantAccess, revokeAccess, paidMembers, PLANS, INACTIVE_DAYS };
}

module.exports = { createTraderAlerts, tierAllows, measure, cleanSettings, PLANS, KINDS, INACTIVE_DAYS };
