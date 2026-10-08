'use strict';

/* Pop-out windows: any Academy module can open in the member's own browser window (drag it to another screen,
 * keep it on top). Discord cannot open a second window from an Activity, so the Activity asks Discord to open a
 * link; that link carries a one-time ticket (2 minutes, single use, never sent to the server in a URL path or
 * query: it rides in the #fragment) which the window trades for its own session.
 *
 * The bus links a member's windows: when one window changes ticker, the member's other windows follow. It is per
 * member (a window only ever hears its own member's windows) and rate limited. */

const crypto = require('node:crypto');

const MODULE_ID = /^[a-z0-9-]{2,24}$/;
const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,9}$/;

function createPopoutService({ now = Date.now, randomBytes = crypto.randomBytes, ticketMs = 120_000, maxTicketsPerUser = 20,
  maxStreamsPerUser = 8, maxStreams = 2000, publishLimit = 30, publishWindowMs = 10_000 } = {}) {
  const tickets = new Map(); // id -> { userId, tier, displayName, expiresAt }
  const streams = new Map(); // userId -> Set(send)
  const publishes = new Map(); // userId -> [timestamps]
  let streamCount = 0;

  const sweep = () => { const t = now(); for (const [id, r] of tickets) if (r.expiresAt <= t) tickets.delete(id); };

  function issueTicket({ userId, tier, displayName = '' }) {
    if (!/^\d{15,24}$/.test(String(userId || ''))) return '';
    sweep();
    let mine = 0;
    for (const r of tickets.values()) if (r.userId === userId) mine += 1;
    if (mine >= maxTicketsPerUser) return '';
    const id = randomBytes(32).toString('base64url');
    tickets.set(id, { userId: String(userId), tier: String(tier || 'member'), displayName: String(displayName || '').slice(0, 80), expiresAt: now() + ticketMs });
    return id;
  }

  function consumeTicket(id) {
    const key = String(id || '');
    const record = tickets.get(key);
    if (!record) return null;
    tickets.delete(key); // single use, even when expired
    return record.expiresAt > now() ? record : null;
  }

  function subscribe(userId, send) {
    const id = String(userId || '');
    if (!id || streamCount >= maxStreams) return null;
    if (!streams.has(id)) streams.set(id, new Set());
    const set = streams.get(id);
    if (set.size >= maxStreamsPerUser) return null;
    set.add(send);
    streamCount += 1;
    let open = true;
    return () => {
      if (!open) return;
      open = false;
      set.delete(send);
      streamCount -= 1;
      if (!set.size) streams.delete(id);
    };
  }

  /* message: { symbol, from }. Returns how many of the member's windows got it, or -1 when rate limited. */
  function publish(userId, message) {
    const id = String(userId || '');
    const t = now();
    const recent = (publishes.get(id) || []).filter((x) => t - x < publishWindowMs);
    if (recent.length >= publishLimit) { publishes.set(id, recent); return -1; }
    recent.push(t);
    publishes.set(id, recent);
    const symbol = String(message && message.symbol || '').toUpperCase();
    if (!SYMBOL.test(symbol)) return 0;
    const out = { type: 'symbol', symbol, from: String(message && message.from || '').replace(/[^a-z0-9]/gi, '').slice(0, 24), at: t };
    let n = 0;
    for (const send of streams.get(id) || []) { try { send(out); n += 1; } catch (_) { /* a closed stream drops itself */ } }
    return n;
  }

  return { issueTicket, consumeTicket, subscribe, publish, stats: () => ({ tickets: tickets.size, streams: streamCount }) };
}

const validModule = (m) => MODULE_ID.test(String(m || ''));
const validSymbol = (s) => SYMBOL.test(String(s || '').toUpperCase());

module.exports = { createPopoutService, validModule, validSymbol };
