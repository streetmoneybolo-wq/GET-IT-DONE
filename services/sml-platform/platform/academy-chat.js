'use strict';

/* The Academy in-app chat: one Global room every member lands in, plus switchable topic channels
 * (Day Trade, Swing Trade, Short Sale, Options Trading) — never one room per Discord server. A
 * connection sits in exactly one channel at a time and switches by joining another. History (the most recent messages) is
 * sent right after a join, so a fresh connection or a channel switch never opens on an empty
 * screen. Messages persist to Postgres (memory in tests/local runs).
 *
 * Moderation: a message length cap, a per-member rate limit, a member may delete their own message,
 * and may report someone else's (stored in academy_chat_reports for moderators; muting a member is
 * a per-viewer client setting, not a server decision).
 *
 * The real-time transport is a WebSocket (attachChatServer, thin glue over the "ws" package).
 * Everything that matters is in createChatHub, which only needs a { send(json) } connection object
 * and is tested with fakes — it never touches a real socket. */

const CHANNELS = [
  { key: 'global', label: 'Global Chat' },
  { key: 'day', label: 'Day Trade' },
  { key: 'swing', label: 'Swing Trade' },
  { key: 'short', label: 'Short Sale' },
  { key: 'options', label: 'Options Trading' }
];
const CHANNEL_KEYS = new Set(CHANNELS.map((c) => c.key));
const MAX_BODY = 500;
const HISTORY = 300; // threads need their replies, so a room opens on its last 300 messages
const MAX_DEPTH = 5; // replies deeper than this attach to the reply above, as on Reddit's collapsed threads
const RATE_LIMIT = 8; // messages
const RATE_WINDOW_MS = 10_000; // per this many ms

const cleanBody = (v) => String(v || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_BODY);
const cleanName = (v) => String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);

