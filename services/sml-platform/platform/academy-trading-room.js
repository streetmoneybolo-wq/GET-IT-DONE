'use strict';

/* TRADING ROOM: a trader's own room behind their profile page, a small Discord server inside the Academy that is easier to
 * use. The profile is the front door; the room is what is behind it.
 *
 *   Roles (like a server's roles, but only the ones that matter):
 *     visitor  not following: sees the profile, the public channels, and the locked channels with what unlocks them
 *     member   follows the trader (free, like the everyone role): reads and chats in the channels the owner marked "members"
 *     paid     holds an active paid grant on a tier: also the channels marked "paid" (or "this tier and up")
 *     owner    the trader: everything, plus the room settings, moderation and the member list
 *
 *   A room is categories of channels. Each channel has a type (announcements, chat, notes, alerts) and an access level
 *   (public, members, paid, and for paid an optional lowest tier). Tiers are the owner's own paid levels with their own prices;
 *   a higher tier includes everything below it. The owner chooses every name, channel, level and price; templates only pre-fill
 *   the layout, and the advice list says in plain words what is missing before the room can sell.
 *
 *   Money is not handled here: a tier is sold through the Alert Chart checkout (alert-chart-billing.js, Stripe Connect through
 *   stockmarketloop.com), which asks offerFor() for the price and records the tier on the grant. Alerts channels reuse the Alert
 *   Chart (academy-trader-alerts.js): the room keeps that chart's channels and their locks in step with its own access levels.
 *   Posts in this room are members' opinions, not advice; nothing here places a trade. */

const SNOWFLAKE = /^\d{15,25}$/;
const PLANS = ['day', 'week', 'month', 'year', 'lifetime'];
const TYPES = ['announce', 'chat', 'notes', 'alerts'];
const ACCESS = ['public', 'members', 'paid'];
const MAX_CATEGORIES = 8, MAX_CHANNELS = 30, MAX_TIERS = 4, MAX_ALERT_CHANNELS = 6, MAX_BANNED = 200, MAX_POST = 1500, MAX_PERKS = 6, KEEP_POSTS = 400;
const MIN_PRICE_CENTS = 100, MAX_PRICE_CENTS = 100_000_00;

const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const body = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim().slice(0, max);
const key = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
const int = (v, d = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : d; };

function defaultRoom() { return { enabled: false, name: '', tagline: '', about: '', memberRole: 'Member', tiers: [], categories: [], banned: [], updatedAt: 0 }; }

