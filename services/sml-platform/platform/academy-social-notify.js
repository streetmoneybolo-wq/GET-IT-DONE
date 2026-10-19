'use strict';

/* Academy social notifications: what a member needs to hear about, shown in their LOOP-KICK (academy-social-notify-ui.js).
 *
 * One row per thing that happened to a member, newest first, with an unread mark:
 *   follow        someone started following them
 *   wall_comment  someone wrote on their Trading Wall
 *   post          someone they follow posted (a root Ticker Talk comment on a ticker, or a message in a live chat room)
 *   like          someone liked their comment (Ticker Talk or Trading Wall)
 *   reply         someone replied to their Ticker Talk comment
 * Likes live here too (academy_likes: one row per member per item), since a like is what makes a 'like' notification.
 *
 * Rules: a member is never notified about their own action; the same actor doing the same thing to the same item within
 * ten minutes is one notification (a follow, unfollow, follow again is one row); each member keeps the newest `keep` rows;
 * a 'post' fans out to the author's followers, capped at `fanout`. Postgres when a pool is given (migration 055), memory
 * otherwise. Nothing here writes to Discord. */

const SNOWFLAKE = /^\d{15,25}$/;
const KINDS = new Set(['follow', 'wall_comment', 'post', 'like', 'reply']);
const LIKE_KINDS = new Set(['talk', 'wall']);
const DEDUPE_MS = 10 * 60_000;
const cleanName = (v) => String(v || '').replace(/[\u0000-\u001f<>@]/g, '').trim().slice(0, 80);
const excerpt = (v, n = 160) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);

