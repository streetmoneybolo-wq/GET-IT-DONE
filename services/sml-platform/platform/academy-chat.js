'use strict';

/* The Academy in-app chat: switchable topic channels (Day Trade, Swing Trade, Short Sale, Options
 * Trading), not one room per Discord server and not one global room. A connection sits in exactly
 * one channel at a time and switches by joining another. History (the most recent messages) is
 * sent right after a join, so a fresh connection or a channel switch never opens on an empty
 * screen. Messages persist to Postgres (memory in tests/local runs).
 *
 * First-version moderation minimum: a message length cap, a per-member rate limit, and a member
 * may delete their own message. Reporting and muting are a fast-follow, not built here.
 *
 * The real-time transport is a WebSocket (attachChatServer, thin glue over the "ws" package).
 * Everything that matters is in createChatHub, which only needs a { send(json) } connection object
 * and is tested with fakes — it never touches a real socket. */

const CHANNELS = [
  { key: 'day', label: 'Day Trade' },
  { key: 'swing', label: 'Swing Trade' },
  { key: 'short', label: 'Short Sale' },
  { key: 'options', label: 'Options Trading' }
];
const CHANNEL_KEYS = new Set(CHANNELS.map((c) => c.key));
const MAX_BODY = 500;
const HISTORY = 50;
const RATE_LIMIT = 8; // messages
const RATE_WINDOW_MS = 10_000; // per this many ms

const cleanBody = (v) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_BODY);
const cleanName = (v) => String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);

/* Where messages are kept: Postgres (academy_chat_messages) when there is a database, memory otherwise (local runs, tests). */
function createChatStore({ pool = null } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = []; // [{ id, channel, discordId, authorName, body, createdAt }]
  let nextId = 1;
  const rowOut = (r) => ({ id: String(r.id), channel: String(r.channel), discordId: String(r.discord_id), authorName: String(r.author_name || ''), body: String(r.body), createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at) });

  async function history(channel, limit = HISTORY) {
    if (db) {
      const rows = (await db.query('SELECT * FROM academy_chat_messages WHERE channel=$1 ORDER BY id DESC LIMIT $2', [channel, limit])).rows;
      return rows.map(rowOut).reverse();
    }
    return mem.filter((m) => m.channel === channel).slice(-limit)
      .map((m) => rowOut({ id: m.id, channel: m.channel, discord_id: m.discordId, author_name: m.authorName, body: m.body, created_at: m.createdAt }));
  }
  async function add({ channel, discordId, authorName, body }) {
    if (db) {
      const row = (await db.query('INSERT INTO academy_chat_messages (channel, discord_id, author_name, body) VALUES ($1,$2,$3,$4) RETURNING *', [channel, discordId, authorName, body])).rows[0];
      return rowOut(row);
    }
    const createdAt = new Date().toISOString();
    const id = nextId++;
    mem.push({ id, channel, discordId, authorName, body, createdAt });
    return rowOut({ id, channel, discord_id: discordId, author_name: authorName, body, created_at: createdAt });
  }
  /* only the author can delete their own message; returns the channel it was in, or null if nothing matched */
  async function remove({ id, discordId }) {
    if (db) {
      const row = (await db.query('DELETE FROM academy_chat_messages WHERE id=$1 AND discord_id=$2 RETURNING channel', [id, discordId])).rows[0];
      return row ? String(row.channel) : null;
    }
    const idx = mem.findIndex((m) => String(m.id) === String(id) && m.discordId === discordId);
    if (idx < 0) return null;
    const { channel } = mem[idx];
    mem.splice(idx, 1);
    return channel;
  }
  return { history, add, remove };
}