/** Normalise whatever the owner sent into a safe room. Fields not sent keep their current value; lists sent are replaced whole. */
function cleanRoom(input, base = defaultRoom()) {
  const out = JSON.parse(JSON.stringify(base));
  if (!input || typeof input !== 'object') return out;
  if (input.enabled !== undefined) out.enabled = Boolean(input.enabled);
  if (input.name !== undefined) out.name = text(input.name, 60);
  if (input.tagline !== undefined) out.tagline = text(input.tagline, 120);
  if (input.about !== undefined) out.about = body(input.about, 700);
  if (input.memberRole !== undefined) out.memberRole = text(input.memberRole, 24) || 'Member';
  if (Array.isArray(input.tiers)) {
    const seen = new Set();
    out.tiers = input.tiers.map((t) => {
      const name = text(t && t.name, 30), id = key(t && t.id) || key(name);
      const prices = {}; for (const p of PLANS) { const c = int(t && t.prices && t.prices[p], 0); prices[p] = Math.max(0, Math.min(MAX_PRICE_CENTS, c)); }
      const perks = Array.isArray(t && t.perks) ? t.perks.map((x) => text(x, 80)).filter(Boolean).slice(0, MAX_PERKS) : [];
      const color = /^#[0-9a-f]{6}$/i.test(String(t && t.color || '')) ? String(t.color).toLowerCase() : '';
      return { id, name, perks, prices, color };
    }).filter((t) => t.id && t.name && !seen.has(t.id) && seen.add(t.id)).slice(0, MAX_TIERS);
  }
  const tierIds = new Set(out.tiers.map((t) => t.id));
  if (Array.isArray(input.categories) || Array.isArray(input.tiers)) {
    const src = Array.isArray(input.categories) ? input.categories : out.categories;
    const used = new Set(); let total = 0, alerts = 0;
    out.categories = src.slice(0, MAX_CATEGORIES).map((c) => {
      const channels = [];
      for (const ch of Array.isArray(c && c.channels) ? c.channels : []) {
        if (total >= MAX_CHANNELS) break;
        const name = text(ch && ch.name, 30), id = key(ch && ch.id) || key(name);
        if (!id || !name || used.has(id)) continue;
        const type = TYPES.includes(ch && ch.type) ? ch.type : 'chat';
        if (type === 'alerts' && alerts >= MAX_ALERT_CHANNELS) continue;
        const access = ACCESS.includes(ch && ch.access) ? ch.access : 'members';
        const minTier = access === 'paid' && tierIds.has(key(ch && ch.minTier)) ? key(ch.minTier) : '';
        used.add(id); total += 1; if (type === 'alerts') alerts += 1;
        channels.push({ id, name, type, access, minTier, about: text(ch && ch.about, 120), slowSec: Math.max(0, Math.min(300, int(ch && ch.slowSec, 0))) });
      }
      return { id: key(c && c.id) || key(c && c.name) || 'group', name: text(c && c.name, 30) || 'Channels', channels };
    }).filter((c, i, a) => a.findIndex((x) => x.id === c.id) === i);
  }
  if (Array.isArray(input.banned)) out.banned = [...new Set(input.banned.map(String).filter((id) => SNOWFLAKE.test(id)))].slice(0, MAX_BANNED);
  return out;
}

const allChannels = (room) => room.categories.flatMap((c) => c.channels);
const channelOf = (room, id) => allChannels(room).find((c) => c.id === key(id)) || null;
const tierRank = (room, id) => room.tiers.findIndex((t) => t.id === id);

/** What a role may do in a channel. role = { kind: 'owner'|'paid'|'member'|'visitor'|'banned', tier } */
function canRead(room, channel, role) {
  if (!channel) return false;
  if (role.kind === 'owner') return true;
  if (channel.access === 'public') return true;
  if (role.kind === 'banned' || role.kind === 'visitor') return false;
  if (channel.access === 'members') return role.kind === 'member' || role.kind === 'paid';
  if (role.kind !== 'paid') return false;
  if (!channel.minTier) return true;
  if (!role.tier) return true; // a grant with no tier (from the owner, or from before tiers) opens every paid channel
  const have = tierRank(room, role.tier), need = tierRank(room, channel.minTier);
  return (have < 0 ? 0 : have) >= (need < 0 ? 0 : need);
}
function canWrite(room, channel, role) {
  if (!channel) return false;
  if (role.kind === 'owner') return true;
  if (channel.type !== 'chat') return false;
  if (role.kind === 'visitor' || role.kind === 'banned') return false;
  return canRead(room, channel, role);
}
/** The tiers whose holders open a channel (for the Alert Chart's lock): the named tier and every higher one; empty means any paid tier. */
function tiersFor(room, channel) {
  if (!channel || channel.access !== 'paid' || !channel.minTier) return [];
  const need = tierRank(room, channel.minTier); if (need < 0) return [];
  return room.tiers.slice(need).map((t) => t.id);
}
const offered = (tier) => PLANS.filter((p) => tier.prices[p] >= MIN_PRICE_CENTS);

