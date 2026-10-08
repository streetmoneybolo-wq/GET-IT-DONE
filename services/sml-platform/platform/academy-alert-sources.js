'use strict';

/* Each member's own alert sources for the Academy alerts desk.
 *
 * The desk starts empty. A member picks a server (one the member and an Academy bot are both in), then a channel in it, and then either follows the
 * whole channel or only chosen posters in it (by picking them from the recent posters, or by typing a Discord user ID). Only channels the member can
 * read in Discord right now are offered or shown, so the desk never reveals anything the member could not already see; access is checked again
 * (cached for a few minutes) every time the desk is read. The owner's own alert streams are offered to every Academy session as presets and keep
 * their existing tiering (free: a count, Academy plan: closed alerts, members: live).
 *
 * Only the channels somebody follows are polled, capped by ACADEMY_ALERTS_MAX_CHANNELS (the most-followed win). Read-only: nothing is posted to
 * Discord and no member is ever messaged. */

const { parseAlertMessage } = require('./academy-alerts-parse');

const DISCORD = 'https://discord.com/api/v10';
const SNOWFLAKE = /^\d{15,25}$/;
const VIEW = 1n << 10n, SEND = 1n << 11n, ATTACH = 1n << 15n, MENTION_EVERYONE = 1n << 17n, MANAGE_WEBHOOKS = 1n << 29n, HISTORY = 1n << 16n, ADMIN = 1n << 3n, ALL = (1n << 53n) - 1n;
const TEXT_TYPES = new Set([0, 5]); // text and announcement channels
const MAX_SOURCES = 12;
const MAX_CHANNELS = Math.max(1, Math.min(80, Number(process.env.ACADEMY_ALERTS_MAX_CHANNELS) || 30));
const PRESET_LABELS = { swings: 'GrandMaster Swings', longterm: 'GrandMaster Long-Term' };

const cleanId = (v) => (SNOWFLAKE.test(String(v || '')) ? String(v) : '');
const cleanStyle = (v) => (v === 'longterm' ? 'longterm' : 'swings');
const cleanLabel = (v) => String(v || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80);

/* Discord's permission rules for one member in one channel: @everyone and role grants, administrator, then the channel's
   @everyone, role and member overwrites in that order. */
function channelPermissions({ guildId, ownerId, roles, memberRoles, userId, overwrites }) {
  if (userId && userId === ownerId) return ALL;
  const mine = new Set(memberRoles || []);
  const everyone = (roles || []).find((r) => r.id === guildId);
  let perms = BigInt(everyone ? everyone.permissions : 0);
  for (const r of roles || []) if (mine.has(r.id)) perms |= BigInt(r.permissions);
  if (perms & ADMIN) return ALL;
  const list = overwrites || [];
  const base = list.find((o) => o.id === guildId);
  if (base) { perms &= ~BigInt(base.deny); perms |= BigInt(base.allow); }
  let allow = 0n, deny = 0n;
  for (const o of list) if (Number(o.type) === 0 && mine.has(o.id)) { allow |= BigInt(o.allow); deny |= BigInt(o.deny); }
  perms &= ~deny; perms |= allow;
  const own = list.find((o) => Number(o.type) === 1 && o.id === userId);
  if (own) { perms &= ~BigInt(own.deny); perms |= BigInt(own.allow); }
  return perms;
}
const canReadWith = (perms) => (perms & VIEW) === VIEW && (perms & HISTORY) === HISTORY;
/* what a member (or the bot) may do when posting in a channel: see it, send in it, and ping @everyone there */
const postingWith = (perms) => ({ send: (perms & VIEW) === VIEW && (perms & SEND) === SEND, attach: (perms & ATTACH) === ATTACH, mentionEveryone: (perms & MENTION_EVERYONE) === MENTION_EVERYONE, webhooks: (perms & MANAGE_WEBHOOKS) === MANAGE_WEBHOOKS });

