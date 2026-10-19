'use strict';

/*
 * Trading Wall: comments members leave on each other's Academy profile pages.
 *
 * Any signed-in member can post on any member's wall (their own included) unless that member has switched the wall off
 * (profile flag showWall=false). A comment can be removed by its author, by the owner of the wall it sits on, and by the
 * Academy owners. Removed comments are kept with a deleted_at mark so moderation can be audited, and never shown again.
 * Posting is rate limited per author so one member cannot flood a wall. Plain text only; the page escapes it when drawing.
 */

const SNOWFLAKE = /^\d{15,25}$/;
const MAX_BODY = 500;
const cleanBody = (v) => String(v || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_BODY);
const cleanName = (v) => String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);

function createProfileWall({ pool = null, now = Date.now, logger = () => {}, perMinute = 3, perHour = 20, limitDefault = 20, limitMax = 50 } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = []; // { id, profileId, authorId, authorName, body, createdAt, deletedAt, deletedBy }
  const recent = new Map(); // authorId -> [ms]
  let seq = 0;

  async function ensureSchema() {
    if (!db) return;
    try {
      await db.query('CREATE TABLE IF NOT EXISTS academy_profile_wall (id BIGSERIAL PRIMARY KEY, profile_id TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL DEFAULT \'\', body TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ, deleted_by TEXT)');
      await db.query('CREATE INDEX IF NOT EXISTS academy_profile_wall_profile_idx ON academy_profile_wall (profile_id, id DESC)');
    } catch (error) { logger('warn', 'academy_profile_wall_schema_failed', { error: String(error && error.message || error) }); }
  }

  const iso = (v) => (v instanceof Date ? v.toISOString() : typeof v === 'number' ? new Date(v).toISOString() : String(v));
  const out = (r) => ({ id: String(r.id), profileId: String(r.profile_id), authorId: String(r.author_id), authorName: String(r.author_name || ''), body: String(r.body), createdAt: iso(r.created_at) });
  const memOut = (m) => out({ id: m.id, profile_id: m.profileId, author_id: m.authorId, author_name: m.authorName, body: m.body, created_at: m.createdAt });

  function allowed(authorId) {
    const t = now(), list = (recent.get(authorId) || []).filter((x) => t - x < 3_600_000);
    recent.set(authorId, list);
    if (list.filter((x) => t - x < 60_000).length >= perMinute) return 'slow_down';
    if (list.length >= perHour) return 'too_many_today';
    return '';
  }

  /** A new comment on profileId's wall. */
  async function post(profileId, authorId, authorName, bodyRaw) {
    const pid = String(profileId), aid = String(authorId);
    if (!SNOWFLAKE.test(pid) || !SNOWFLAKE.test(aid)) return { ok: false, error: 'invalid_user' };
    const body = cleanBody(bodyRaw);
    if (!body) return { ok: false, error: 'empty' };
    const why = allowed(aid); if (why) return { ok: false, error: why };
    // the same words twice in a row on the same wall is a double tap, not a second comment
    const last = await latestBy(pid, aid);
    if (last && last.body === body && now() - Date.parse(last.createdAt) < 600_000) return { ok: true, item: last, duplicate: true };
    recent.get(aid).push(now());
    const name = cleanName(authorName) || 'Member';
    if (db) {
      const r = await db.query('INSERT INTO academy_profile_wall (profile_id, author_id, author_name, body) VALUES ($1,$2,$3,$4) RETURNING id, profile_id, author_id, author_name, body, created_at', [pid, aid, name, body]);
      return { ok: true, item: out(r.rows[0]) };
    }
    const m = { id: String(++seq), profileId: pid, authorId: aid, authorName: name, body, createdAt: new Date(now()).toISOString(), deletedAt: null, deletedBy: null };
    mem.push(m);
    return { ok: true, item: memOut(m) };
  }

  async function latestBy(profileId, authorId) {
    if (db) {
      const r = await db.query('SELECT id, profile_id, author_id, author_name, body, created_at FROM academy_profile_wall WHERE profile_id=$1 AND author_id=$2 AND deleted_at IS NULL ORDER BY id DESC LIMIT 1', [profileId, authorId]);
      return r.rows[0] ? out(r.rows[0]) : null;
    }
    for (let i = mem.length - 1; i >= 0; i--) if (mem[i].profileId === profileId && mem[i].authorId === authorId && !mem[i].deletedAt) return memOut(mem[i]);
    return null;
  }

  /** Newest first; `before` (a comment id) pages further back. */
  async function list(profileId, { limit = limitDefault, before = '' } = {}) {
    const pid = String(profileId); if (!SNOWFLAKE.test(pid)) return { items: [], count: 0, more: false };
    const n = Math.max(1, Math.min(limitMax, Number(limit) || limitDefault));
    const cursor = /^\d+$/.test(String(before || '')) ? String(before) : '';
    if (db) {
      const [rows, count] = await Promise.all([
        db.query(`SELECT id, profile_id, author_id, author_name, body, created_at FROM academy_profile_wall WHERE profile_id=$1 AND deleted_at IS NULL ${cursor ? 'AND id < $3' : ''} ORDER BY id DESC LIMIT $2`, cursor ? [pid, n + 1, cursor] : [pid, n + 1]),
        db.query('SELECT count(*)::int AS n FROM academy_profile_wall WHERE profile_id=$1 AND deleted_at IS NULL', [pid])
      ]);
      const items = rows.rows.slice(0, n).map(out);
      return { items, count: Number(count.rows[0] && count.rows[0].n) || 0, more: rows.rows.length > n };
    }
    const all = mem.filter((m) => m.profileId === pid && !m.deletedAt && (!cursor || Number(m.id) < Number(cursor))).sort((a, b) => Number(b.id) - Number(a.id));
    return { items: all.slice(0, n).map(memOut), count: mem.filter((m) => m.profileId === pid && !m.deletedAt).length, more: all.length > n };
  }

  /** Author, wall owner (profileId === byUserId) or an elevated caller may remove a comment. */
  async function remove(id, byUserId, { profileId = '', elevated = false } = {}) {
    const cid = String(id), by = String(byUserId);
    if (!/^\d+$/.test(cid) || !SNOWFLAKE.test(by)) return { ok: false, error: 'invalid_request' };
    const may = (row) => elevated || row.authorId === by || row.profileId === by || (profileId && row.profileId === String(profileId) && String(profileId) === by);
    if (db) {
      const r = await db.query('SELECT id, profile_id, author_id, author_name, body, created_at FROM academy_profile_wall WHERE id=$1 AND deleted_at IS NULL', [cid]);
      if (!r.rows[0]) return { ok: false, error: 'not_found' };
      if (!may(out(r.rows[0]))) return { ok: false, error: 'forbidden' };
      await db.query('UPDATE academy_profile_wall SET deleted_at=now(), deleted_by=$2 WHERE id=$1', [cid, by]);
      return { ok: true };
    }
    const m = mem.find((x) => x.id === cid && !x.deletedAt);
    if (!m) return { ok: false, error: 'not_found' };
    if (!may(memOut(m))) return { ok: false, error: 'forbidden' };
    m.deletedAt = new Date(now()).toISOString(); m.deletedBy = by;
    return { ok: true };
  }

  return { ensureSchema, post, list, remove, MAX_BODY };
}

module.exports = { createProfileWall, cleanBody, MAX_BODY };