/* ---------- templates: a starting layout, nothing more; every name, level and price stays the owner's to change ---------- */
const tier = (id, name, perks) => ({ id, name, perks, prices: { day: 0, week: 0, month: 0, year: 0, lifetime: 0 }, color: '' });
const ch = (id, name, type, access, extra = {}) => ({ id, name, type, access, minTier: '', about: '', slowSec: 0, ...extra });
const TEMPLATES = {
  classic: {
    label: 'Alerts room', blurb: 'A free front desk, a free community chat, and a paid side with the alerts and the inner circle.',
    tiers: [tier('premium', 'Premium', ['Every premium alert', 'The members-only chat', 'Trade notes'])],
    categories: [
      { id: 'start', name: 'START HERE', channels: [ch('welcome', 'welcome', 'announce', 'public', { about: 'What this room is and how to use it' }), ch('how-it-works', 'how-it-works', 'notes', 'public', { about: 'How I trade and how I post' })] },
      { id: 'free', name: 'FREE MEMBERS', channels: [ch('general', 'general', 'chat', 'members', { about: 'Talk to me and the other members', slowSec: 3 }), ch('free-picks', 'free-picks', 'alerts', 'members', { about: 'A taste of the alerts, free' })] },
      { id: 'premium', name: 'PREMIUM', channels: [ch('premium-alerts', 'premium-alerts', 'alerts', 'paid', { about: 'Every alert, live' }), ch('vip-chat', 'vip-chat', 'chat', 'paid', { about: 'The inner circle' }), ch('trade-notes', 'trade-notes', 'notes', 'paid', { about: 'My plan for the day and the week' })] }
    ]
  },
  alerts: {
    label: 'Alerts only', blurb: 'Everything free is one welcome note; the alerts are the product.',
    tiers: [tier('premium', 'Premium', ['Every alert, live'])],
    categories: [
      { id: 'start', name: 'START HERE', channels: [ch('welcome', 'welcome', 'announce', 'public')] },
      { id: 'alerts', name: 'ALERTS', channels: [ch('free-picks', 'free-picks', 'alerts', 'members'), ch('premium-alerts', 'premium-alerts', 'alerts', 'paid')] }
    ]
  },
  ladder: {
    label: 'Two levels', blurb: 'A lower tier for the alerts and a top tier for the chat, the notes and direct access.',
    tiers: [tier('plus', 'Plus', ['Every alert']), tier('vip', 'VIP', ['Everything in Plus', 'VIP chat and notes', 'Ask me directly'])],
    categories: [
      { id: 'start', name: 'START HERE', channels: [ch('welcome', 'welcome', 'announce', 'public'), ch('general', 'general', 'chat', 'members', { slowSec: 3 })] },
      { id: 'plus', name: 'PLUS', channels: [ch('plus-alerts', 'plus-alerts', 'alerts', 'paid', { minTier: 'plus' }), ch('plus-chat', 'plus-chat', 'chat', 'paid', { minTier: 'plus' })] },
      { id: 'vip', name: 'VIP', channels: [ch('vip-notes', 'vip-notes', 'notes', 'paid', { minTier: 'vip' }), ch('vip-chat', 'vip-chat', 'chat', 'paid', { minTier: 'vip' })] }
    ]
  },
  education: {
    label: 'Classroom', blurb: 'Free lessons to bring people in, premium lessons and live Q and A for the ones who stay.',
    tiers: [tier('premium', 'Premium', ['All premium lessons', 'Live Q and A'])],
    categories: [
      { id: 'start', name: 'START HERE', channels: [ch('welcome', 'welcome', 'announce', 'public')] },
      { id: 'learn', name: 'LESSONS', channels: [ch('free-lessons', 'free-lessons', 'notes', 'members'), ch('premium-lessons', 'premium-lessons', 'notes', 'paid')] },
      { id: 'talk', name: 'COMMUNITY', channels: [ch('q-and-a', 'q-and-a', 'chat', 'members', { slowSec: 5 }), ch('vip-q-and-a', 'vip-q-and-a', 'chat', 'paid')] }
    ]
  },
  free: {
    label: 'Free community', blurb: 'No paid side: an open room for the people who follow you.',
    tiers: [],
    categories: [{ id: 'start', name: 'COMMUNITY', channels: [ch('welcome', 'welcome', 'announce', 'public'), ch('general', 'general', 'chat', 'members', { slowSec: 3 }), ch('ideas', 'ideas', 'chat', 'members')] }]
  },
  blank: { label: 'Blank', blurb: 'Start empty and add your own.', tiers: [], categories: [{ id: 'start', name: 'START HERE', channels: [ch('welcome', 'welcome', 'announce', 'public')] }] }
};