/* Where messages are kept: Postgres (academy_chat_messages) when there is a database, memory otherwise (local runs, tests). */
function createChatStore({ pool = null } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = []; // [{ id, channel, discordId, authorName, body, createdAt, parentId, deleted }]
  const memVotes = new Map(); // messageId -> Map(voterId -> 1 | -1)
  let nextId = 1;
  const iso = (v) => (v instanceof Date ? v.toISOString() : String(v));
  const rowOut = (r) => ({ id: String(r.id), channel: String(r.channel), discordId: String(r.discord_id), authorName: String(r.author_name || ''), body: String(r.body), createdAt: iso(r.created_at), parentId: r.parent_id == null ? null : String(r.parent_id), deleted: !!r.deleted, score: Number(r.score) || 0, myVote: Number(r.my_vote) || 0 });
  const scoreOf = (id) => { let n = 0; for (const v of (memVotes.get(String(id)) || new Map()).values()) n += v; return n; };
  const memOut = (m, viewerId) => rowOut({ id: m.id, channel: m.channel, discord_id: m.discordId, author_name: m.authorName, body: m.body, created_at: m.createdAt, parent_id: m.parentId, deleted: m.deleted, score: scoreOf(m.id), my_vote: viewerId ? ((memVotes.get(String(m.id)) || new Map()).get(String(viewerId)) || 0) : 0 });

  /* The most recent messages of a room (replies included), each with its vote score and, for viewerId, that member's own vote. */
  async function history(channel, limit = HISTORY, viewerId = '') {
    if (db) {
      const rows = (await db.query('SELECT m.*, COALESCE((SELECT SUM(value) FROM academy_chat_votes v WHERE v.message_id=m.id),0) AS score, COALESCE((SELECT value FROM academy_chat_votes v WHERE v.message_id=m.id AND v.voter_id=$3),0) AS my_vote FROM academy_chat_messages m WHERE m.channel=$1 ORDER BY m.id DESC LIMIT $2', [channel, limit, String(viewerId || '')])).rows;
      return rows.map(rowOut).reverse();
    }
    return mem.filter((m) => m.channel === channel).slice(-limit).map((m) => memOut(m, viewerId));
  }
  async function get(id) {
    if (db) {
      const row = (await db.query('SELECT m.*, COALESCE((SELECT SUM(value) FROM academy_chat_votes v WHERE v.message_id=m.id),0) AS score FROM academy_chat_messages m WHERE m.id=$1', [id])).rows[0];
      return row ? rowOut(row) : null;
    }
    const m = mem.find((x) => String(x.id) === String(id));
    return m ? memOut(m, '') : null;
  }
  async function add({ channel, discordId, authorName, body, parentId = null }) {
    if (db) {
      const row = (await db.query('INSERT INTO academy_chat_messages (channel, discord_id, author_name, body, parent_id) VALUES ($1,$2,$3,$4,$5) RETURNING *', [channel, discordId, authorName, body, parentId])).rows[0];
      return rowOut(row);
    }
    const createdAt = new Date().toISOString();
    const id = nextId++;
    mem.push({ id, channel, discordId, authorName, body, createdAt, parentId: parentId == null ? null : String(parentId), deleted: false });
    return memOut(mem[mem.length - 1], '');
  }
  /* Only the author can delete their own message. One that already has replies stays in its thread as "[deleted]" so the replies keep their place; returns { channel, soft } or null. */
  async function remove({ id, discordId }) {
    if (db) {
      const own = (await db.query('SELECT channel FROM academy_chat_messages WHERE id=$1 AND discord_id=$2 AND NOT deleted', [id, discordId])).rows[0];
      if (!own) return null;
      const kids = (await db.query('SELECT 1 FROM academy_chat_messages WHERE parent_id=$1 LIMIT 1', [id])).rows.length > 0;
      if (kids) await db.query("UPDATE academy_chat_messages SET deleted=TRUE, body='', author_name='' WHERE id=$1", [id]);
      else { await db.query('DELETE FROM academy_chat_votes WHERE message_id=$1', [id]); await db.query('DELETE FROM academy_chat_messages WHERE id=$1', [id]); }
      return { channel: String(own.channel), soft: kids };
    }
    const idx = mem.findIndex((m) => String(m.id) === String(id) && m.discordId === discordId && !m.deleted);
    if (idx < 0) return null;
    const m = mem[idx], channel = m.channel;
    if (mem.some((x) => x.parentId === String(m.id))) { m.deleted = true; m.body = ''; m.authorName = ''; return { channel, soft: true }; }
    mem.splice(idx, 1); memVotes.delete(String(m.id));
    return { channel, soft: false };
  }
  /* value 1, -1, or 0 to take a vote back. A member cannot vote on their own message or a deleted one. Returns { channel, score, myVote } or null. */
  async function vote({ id, voterId, value }) {
    const v = value === 1 ? 1 : value === -1 ? -1 : 0;
    const msg = await get(id);
    if (!msg || msg.deleted || msg.discordId === String(voterId)) return null;
    if (db) {
      if (v === 0) await db.query('DELETE FROM academy_chat_votes WHERE message_id=$1 AND voter_id=$2', [id, String(voterId)]);
      else await db.query('INSERT INTO academy_chat_votes (message_id, voter_id, value) VALUES ($1,$2,$3) ON CONFLICT (message_id, voter_id) DO UPDATE SET value=EXCLUDED.value', [id, String(voterId), v]);
      return { channel: msg.channel, score: (await get(id)).score, myVote: v };
    }
    const map = memVotes.get(String(id)) || new Map();
    if (v === 0) map.delete(String(voterId)); else map.set(String(voterId), v);
    memVotes.set(String(id), map);
    return { channel: msg.channel, score: scoreOf(id), myVote: v };
  }
  const reports = []; // memory mode: [{ messageId, reporterId }]
  /* Records a report of someone else's message; returns 'reported', 'duplicate' or null (no such message, or it is the reporter's own). */
  async function report({ id, reporterId }) {
    if (db) {
      const msg = (await db.query('SELECT id, channel, discord_id, body FROM academy_chat_messages WHERE id=$1', [id])).rows[0];
      if (!msg || String(msg.discord_id) === String(reporterId)) return null;
      const res = await db.query('INSERT INTO academy_chat_reports (message_id, channel, reporter_id, author_id, body) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (message_id, reporter_id) DO NOTHING RETURNING id', [msg.id, msg.channel, reporterId, msg.discord_id, msg.body]);
      return res.rows.length ? 'reported' : 'duplicate';
    }
    const msg = mem.find((m) => String(m.id) === String(id));
    if (!msg || msg.discordId === reporterId) return null;
    if (reports.some((r) => r.messageId === msg.id && r.reporterId === reporterId)) return 'duplicate';
    reports.push({ messageId: msg.id, reporterId });
    return 'reported';
  }
  return { history, get, add, remove, vote, report };
}

