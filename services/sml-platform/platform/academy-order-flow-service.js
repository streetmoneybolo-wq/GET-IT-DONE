'use strict';

const { createOrderFlow } = require('./academy-order-flow');

const SYMBOL = /^[A-Z0-9.:-]{1,10}$/;

/*
 * Keeps a rolling Level 2 history per symbol on the server, so a member who opens the Activity late still sees the last ten minutes of order flow,
 * and every member sees the same reading. One poller walks the active symbols one after another (never in parallel), so the moomoo bridge behind
 * WordPress sees a steady trickle instead of a burst. Symbols nobody looks at for two minutes are dropped; SPY and QQQ stay warm.
 * Every event is stored with its price so a job can record the 5-minute outcome, which is how the signals get measured before anyone leans on them.
 */
function createOrderFlowService({ origin, fetchImpl = fetch, store = null, logger = () => {}, now = Date.now, pollMs = 2500, idleMs = 120000, closedPollMs = 30000, alwaysOn = ['SPY', 'QQQ'], maxSymbols = 8, outcomeMs = 300000, fastPollMs = 1000, fastWindowMs = 15000, timers = { setTimeout, clearTimeout } } = {}) {
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
      e = { flow: createOrderFlow(), lastTouch: now(), nextAt: 0, failures: 0, closed: false, lastError: '', lastOk: 0, lastPush: 0, latest: null, tape: [], seen: new Set(), seq: 0 };
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
      /* Poll fast for whoever is watching (live view), but feed the order-flow model at its calibrated ~2.5 s cadence so its windows keep their meaning. */
      const cadence = now() - e.lastTouch < fastWindowMs ? fastPollMs : pollMs;
      e.nextAt = now() + cadence;
      absorbLive(e, data);
      if (now() - e.lastPush < pollMs - 150) return;
      e.lastPush = now();
      const r = e.flow.push(data);
      if (!r.ok) return;
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

  /* Keep the newest book and a de-duplicated tape of individual prints for the live view. */
  function absorbLive(e, data) {
    e.latest = data; e.seq++;
    for (const k of data.ticks || []) {
      const id = k && (k.id != null ? String(k.id) : [k.timestamp_ms, k.price, k.size].join(':'));
      if (!id || e.seen.has(id)) continue;
      const price = Number(k.price), size = Number(k.size), t = Number(k.timestamp_ms);
      if (!Number.isFinite(price) || !Number.isFinite(size) || !Number.isFinite(t)) continue;
      e.seen.add(id); e.tape.push({ t, price, size, dir: String(k.direction || '').toUpperCase() === 'BUY' ? 'B' : String(k.direction || '').toUpperCase() === 'SELL' ? 'S' : 'N' });
    }
    if (e.seen.size > 600) e.seen = new Set([...e.seen].slice(-300));
    e.tape.sort((a, b) => a.t - b.t);
    if (e.tape.length > 60) e.tape = e.tape.slice(-60);
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

  /** Fast path for the live view: newest book levels + individual prints, straight from memory. */
  function live(symbolRaw) {
    const symbol = String(symbolRaw || '').toUpperCase();
    const e = touch(symbol);
    const d = e.latest;
    if (!d) return { symbol, ready: false, closed: e.closed, failing: e.failures >= 3, servedAt: now() };
    const tape = e.tape.slice(-30).reverse();
    return { symbol, ready: true, asOf: d.t, seq: e.seq, book: { bids: d.bids.slice(0, 10), asks: d.asks.slice(0, 10) }, tape, last: tape.length ? tape[0].price : null, closed: e.closed, failing: e.failures >= 3, servedAt: now() };
  }

  return { start, stop, touch, get, live, tick, engines, pending, gradeFor: (symbol, dir) => { const e = engines.get(String(symbol || '').toUpperCase()); return e ? e.flow.grade(dir, now()) : { grade: 'unavailable', reason: 'not tracked yet' }; } };
}

module.exports = { createOrderFlowService };