function createSocialNotify({ pool = null, profiles = null, talk = null, wall = null, names = null, now = Date.now, logger = () => {}, keep = 200, fanout = 500 } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = []; // { id, userId, kind, actorId, actorName, ref, body, createdAt, readAt }
  const memLikes = new Map(); // kind:item -> Map(userId -> at)
  let seq = 0;

  async function ensureSchema() {
    if (!db) return;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS academy_notifications (id BIGSERIAL PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, actor_id TEXT NOT NULL DEFAULT '', actor_name TEXT NOT NULL DEFAULT '',
        ref JSONB NOT NULL DEFAULT '{}', body TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now(), read_at TIMESTAMPTZ)`);
      await db.query('CREATE INDEX IF NOT EXISTS academy_notifications_user_idx ON academy_notifications (user_id, id DESC)');
      await db.query('CREATE TABLE IF NOT EXISTS academy_likes (kind TEXT NOT NULL, item_id TEXT NOT NULL, user_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (kind, item_id, user_id))');
    } catch (error) { logger('warn', 'academy_social_notify_schema_failed', { error: String(error && error.message || error) }); }
  }

  const iso = (v) => (v instanceof Date ? v.toISOString() : typeof v === 'number' ? new Date(v).toISOString() : String(v));
  const refOf = (v) => { if (v && typeof v === 'object') return v; try { return JSON.parse(v || '{}') || {}; } catch (_) { return {}; } };
  const out = (r) => ({ id: String(r.id), kind: String(r.kind), actorId: String(r.actor_id || ''), actorName: String(r.actor_name || ''), ref: refOf(r.ref), body: String(r.body || ''), createdAt: iso(r.created_at), read: !!r.read_at });
  const memOut = (m) => out({ id: m.id, kind: m.kind, actor_id: m.actorId, actor_name: m.actorName, ref: m.ref, body: m.body, created_at: m.createdAt, read_at: m.readAt });
  /* the Academy profile name first (what other members know them by), the caller's name (the session's) as the fallback */
  const nameOf = async (id, given) => { let v = ''; if (typeof names === 'function' && SNOWFLAKE.test(String(id || ''))) { try { v = cleanName(await names(id)); } catch (_) { v = ''; } } return v || cleanName(given); };

  /* One notification for userId. Skips the member's own actions and a repeat of the same thing inside DEDUPE_MS. */
  async function add({ userId, kind, actor = {}, ref = {}, body = '' } = {}) {
    const uid = String(userId || ''), aid = String(actor.id || '');
    if (!SNOWFLAKE.test(uid) || !KINDS.has(kind)) return { ok: false, error: 'invalid_notification' };
    if (aid && aid === uid) return { ok: true, skipped: 'self' };
    const actorName = await nameOf(aid, actor.name);
    const key = JSON.stringify({ k: kind, a: aid, i: ref && ref.id != null ? String(ref.id) : '', s: ref && ref.symbol ? String(ref.symbol) : '', r: ref && ref.room ? String(ref.room) : '' });
    const since = now() - DEDUPE_MS;
    const text = excerpt(body);
    if (db) {
      try {
        const dup = await db.query(`SELECT id FROM academy_notifications WHERE user_id=$1 AND kind=$2 AND actor_id=$3 AND created_at > $4 AND COALESCE(ref->>'id','') = $5 AND COALESCE(ref->>'symbol','') = $6 AND COALESCE(ref->>'room','') = $7 LIMIT 1`,
          [uid, kind, aid, new Date(since), ref && ref.id != null ? String(ref.id) : '', ref && ref.symbol ? String(ref.symbol) : '', ref && ref.room ? String(ref.room) : '']);
        if (dup.rows[0]) return { ok: true, skipped: 'duplicate', id: String(dup.rows[0].id) };
        const r = await db.query('INSERT INTO academy_notifications (user_id, kind, actor_id, actor_name, ref, body) VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *', [uid, kind, aid, actorName, JSON.stringify(ref || {}), text]);
        // keep the newest `keep` rows per member; the trim is best effort
        db.query('DELETE FROM academy_notifications WHERE user_id=$1 AND id < (SELECT id FROM academy_notifications WHERE user_id=$1 ORDER BY id DESC OFFSET $2 LIMIT 1)', [uid, keep]).catch(() => {});
        return { ok: true, item: out(r.rows[0]) };
      } catch (error) { logger('warn', 'academy_social_notify_write_failed', { kind, error: String(error && error.message || error) }); return { ok: false, error: 'storage_unavailable' }; }
    }
    const dup = mem.find((m) => m.userId === uid && m.key === key && Date.parse(m.createdAt) > since);
    if (dup) return { ok: true, skipped: 'duplicate', id: dup.id };
    const m = { id: String(++seq), userId: uid, kind, actorId: aid, actorName, ref: ref || {}, body: text, createdAt: new Date(now()).toISOString(), readAt: null, key };
    mem.push(m);
    const mine = mem.filter((x) => x.userId === uid);
    if (mine.length > keep) { const drop = new Set(mine.slice(0, mine.length - keep).map((x) => x.id)); for (let i = mem.length - 1; i >= 0; i--) if (drop.has(mem[i].id)) mem.splice(i, 1); }
    return { ok: true, item: memOut(m) };
  }

  /* ---- the four things, plus replies ---- */
  async function follow(followerId, followedId, followerName = '') {
    return add({ userId: followedId, kind: 'follow', actor: { id: followerId, name: followerName }, ref: { id: String(followerId) } });
  }
  async function wallComment(wallOwnerId, comment = {}) {
    return add({ userId: wallOwnerId, kind: 'wall_comment', actor: { id: comment.authorId, name: comment.authorName }, ref: { id: String(comment.id || ''), profileId: String(wallOwnerId) }, body: comment.body });
  }
  /* a root post by `author`: every follower hears about it (source 'talk' carries the symbol, 'chat' the room) */
  async function followedPost(author = {}, post = {}) {
    const aid = String(author.id || ''); if (!SNOWFLAKE.test(aid)) return { ok: false, error: 'invalid_user' };
    if (!profiles || typeof profiles.followers !== 'function') return { ok: true, sent: 0 };
    let ids = [];
    try { ids = (await profiles.followers(aid, fanout)) || []; } catch (error) { logger('warn', 'academy_social_notify_followers_failed', { error: String(error && error.message || error) }); return { ok: false, error: 'storage_unavailable' }; }
    const actorName = await nameOf(aid, author.name);
    const ref = { id: String(post.id || ''), source: post.source === 'chat' ? 'chat' : 'talk' };
    if (post.symbol) ref.symbol = String(post.symbol).toUpperCase().slice(0, 12);
    if (post.room) ref.room = String(post.room).slice(0, 40);
    let sent = 0;
    for (const id of ids) { const r = await add({ userId: id, kind: 'post', actor: { id: aid, name: actorName }, ref, body: post.body }); if (r.ok && r.item) sent += 1; }
    return { ok: true, sent, followers: ids.length };
  }
  async function reply(parentAuthorId, comment = {}) {
    return add({ userId: parentAuthorId, kind: 'reply', actor: { id: comment.authorId, name: comment.authorName }, ref: { id: String(comment.id || ''), rootId: String(comment.parentId || comment.id || ''), symbol: String(comment.symbol || '').toUpperCase() }, body: comment.body });
  }

  /* ---- likes ---- */
  async function itemOf(kind, itemId) {
    const id = String(itemId || ''); if (!/^\d+$/.test(id)) return null;
    try {
      if (kind === 'talk' && talk && typeof talk.get === 'function') { const c = await talk.get(id); return c ? { authorId: c.authorId, authorName: c.authorName, body: c.body, symbol: c.symbol, rootId: c.parentId || c.id } : null; }
      if (kind === 'wall' && wall && typeof wall.get === 'function') { const c = await wall.get(id); return c ? { authorId: c.authorId, authorName: c.authorName, body: c.body, profileId: c.profileId } : null; }
    } catch (error) { logger('warn', 'academy_social_notify_item_failed', { kind, error: String(error && error.message || error) }); }
    return null;
  }
  async function countLikes(kind, itemId, viewerId = '') {
    const id = String(itemId);
    if (db) {
      const r = await db.query('SELECT count(*)::int AS n, bool_or(user_id=$3) AS me FROM academy_likes WHERE kind=$1 AND item_id=$2', [kind, id, String(viewerId || '')]);
      return { likes: Number(r.rows[0] && r.rows[0].n) || 0, liked: !!(r.rows[0] && r.rows[0].me) };
    }
    const set = memLikes.get(kind + ':' + id) || new Map();
    return { likes: set.size, liked: set.has(String(viewerId || '')) };
  }
  /** like (on=true) or unlike an item; the item's author hears about a new like */
  async function like(kind, itemId, user = {}, on = true) {
    const uid = String(user.id || ''), id = String(itemId || '');
    if (!LIKE_KINDS.has(kind) || !/^\d+$/.test(id) || !SNOWFLAKE.test(uid)) return { ok: false, error: 'invalid_like' };
    const item = await itemOf(kind, id);
    if (!item) return { ok: false, error: 'not_found' };
    let fresh = false;
    if (db) {
      try {
        if (on) { const r = await db.query('INSERT INTO academy_likes (kind, item_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING user_id', [kind, id, uid]); fresh = r.rows.length > 0; }
        else await db.query('DELETE FROM academy_likes WHERE kind=$1 AND item_id=$2 AND user_id=$3', [kind, id, uid]);
      } catch (error) { logger('warn', 'academy_social_notify_like_failed', { error: String(error && error.message || error) }); return { ok: false, error: 'storage_unavailable' }; }
    } else {
      const key = kind + ':' + id; if (!memLikes.has(key)) memLikes.set(key, new Map());
      const set = memLikes.get(key);
      if (on) { fresh = !set.has(uid); set.set(uid, now()); } else set.delete(uid);
    }
    if (fresh && item.authorId && String(item.authorId) !== uid) {
      const ref = { id, kind, symbol: item.symbol || '', rootId: item.rootId || '', profileId: item.profileId || '' };
      await add({ userId: item.authorId, kind: 'like', actor: { id: uid, name: user.name }, ref, body: item.body });
    }
    const c = await countLikes(kind, id, uid);
    return { ok: true, kind, id, liked: on && c.liked, likes: c.likes };
  }
  /** like counts for many items at once: { [id]: { likes, liked } } */
  async function likesFor(kind, ids = [], viewerId = '') {
    const list = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter((x) => /^\d+$/.test(x)))].slice(0, 300);
    const outMap = {};
    if (!LIKE_KINDS.has(kind) || !list.length) return outMap;
    for (const id of list) outMap[id] = { likes: 0, liked: false };
    if (db) {
      try {
        const r = await db.query('SELECT item_id, count(*)::int AS n, bool_or(user_id=$3) AS me FROM academy_likes WHERE kind=$1 AND item_id = ANY($2::text[]) GROUP BY item_id', [kind, list, String(viewerId || '')]);
        for (const row of r.rows) outMap[String(row.item_id)] = { likes: Number(row.n) || 0, liked: !!row.me };
      } catch (error) { logger('warn', 'academy_social_notify_like_read_failed', { error: String(error && error.message || error) }); }
      return outMap;
    }
    for (const id of list) { const set = memLikes.get(kind + ':' + id); if (set) outMap[id] = { likes: set.size, liked: set.has(String(viewerId || '')) }; }
    return outMap;
  }

  /* ---- reading ---- */
  async function unread(userId) {
    const uid = String(userId || ''); if (!SNOWFLAKE.test(uid)) return 0;
    if (db) { try { const r = await db.query('SELECT count(*)::int AS n FROM academy_notifications WHERE user_id=$1 AND read_at IS NULL', [uid]); return Number(r.rows[0] && r.rows[0].n) || 0; } catch (_) { return 0; } }
    return mem.filter((m) => m.userId === uid && !m.readAt).length;
  }
  /** newest first; `before` (an id) pages further back */
  async function list(userId, { limit = 30, before = '' } = {}) {
    const uid = String(userId || ''); if (!SNOWFLAKE.test(uid)) return { ok: false, error: 'invalid_user', items: [], unread: 0, more: false };
    const n = Math.max(1, Math.min(100, Number(limit) || 30));
    const cursor = /^\d+$/.test(String(before || '')) ? String(before) : '';
    let items, more;
    if (db) {
      try {
        const r = await db.query(`SELECT * FROM academy_notifications WHERE user_id=$1 ${cursor ? 'AND id < $3' : ''} ORDER BY id DESC LIMIT $2`, cursor ? [uid, n + 1, cursor] : [uid, n + 1]);
        items = r.rows.slice(0, n).map(out); more = r.rows.length > n;
      } catch (error) { logger('warn', 'academy_social_notify_read_failed', { error: String(error && error.message || error) }); return { ok: false, error: 'storage_unavailable', items: [], unread: 0, more: false }; }
    } else {
      const all = mem.filter((m) => m.userId === uid && (!cursor || Number(m.id) < Number(cursor))).sort((a, b) => Number(b.id) - Number(a.id));
      items = all.slice(0, n).map(memOut); more = all.length > n;
    }
    return { ok: true, items, unread: await unread(uid), more, asOf: now() };
  }
  /** mark some ids (or everything) read */
  async function markRead(userId, { ids = null, all = false } = {}) {
    const uid = String(userId || ''); if (!SNOWFLAKE.test(uid)) return { ok: false, error: 'invalid_user' };
    const list_ = Array.isArray(ids) ? [...new Set(ids.map(String).filter((x) => /^\d+$/.test(x)))].slice(0, 300) : [];
    if (!all && !list_.length) return { ok: true, unread: await unread(uid) };
    if (db) {
      try { if (all) await db.query('UPDATE academy_notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL', [uid]); else await db.query('UPDATE academy_notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL AND id = ANY($2::bigint[])', [uid, list_]); }
      catch (error) { logger('warn', 'academy_social_notify_read_failed', { error: String(error && error.message || error) }); return { ok: false, error: 'storage_unavailable' }; }
    } else {
      const set = new Set(list_), at = new Date(now()).toISOString();
      for (const m of mem) if (m.userId === uid && !m.readAt && (all || set.has(m.id))) m.readAt = at;
    }
    return { ok: true, unread: await unread(uid) };
  }

  return { configured: !!db, ensureSchema, add, follow, wallComment, followedPost, reply, like, likesFor, list, unread, markRead, KINDS: [...KINDS], LIKE_KINDS: [...LIKE_KINDS] };
}

module.exports = { createSocialNotify, KINDS: [...KINDS], LIKE_KINDS: [...LIKE_KINDS], DEDUPE_MS };