/* verifySession: the same shape as academyOAuth.verifySession — (authorizationHeaderString) => { ok, userId, tier } | { ok:false, ... } */
function createChatHub({ store, verifySession, logger = () => {}, now = Date.now, rateLimit = RATE_LIMIT, rateWindowMs = RATE_WINDOW_MS } = {}) {
  const byChannel = new Map(CHANNELS.map((c) => [c.key, new Set()])); // channel -> Set(conn)
  const hits = new Map(); // discordId -> [timestamps within the window]

  function withinRate(key, limit = rateLimit) {
    const list = (hits.get(key) || []).filter((t) => now() - t < rateWindowMs);
    list.push(now());
    hits.set(key, list);
    return list.length <= limit;
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
    return session.ok ? { userId: session.userId, tier: session.tier, displayName: session.displayName || '' } : null;
  }

  /* conn: { send(jsonString) }. identity: { userId, tier, displayName, authorName? } from
     authenticate(), optionally with a client-supplied authorName. The verified displayName (from
     the signed session) always wins; authorName only fills in for an older session that carries no
     name. Returns { receive(rawFrame), onClose() } for the transport layer to feed inbound frames
     and the close event into — nothing here touches a real socket, which is what makes it testable
     with a fake conn. */
  function open(conn, identity) {
    let channel = null;
    const authorName = cleanName(identity.displayName || identity.authorName);

    async function join(next) {
      if (!CHANNEL_KEYS.has(next)) { conn.send(JSON.stringify({ type: 'error', error: 'unknown_channel' })); return; }
      if (channel) (byChannel.get(channel) || new Set()).delete(conn);
      channel = next;
      byChannel.get(channel).add(conn);
      const messages = await store.history(channel, HISTORY, identity.userId).catch(() => []);
      conn.send(JSON.stringify({ type: 'history', channel, messages }));
    }
    async function post(body, parentId) {
      if (!channel) { conn.send(JSON.stringify({ type: 'error', error: 'join_first' })); return; }
      const clean = cleanBody(body);
      if (!clean) { conn.send(JSON.stringify({ type: 'error', error: 'empty_message' })); return; }
      if (!withinRate(identity.userId)) { conn.send(JSON.stringify({ type: 'error', error: 'rate_limited' })); return; }
      let parent = null;
      if (parentId != null && parentId !== '') {
        parent = await store.get(parentId).catch(() => null);
        if (!parent || parent.channel !== channel || parent.deleted) { conn.send(JSON.stringify({ type: 'error', error: 'reply_target_missing' })); return; }
        const chain = [parent]; // parent, its parent, ... up to the root; a reply sits one level below its parent
        while (chain[chain.length - 1].parentId && chain.length < 60) { const up = await store.get(chain[chain.length - 1].parentId).catch(() => null); if (!up) break; chain.push(up); }
        parent = chain[Math.max(0, chain.length - (MAX_DEPTH - 1))];
      }
      const row = await store.add({ channel, discordId: identity.userId, authorName, body: clean, parentId: parent ? parent.id : null });
      broadcast(channel, { type: 'message', channel, message: row });
    }
    async function remove(id) {
      const removed = await store.remove({ id, discordId: identity.userId }).catch(() => null);
      if (removed) broadcast(removed.channel, { type: 'deleted', channel: removed.channel, id: String(id), soft: removed.soft });
      else conn.send(JSON.stringify({ type: 'error', error: 'not_found' }));
    }
    async function vote(id, value) {
      if (!withinRate('v:' + identity.userId, 30)) { conn.send(JSON.stringify({ type: 'error', error: 'rate_limited' })); return; }
      const res = await store.vote({ id, voterId: identity.userId, value: Number(value) }).catch(() => null);
      if (!res) { conn.send(JSON.stringify({ type: 'error', error: 'cannot_vote' })); return; }
      broadcast(res.channel, { type: 'vote', channel: res.channel, id: String(id), score: res.score });
      conn.send(JSON.stringify({ type: 'voted', id: String(id), myVote: res.myVote, score: res.score }));
    }
    async function report(id) {
      if (!store.report) { conn.send(JSON.stringify({ type: 'error', error: 'unknown_type' })); return; }
      const result = await store.report({ id, reporterId: identity.userId }).catch(() => null);
      if (!result) { conn.send(JSON.stringify({ type: 'error', error: 'not_found' })); return; }
      if (result === 'reported') logger('warn', 'academy_chat_message_reported', { messageId: String(id), reporterId: identity.userId });
      conn.send(JSON.stringify({ type: 'reported', id: String(id) }));
    }
    /* Returns the in-flight promise so a caller that wants to know when a frame has been fully
       handled (tests; anything awaiting delivery) can await it. The real ws transport ignores the
       return value — a WebSocket 'message' handler is fire-and-forget either way. */
    function receive(raw) {
      let msg; try { msg = JSON.parse(raw); } catch (_) { conn.send(JSON.stringify({ type: 'error', error: 'invalid_json' })); return null; }
      if (msg && msg.type === 'join') return join(String(msg.channel || ''));
      if (msg && msg.type === 'message') return post(msg.body, msg.parentId);
      if (msg && msg.type === 'vote') return vote(msg.id, msg.value);
      if (msg && msg.type === 'delete') return remove(msg.id);
      if (msg && msg.type === 'report') return report(msg.id);
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
    identity.authorName = url.searchParams.get('name') || ''; // fallback only: hub.open prefers the session's verified displayName
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