/* verifySession: the same shape as academyOAuth.verifySession — (authorizationHeaderString) => { ok, userId, tier } | { ok:false, ... } */
function createChatHub({ store, verifySession, logger = () => {}, now = Date.now, rateLimit = RATE_LIMIT, rateWindowMs = RATE_WINDOW_MS } = {}) {
  const byChannel = new Map(CHANNELS.map((c) => [c.key, new Set()])); // channel -> Set(conn)
  const hits = new Map(); // discordId -> [timestamps within the window]

  function withinRate(discordId) {
    const list = (hits.get(discordId) || []).filter((t) => now() - t < rateWindowMs);
    list.push(now());
    hits.set(discordId, list);
    return list.length <= rateLimit;
  }
  function broadcast(channel, payload) {
    const json = JSON.stringify(payload);
    for (const conn of byChannel.get(channel) || []) {
      try { conn.send(json); } catch (error) { logger('warn', 'academy_chat_send_failed', { error: String(error.message || error) }); }
    }
  }

  /* Called once per new connection with the raw session token (a query-string token on the
     WebSocket URL, since a browser cannot set a header on a WS handshake). Returns null if the
     token does not verify — the caller should refuse the connection. */
  function authenticate(token) {
    const session = verifySession(`Bearer ${token}`);
    return session.ok ? { userId: session.userId, tier: session.tier } : null;
  }

  /* conn: { send(jsonString) }. identity: { userId, tier, authorName? } from authenticate(), with
     a display name attached by the caller. Returns { receive(rawFrame), onClose() } for the
     transport layer to feed inbound frames and the close event into — nothing here touches a real
     socket, which is what makes it testable with a fake conn. */
  function open(conn, identity) {
    let channel = null;
    const authorName = cleanName(identity.authorName);

    async function join(next) {
      if (!CHANNEL_KEYS.has(next)) { conn.send(JSON.stringify({ type: 'error', error: 'unknown_channel' })); return; }
      if (channel) (byChannel.get(channel) || new Set()).delete(conn);
      channel = next;
      byChannel.get(channel).add(conn);
      const messages = await store.history(channel).catch(() => []);
      conn.send(JSON.stringify({ type: 'history', channel, messages }));
    }
    async function post(body) {
      if (!channel) { conn.send(JSON.stringify({ type: 'error', error: 'join_first' })); return; }
      const clean = cleanBody(body);
      if (!clean) { conn.send(JSON.stringify({ type: 'error', error: 'empty_message' })); return; }
      if (!withinRate(identity.userId)) { conn.send(JSON.stringify({ type: 'error', error: 'rate_limited' })); return; }
      const row = await store.add({ channel, discordId: identity.userId, authorName, body: clean });
      broadcast(channel, { type: 'message', channel, message: row });
    }
    async function remove(id) {
      const removedChannel = await store.remove({ id, discordId: identity.userId }).catch(() => null);
      if (removedChannel) broadcast(removedChannel, { type: 'deleted', channel: removedChannel, id: String(id) });
      else conn.send(JSON.stringify({ type: 'error', error: 'not_found' }));
    }
    /* Returns the in-flight promise so a caller that wants to know when a frame has been fully
       handled (tests; anything awaiting delivery) can await it. The real ws transport ignores the
       return value — a WebSocket 'message' handler is fire-and-forget either way. */
    function receive(raw) {
      let msg; try { msg = JSON.parse(raw); } catch (_) { conn.send(JSON.stringify({ type: 'error', error: 'invalid_json' })); return null; }
      if (msg && msg.type === 'join') return join(String(msg.channel || ''));
      if (msg && msg.type === 'message') return post(msg.body);
      if (msg && msg.type === 'delete') return remove(msg.id);
      conn.send(JSON.stringify({ type: 'error', error: 'unknown_type' }));
      return null;
    }
    function onClose() { if (channel) (byChannel.get(channel) || new Set()).delete(conn); }
    return { receive, onClose };
  }

  return { authenticate, open, channels: CHANNELS };
}

/* Wires a real ws WebSocketServer onto an existing http.Server at path, using the hub above. Kept
   thin and untested directly (it is just glue); all real behavior lives in createChatHub. */
function attachChatServer(httpServer, hub, { path = '/academy-activity/chat', WebSocketServer } = {}) {
  const wss = new WebSocketServer({ noServer: true });
  httpServer.on('upgrade', (request, socket, head) => {
    let url; try { url = new URL(request.url || '/', 'http://localhost'); } catch (_) { socket.destroy(); return; }
    if (url.pathname !== path) return; // not ours: leave the socket for another upgrade listener, if any
    const identity = hub.authenticate(url.searchParams.get('token') || '');
    if (!identity) { socket.destroy(); return; }
    identity.authorName = url.searchParams.get('name') || '';
    wss.handleUpgrade(request, socket, head, (ws) => {
      const conn = { send: (s) => ws.send(s) };
      const handlers = hub.open(conn, identity);
      ws.on('message', (data) => handlers.receive(String(data)));
      ws.on('close', () => handlers.onClose());
    });
  });
  return wss;
}

module.exports = { createChatStore, createChatHub, attachChatServer, CHANNELS, MAX_BODY };