/** Plain-language next steps for the owner: what is missing before the room works the way they set it up. */
function adviceFor(room, { sellerReady = false, followers = 0, paid = 0 } = {}) {
  const out = [], chs = allChannels(room);
  const add = (level, id, textLine) => out.push({ level, id, text: textLine });
  if (!chs.length) { add('todo', 'template', 'Pick a template to lay the room out, then change anything you like.'); return out; }
  const paidChs = chs.filter((c) => c.access === 'paid');
  if (paidChs.length && !room.tiers.length) add('todo', 'tier', 'You have paid channels but no paid tier. Add a tier so members have something to buy.');
  for (const t of room.tiers) if (!offered(t).length) add('todo', 'price:' + t.id, `${t.name} has no price yet. Set at least one price of $1 or more so it can be bought.`);
  if (room.tiers.length && !paidChs.length) add('warn', 'unused-tier', 'You have a paid tier but no channel is set to paid, so nobody gets anything for paying. Set a channel to paid.');
  for (const t of room.tiers.slice(1)) if (!chs.some((c) => c.access === 'paid' && c.minTier === t.id)) add('tip', 'tier-empty:' + t.id, `${t.name} adds nothing over the tier below it. Set a channel to ${t.name} and up.`);
  if ((paidChs.length || room.tiers.length) && !sellerReady) add('todo', 'payouts', 'Connect payouts (step 5 in Room settings) so members can pay you. Until then the room can be browsed but not bought.');
  if (!chs.some((c) => c.access === 'public')) add('warn', 'no-public', 'No channel is public, so visitors see only locked doors. Make one welcome channel public.');
  if (!chs.some((c) => c.access === 'members')) add('tip', 'no-free', 'Free members get nothing here. A free channel keeps followers around long enough to want the paid side.');
  if (!chs.some((c) => c.type === 'chat')) add('tip', 'no-chat', 'There is no chat channel. A community needs somewhere to talk.');
  if (!room.enabled) add('todo', 'open', 'Your room is closed. Open it when you are ready: it appears on your profile.');
  else if (!out.length) add('tip', 'ready', paid ? `Your room is open with ${followers} free and ${paid} paid members.` : followers ? `Your room is open with ${followers} free member${followers === 1 ? '' : 's'}. Post in your welcome channel to greet them.` : 'Your room is open. Share your profile link to bring people in.');
  return out;
}

