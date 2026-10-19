'use strict';

/* The engagement layer: what gets members talking in the comments and following each other.
 *  - suggest(viewer): traders to follow, ranked by what they did this week (alerts posted, Ticker Talk comments, followers,
 *    an active Alert Chart), never the viewer and never someone already followed; a one-line reason per trader.
 *  - following(viewer): one stream of what the traders a member follows said and posted (comments across every ticker,
 *    alerts from their charts), newest first.
 *  - inbox(viewer, since): what happened to the member since they last looked: replies to their comments, new followers,
 *    targets smashed on charts they follow. The page turns these into toasts with a one-tap action.
 *  - follow(viewer, user, on): one Follow does both: the profile follow (the Academy feed and the followers count) and the
 *    Alert Chart follow (their alerts in the Traders tab), without the push until the member asks for it.
 * Everything is read-only aggregation over the talk, profile and alert services; bounded and cached briefly. */

const SNOWFLAKE = /^\d{15,25}$/;
const DAY_MS = 86_400_000;

function createCommunity({ talk = null, alerts = null, profiles = null, names = null, now = Date.now, logger = () => {}, ttlMs = 120_000 } = {}) {
  const cache = new Map();
  const memo = async (key, fn) => { const hit = cache.get(key); if (hit && now() - hit.at < ttlMs) return hit.value; const value = await fn(); cache.set(key, { at: now(), value }); if (cache.size > 500) cache.delete(cache.keys().next().value); return value; };
  const safe = async (fn, fallback) => { try { const v = await Promise.race([fn(), new Promise((r) => setTimeout(() => r(fallback), 5_000))]); return v == null ? fallback : v; } catch (error) { logger('warn', 'academy_community_source_failed', { error: String((error && error.message) || error) }); return fallback; } };
  const nameOf = async (id) => { if (typeof names !== 'function') return ''; try { return String((await names(id)) || '').slice(0, 60); } catch (_) { return ''; } };

  async function followedBy(viewerId) {
    const me = String(viewerId || ''); if (!SNOWFLAKE.test(me)) return new Set();
    const [prof, al] = await Promise.all([
      profiles && typeof profiles.followingOf === 'function' ? safe(() => profiles.followingOf(me), []) : [],
      alerts && typeof alerts.followingOf === 'function' ? safe(() => alerts.followingOf(me), []) : []
    ]);
    return new Set([...prof, ...al].map(String));
  }

  /* the week's ranking, shared by every viewer; the viewer's own exclusions are applied on top */
  async function ranking() {
    return memo('ranking', async () => {
      const [talkers, alertRows, followed] = await Promise.all([
        talk && typeof talk.recentAuthors === 'function' ? safe(() => talk.recentAuthors(7, 40), []) : [],
        alerts && typeof alerts.feed === 'function' ? safe(() => alerts.feed('', { limit: 100 }), { alerts: [] }) : { alerts: [] },
        profiles && typeof profiles.topFollowed === 'function' ? safe(() => profiles.topFollowed(40), []) : []
      ]);
      const rows = new Map();
      const row = (id) => { if (!rows.has(id)) rows.set(id, { id, name: '', comments: 0, alerts: 0, followers: 0, lastAlertAt: 0 }); return rows.get(id); };
      for (const t of talkers) { const r = row(String(t.id)); r.comments = Number(t.comments) || 0; if (t.name) r.name = t.name; }
      const weekAgo = now() - 7 * DAY_MS;
      for (const a of (alertRows.alerts || [])) { const r = row(String(a.authorId)); if (Date.parse(a.createdAt) >= weekAgo) r.alerts += 1; r.lastAlertAt = Math.max(r.lastAlertAt, Date.parse(a.createdAt) || 0); if (a.authorName) r.name = a.authorName; }
      for (const f of followed) { const r = row(String(f.id)); r.followers = Number(f.followers) || 0; }
      const out = [...rows.values()].map((r) => ({ ...r, score: r.alerts * 3 + r.comments + Math.min(20, r.followers) * 0.5 + (r.lastAlertAt && now() - r.lastAlertAt < 30 * DAY_MS ? 2 : 0) })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 60);
      for (const r of out) if (!r.name) r.name = await nameOf(r.id);
      return out;
    });
  }
  function reasonFor(r) {
    const parts = [];
    if (r.alerts) parts.push(r.alerts + (r.alerts === 1 ? ' alert' : ' alerts') + ' this week');
    if (r.comments) parts.push(r.comments + (r.comments === 1 ? ' comment' : ' comments') + ' this week');
    if (r.followers) parts.push(r.followers + (r.followers === 1 ? ' follower' : ' followers'));
    return parts.slice(0, 2).join(' · ') || 'active in the Academy';
  }
  async function suggest(viewerId, { limit = 6 } = {}) {
    const me = String(viewerId || '');
    const [rank, mine] = await Promise.all([ranking(), followedBy(me)]);
    const n = Math.max(1, Math.min(20, Number(limit) || 6));
    const out = rank.filter((r) => r.id !== me && !mine.has(r.id)).slice(0, n).map((r) => ({ id: r.id, name: r.name || 'Academy trader', comments: r.comments, alerts: r.alerts, followers: r.followers, reason: reasonFor(r) }));
    return { ok: true, traders: out, following: mine.size, asOf: now() };
  }

  async function following(viewerId, { limit = 40 } = {}) {
    const me = String(viewerId || ''); if (!SNOWFLAKE.test(me)) return { ok: false, error: 'invalid_user' };
    const ids = [...(await followedBy(me))];
    const n = Math.max(1, Math.min(100, Number(limit) || 40));
    if (!ids.length) return { ok: true, items: [], following: 0, asOf: now() };
    const [comments, feed] = await Promise.all([
      talk && typeof talk.byAuthors === 'function' ? safe(() => talk.byAuthors(ids, n), []) : [],
      alerts && typeof alerts.feed === 'function' ? safe(() => alerts.feed(me, { limit: n }), { alerts: [] }) : { alerts: [] }
    ]);
    const names_ = new Map();
    const items = [];
    for (const c of comments) items.push({ kind: 'comment', at: c.createdAt, authorId: c.authorId, authorName: c.authorName || '', symbol: c.symbol, id: c.id, parentId: c.parentId || null, body: String(c.body || '').slice(0, 400), replyCount: c.replyCount || 0, images: Array.isArray(c.images) ? c.images.length : 0 });
    for (const a of (feed.alerts || [])) if (ids.includes(String(a.authorId))) items.push({ kind: 'alert', at: a.updates && a.updates.length ? a.updates[a.updates.length - 1].createdAt : a.createdAt, authorId: a.authorId, authorName: a.authorName || '', symbol: a.symbol, id: a.id, locked: Boolean(a.locked), side: a.side, status: a.status, metrics: a.metrics, lastUpdate: a.updates && a.updates.length ? a.updates[a.updates.length - 1] : null });
    for (const it of items) if (!it.authorName) { if (!names_.has(it.authorId)) names_.set(it.authorId, await nameOf(it.authorId)); it.authorName = names_.get(it.authorId); }
    items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return { ok: true, items: items.slice(0, n), following: ids.length, asOf: now() };
  }

  async function inbox(viewerId, { since = '' } = {}) {
    const me = String(viewerId || ''); if (!SNOWFLAKE.test(me)) return { ok: false, error: 'invalid_user' };
    const sinceIso = since && Date.parse(since) ? new Date(Date.parse(since)).toISOString() : new Date(now() - 2 * DAY_MS).toISOString();
    const [replies, newFollowers, feed] = await Promise.all([
      talk && typeof talk.repliesTo === 'function' ? safe(() => talk.repliesTo(me, sinceIso, 20), []) : [],
      profiles && typeof profiles.followersSince === 'function' ? safe(() => profiles.followersSince(me, sinceIso, 20), []) : [],
      alerts && typeof alerts.feed === 'function' ? safe(() => alerts.feed(me, { limit: 60 }), { alerts: [] }) : { alerts: [] }
    ]);
    const events = [];
    for (const r of replies) events.push({ kind: 'reply', at: r.createdAt, from: r.authorId, fromName: r.authorName || '', symbol: r.symbol, commentId: r.id, rootId: r.parentId || r.id, body: String(r.body || '').slice(0, 160) });
    for (const f of newFollowers) events.push({ kind: 'follow', at: f.at, from: f.id, fromName: await nameOf(f.id) });
    const sinceMs = Date.parse(sinceIso);
    for (const a of (feed.alerts || [])) {
      if (!a.followed || a.locked || a.authorId === me) continue;
      for (const u of (a.updates || [])) if (Date.parse(u.createdAt) > sinceMs && (u.kind === 'pt_hit' || u.kind === 'close')) events.push({ kind: u.kind === 'pt_hit' ? 'pt_hit' : 'closed', at: u.createdAt, from: a.authorId, fromName: a.authorName || '', symbol: a.symbol, alertId: a.id, pct: a.metrics ? a.metrics.peakPct : null, body: String(u.body || '').slice(0, 120) });
      if (Date.parse(a.createdAt) > sinceMs) events.push({ kind: 'alert', at: a.createdAt, from: a.authorId, fromName: a.authorName || '', symbol: a.symbol, alertId: a.id, side: a.side });
    }
    events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
    return { ok: true, events: events.slice(0, 30), asOf: now() };
  }

  async function follow(viewerId, userId, on = true) {
    const me = String(viewerId || ''), who = String(userId || '');
    if (!SNOWFLAKE.test(me) || !SNOWFLAKE.test(who) || me === who) return { ok: false, error: 'invalid_user' };
    const [p, a] = await Promise.all([
      profiles && typeof profiles.follow === 'function' ? safe(() => profiles.follow(me, who, on), null) : null,
      alerts && typeof alerts.follow === 'function' ? safe(() => alerts.follow(me, who, { on, push: null }), null) : null
    ]);
    cache.delete('ranking');
    return { ok: true, following: Boolean(on), followers: p && p.followers != null ? p.followers : (a ? a.followers : null) };
  }

  return { suggest, following, inbox, follow, ranking };
}

module.exports = { createCommunity };
