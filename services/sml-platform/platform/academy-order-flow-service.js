'use strict';

const { createOrderFlow } = require('./academy-order-flow');

const SYMBOL = /^[A-Z0-9.:-]{1,10}$/;

/*
 * Keeps a rolling Level 2 history per symbol on the server, so a member who opens the Activity late still sees the last ten minutes of order flow,
 * and every member sees the same reading. One poller walks the active symbols one after another (never in parallel), so the moomoo bridge behind
 * WordPress sees a steady trickle instead of a burst. Symbols nobody looks at for two minutes are dropped; SPY and QQQ stay warm.
 * Every event is stored with its price so a job can record the 5-minute outcome, which is how the signals get measured before anyone leans on them.
 */
function createOrderFlowService({ origin, fetchImpl = fetch, store = null, logger = () => {}, now = Date.now, pollMs = 2500, idleMs = 120000, closedPollMs = 30000, alwaysOn = ['SPY', 'QQQ'], maxSymbols = 8, outcomeMs = 300000, timers = { setTimeout, clearTimeout } } = {}) {
  const engines = new Map();   // symbol -> { flow, lastTouch, nextAt, failures, closed, lastError, lastOk }
  const pending = [];          // { id, symbol, price0, side, dueAt }
  let running = false, timer = null, warnedAt = 0;

  function touch(symbolRaw) {
    const symbol = String(symbolRaw || '').toUpperCase();
    if (!SYMBOL.test(symbol)) throw new TypeError('invalid_symbol');
    let e = engines.get(symbol);
    if (!e) {
      if (engines.size >= maxSymbols) {
        // make room by dropping the least recently viewed, never an always-on symbol
        const victim = [...engines.entries()].filter(([s]) => !alwaysOn.includes(s)).sort((a, b) => a[1].lastTouch - b[1].lastTouch)[0];
        if (!victim) throw new TypeError('too_many_symbols');
        engines.delete(victim[0]);
      }
      e = { flow: createOrderFlow(), lastTouch: now(), nextAt: 0, failures: 0, closed: false, lastError: '', lastOk: 0 };
      engines.set(symbol, e);
    }
    e.lastTouch = now();
    return e;
  }

  async function fetchOne(symbol) {
    const url = `${origin}/wp-json/sml-scanner/v1/market-v2?symbol=${encodeURIComponent(symbol)}&depth=10&ticks=40`;
    const res = await fetchImpl(url, { headers: { Accept: 'application/json', 'User-Agent': 'StockMarketLoop-Academy-Activity/1.0' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`orderflow_${res.status}`);
    const j = await res.json();
    const bids = j && j.book && j.book.bids, asks = j && j.book && j.book.asks;
    if (!j || j.available === false || !Array.isArray(bids) || !Array.isArray(asks) || !bids.length || !asks.length) return { closed: true };
    const asof = Number(j.asof);
    return { t: Number.isFinite(asof) && asof > 1e11 ? asof : now(), bids, asks, ticks: Array.isArray(j.ticks) ? j.ticks : [] };
  }

  async function pollSymbol(symbol, e) {
    try {
      const data = await fetchOne(symbol);
      if (data.closed) { e.closed = true; e.nextAt = now() + closedPollMs; return; }
      e.closed = false; e.failures = 0; e.lastOk = now();
      const r = e.flow.push(data);
      if (!r.ok) { e.nextAt = now() + pollMs; return; }
      e.nextAt = now() + pollMs;
      const reading = r.emitted.length ? e.flow.analyze(now()) : null;
      for (const ev of r.emitted) {
        const price0 = reading && reading.book ? reading.book.mid : ev.price;
        if (store) {
          store.recordEvent({ symbol, ts: ev.t, kind: ev.kind, side: ev.side, price: ev.price || price0, strength: ev.strength, score: reading ? reading.score : 0, features: { note: ev.note } })
            .then((id) => { if (id) pending.push({ id, symbol, price0: price0, side: ev.side, dueAt: now() + outcomeMs }); })
            .catch((error) => { if (now() - warnedAt > 300000) { warnedAt = now(); logger('warn', 'orderflow_record_failed', { error }); } });
        }
      }
    } catch (error) {
      e.failures++; e.lastError = String(error && error.message || error).slice(0, 80);
      e.nextAt = now() + Math.min(60000, pollMs * 2 ** Math.min(5, e.failures));
      if (e.failures === 3 && now() - warnedAt > 300000) { warnedAt = now(); logger('warn', 'orderflow_poll_failing', { symbol, error: e.lastError }); }
    }
  }

  async function settleOutcomes() {
    const t = now();
    for (let i = pending.length - 1; i >= 0; i--) {
      const p = pending[i];
      if (p.dueAt > t) continue;
      pending.splice(i, 1);
      const e = engines.get(p.symbol);
      const a = e && e.flow.analyze(t);
      const mid = a && a.book ? a.book.mid : NaN;
      if (store && Number.isFinite(mid) && p.price0 > 0) {
        const pct = ((mid - p.price0) / p.price0) * 100 * (p.side === 'bull' ? 1 : -1); // + means the signal's direction was right
        store.recordOutcome(p.id, pct).catch(() => {});
      }
    }
  }

  async function tick() {
    if (!running) return;
    const t = now();
    for (const [symbol, e] of [...engines.entries()]) {
      if (!alwaysOn.includes(symbol) && t - e.lastTouch > idleMs) { engines.delete(symbol); continue; }
      if (e.nextAt <= t) await pollSymbol(symbol, e);
    }
    await settleOutcomes();
    if (running) { timer = timers.setTimeout(() => { void tick(); }, 500); if (timer && timer.unref) timer.unref(); }
  }

  function start() {
    if (running) return;
    running = true;
    for (const s of alwaysOn) { try { touch(s); } catch (_) { /* ignore */ } }
    timer = timers.setTimeout(() => { void tick(); }, 50);
    if (timer && timer.unref) timer.unref();
  }
  function stop() { running = false; if (timer) timers.clearTimeout(timer); }

  /** What the Activity asks for. Touching the symbol keeps it polled; the first call for a new symbol returns "warming". */
  function get(symbolRaw) {
    const symbol = String(symbolRaw || '').toUpperCase();
    const e = touch(symbol);
    const a = e.flow.analyze(now());
    const grades = a.ready ? { long: e.flow.grade(1, now()), short: e.flow.grade(-1, now()) } : null;
    return { symbol, ...a, grades, closed: e.closed, failing: e.failures >= 3, error: e.failures >= 3 ? e.lastError : '', servedAt: now() };
  }

  return { start, stop, touch, get, tick, engines, pending, gradeFor: (symbol, dir) => { const e = engines.get(String(symbol || '').toUpperCase()); return e ? e.flow.grade(dir, now()) : { grade: 'unavailable', reason: 'not tracked yet' }; } };
}

module.exports = { createOrderFlowService };
