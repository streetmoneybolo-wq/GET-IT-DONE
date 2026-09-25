'use strict';

/* One real-time Massive connection for the whole Academy.
 *
 * Massive allows a single open stock stream per key, so the server holds that one connection and fans every trade and quote out to all viewers (SSE or the polled /live view).
 * Symbols are subscribed the first time someone watches them and dropped after ten idle minutes. Trades are stored as a short tape; quotes keep the newest best bid and ask.
 * Educational display only: nothing here places a trade. */

const URL_DEFAULT = 'wss://socket.massive.com/stocks';
const MAX_SYMBOLS = 60;
const IDLE_MS = 10 * 60_000;
const TAPE_MAX = 60;
const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;

function createMassiveStream({ apiKey = '', url = URL_DEFAULT, WebSocketImpl = globalThis.WebSocket, logger = () => {}, now = Date.now, timers = { setTimeout, clearTimeout, setInterval, clearInterval } } = {}) {
  const symbols = new Map(); // SYM -> { tape, quote, last, lastAt, wantedAt, subscribed }
  const listeners = new Map(); // SYM -> Set<fn>
  let ws = null, authed = false, stopped = true, retry = 0, reconnectTimer = null, sweepTimer = null, connectedAt = 0, lastMessageAt = 0, failedAuth = false;
  const enabled = Boolean(apiKey && WebSocketImpl);

  const send = (obj) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); } catch (_) { /* reconnect handles it */ } };
  const entry = (sym) => { let e = symbols.get(sym); if (!e) { e = { tape: [], quote: null, last: null, lastAt: 0, wantedAt: now(), subscribed: false, stats: newStats() }; symbols.set(sym, e); } return e; };
  const fire = (sym, evt) => { const set = listeners.get(sym); if (!set) return; for (const fn of set) { try { fn(evt); } catch (_) { /* a broken listener must not stop the feed */ } } };

  function subscribeAll() {
    if (!authed) return;
    const fresh = [...symbols.entries()].filter(([, e]) => !e.subscribed).map(([s]) => s);
    if (!fresh.length) return;
    send({ action: 'subscribe', params: fresh.flatMap((s) => [`T.${s}`, `Q.${s}`]).join(',') });
    for (const s of fresh) symbols.get(s).subscribed = true;
  }

  /* Session tape statistics since the symbol was first watched: lift the offer / hit the bid / neutral split, VWAP, price-by-volume, off-exchange share and the biggest prints. */
  function newStats() { return { since: now(), count: 0, vol: 0, notional: 0, buy: 0, sell: 0, neu: 0, buyN: 0, sellN: 0, neuN: 0, offVol: 0, offN: 0, pv: new Map(), big: [], times: [] }; }
  const pvKey = (price) => { const step = price >= 100 ? 0.5 : price >= 20 ? 0.1 : price >= 5 ? 0.05 : 0.01; return (Math.round(price / step) * step).toFixed(step < 0.05 ? 2 : step < 0.5 ? 2 : 2); };
  function record(e, trade, off) {
    const st = e.stats; st.count += 1; st.vol += trade.size; st.notional += trade.size * trade.price;
    if (trade.dir === 'B') { st.buy += trade.size; st.buyN += 1; } else if (trade.dir === 'S') { st.sell += trade.size; st.sellN += 1; } else { st.neu += trade.size; st.neuN += 1; }
    if (off) { st.offVol += trade.size; st.offN += 1; trade.off = true; }
    const k = pvKey(trade.price); st.pv.set(k, (st.pv.get(k) || 0) + trade.size);
    if (st.pv.size > 400) { const small = [...st.pv.entries()].sort((a, b) => a[1] - b[1])[0]; st.pv.delete(small[0]); }
    const notional = trade.size * trade.price;
    if (trade.size >= 500 && notional >= 50_000) { st.big.push({ t: trade.t, price: trade.price, size: trade.size, dir: trade.dir, off: Boolean(off) }); st.big.sort((a, b) => b.size * b.price - a.size * a.price); if (st.big.length > 5) st.big.length = 5; }
    st.times.push(trade.t); if (st.times.length > 600) st.times.shift();
  }
  function summarize(e) {
    const st = e.stats; if (!st || !st.count) return null;
    const t = now(); const rate60 = st.times.filter((x) => t - x < 60_000).length;
    return { since: st.since, count: st.count, vol: st.vol, vwap: st.vol > 0 ? st.notional / st.vol : null, buy: st.buy, sell: st.sell, neu: st.neu, buyN: st.buyN, sellN: st.sellN, neuN: st.neuN, offVol: st.offVol, offN: st.offN, rate60,
      pv: [...st.pv.entries()].map(([price, vol]) => ({ price: Number(price), vol })).sort((a, b) => b.vol - a.vol).slice(0, 8), big: st.big.slice() };
  }

  function classify(price, quote) {
    if (!quote) return 'N';
    if (price >= quote.ask && quote.ask > 0) return 'B';
    if (price <= quote.bid && quote.bid > 0) return 'S';
    return 'N';
  }

  function onMessage(raw) {
    lastMessageAt = now();
    let list; try { list = JSON.parse(raw); } catch (_) { return; }
    if (!Array.isArray(list)) return;
    for (const m of list) {
      if (!m) continue;
      if (m.ev === 'status') {
        if (m.status === 'connected') send({ action: 'auth', params: apiKey });
        else if (m.status === 'auth_success') { authed = true; failedAuth = false; retry = 0; for (const e of symbols.values()) e.subscribed = false; subscribeAll(); logger('info', 'massive_stream_ready', { symbols: symbols.size }); }
        else if (m.status === 'auth_failed') { failedAuth = true; authed = false; logger('warn', 'massive_stream_auth_failed', { message: String(m.message || '').slice(0, 80) }); }
        else if (m.status === 'max_connections') { logger('warn', 'massive_stream_max_connections', {}); }
        continue;
      }
      const sym = String(m.sym || '').toUpperCase(); const e = symbols.get(sym); if (!e) continue;
      if (m.ev === 'Q') {
        const bid = Number(m.bp), ask = Number(m.ap); if (!(bid > 0 && ask > 0)) continue;
        e.quote = { bid, ask, bs: Number(m.bs) * 100 || 0, as: Number(m.as) * 100 || 0, t: Number(m.t) || now() };
        fire(sym, { type: 'quote', quote: e.quote });
      } else if (m.ev === 'T') {
        const price = Number(m.p), size = Number(m.s) > 0 ? Number(m.s) : Number(m.ds) || 0; if (!(price > 0)) continue;
        const t = Number(m.t) || now();
        const trade = { t, price, size: Number.isFinite(size) ? size : 0, dir: classify(price, e.quote) };
        record(e, trade, m.x === 4 || m.trfi != null);
        e.tape.push(trade); if (e.tape.length > TAPE_MAX) e.tape.shift();
        e.last = price; e.lastAt = t;
        fire(sym, { type: 'trade', trade });
      }
    }
  }

  function connect() {
    if (!enabled || stopped || ws) return;
    let sock;
    try { sock = new WebSocketImpl(url); } catch (error) { logger('warn', 'massive_stream_connect_failed', { error }); schedule(); return; }
    ws = sock; authed = false;
    sock.onopen = () => { connectedAt = now(); };
    sock.onmessage = (event) => onMessage(typeof event.data === 'string' ? event.data : String(event.data));
    const dropped = () => { if (ws !== sock) return; ws = null; authed = false; for (const e of symbols.values()) e.subscribed = false; schedule(); };
    sock.onclose = dropped;
    sock.onerror = () => { try { sock.close(); } catch (_) { /* already closing */ } };
  }
  function schedule() {
    if (stopped || reconnectTimer) return;
    retry += 1;
    const wait = failedAuth ? 60_000 : Math.min(30_000, 500 * 2 ** Math.min(retry, 6));
    reconnectTimer = timers.setTimeout(() => { reconnectTimer = null; connect(); }, wait); if (reconnectTimer && reconnectTimer.unref) reconnectTimer.unref();
  }

  function sweep() {
    // a socket that is open but silent for a while during a busy symbol is stale: cycle it
    if (ws && authed && symbols.size && now() - lastMessageAt > 180_000 && now() - connectedAt > 180_000) { try { ws.close(); } catch (_) { /* reconnect follows */ } }
    const drop = [];
    for (const [s, e] of symbols) if (now() - e.wantedAt > IDLE_MS && !(listeners.get(s) && listeners.get(s).size)) drop.push(s);
    if (drop.length) { send({ action: 'unsubscribe', params: drop.flatMap((s) => [`T.${s}`, `Q.${s}`]).join(',') }); for (const s of drop) symbols.delete(s); }
  }

  function start() {
    if (!enabled || !stopped) return;
    stopped = false; connect();
    sweepTimer = timers.setInterval(sweep, 30_000); if (sweepTimer && sweepTimer.unref) sweepTimer.unref();
  }
  function stop() { stopped = true; if (reconnectTimer) timers.clearTimeout(reconnectTimer); reconnectTimer = null; if (sweepTimer) timers.clearInterval(sweepTimer); sweepTimer = null; try { if (ws) ws.close(); } catch (_) { /* closing */ } ws = null; authed = false; }

  /** Marks a symbol as being watched (subscribes on first use). Returns false for a bad symbol or when the cap is reached. */
  function watch(symbolRaw) {
    const sym = String(symbolRaw || '').toUpperCase();
    if (!SYMBOL_RE.test(sym)) return false;
    if (!symbols.has(sym) && symbols.size >= MAX_SYMBOLS) {
      const oldest = [...symbols.entries()].filter(([s]) => !(listeners.get(s) && listeners.get(s).size)).sort((a, b) => a[1].wantedAt - b[1].wantedAt)[0];
      if (!oldest) return false;
      send({ action: 'unsubscribe', params: `T.${oldest[0]},Q.${oldest[0]}` }); symbols.delete(oldest[0]);
    }
    const e = entry(sym); e.wantedAt = now(); subscribeAll();
    return true;
  }

  /** Newest data for a symbol, or null when nothing has arrived recently. */
  function peek(symbolRaw, maxAgeMs = 20_000) {
    const sym = String(symbolRaw || '').toUpperCase(); const e = symbols.get(sym);
    if (!e) return null;
    const qFresh = e.quote && now() - e.quote.t < maxAgeMs, tFresh = e.tape.length && now() - e.tape[e.tape.length - 1].t < 6 * 3600_000;
    if (!qFresh && !e.tape.length) return null;
    return { symbol: sym, quote: e.quote, tape: e.tape.slice(-30).reverse(), last: tFresh ? e.last : (e.quote ? (e.quote.bid + e.quote.ask) / 2 : null), quoteFresh: Boolean(qFresh), lastTradeAt: e.lastAt, stats: summarize(e) };
  }

  function on(symbolRaw, fn) {
    const sym = String(symbolRaw || '').toUpperCase();
    if (!watch(sym)) return () => {};
    let set = listeners.get(sym); if (!set) { set = new Set(); listeners.set(sym, set); }
    set.add(fn);
    return () => { set.delete(fn); if (!set.size) listeners.delete(sym); };
  }

  const status = () => ({ enabled, connected: Boolean(ws && ws.readyState === 1), authed, symbols: symbols.size, lastMessageAt, failedAuth });
  return { start, stop, watch, peek, on, status, onMessage, symbols };
}

module.exports = { createMassiveStream, SYMBOL_RE };
