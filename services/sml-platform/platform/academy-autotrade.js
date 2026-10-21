'use strict';

/* AUTO-TRADE (simulated only): the owner's MEM ALGO buy signals placed as orders on a moomoo SIMULATED account through the OpenD trade bridge.
 *
 * Safety model, in order of strength:
 *   1. the broker adapter refuses to talk to anything that does not report the SIMULATE environment, on every call; there is no real-money path
 *   2. off by default, and "dry" by default when switched on: decisions are logged, nothing is sent, until the owner chooses "sim"
 *   3. guardrails the owner sets: dollars per position, open positions, orders per day, a daily loss stop that halts the day, a minimum grade, styles
 *   4. a kill switch that stops new orders at once and (optionally) flattens what the engine opened
 * Exits are managed here (OpenD has no bracket orders): a held position is sold at the signal's target or stop, or at the close for day-style signals.
 * Educational simulation; nothing here is advice and nothing touches real money. */

const crypto = require('node:crypto');

const GRADE_RANK = { A: 2, B: 1 };
const DEFAULTS = Object.freeze({ enabled: false, mode: 'dry', maxPositionUsd: 1000, maxOpen: 5, maxOrdersPerDay: 10, dailyLossUsd: 500, minGrade: 'A', styles: ['day', 'swing'], flattenDayAtClose: true });
const fin = Number.isFinite;
const num = (v, d) => { const n = Number(v); return fin(n) ? n : d; };

function cleanSettings(input, base = DEFAULTS) {
  const s = { ...base };
  if (!input || typeof input !== 'object') return s;
  if (typeof input.enabled === 'boolean') s.enabled = input.enabled;
  if (input.mode === 'dry' || input.mode === 'sim') s.mode = input.mode;
  if (input.maxPositionUsd != null) s.maxPositionUsd = Math.min(100_000, Math.max(50, Math.round(num(input.maxPositionUsd, s.maxPositionUsd))));
  if (input.maxOpen != null) s.maxOpen = Math.min(20, Math.max(1, Math.round(num(input.maxOpen, s.maxOpen))));
  if (input.maxOrdersPerDay != null) s.maxOrdersPerDay = Math.min(100, Math.max(1, Math.round(num(input.maxOrdersPerDay, s.maxOrdersPerDay))));
  if (input.dailyLossUsd != null) s.dailyLossUsd = Math.min(100_000, Math.max(10, Math.round(num(input.dailyLossUsd, s.dailyLossUsd))));
  if (input.minGrade === 'A' || input.minGrade === 'B') s.minGrade = input.minGrade;
  if (Array.isArray(input.styles)) { const st = input.styles.filter((x) => x === 'day' || x === 'swing'); if (st.length) s.styles = [...new Set(st)]; }
  if (typeof input.flattenDayAtClose === 'boolean') s.flattenDayAtClose = input.flattenDayAtClose;
  return s;
}

/* The moomoo simulated-account broker. The bridge (tools/moomoo-sim-bridge) fronts OpenD and answers:
 *   GET  /trade/account    -> { env, cash, equity, dayPnl }
 *   GET  /trade/positions  -> { env, positions: [{ symbol, qty, cost, last }] }
 *   POST /trade/order      -> { env, id, status }     body { symbol, side, qty, type: 'limit'|'market', price }
 * Every answer must say env === 'SIMULATE' or the call is refused. */