/* Discord lookups through the Academy's bot tokens, every one cached. A server is reachable through whichever bot is in it. */
function createDiscordDirectory({ tokens = [], fetchImpl = globalThis.fetch, now = Date.now, logger = () => {} } = {}) {
  const cache = new Map(), inflight = new Map();
  async function call(token, path) {
    const res = await fetchImpl(`${DISCORD}${path}`, { headers: { authorization: `Bot ${token.token}`, 'user-agent': 'StockMarketLoop-Academy-Alerts/1.0' }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404 || res.status === 403) return { missing: true, status: res.status };
    if (!res.ok) { const error = new Error(`discord_${res.status}`); error.status = res.status; throw error; }
    return { data: await res.json() };
  }
  async function cached(key, ms, fn) {
    const hit = cache.get(key);
    if (hit && hit.until > now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try { const value = await fn(); cache.set(key, { value, until: now() + ms }); if (cache.size > 5000) cache.delete(cache.keys().next().value); return value; }
      catch (error) { if (hit) return hit.value; throw error; } // a Discord hiccup keeps the last good answer
    })();
    inflight.set(key, p);
    try { return await p; } finally { inflight.delete(key); }
  }
  const botUser = (t) => cached(`me:${t.label}`, 3_600_000, async () => { const r = await call(t, '/users/@me'); return r.data ? String(r.data.id) : ''; });
  /* every server any Academy bot is in -> { id, name, token } */
  const botGuilds = () => cached('guilds', 300_000, async () => {
    const out = new Map();
    for (const t of tokens) {
      try { const r = await call(t, '/users/@me/guilds?limit=200'); for (const g of (r.data || [])) if (!out.has(String(g.id))) out.set(String(g.id), { id: String(g.id), name: cleanLabel(g.name), token: t }); }
      catch (error) { logger('warn', 'academy_alert_sources_guilds_failed', { bot: t.label, error: String(error.message || error) }); }
    }
    return out;
  });
  const tokenFor = async (guildId) => { const g = (await botGuilds()).get(guildId); return g ? g.token : null; };
  const member = (guildId, userId) => cached(`m:${guildId}:${userId}`, 300_000, async () => { const t = await tokenFor(guildId); if (!t) return null; const r = await call(t, `/guilds/${guildId}/members/${userId}`); return r.data ? { roles: (r.data.roles || []).map(String) } : null; });
  const guild = (guildId) => cached(`g:${guildId}`, 600_000, async () => { const t = await tokenFor(guildId); if (!t) return null; const r = await call(t, `/guilds/${guildId}`); return r.data ? { id: guildId, name: cleanLabel(r.data.name) || ((await botGuilds()).get(guildId) || {}).name || '', ownerId: String(r.data.owner_id || ''), roles: (r.data.roles || []).map((x) => ({ id: String(x.id), permissions: String(x.permissions || '0') })) } : null; });
  const guildChannels = (guildId) => cached(`gc:${guildId}`, 300_000, async () => { const t = await tokenFor(guildId); if (!t) return []; const r = await call(t, `/guilds/${guildId}/channels`); return Array.isArray(r.data) ? r.data : []; });
  /* a channel's guild, found through whichever bot can see it */
  const channelInfo = (channelId) => cached(`c:${channelId}`, 600_000, async () => {
    for (const t of tokens) { try { const r = await call(t, `/channels/${channelId}`); if (r.data && r.data.guild_id) return { id: channelId, guildId: String(r.data.guild_id), name: cleanLabel(r.data.name), type: Number(r.data.type) }; } catch (_) { /* next bot */ } }
    return null;
  });

  async function permsIn(guildId, userId, overwrites) {
    const [g, m] = await Promise.all([guild(guildId), member(guildId, userId)]);
    if (!g || !m) return 0n;
    return channelPermissions({ guildId, ownerId: g.ownerId, roles: g.roles, memberRoles: m.roles, userId, overwrites });
  }
  async function botCanRead(guildId, overwrites) {
    const t = await tokenFor(guildId); if (!t) return false;
    const id = await botUser(t); if (!id) return false;
    return canReadWith(await permsIn(guildId, id, overwrites));
  }

  /* the servers this member shares with an Academy bot, the one the Activity is open in first */
  async function guildsFor(userId, currentGuildId = '') {
    const all = [...(await botGuilds()).values()];
    const checks = await Promise.all(all.slice(0, 60).map(async (g) => { try { return (await member(g.id, userId)) ? g : null; } catch (_) { return null; } }));
    return checks.filter(Boolean).map((g) => ({ id: g.id, name: g.name, current: g.id === currentGuildId }))
      .sort((a, b) => Number(b.current) - Number(a.current) || a.name.localeCompare(b.name));
  }
  /* text channels in a server that both the member and the bot can read */
  async function readableChannels(guildId, userId) {
    if (!(await member(guildId, userId))) return null;
    const list = await guildChannels(guildId);
    const categories = new Map(list.filter((c) => Number(c.type) === 4).map((c) => [String(c.id), cleanLabel(c.name)]));
    const out = [];
    for (const c of list) {
      if (!TEXT_TYPES.has(Number(c.type))) continue;
      const ow = c.permission_overwrites || [];
      if (!canReadWith(await permsIn(guildId, userId, ow))) continue;
      if (!(await botCanRead(guildId, ow))) continue;
      out.push({ id: String(c.id), name: cleanLabel(c.name), category: categories.get(String(c.parent_id)) || '', position: Number(c.position) || 0, catPos: Number((list.find((x) => String(x.id) === String(c.parent_id)) || {}).position) || 0 });
    }
    return out.sort((a, b) => a.catPos - b.catPos || a.position - b.position).map(({ catPos, position, ...c }) => c);
  }
  /* can this member read this channel in Discord right now (cached a few minutes) */
  async function canRead(userId, channelId) {
    return cached(`r:${userId}:${channelId}`, 300_000, async () => {
      const info = await channelInfo(channelId); if (!info || !TEXT_TYPES.has(info.type)) return false;
      const list = await guildChannels(info.guildId);
      const c = list.find((x) => String(x.id) === channelId); if (!c) return false;
      return canReadWith(await permsIn(info.guildId, userId, c.permission_overwrites || []));
    }).catch(() => false);
  }
  const recent = (channelId) => cached(`msg:${channelId}`, 60_000, async () => {
    const info = await channelInfo(channelId); const t = info && await tokenFor(info.guildId); if (!t) return [];
    const r = await call(t, `/channels/${channelId}/messages?limit=100`); return Array.isArray(r.data) ? r.data : [];
  });
  /* A Discord user's public profile through whichever Academy bot can fetch it (cached half an hour). Null when no bot can see the user. */
  const userProfile = (userId) => cached(`u:${userId}`, 1_800_000, async () => {
    for (const t of tokens) {
      try {
        const r = await call(t, `/users/${userId}`);
        if (r.data && r.data.id) return { id: String(r.data.id), username: cleanLabel(r.data.username), globalName: cleanLabel(r.data.global_name), avatar: /^[a-z0-9_]{1,64}$/i.test(String(r.data.avatar || '')) ? String(r.data.avatar) : '', banner: /^[a-z0-9_]{1,64}$/i.test(String(r.data.banner || '')) ? String(r.data.banner) : '', accentColor: Number.isInteger(r.data.accent_color) ? r.data.accent_color : null };
      } catch (_) { /* next bot */ }
    }
    return null;
  });

  /* ---------- posting (the Click-to-Alert feature): who may post where, and the post itself ---------- */
  const memberRoles = async (guildId, userId) => { const m = await member(guildId, userId); return m && Array.isArray(m.roles) ? m.roles.map(String) : null; };
  /* uncached: a subscription that just ended (or just started) is honoured on the very next click */
  const memberRolesLive = async (guildId, userId) => { const t = await tokenFor(guildId); if (!t) return null; const r = await call(t, `/guilds/${guildId}/members/${userId}`); return r.data && Array.isArray(r.data.roles) ? r.data.roles.map(String) : null; };
  async function botPosting(guildId, overwrites) {
    const t = await tokenFor(guildId); if (!t) return { send: false, attach: false, mentionEveryone: false };
    const id = await botUser(t); if (!id) return { send: false, attach: false, mentionEveryone: false };
    return postingWith(await permsIn(guildId, id, overwrites));
  }
  /* text channels in a server the member can post in AND the Academy bot can post in */
  async function sendableChannels(guildId, userId) {
    if (!(await member(guildId, userId))) return null;
    const list = await guildChannels(guildId);
    const categories = new Map(list.filter((c) => Number(c.type) === 4).map((c) => [String(c.id), cleanLabel(c.name)]));
    const out = [];
    for (const c of list) {
      if (!TEXT_TYPES.has(Number(c.type))) continue;
      const ow = c.permission_overwrites || [];
      const mine = postingWith(await permsIn(guildId, userId, ow)); if (!mine.send) continue;
      const bot = await botPosting(guildId, ow); if (!bot.send) continue;
      out.push({ id: String(c.id), name: cleanLabel(c.name), asMe: !!bot.webhooks, category: categories.get(String(c.parent_id)) || '', position: Number(c.position) || 0, catPos: Number((list.find((x) => String(x.id) === String(c.parent_id)) || {}).position) || 0, mentionEveryone: mine.mentionEveryone && bot.mentionEveryone });
    }
    return out.sort((a, b) => a.catPos - b.catPos || a.position - b.position).map(({ catPos, position, ...c }) => c);
  }
  /* the exact answer for one channel, never cached (a send is checked against the live permissions of that moment) */
  async function postingIn(userId, channelId) {
    const info = await channelInfo(channelId); if (!info || !TEXT_TYPES.has(info.type)) return null;
    const t = await tokenFor(info.guildId); if (!t) return null;
    const [g, m, chan] = await Promise.all([call(t, `/guilds/${info.guildId}`), call(t, `/guilds/${info.guildId}/members/${userId}`), call(t, `/channels/${channelId}`)]);
    if (!g.data || !m.data || !chan.data) return null;
    const ow = chan.data.permission_overwrites || [];
    const mine = postingWith(channelPermissions({ guildId: info.guildId, ownerId: String(g.data.owner_id || ''), roles: g.data.roles || [], memberRoles: m.data.roles || [], userId, overwrites: ow }));
    const bot = await botPosting(info.guildId, ow);
    return { guildId: info.guildId, name: info.name, botCanWebhook: !!bot.webhooks, userCanSend: mine.send, botCanSend: bot.send, userCanAttach: mine.attach, botCanAttach: bot.attach, mentionEveryone: mine.mentionEveryone && bot.mentionEveryone };
  }
  /* files: [{ name, bytes (Buffer), contentType, alt }] are sent as attachments on the same message (multipart), each with its alt text */
  async function post(channelId, body, files = []) {
    const info = await channelInfo(channelId); const t = info && await tokenFor(info.guildId); if (!t) { const e = new Error('discord_bot_not_in_server'); e.status = 404; throw e; }
    const headers = { authorization: `Bot ${t.token}`, 'user-agent': 'StockMarketLoop-Academy-Alerts/1.0' };
    let payload;
    if (files && files.length) {
      payload = new FormData();
      payload.append('payload_json', JSON.stringify({ ...body, attachments: files.map((f, i) => ({ id: i, filename: f.name, description: String(f.alt || '').slice(0, 1000) })) }));
      files.forEach((f, i) => payload.append(`files[${i}]`, new Blob([f.bytes], { type: f.contentType || 'image/png' }), f.name));
    } else { payload = JSON.stringify(body); headers['content-type'] = 'application/json'; }
    const res = await fetchImpl(`${DISCORD}/channels/${channelId}/messages`, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(files && files.length ? 20_000 : 10_000) });
    if (!res.ok) { const e = new Error(`discord_post_${res.status}`); e.status = res.status; throw e; }
    const out = await res.json(); return { id: String(out.id || ''), channelId: String(out.channel_id || channelId) };
  }
  /* Post under the member's own name and picture. Discord does not let any app post as a user account, so this uses a channel webhook (made once by the
     Academy app, which needs Manage Webhooks there) with the member's display name and avatar; Discord still marks such a message APP. */
  const hooks = new Map(); // channelId -> { id, token }
  async function webhookFor(channelId, t, botId) {
    const hit = hooks.get(channelId); if (hit) return hit;
    const headers = { authorization: `Bot ${t.token}`, 'user-agent': 'StockMarketLoop-Academy-Alerts/1.0' };
    const list = await fetchImpl(`${DISCORD}/channels/${channelId}/webhooks`, { headers, signal: AbortSignal.timeout(10_000) });
    if (list.ok) { const found = (await list.json()).find((w) => w && w.token && String(w.user && w.user.id) === botId && w.name === 'Academy Alerts'); if (found) { const h = { id: String(found.id), token: String(found.token) }; hooks.set(channelId, h); return h; } }
    const made = await fetchImpl(`${DISCORD}/channels/${channelId}/webhooks`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Academy Alerts' }), signal: AbortSignal.timeout(10_000) });
    if (!made.ok) { const e = new Error(`discord_webhook_${made.status}`); e.status = made.status; throw e; }
    const w = await made.json(); const h = { id: String(w.id), token: String(w.token) }; hooks.set(channelId, h); return h;
  }
  const avatarUrl = (profile, userId) => (profile && profile.avatar ? `https://cdn.discordapp.com/avatars/${userId}/${profile.avatar}.png?size=128` : '');
  const cleanName = (v) => String(v || '').replace(/[\u0000-\u001f<>@`*_~|#:]/g, '').replace(/discord|clyde/gi, '').replace(/[ ]+/g, ' ').trim().slice(0, 80);
  async function postAsMember(channelId, body, files = [], { userId, displayName } = {}) {
    const info = await channelInfo(channelId); const t = info && await tokenFor(info.guildId); if (!t) { const e = new Error('discord_bot_not_in_server'); e.status = 404; throw e; }
    const botId = await botUser(t);
    const profile = await userProfile(String(userId)).catch(() => null);
    const username = cleanName(displayName || (profile && (profile.globalName || profile.username))) || 'Academy member';
    const avatar_url = avatarUrl(profile, String(userId));
    const send = async (hook) => {
      const meta = { ...body, username, ...(avatar_url ? { avatar_url } : {}) };
      let payload; const headers = { 'user-agent': 'StockMarketLoop-Academy-Alerts/1.0' };
      if (files && files.length) {
        payload = new FormData();
        payload.append('payload_json', JSON.stringify({ ...meta, attachments: files.map((f, i) => ({ id: i, filename: f.name, description: String(f.alt || '').slice(0, 1000) })) }));
        files.forEach((f, i) => payload.append(`files[${i}]`, new Blob([f.bytes], { type: f.contentType || 'image/png' }), f.name));
      } else { payload = JSON.stringify(meta); headers['content-type'] = 'application/json'; }
      return fetchImpl(`${DISCORD}/webhooks/${hook.id}/${hook.token}?wait=true`, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(files && files.length ? 20_000 : 10_000) });
    };
    let hook = await webhookFor(String(channelId), t, botId), res = await send(hook);
    if (res.status === 404) { hooks.delete(String(channelId)); hook = await webhookFor(String(channelId), t, botId); res = await send(hook); } // the webhook was deleted: make a new one once
    if (!res.ok) { const e = new Error(`discord_webhook_post_${res.status}`); e.status = res.status; throw e; }
    const out = await res.json(); return { id: String(out.id || ''), channelId: String(out.channel_id || channelId) };
  }
  return { guildsFor, readableChannels, canRead, channelInfo, guild, recent, botGuilds, userProfile, memberRoles, memberRolesLive, sendableChannels, postingIn, post, postAsMember };
}

/* Where each member's sources are kept: Postgres (academy_alert_sources) when there is a database, memory otherwise (local runs, tests). */
function createAlertSourceStore({ pool = null } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = new Map(); // userId -> Map(channelId:authorId -> row)
  const rowOut = (r) => ({ guildId: String(r.guild_id), channelId: String(r.channel_id), authorId: String(r.author_id || ''), style: cleanStyle(r.style), label: String(r.label || ''), guildName: String(r.guild_name || ''), authorName: String(r.author_name || '') });
  async function list(userId) {
    if (db) return (await db.query('SELECT * FROM academy_alert_sources WHERE discord_id=$1 ORDER BY created_at', [userId])).rows.map(rowOut);
    return [...(mem.get(userId) || new Map()).values()].map(rowOut);
  }
  async function add(userId, src) {
    const row = { discord_id: userId, guild_id: src.guildId, channel_id: src.channelId, author_id: src.authorId || '', style: cleanStyle(src.style), label: cleanLabel(src.label), guild_name: cleanLabel(src.guildName), author_name: cleanLabel(src.authorName) };
    if (db) {
      await db.query(`INSERT INTO academy_alert_sources (discord_id, guild_id, channel_id, author_id, style, label, guild_name, author_name)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (discord_id, channel_id, author_id)
        DO UPDATE SET style=EXCLUDED.style, label=EXCLUDED.label, guild_name=EXCLUDED.guild_name, author_name=EXCLUDED.author_name`,
      [row.discord_id, row.guild_id, row.channel_id, row.author_id, row.style, row.label, row.guild_name, row.author_name]);
      return;
    }
    if (!mem.has(userId)) mem.set(userId, new Map());
    mem.get(userId).set(`${row.channel_id}:${row.author_id}`, row);
  }
  async function remove(userId, channelId, authorId = '') {
    if (db) { await db.query('DELETE FROM academy_alert_sources WHERE discord_id=$1 AND channel_id=$2 AND author_id=$3', [userId, channelId, authorId]); return; }
    const m = mem.get(userId); if (m) m.delete(`${channelId}:${authorId}`);
  }
  /* every followed channel, most-followed first */
  async function followedChannels() {
    if (db) return (await db.query(`SELECT channel_id, MIN(guild_id) AS guild_id, MAX(style) AS style, MAX(label) AS label, COUNT(DISTINCT discord_id) AS n
      FROM academy_alert_sources GROUP BY channel_id ORDER BY n DESC, channel_id LIMIT $1`, [MAX_CHANNELS])).rows
      .map((r) => ({ channelId: String(r.channel_id), guildId: String(r.guild_id), style: cleanStyle(r.style), label: String(r.label || ''), followers: Number(r.n) }));
    const agg = new Map();
    for (const m of mem.values()) for (const r of m.values()) { const a = agg.get(r.channel_id) || { channelId: r.channel_id, guildId: r.guild_id, style: r.style, label: r.label, users: new Set() }; a.users.add(r.discord_id); agg.set(r.channel_id, a); }
    return [...agg.values()].map((a) => ({ channelId: a.channelId, guildId: a.guildId, style: a.style, label: a.label, followers: a.users.size })).sort((x, y) => y.followers - x.followers).slice(0, MAX_CHANNELS);
  }
  return { list, add, remove, followedChannels, persistent: !!db };
}

/* Ties the store, the Discord directory and the alerts service together, and answers the desk's routes. */
function createAlertSources({ store, directory, alerts, presets = [], tierFor = null, alertsTiering = false, logger = () => {}, timers = { setInterval, clearInterval } } = {}) {
  /* presets: the owner's streams [{ key, id, mirrorId }] from defaultChannels(); shown to every Academy session */
  const PRESETS = presets.filter((p) => p && cleanId(p.id)).map((p) => ({ channelId: String(p.id), mirrorId: cleanId(p.mirrorId), style: cleanStyle(p.key), label: PRESET_LABELS[p.key] || cleanLabel(p.key) }));
  const presetOf = (channelId) => PRESETS.find((p) => p.channelId === channelId) || null;
  let timer = null;

  async function sync() {
    const followed = await store.followedChannels();
    /* The owner's streams are always tracked, even before any Academy member follows them: the stockmarketloop.com group desk reads them too. */
    for (const p of PRESETS) if (!followed.some((f) => f.channelId === p.channelId)) followed.push({ channelId: p.channelId, style: p.style, label: p.label });
    const records = followed.map((f) => {
      const preset = presetOf(f.channelId);
      return { key: f.channelId, id: f.channelId, mirrorId: preset ? preset.mirrorId : '', style: preset ? preset.style : f.style, premium: !!preset, label: preset ? preset.label : f.label };
    });
    return alerts.setChannels(records);
  }
  function start() { if (timer) return; void sync().catch((error) => logger('warn', 'academy_alert_sources_sync_failed', { error: String(error.message || error) })); timer = timers.setInterval(() => { void sync().catch(() => {}); }, 60_000); if (timer && timer.unref) timer.unref(); }
  function stop() { if (timer) timers.clearInterval(timer); timer = null; }

  /* premiumView: how this session sees the owner's streams ('live' | 'closed' | 'teaser'); every other source the member can read shows live */
  async function viewFor(userId, premiumView = 'live') {
    const mine = await store.list(userId);
    const out = [];
    for (const s of mine) {
      const preset = presetOf(s.channelId);
      const ok = preset ? true : await directory.canRead(userId, s.channelId);
      out.push({ ...s, key: s.channelId, view: preset ? premiumView : 'live', premium: !!preset, access: ok });
    }
    return out;
  }
  /* The owner's streams as desk sources, all shown the same way ('live' | 'closed' | 'teaser'). Used by the stockmarketloop.com group desk. */
  function presetSources(view = 'live') {
    return PRESETS.map((p) => ({ key: p.channelId, channelId: p.channelId, guildId: 'preset', label: p.label, style: p.style, view, premium: true, access: true }));
  }
  /* One member's desk for stockmarketloop.com (linked by Discord id): the sources they follow in the Academy, with the owner's streams
     shown the way their Academy roles allow. grantedView is what a stockmarketloop.com group already grants them ('' outside a group);
     the better of the two wins, and inside a group the owner's streams are always on the desk. */
  const VIEW_RANK = { '': 0, teaser: 1, closed: 2, live: 3 };
  async function siteDesk(userId, grantedView = '') {
    const id = cleanId(userId);
    if (!id) return { view: '', tier: 'none', sources: [] };
    const tier = tierFor ? await tierFor(id).catch(() => 'none') : 'none';
    const academyView = tier === 'member' ? 'live' : tier === 'academy' ? (alertsTiering ? 'closed' : 'live') : tier === 'free' ? 'teaser' : '';
    const granted = VIEW_RANK[grantedView] ? grantedView : '';
    const view = VIEW_RANK[granted] > VIEW_RANK[academyView] ? granted : academyView;
    const sources = (await viewFor(id, view || 'teaser')).filter((s) => s.access);
    if (granted) for (const p of presetSources(view)) if (!sources.some((s) => s.channelId === p.channelId)) sources.push(p);
    return { view: view || 'teaser', tier, sources };
  }
  const publicSource = (s) => ({ guildId: s.guildId, guildName: s.guildName, channelId: s.channelId, label: s.label, authorId: s.authorId, authorName: s.authorName, style: s.style, premium: !!s.premium, access: s.access !== false });

  async function add(userId, input) {
    const channelId = cleanId(input && input.channel);
    const authorId = input && input.author ? cleanId(input.author) : '';
    if (!channelId || (input && input.author && !authorId)) throw new TypeError('invalid_source');
    const mine = await store.list(userId);
    if (mine.length >= MAX_SOURCES && !mine.some((s) => s.channelId === channelId && s.authorId === authorId)) throw new RangeError('too_many_sources');
    const preset = presetOf(channelId);
    let guildId = '', guildName = '', label = '';
    if (preset) { label = preset.label; guildName = 'Making Easy Money'; }
    else {
      if (!(await directory.canRead(userId, channelId))) { const e = new Error('no_access'); e.code = 'no_access'; throw e; }
      const info = await directory.channelInfo(channelId);
      const g = info && await directory.guild(info.guildId);
      guildId = info ? info.guildId : ''; label = info ? '#' + info.name : ''; guildName = g ? g.name : '';
    }
    let authorName = cleanLabel(input && input.authorName);
    if (authorId && !authorName) {
      const seen = (await directory.recent(channelId).catch(() => [])).find((m) => m.author && String(m.author.id) === authorId);
      authorName = seen ? cleanLabel(seen.author.global_name || seen.author.username) : '';
    }
    await store.add(userId, { guildId: guildId || (preset ? 'preset' : ''), channelId, authorId, style: preset ? preset.style : input && input.style, label, guildName, authorName });
    await sync().catch(() => {});
    return list(userId);
  }
  async function remove(userId, input) {
    const channelId = cleanId(input && input.channel), authorId = input && input.author ? cleanId(input.author) : '';
    if (!channelId) throw new TypeError('invalid_source');
    await store.remove(userId, channelId, authorId);
    await sync().catch(() => {});
    return list(userId);
  }
  async function list(userId) {
    return { sources: (await viewFor(userId)).map(publicSource), presets: PRESETS.map((p) => ({ channelId: p.channelId, label: p.label, style: p.style })), max: MAX_SOURCES };
  }

  /* one channel, before following it: who posts there and what their recent alerts look like */
  async function preview(userId, channelId) {
    if (!(await directory.canRead(userId, channelId))) return null;
    const info = await directory.channelInfo(channelId);
    const messages = await directory.recent(channelId).catch(() => []);
    const posters = new Map(); const alertsFound = [];
    for (const m of messages) {
      const a = m.author || {}; const id = cleanId(a.id); if (!id || a.bot) continue;
      const p = posters.get(id) || { id, name: cleanLabel(a.global_name || a.username) || 'member', posts: 0, alerts: 0 };
      p.posts += 1;
      const parsed = parseAlertMessage(m.content, m.timestamp);
      if (parsed && parsed.kind === 'equity') { p.alerts += 1; if (alertsFound.length < 8) alertsFound.push({ symbol: parsed.symbol, entry: parsed.entryPrice, target: parsed.targetPrice, author: p.name, authorId: id, at: Date.parse(m.timestamp) || 0 }); }
      posters.set(id, p);
    }
    return { channel: info ? { id: channelId, name: info.name, guildId: info.guildId } : { id: channelId }, read: messages.length,
      posters: [...posters.values()].sort((x, y) => y.alerts - x.alerts || y.posts - x.posts).slice(0, 15), alerts: alertsFound };
  }

  return { sync, start, stop, viewFor, add, remove, list, preview, guilds: (u, g) => directory.guildsFor(u, cleanId(g)), channels: (u, g) => directory.readableChannels(cleanId(g), u), presetOf, presetSources, siteDesk, MAX_SOURCES };
}

module.exports = { createAlertSources, createAlertSourceStore, createDiscordDirectory, channelPermissions, canReadWith, postingWith, MAX_SOURCES };