function createTradingRoom({ pool = null, traderAlerts = null, names = null, now = Date.now, logger = () => {} } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = { rooms: new Map(), posts: new Map(), seq: 1 };
  const lastPost = new Map();
  let schemaReady = null;

  async function ensureSchema() {
    if (!db) return;
    if (schemaReady) return schemaReady;
    schemaReady = (async () => {
      try {
        await db.query('CREATE TABLE IF NOT EXISTS academy_rooms (owner_id TEXT PRIMARY KEY, room JSONB NOT NULL DEFAULT \'{}\', updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
        await db.query('CREATE TABLE IF NOT EXISTS academy_room_posts (id BIGSERIAL PRIMARY KEY, owner_id TEXT NOT NULL, channel TEXT NOT NULL, author_id TEXT NOT NULL, body TEXT NOT NULL, pinned BOOLEAN NOT NULL DEFAULT false, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
        await db.query('CREATE INDEX IF NOT EXISTS academy_room_posts_chan_idx ON academy_room_posts (owner_id, channel, id DESC)');
      } catch (error) { logger('warn', 'academy_rooms_schema_failed', { error: String((error && error.message) || error) }); }
    })();
    return schemaReady;
  }
  const nameOf = async (id) => { if (typeof names !== 'function') return ''; try { return text(await names(id), 60); } catch (_) { return ''; } };

  async function roomOf(ownerId) {
    const id = String(ownerId);
    if (db) { await ensureSchema(); try { const r = await db.query('SELECT room FROM academy_rooms WHERE owner_id = $1', [id]); return cleanRoom(r.rows[0] ? r.rows[0].room : null); } catch (_) { /* fall through */ } }
    return cleanRoom(mem.rooms.get(id) || null);
  }

  /* the Alert Chart keeps its own channels, locks and price list: keep them in step with the room (alerts channels only; a room with none leaves the chart alone) */
  async function syncAlerts(ownerId, room) {
    if (!traderAlerts || typeof traderAlerts.saveSettings !== 'function') return;
    const alerts = allChannels(room).filter((c) => c.type === 'alerts');
    if (!alerts.length) return;
    const patch = { channels: alerts.map((c) => ({ key: c.id, name: c.name, premium: c.access === 'paid', tiers: tiersFor(room, c) })) };
    const base = room.tiers[0]; if (base) patch.prices = { ...base.prices };
    try { await traderAlerts.saveSettings(ownerId, patch); } catch (error) { logger('warn', 'academy_room_alert_sync_failed', { error: String((error && error.message) || error) }); }
  }

  async function save(ownerId, input) {
    const id = String(ownerId); if (!SNOWFLAKE.test(id)) return { ok: false, error: 'invalid_user' };
    const next = cleanRoom(input, await roomOf(id)); next.updatedAt = now();
    if (db) { await ensureSchema(); await db.query('INSERT INTO academy_rooms (owner_id, room, updated_at) VALUES ($1,$2,now()) ON CONFLICT (owner_id) DO UPDATE SET room = EXCLUDED.room, updated_at = now()', [id, JSON.stringify(next)]); }
    else mem.rooms.set(id, next);
    await syncAlerts(id, next);
    return { ok: true, room: next };
  }
  async function applyTemplate(ownerId, templateKey) {
    const t = TEMPLATES[String(templateKey)]; if (!t) return { ok: false, error: 'unknown_template' };
    const cur = await roomOf(ownerId);
    return save(ownerId, { ...cur, enabled: cur.enabled, tiers: JSON.parse(JSON.stringify(t.tiers)), categories: JSON.parse(JSON.stringify(t.categories)) });
  }

  async function roleOf(viewerId, ownerId, room = null) {
    const v = String(viewerId || ''), o = String(ownerId);
    if (!SNOWFLAKE.test(v)) return { kind: 'visitor' };
    if (v === o) return { kind: 'owner' };
    const r = room || await roomOf(o);
    if (r.banned.includes(v)) return { kind: 'banned' };
    if (traderAlerts && typeof traderAlerts.access === 'function') {
      const acc = await traderAlerts.access(v, o).catch(() => ({ ok: false }));
      if (acc && acc.ok) return { kind: 'paid', tier: String(acc.tier || ''), plan: String(acc.plan || ''), until: acc.until || null };
    }
    if (traderAlerts && typeof traderAlerts.followState === 'function') { const f = await traderAlerts.followState(v, o).catch(() => ({ following: false })); if (f && f.following) return { kind: 'member' }; }
    return { kind: 'visitor' };
  }

  const publicTier = (t) => ({ id: t.id, name: t.name, perks: t.perks, color: t.color, prices: Object.fromEntries(offered(t).map((p) => [p, t.prices[p]])), forSale: offered(t).length > 0 });
  const channelView = (room, c, role) => ({ id: c.id, name: c.name, type: c.type, access: c.access, minTier: c.minTier, minTierName: c.minTier ? (room.tiers.find((t) => t.id === c.minTier) || {}).name || '' : '', about: c.about, slowSec: c.slowSec, canRead: canRead(room, c, role), canWrite: canWrite(room, c, role) });

  /** The room as one viewer sees it: roles, tiers with prices, categories with what is open and what is locked. */
  async function view(viewerId, ownerId, { sellerReady = false } = {}) {
    const o = String(ownerId); if (!SNOWFLAKE.test(o)) return { ok: false, error: 'invalid_user' };
    const room = await roomOf(o), role = await roleOf(viewerId, o, room), owner = role.kind === 'owner';
    if (!room.enabled && !owner) return { ok: false, error: 'no_room' };
    const [ownerName, followers] = await Promise.all([nameOf(o), traderAlerts && traderAlerts.followerCount ? traderAlerts.followerCount(o).catch(() => 0) : 0]);
    const tierName = role.tier ? (room.tiers.find((t) => t.id === role.tier) || {}).name || '' : '';
    const out = {
      ok: true, owner: { id: o, name: ownerName }, room: { enabled: room.enabled, name: room.name || (ownerName ? ownerName + '’s room' : 'Trading room'), tagline: room.tagline, about: room.about, memberRole: room.memberRole },
      role: { kind: role.kind, tier: role.tier || '', tierName, plan: role.plan || '', until: role.until || null }, tiers: room.tiers.map(publicTier),
      categories: room.categories.map((c) => ({ id: c.id, name: c.name, channels: c.channels.map((x) => channelView(room, x, role)) })), stats: { members: followers, channels: allChannels(room).length }
    };
    if (owner) {
      const paid = traderAlerts && traderAlerts.paidMembers ? await traderAlerts.paidMembers(o, { limit: 500 }).catch(() => []) : [];
      out.stats.paid = paid.length; out.settings = room;
      out.templates = Object.entries(TEMPLATES).map(([k, t]) => ({ key: k, label: t.label, blurb: t.blurb }));
      out.advice = adviceFor(room, { sellerReady, followers, paid: paid.length });
    }
    return out;
  }

  /* ---------- posts ---------- */
  const rowOut = (r) => ({ id: String(r.id), authorId: String(r.author_id || r.authorId), body: String(r.body), pinned: Boolean(r.pinned), createdAt: new Date(r.created_at || r.createdAt).toISOString() });
  async function readPosts(ownerId, channelId, { since = 0, limit = 60 } = {}) {
    const lim = Math.max(1, Math.min(200, Number(limit) || 60)), sinceId = Math.max(0, Math.floor(Number(since) || 0));
    if (db) { await ensureSchema(); const r = await db.query('SELECT id, author_id, body, pinned, created_at FROM academy_room_posts WHERE owner_id = $1 AND channel = $2 AND id > $3 ORDER BY id DESC LIMIT $4', [ownerId, channelId, sinceId, lim]); return r.rows.map(rowOut).reverse(); }
    return (mem.posts.get(ownerId + '|' + channelId) || []).filter((p) => Number(p.id) > sinceId).slice(-lim).map(rowOut);
  }

  async function channelContent(viewerId, ownerId, channelId, { since = 0, limit = 60 } = {}) {
    const o = String(ownerId); if (!SNOWFLAKE.test(o)) return { ok: false, error: 'invalid_user' };
    const room = await roomOf(o), role = await roleOf(viewerId, o, room), owner = role.kind === 'owner';
    if (!room.enabled && !owner) return { ok: false, error: 'no_room' };
    const c = channelOf(room, channelId); if (!c) return { ok: false, error: 'no_channel' };
    const view = channelView(room, c, role);
    if (!view.canRead) return { ok: false, error: 'locked', channel: view, unlock: unlockHint(room, c, role) };
    if (c.type === 'alerts') {
      const r = traderAlerts && traderAlerts.list ? await traderAlerts.list(o, { viewerId, limit: 60 }).catch(() => null) : null;
      return { ok: true, channel: view, alerts: r && r.ok ? r.alerts.filter((a) => a.channel === c.id) : [], posts: [] };
    }
    const rows = await readPosts(o, c.id, { since, limit });
    const authors = [...new Set(rows.map((p) => p.authorId))], nm = new Map();
    await Promise.all(authors.map(async (a) => nm.set(a, a === o ? await nameOf(a) : await nameOf(a))));
    const posts = rows.map((p) => ({ ...p, authorName: nm.get(p.authorId) || 'Member', owner: p.authorId === o, mine: p.authorId === String(viewerId || '') }));
    return { ok: true, channel: view, posts, pinned: posts.filter((p) => p.pinned) };
  }
  /* what a locked door needs, in one line for the visitor */
  function unlockHint(room, c, role) {
    if (role.kind === 'banned') return { need: 'banned', text: 'The owner has limited your access to this room.' };
    if (c.access === 'members') return { need: 'follow', text: 'Follow ' + (room.name || 'this room') + ' (free) to unlock this channel.' };
    const t = c.minTier ? room.tiers.find((x) => x.id === c.minTier) : null;
    const tierText = t ? t.name + ' and up' : 'any paid tier';
    return { need: 'paid', tier: t ? t.id : '', text: 'Unlocks with ' + tierText + '.' };
  }

  async function post(authorId, ownerId, channelId, input) {
    const a = String(authorId || ''), o = String(ownerId); if (!SNOWFLAKE.test(a) || !SNOWFLAKE.test(o)) return { ok: false, error: 'invalid_user' };
    const room = await roomOf(o), role = await roleOf(a, o, room);
    if (!room.enabled && role.kind !== 'owner') return { ok: false, error: 'no_room' };
    const c = channelOf(room, channelId); if (!c) return { ok: false, error: 'no_channel' };
    if (c.type === 'alerts') return { ok: false, error: 'use_alert_tool' };
    if (!canWrite(room, c, role)) return { ok: false, error: canRead(room, c, role) ? 'read_only' : 'locked' };
    const textBody = body(input && input.body !== undefined ? input.body : input, MAX_POST); if (!textBody) return { ok: false, error: 'empty' };
    const k = a + '|' + o + '|' + c.id, gap = role.kind === 'owner' ? 0 : Math.max(1500, c.slowSec * 1000), last = lastPost.get(k) || 0;
    if (gap && now() - last < gap) return { ok: false, error: 'slow_mode', retryAfterMs: gap - (now() - last) };
    lastPost.set(k, now()); if (lastPost.size > 5000) lastPost.delete(lastPost.keys().next().value);
    let row;
    if (db) { await ensureSchema(); const r = await db.query('INSERT INTO academy_room_posts (owner_id, channel, author_id, body) VALUES ($1,$2,$3,$4) RETURNING id, author_id, body, pinned, created_at', [o, c.id, a, textBody]); row = rowOut(r.rows[0]);
      if (Math.random() < 0.05) db.query('DELETE FROM academy_room_posts WHERE owner_id = $1 AND channel = $2 AND id < (SELECT COALESCE(MIN(id), 0) FROM (SELECT id FROM academy_room_posts WHERE owner_id = $1 AND channel = $2 ORDER BY id DESC LIMIT $3) t)', [o, c.id, KEEP_POSTS * 5]).catch(() => {}); }
    else { const list = mem.posts.get(o + '|' + c.id) || []; row = { id: String(mem.seq++), authorId: a, body: textBody, pinned: false, createdAt: new Date(now()).toISOString() }; list.push(row); if (list.length > KEEP_POSTS) list.shift(); mem.posts.set(o + '|' + c.id, list); }
    return { ok: true, post: { ...row, authorName: await nameOf(a), owner: a === o, mine: true } };
  }
  async function findPost(ownerId, postId) {
    const id = String(postId);
    if (db) { await ensureSchema(); const r = await db.query('SELECT id, author_id, channel FROM academy_room_posts WHERE owner_id = $1 AND id = $2', [ownerId, id]); return r.rows[0] ? { id, authorId: String(r.rows[0].author_id), channel: String(r.rows[0].channel) } : null; }
    for (const [k, list] of mem.posts) if (k.startsWith(ownerId + '|')) { const p = list.find((x) => x.id === id); if (p) return { id, authorId: p.authorId, channel: k.split('|')[1], ref: p, list }; }
    return null;
  }
  async function removePost(actorId, ownerId, postId) {
    const actor = String(actorId || ''), o = String(ownerId); if (!SNOWFLAKE.test(actor) || !SNOWFLAKE.test(o)) return { ok: false, error: 'invalid_user' };
    const p = await findPost(o, postId); if (!p) return { ok: false, error: 'not_found' };
    if (actor !== o && actor !== p.authorId) return { ok: false, error: 'not_yours' };
    if (db) await db.query('DELETE FROM academy_room_posts WHERE owner_id = $1 AND id = $2', [o, String(postId)]); else p.list.splice(p.list.indexOf(p.ref), 1);
    return { ok: true };
  }
  async function pinPost(actorId, ownerId, postId, on = true) {
    const o = String(ownerId); if (String(actorId) !== o) return { ok: false, error: 'not_yours' };
    const p = await findPost(o, postId); if (!p) return { ok: false, error: 'not_found' };
    if (db) await db.query('UPDATE academy_room_posts SET pinned = $3 WHERE owner_id = $1 AND id = $2', [o, String(postId), Boolean(on)]); else p.ref.pinned = Boolean(on);
    return { ok: true, pinned: Boolean(on) };
  }

  /* ---------- the owner's people ---------- */
  async function members(ownerId, { limit = 100 } = {}) {
    const o = String(ownerId), room = await roomOf(o);
    const [fl, paid] = await Promise.all([traderAlerts && traderAlerts.followersOf ? traderAlerts.followersOf(o).catch(() => []) : [], traderAlerts && traderAlerts.paidMembers ? traderAlerts.paidMembers(o, { limit: 500 }).catch(() => []) : []]);
    const paidBy = new Map(paid.map((p) => [p.memberId, p]));
    const ids = [...new Set([...paid.map((p) => p.memberId), ...fl.map((f) => f.id)])].slice(0, Math.max(1, Math.min(300, Number(limit) || 100)));
    const rows = [];
    for (const id of ids) { const p = paidBy.get(id); rows.push({ id, name: await nameOf(id) || 'Member', kind: p ? 'paid' : 'member', tier: p ? p.tier : '', tierName: p && p.tier ? (room.tiers.find((t) => t.id === p.tier) || {}).name || '' : '', plan: p ? p.plan : '', until: p ? p.until : null, banned: room.banned.includes(id) }); }
    rows.sort((x, y) => (x.kind === y.kind ? 0 : x.kind === 'paid' ? -1 : 1));
    return { ok: true, members: rows, total: ids.length };
  }
  async function setBan(ownerId, memberId, on = true) {
    const o = String(ownerId), m = String(memberId); if (!SNOWFLAKE.test(m) || m === o) return { ok: false, error: 'invalid_user' };
    const room = await roomOf(o); const set = new Set(room.banned); if (on) set.add(m); else set.delete(m);
    return save(o, { banned: [...set] });
  }

  /** For the checkout: is this tier on sale for this plan, and at what price. */
  async function offerFor(ownerId, tierId, plan) {
    const room = await roomOf(ownerId); if (!room.enabled) return { ok: false, error: 'no_room' };
    const t = room.tiers.find((x) => x.id === key(tierId)); if (!t) return { ok: false, error: 'no_tier' };
    if (!PLANS.includes(String(plan))) return { ok: false, error: 'invalid_plan' };
    const cents = t.prices[plan]; if (!(cents >= MIN_PRICE_CENTS)) return { ok: false, error: 'plan_not_offered' };
    return { ok: true, priceCents: cents, tier: t.id, tierName: t.name };
  }

  return { ensureSchema, roomOf, save, applyTemplate, roleOf, view, channelContent, post, removePost, pinPost, members, setBan, offerFor, TEMPLATES, advice: (room, ctx) => adviceFor(room, ctx) };
}

module.exports = { createTradingRoom, cleanRoom, canRead, canWrite, tiersFor, adviceFor, TEMPLATES, PLANS, TYPES, ACCESS, MAX_POST };