function createMoomooSimBroker({ baseUrl = '', secret = '', fetchImpl = globalThis.fetch, timeoutMs = 12_000 } = {}) {
  const root = String(baseUrl || '').trim().replace(/\/+$/, '');
  const configured = /^https:\/\//i.test(root) && String(secret).length >= 16;
  async function call(path, body) {
    if (!configured) { const e = new Error('trade_bridge_unconfigured'); e.code = 'trade_bridge_unconfigured'; throw e; }
    const payload = body ? JSON.stringify(body) : '';
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = crypto.createHmac('sha256', String(secret)).update(ts + '.' + path + '.' + payload).digest('hex');
    const res = await fetchImpl(root + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-sml-key': String(secret), 'x-sml-ts': ts, 'x-sml-sig': sig }, body: body ? payload : undefined, signal: AbortSignal.timeout(timeoutMs) });
    const json = await res.json().catch(() => null);
    if (!res.ok) { const e = new Error('trade_bridge_' + res.status); e.code = 'trade_bridge_' + res.status; e.detail = json && json.error ? String(json.error) : ''; throw e; }
    if (!json || String(json.env || '').toUpperCase() !== 'SIMULATE') { const e = new Error('not_simulated'); e.code = 'not_simulated'; throw e; }
    return json;
  }
  return {
    configured,
    async account() { const a = await call('/trade/account'); return { cash: num(a.cash, 0), equity: num(a.equity, 0), dayPnl: num(a.dayPnl, 0) }; },
    async positions() { const p = await call('/trade/positions'); return (Array.isArray(p.positions) ? p.positions : []).map((x) => ({ symbol: String(x.symbol || '').toUpperCase().replace(/^US\./, ''), qty: num(x.qty, 0), cost: num(x.cost, 0), last: num(x.last, 0) })).filter((x) => x.symbol && x.qty > 0); },
    async placeOrder({ symbol, side, qty, type = 'limit', price }) { const r = await call('/trade/order', { symbol: 'US.' + String(symbol).toUpperCase(), side, qty, type, price }); return { id: String(r.id || ''), status: String(r.status || 'submitted') }; }
  };
}

function createAutoTrade({ broker, signals, store = null, marketState = null, now = Date.now, logger = () => {} } = {}) {
  let state = null;
  async function load() {
    if (state) return state;
    try { state = (store && await store.read()) || null; } catch (_) { state = null; }
    if (!state || typeof state !== 'object') state = {};
    state.settings = cleanSettings(state.settings || {});
    state.killed = !!state.killed; state.seen = state.seen || {}; state.open = state.open || {}; state.log = Array.isArray(state.log) ? state.log : [];
    state.day = state.day || ''; state.ordersToday = num(state.ordersToday, 0); state.haltedDay = state.haltedDay || '';
    return state;
  }
  async function save() { if (store) { try { await store.write(state); } catch (error) { logger('warn', 'autotrade_save_failed', { error: String(error && error.message || error) }); } } }
  const note = (kind, data) => { state.log.push({ at: now(), kind, ...data }); if (state.log.length > 200) state.log.splice(0, state.log.length - 200); };
  const dayOf = (t) => new Date(t - 4 * 3_600_000).toISOString().slice(0, 10); // New York calendar day, close enough for a once-a-day counter

  async function setSettings(input) { await load(); state.settings = cleanSettings(input, state.settings); if (state.settings.enabled) state.killed = false; note('settings', { settings: state.settings }); await save(); return state.settings; }
  async function kill({ flatten = false } = {}) {
    await load(); state.killed = true; state.settings.enabled = false; note('kill', { flatten }); const sold = [];
    if (flatten && broker && broker.configured) { try { for (const p of await broker.positions()) { if (state.open[p.symbol]) { if (state.settings.mode === 'sim') await broker.placeOrder({ symbol: p.symbol, side: 'sell', qty: p.qty, type: 'market' }); sold.push(p.symbol); delete state.open[p.symbol]; } } } catch (error) { note('error', { where: 'flatten', error: String(error && error.message || error) }); } }
    await save(); return { ok: true, flattened: sold };
  }

  /* one pass: manage exits for what the engine opened, then take new signals inside the guardrails */
  async function tick() {
    await load();
    const s = state.settings, t = now(), out = { ran: false, placed: [], exits: [], skipped: '' };
    if (!s.enabled || state.killed) { out.skipped = state.killed ? 'killed' : 'off'; return out; }
    if (!broker || !broker.configured) { out.skipped = 'no_broker'; return out; }
    const ms = marketState ? marketState(t) : { tradingDay: true, session: 'regular' };
    if (ms.tradingDay === false) { out.skipped = 'not_trading_day'; return out; }
    const today = dayOf(t); if (state.day !== today) { state.day = today; state.ordersToday = 0; state.haltedDay = ''; }
    out.ran = true;
    let account, positions;
    try { [account, positions] = await Promise.all([broker.account(), broker.positions()]); }
    catch (error) { note('error', { where: 'broker', error: String(error && error.code || error && error.message || error) }); await save(); out.skipped = String(error && error.code || 'broker_error'); out.ran = false; return out; }
    const held = new Map(positions.map((p) => [p.symbol, p]));
    const live = s.mode === 'sim';
    const send = async (order) => (live ? broker.placeOrder(order) : { id: 'dry', status: 'dry_run' });

    /* exits: target, stop, and the close for day signals */
    for (const [symbol, o] of Object.entries(state.open)) {
      const p = held.get(symbol);
      if (!p) { delete state.open[symbol]; continue; } // closed outside the engine
      const atClose = ms.session !== 'regular' && o.style === 'day' && s.flattenDayAtClose;
      const why = p.last >= o.target ? 'target' : p.last > 0 && p.last <= o.stop ? 'stop' : atClose ? 'close' : '';
      if (!why) continue;
      try { const r = await send({ symbol, side: 'sell', qty: p.qty, type: 'market' }); note('exit', { symbol, why, qty: p.qty, last: p.last, order: r.id, mode: s.mode }); out.exits.push({ symbol, why }); delete state.open[symbol]; }
      catch (error) { note('error', { where: 'exit', symbol, error: String(error && error.message || error) }); }
    }

    /* the daily loss stop halts new entries for the day */
    if (account.dayPnl <= -s.dailyLossUsd) { if (state.haltedDay !== today) { state.haltedDay = today; note('halt', { dayPnl: account.dayPnl, limit: s.dailyLossUsd }); } await save(); out.skipped = 'daily_loss_stop'; return out; }
    if (ms.session !== 'regular') { await save(); out.skipped = 'market_closed'; return out; }

    /* entries: fresh signals, best grade first, one per symbol, inside every guardrail */
    const since = t - 6 * 3_600_000;
    let list = []; try { list = (await signals(since)) || []; } catch (error) { note('error', { where: 'signals', error: String(error && error.message || error) }); }
    list = list.filter((x) => x && !state.seen[x.id] && s.styles.includes(x.style) && (GRADE_RANK[x.grade] || 0) >= GRADE_RANK[s.minGrade] && fin(x.entry) && x.entry > 0 && fin(x.target) && fin(x.stop) && x.stop < x.entry)
      .sort((a, b) => (GRADE_RANK[b.grade] - GRADE_RANK[a.grade]) || (b.score - a.score));
    let open = held.size;
    for (const sig of list) {
      state.seen[sig.id] = t;
      if (open >= s.maxOpen) { note('skip', { id: sig.id, why: 'max_open' }); break; }
      if (state.ordersToday >= s.maxOrdersPerDay) { note('skip', { id: sig.id, why: 'max_orders' }); break; }
      if (held.has(sig.symbol)) { note('skip', { id: sig.id, why: 'already_held' }); continue; }
      const qty = Math.floor(s.maxPositionUsd / sig.entry);
      if (qty < 1) { note('skip', { id: sig.id, why: 'too_small', entry: sig.entry }); continue; }
      if (qty * sig.entry > account.cash) { note('skip', { id: sig.id, why: 'no_cash' }); continue; }
      try {
        const price = Math.round(sig.entry * 1.002 * 100) / 100; // a marketable limit: never chase more than 0.2%
        const r = await send({ symbol: sig.symbol, side: 'buy', qty, type: 'limit', price });
        state.open[sig.symbol] = { id: sig.id, style: sig.style, entry: sig.entry, target: sig.target, stop: sig.stop, qty, at: t };
        state.ordersToday += 1; open += 1; held.set(sig.symbol, { symbol: sig.symbol, qty, cost: sig.entry, last: sig.entry });
        note('entry', { id: sig.id, symbol: sig.symbol, grade: sig.grade, qty, price, target: sig.target, stop: sig.stop, order: r.id, mode: s.mode }); out.placed.push({ symbol: sig.symbol, qty, price });
      } catch (error) { note('error', { where: 'entry', symbol: sig.symbol, error: String(error && error.message || error) }); }
    }
    for (const k of Object.keys(state.seen)) if (t - state.seen[k] > 2 * 86_400_000) delete state.seen[k];
    await save();
    return out;
  }

  async function status() {
    await load();
    let account = null, error = '';
    if (broker && broker.configured) { try { account = await broker.account(); } catch (e) { error = String(e && e.code || e && e.message || e); } }
    return { ok: true, settings: state.settings, killed: state.killed, brokerConfigured: !!(broker && broker.configured), env: 'SIMULATE', account, brokerError: error, open: state.open, ordersToday: state.ordersToday, haltedDay: state.haltedDay, log: state.log.slice(-40).reverse(), note: 'Simulated moomoo account only. Educational, not advice; no real money is ever used.' };
  }

  return { tick, status, setSettings, kill, load };
}

module.exports = { createAutoTrade, createMoomooSimBroker, cleanSettings, DEFAULTS };
