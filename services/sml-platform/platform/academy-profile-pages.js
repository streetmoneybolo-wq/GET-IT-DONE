'use strict';

/* Academy member profile pages (schema 045): what a member shows about themselves inside the Academy, who follows whom,
 * and the data the page is built from. Every number on a page comes from something the Academy already records:
 *   - posts: academy_chat_messages (the live chat rooms), newest first, as the member's feed
 *   - paper account: the member's own paper store (paper:u:<id>) and a leaderboard across every member's paper store
 *   - main server: minutes in the Activity per Discord server (academy_presence; the client sends one beat a minute while
 *     the Activity is visible), the busiest server wins
 *   - tier: the live access check, cached a few minutes
 * The member chooses one of LAYOUTS, a theme (accent, background effect, font, immersive level), one song (a direct audio
 * link plays in the Academy; YouTube/Spotify/SoundCloud/Apple links open outside), and up to 8 social links, each with a
 * link card (title + image read from the page's own Open Graph tags, image served through the Academy's origin because
 * the Activity may only show images from itself). Nothing here reads DMs, other channels or anything private. */

const SNOWFLAKE = /^\d{15,25}$/;
const LAYOUTS = [
  ['classic', 'Classic'], ['hero-left', 'Hero left'], ['magazine', 'Magazine'], ['terminal', 'Terminal'], ['glass', 'Glass'],
  ['neon', 'Neon'], ['minimal', 'Minimal'], ['poster', 'Poster'], ['ticker', 'Ticker'], ['dashboard', 'Dashboard'],
  ['timeline', 'Timeline'], ['mosaic', 'Mosaic'], ['split', 'Split'], ['polaroid', 'Polaroid'], ['newspaper', 'Newspaper'],
  ['orbit', 'Orbit'], ['stack', 'Stack'], ['compact', 'Compact'], ['cinema', 'Cinema'], ['gradient', 'Gradient']
];
const LAYOUT_IDS = new Set(LAYOUTS.map(([id]) => id));
const FX = new Set(['none', 'aurora', 'particles', 'grid', 'waves', 'stars', 'embers', 'rain']);
const FONTS = new Set(['system', 'mono', 'serif', 'display', 'rounded']);
const IMMERSIVE = new Set(['off', 'subtle', 'balanced', 'immersive']);
/* module textures (what every section looks and feels like), desks (the surface the sections sit on), the lighting in the
 * background, the 3D orbs flying around, and the 3D orbit of up to 12 pictures that each link out. The look itself is drawn by
 * the page (academy-profile-desk.js); the server only keeps the member's choice. */
const TEXTURES = new Set(['none', 'legal-pad', 'graph-paper', 'manila-folder', 'kraft-paper', 'newsprint', 'ledger-green', 'ticker-tape', 'index-card', 'sticky-note', 'blueprint', 'carbon-fiber', 'brushed-steel', 'leather', 'walnut', 'oak', 'marble', 'brass-plate', 'green-felt', 'cork-board', 'crt-terminal', 'parchment', 'concrete', 'slate', 'frosted-glass']);
const DESKS = new Set(['none', 'nyse-floor', 'paper-desk', 'walnut-office', 'steel-trader', 'cork-wall', 'leather-blotter']);
const LIGHTS = new Set(['off', 'desk-lamp', 'window-sun', 'monitor-glow', 'neon-sweep', 'golden-hour', 'spotlight']);
const ORBS = new Set(['off', 'few', 'many']);
const MAX_ORBIT = 12;
const SOCIAL_KINDS = [
  ['x', /(^|\.)(x|twitter)\.com$/], ['instagram', /(^|\.)instagram\.com$/], ['tiktok', /(^|\.)tiktok\.com$/], ['youtube', /(^|\.)(youtube\.com|youtu\.be)$/],
  ['facebook', /(^|\.)facebook\.com$/], ['threads', /(^|\.)threads\.net$/], ['linkedin', /(^|\.)linkedin\.com$/], ['twitch', /(^|\.)twitch\.tv$/],
  ['discord', /(^|\.)(discord\.gg|discord\.com)$/], ['stocktwits', /(^|\.)stocktwits\.com$/], ['substack', /(^|\.)substack\.com$/], ['stockmarketloop', /(^|\.)stockmarketloop\.com$/]
];
const SONG_KINDS = [['youtube', /(^|\.)(youtube\.com|youtu\.be)$/], ['spotify', /(^|\.)spotify\.com$/], ['soundcloud', /(^|\.)soundcloud\.com$/], ['apple', /(^|\.)music\.apple\.com$/]];
const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|wav|flac|opus)(\?|#|$)/i;
const MAX_SOCIALS = 8, MAX_CARD_HTML = 262_144, MAX_IMAGE_BYTES = 1_572_864, MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const text = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
const httpsUrl = (v) => { try { const u = new URL(String(v || '').trim()); if (u.protocol !== 'https:' || !u.hostname.includes('.')) return ''; u.hash = ''; return u.toString().slice(0, 500); } catch (_) { return ''; } };
const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; } };
const kindOf = (table, url, fallback) => { const h = hostOf(url); for (const [k, re] of table) if (re.test(h)) return k; return fallback; };
const r2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

/* the member's settings, cleaned: unknown keys are dropped, every value is bounded */
function cleanSettings(input = {}, prev = {}) {
  const s = { ...prev };
  if (input.displayName !== undefined) s.displayName = text(input.displayName, 40);
  if (input.tagline !== undefined) s.tagline = text(input.tagline, 90);
  if (input.bio !== undefined) s.bio = String(input.bio == null ? '' : input.bio).replace(/[\u0000-\u0008\u000b-\u001f\u007f<>]/g, '').trim().slice(0, 600);
  if (input.layout !== undefined) s.layout = LAYOUT_IDS.has(String(input.layout)) ? String(input.layout) : 'classic';
  if (input.theme !== undefined && input.theme && typeof input.theme === 'object') {
    const t = input.theme, out = { ...(prev.theme || {}) };
    if (t.accent !== undefined) out.accent = /^#[0-9a-f]{6}$/i.test(String(t.accent)) ? String(t.accent).toLowerCase() : '';
    if (t.accent2 !== undefined) out.accent2 = /^#[0-9a-f]{6}$/i.test(String(t.accent2)) ? String(t.accent2).toLowerCase() : '';
    if (t.fx !== undefined) out.fx = FX.has(String(t.fx)) ? String(t.fx) : 'aurora';
    if (t.font !== undefined) out.font = FONTS.has(String(t.font)) ? String(t.font) : 'system';
    if (t.immersive !== undefined) out.immersive = IMMERSIVE.has(String(t.immersive)) ? String(t.immersive) : 'balanced';
    if (t.dark !== undefined) out.dark = t.dark !== false;
    if (t.texture !== undefined) out.texture = TEXTURES.has(String(t.texture)) ? String(t.texture) : 'none';
    if (t.desk !== undefined) out.desk = DESKS.has(String(t.desk)) ? String(t.desk) : 'none';
    if (t.light !== undefined) out.light = LIGHTS.has(String(t.light)) ? String(t.light) : 'off';
    if (t.orbs !== undefined) out.orbs = ORBS.has(String(t.orbs)) ? String(t.orbs) : 'off';
    if (t.orbit !== undefined) {
      /* up to 12 pictures; each is an https image and may link to an https page (the member's own link back) */
      const list = Array.isArray(t.orbit) ? t.orbit : [], seen = new Set(), orbit = [];
      for (const it of list) {
        const image = httpsUrl(it && it.image); if (!image || seen.has(image)) continue; seen.add(image);
        orbit.push({ image, href: httpsUrl(it && it.href), title: text(it && it.title, 60) });
        if (orbit.length >= MAX_ORBIT) break;
      }
      out.orbit = orbit;
    }
    s.theme = out;
  }
  if (input.song !== undefined) {
    if (!input.song || !input.song.url) s.song = null;
    else {
      const url = httpsUrl(input.song.url);
      s.song = url ? { url, title: text(input.song.title, 80), kind: AUDIO_EXT.test(url) ? 'audio' : kindOf(SONG_KINDS, url, 'link') } : null;
    }
  }
  if (input.socials !== undefined) {
    const list = Array.isArray(input.socials) ? input.socials : [];
    const seen = new Set(), out = [];
    for (const it of list) {
      const url = httpsUrl(it && (it.url || it)); if (!url || seen.has(url)) continue; seen.add(url);
      const old = (prev.socials || []).find((p) => p.url === url) || {};
      out.push({ url, kind: kindOf(SOCIAL_KINDS, url, 'link'), title: text(it && it.title, 60) || old.title || '', card: old.card || null });
      if (out.length >= MAX_SOCIALS) break;
    }
    s.socials = out;
  }
  if (input.flags !== undefined && input.flags && typeof input.flags === 'object') {
    const f = { ...(prev.flags || {}) };
    for (const k of ['showPaper', 'showServer', 'showSocials', 'showFeed', 'showFollowers']) if (input.flags[k] !== undefined) f[k] = input.flags[k] !== false;
    s.flags = f;
  }
  return s;
}
const defaults = () => ({ displayName: '', tagline: '', bio: '', layout: 'classic', theme: { accent: '', accent2: '', fx: 'aurora', font: 'system', immersive: 'balanced', dark: true, texture: 'none', desk: 'none', light: 'off', orbs: 'off', orbit: [] }, song: null, socials: [], flags: { showPaper: true, showServer: true, showSocials: true, showFeed: true, showFollowers: true } });

/* Open Graph title + image of a page, for the link card. Only the page's own meta tags are read. */
function parseOg(html, url) {
  const h = String(html || '').slice(0, MAX_CARD_HTML);
  const meta = (prop) => { const re = new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*content=["\']([^"\']{1,500})["\']', 'i'); const m = re.exec(h); if (m) return m[1]; const re2 = new RegExp('<meta[^>]+content=["\']([^"\']{1,500})["\'][^>]*(?:property|name)=["\']' + prop + '["\']', 'i'); const m2 = re2.exec(h); return m2 ? m2[1] : ''; };
  const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  const title = decode(meta('og:title') || meta('twitter:title') || (/<title[^>]*>([^<]{1,200})<\/title>/i.exec(h) || [])[1] || '');
  let image = decode(meta('og:image') || meta('twitter:image') || '');
  if (image && !/^https?:/i.test(image)) { try { image = new URL(image, url).toString(); } catch (_) { image = ''; } }
  image = httpsUrl(image);
  return { title: text(title, 120), image, site: text(decode(meta('og:site_name')), 60) || hostOf(url) };
}

function createProfilePages({ pool = null, chat = null, paper = null, paperStore = null, tierLive = null, directory = null, fetchImpl = globalThis.fetch, now = Date.now, logger = () => {} } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = { profiles: new Map(), follows: new Set(), presence: new Map() };
  const tiers = new Map(), cards = new Map(), images = new Set(), lastBeat = new Map();
  let lb = { at: 0, rows: [] };

  async function ensureSchema() {
    if (!db) return;
    try {
      await db.query('CREATE TABLE IF NOT EXISTS academy_profiles (discord_id TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT \'\', tagline TEXT NOT NULL DEFAULT \'\', bio TEXT NOT NULL DEFAULT \'\', layout TEXT NOT NULL DEFAULT \'classic\', theme JSONB NOT NULL DEFAULT \'{}\'::jsonb, song JSONB, socials JSONB NOT NULL DEFAULT \'[]\'::jsonb, flags JSONB NOT NULL DEFAULT \'{}\'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
      await db.query('CREATE TABLE IF NOT EXISTS academy_follows (follower_id TEXT NOT NULL, followed_id TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (follower_id, followed_id))');
      await db.query('CREATE TABLE IF NOT EXISTS academy_presence (discord_id TEXT NOT NULL, guild_id TEXT NOT NULL, minutes INTEGER NOT NULL DEFAULT 0, last_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY (discord_id, guild_id))');
    } catch (error) { logger('warn', 'academy_profiles_schema_failed', { error: String(error && error.message || error) }); }
  }

  /* ---------- settings ---------- */
  const rowToSettings = (r) => cleanSettings({ displayName: r.display_name, tagline: r.tagline, bio: r.bio, layout: r.layout, theme: typeof r.theme === 'string' ? JSON.parse(r.theme) : (r.theme || {}), song: typeof r.song === 'string' ? JSON.parse(r.song) : r.song, socials: typeof r.socials === 'string' ? JSON.parse(r.socials) : (r.socials || []), flags: typeof r.flags === 'string' ? JSON.parse(r.flags) : (r.flags || {}) }, defaults());
  async function settingsOf(userId) {
    const id = String(userId);
    let out;
    if (db) { const r = await db.query('SELECT * FROM academy_profiles WHERE discord_id=$1', [id]); out = r.rows[0] ? { ...defaults(), ...rowToSettings(r.rows[0]), exists: true } : { ...defaults(), exists: false }; }
    else out = mem.profiles.has(id) ? { ...defaults(), ...mem.profiles.get(id), exists: true } : { ...defaults(), exists: false };
    /* the image allow-list lives in memory: saved orbit pictures and link cards are allowed again after a restart */
    for (const o of (out.theme && out.theme.orbit) || []) images.add(o.image);
    for (const x of out.socials || []) if (x.card && x.card.image) images.add(x.card.image);
    return out;
  }
  async function save(userId, input = {}) {
    const id = String(userId); if (!SNOWFLAKE.test(id)) return { ok: false, error: 'invalid_user' };
    const prev = await settingsOf(id);
    const next = cleanSettings(input || {}, prev);
    delete next.exists;
    // link cards for new social links (best effort, bounded)
    for (const s of next.socials || []) if (!s.card) s.card = await linkCard(s.url);
    if (db) {
      await db.query('INSERT INTO academy_profiles (discord_id, display_name, tagline, bio, layout, theme, song, socials, flags, updated_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb, now()) ON CONFLICT (discord_id) DO UPDATE SET display_name=EXCLUDED.display_name, tagline=EXCLUDED.tagline, bio=EXCLUDED.bio, layout=EXCLUDED.layout, theme=EXCLUDED.theme, song=EXCLUDED.song, socials=EXCLUDED.socials, flags=EXCLUDED.flags, updated_at=now()',
        [id, next.displayName || '', next.tagline || '', next.bio || '', next.layout || 'classic', JSON.stringify(next.theme || {}), next.song ? JSON.stringify(next.song) : null, JSON.stringify(next.socials || []), JSON.stringify(next.flags || {})]);
    } else mem.profiles.set(id, next);
    for (const s of next.socials || []) if (s.card && s.card.image) images.add(s.card.image);
    for (const o of (next.theme && next.theme.orbit) || []) images.add(o.image);
    return { ok: true, settings: next };
  }

  /* ---------- link cards ---------- */
  async function linkCard(url) {
    const u = httpsUrl(url); if (!u) return null;
    const hit = cards.get(u); if (hit && now() - hit.at < 6 * 3_600_000) return hit.card;
    let card = { title: '', image: '', site: hostOf(u) };
    try {
      const res = await fetchImpl(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; MEM-Academy-LinkCard/1.0)', accept: 'text/html,*/*;q=0.5' }, redirect: 'follow', signal: AbortSignal.timeout(5_000) });
      if (res.ok && /text\/html/i.test(String(res.headers.get('content-type') || ''))) card = parseOg(await res.text(), u);
    } catch (error) { logger('info', 'academy_link_card_failed', { host: hostOf(u), error: String(error && error.message || error) }); }
    if (card.image) images.add(card.image);
    cards.set(u, { at: now(), card }); if (cards.size > 2000) cards.delete(cards.keys().next().value);
    return card;
  }
  /* the card image, served from the Academy's own origin; only images the server itself found on a saved link */
  async function linkImage(url) {
    const u = httpsUrl(url); if (!u || !images.has(u)) return null;
    try {
      const res = await fetchImpl(u, { redirect: 'follow', signal: AbortSignal.timeout(8_000) });
      if (!res.ok) return null;
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim();
      if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(type)) return null;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) return null;
      return { contentType: type, bytes };
    } catch (_) { return null; }
  }
  /* an orbit picture the member is adding: the server fetches it once to prove it is a real picture, then allows it. Only public
     https hosts (never an address or an internal name), and a handful of checks a minute per member. */
  const regs = new Map();
  const publicHost = (h) => !!h && h.includes('.') && !h.includes(':') && !/^[0-9.]+$/.test(h) && !/(^|\.)(localhost|local|internal|localdomain|home|lan)$/.test(h);
  async function registerImage(url, userId = '') {
    const u = httpsUrl(url); if (!u || !publicHost(hostOf(u))) return { ok: false, error: 'invalid_url' };
    const k = String(userId), t = now(), hits = (regs.get(k) || []).filter((x) => t - x < 60_000);
    if (hits.length >= 20) return { ok: false, error: 'slow_down' };
    hits.push(t); regs.set(k, hits); if (regs.size > 5000) regs.delete(regs.keys().next().value);
    const had = images.has(u); images.add(u);
    const img = await linkImage(u);
    if (!img) { if (!had) images.delete(u); return { ok: false, error: 'not_an_image' }; }
    return { ok: true, url: u };
  }
  /* a direct audio link, streamed through the Academy's origin (the page may only play media from itself) */
  async function audioStream(url, ownerId) {
    const u = httpsUrl(url); if (!u || !AUDIO_EXT.test(u)) return null;
    const s = await settingsOf(ownerId); if (!s.song || s.song.url !== u) return null;
    try {
      const res = await fetchImpl(u, { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) return null;
      const type = String(res.headers.get('content-type') || '').split(';')[0].trim() || 'audio/mpeg';
      const len = Number(res.headers.get('content-length')); if (len > MAX_AUDIO_BYTES) return null;
      if (!/^(audio\/|application\/octet-stream|video\/mp4)/.test(type)) return null;
      return { contentType: type.startsWith('audio/') ? type : 'audio/mpeg', body: res.body, length: Number.isFinite(len) ? len : null };
    } catch (_) { return null; }
  }

  /* ---------- follows ---------- */
  async function follow(a, b, on = true) {
    const x = String(a), y = String(b); if (!SNOWFLAKE.test(x) || !SNOWFLAKE.test(y) || x === y) return { ok: false, error: 'invalid_follow' };
    if (db) { if (on) await db.query('INSERT INTO academy_follows (follower_id, followed_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [x, y]); else await db.query('DELETE FROM academy_follows WHERE follower_id=$1 AND followed_id=$2', [x, y]); }
    else { if (on) mem.follows.add(x + '>' + y); else mem.follows.delete(x + '>' + y); }
    return { ok: true, following: on, ...(await followCounts(y, x)) };
  }
  async function followCounts(userId, viewerId = '') {
    const id = String(userId);
    if (db) {
      const r = await db.query('SELECT (SELECT COUNT(*) FROM academy_follows WHERE followed_id=$1) AS followers, (SELECT COUNT(*) FROM academy_follows WHERE follower_id=$1) AS following, EXISTS(SELECT 1 FROM academy_follows WHERE follower_id=$2 AND followed_id=$1) AS viewer', [id, String(viewerId || '')]);
      const x = r.rows[0] || {}; return { followers: Number(x.followers) || 0, following: Number(x.following) || 0, viewerFollows: !!x.viewer };
    }
    let followers = 0, following = 0;
    for (const k of mem.follows) { const [f, t] = k.split('>'); if (t === id) followers += 1; if (f === id) following += 1; }
    return { followers, following, viewerFollows: mem.follows.has(String(viewerId) + '>' + id) };
  }
  async function followers(userId, limit = 50) {
    const id = String(userId);
    if (db) return (await db.query('SELECT follower_id FROM academy_follows WHERE followed_id=$1 ORDER BY created_at DESC LIMIT $2', [id, limit])).rows.map((r) => String(r.follower_id));
    return [...mem.follows].filter((k) => k.endsWith('>' + id)).map((k) => k.split('>')[0]).slice(0, limit);
  }

  /* ---------- presence: one beat a minute from a visible Activity ---------- */
  async function beat(userId, guildId) {
    const id = String(userId), g = String(guildId || '');
    if (!SNOWFLAKE.test(id) || !SNOWFLAKE.test(g)) return { ok: false, error: 'invalid_presence' };
    const k = id + ':' + g, t = now();
    if (lastBeat.has(k) && t - lastBeat.get(k) < 50_000) return { ok: true, counted: false };
    lastBeat.set(k, t); if (lastBeat.size > 20_000) lastBeat.delete(lastBeat.keys().next().value);
    if (db) await db.query('INSERT INTO academy_presence (discord_id, guild_id, minutes, last_at) VALUES ($1,$2,1,now()) ON CONFLICT (discord_id, guild_id) DO UPDATE SET minutes=academy_presence.minutes+1, last_at=now()', [id, g]);
    else { const m = mem.presence.get(id) || new Map(); m.set(g, (m.get(g) || 0) + 1); mem.presence.set(id, m); }
    return { ok: true, counted: true };
  }
  async function mainServer(userId) {
    const id = String(userId);
    let rows = [];
    if (db) rows = (await db.query('SELECT guild_id, minutes FROM academy_presence WHERE discord_id=$1 ORDER BY minutes DESC LIMIT 5', [id])).rows.map((r) => ({ guildId: String(r.guild_id), minutes: Number(r.minutes) || 0 }));
    else rows = [...(mem.presence.get(id) || new Map()).entries()].map(([guildId, minutes]) => ({ guildId, minutes })).sort((a, b) => b.minutes - a.minutes);
    if (!rows.length) return null;
    const top = rows[0];
    let name = '';
    try { const g = directory && typeof directory.guild === 'function' ? await directory.guild(top.guildId) : null; name = g && g.name ? g.name : ''; } catch (_) { name = ''; }
    const total = rows.reduce((n, r) => n + r.minutes, 0);
    return { guildId: top.guildId, name: name || 'Discord server', minutes: top.minutes, sharePct: total > 0 ? Math.round(top.minutes / total * 100) : 100, servers: rows.length };
  }

  /* ---------- tier ---------- */
  async function tierOf(userId) {
    const id = String(userId); const hit = tiers.get(id); if (hit && now() - hit.at < 600_000) return hit.tier;
    let tier = 'member';
    try { tier = tierLive ? String(await tierLive(id)) : 'member'; } catch (_) { tier = 'member'; }
    tiers.set(id, { at: now(), tier }); if (tiers.size > 5000) tiers.delete(tiers.keys().next().value);
    return tier;
  }
  const tierLabel = (t) => ({ member: 'MEM member', academy: 'Academy', free: 'Free', none: 'Visitor' }[t] || 'Member');

  /* ---------- paper: the member's account and where it ranks ---------- */
  async function paperSummary(userId) {
    if (!paper) return null;
    try { const snap = await paper.snapshot('u:' + String(userId), { cash: 1000, name: 'My paper account', owner: String(userId) }); const s = snap && snap.summary; return s ? { equity: r2(num(s.equity) || 0), pnl: r2(num(s.pnl) || 0), returnPct: r2(num(s.returnPct) || 0), trades: Number(s.trades || (snap.trades || []).length) || 0, winRate: num(s.winRate), since: snap.createdAt || null } : null; }
    catch (_) { return null; }
  }
  async function leaderboard(limit = 50) {
    if (now() - lb.at < 60_000) return lb.rows.slice(0, limit);
    let rows = [];
    try {
      if (db) {
        const r = await db.query("SELECT key, value FROM academy_state_kv WHERE key LIKE 'paper:u:%'");
        for (const x of r.rows) { const acct = typeof x.value === 'string' ? JSON.parse(x.value) : x.value; const row = rankRow(String(x.key).slice('paper:u:'.length), acct); if (row) rows.push(row); }
      } else if (paperStore && typeof paperStore.all === 'function') {
        for (const [key, acct] of await paperStore.all()) { const row = rankRow(String(key).slice('paper:u:'.length), acct); if (row) rows.push(row); }
      }
    } catch (error) { logger('warn', 'academy_paper_leaderboard_failed', { error: String(error && error.message || error) }); }
    rows.sort((a, b) => b.returnPct - a.returnPct || b.equity - a.equity);
    rows.forEach((r, i) => { r.rank = i + 1; });
    lb = { at: now(), rows };
    return rows.slice(0, limit);
  }
  function rankRow(userId, acct) {
    if (!acct || !SNOWFLAKE.test(userId) || !Array.isArray(acct.trades) || !acct.trades.length) return null;
    const positions = Object.values(acct.positions || {});
    const equity = r2((num(acct.cash) || 0) + positions.reduce((s, p) => s + (num(p.qty) || 0) * (num(p.mark) || 0) * (p.kind === 'option' ? 100 : 1), 0));
    const deposited = (acct.deposits || []).reduce((s, d) => s + (num(d.amount) || 0), 0) || num(acct.startCash) || 1000;
    return { userId, equity, pnl: r2(equity - deposited), returnPct: r2((equity - deposited) / Math.max(1, deposited) * 100), trades: acct.trades.length };
  }
  async function rankOf(userId) { const rows = await leaderboard(100000); const i = rows.findIndex((r) => r.userId === String(userId)); return i >= 0 ? { rank: i + 1, of: rows.length, ...rows[i] } : { rank: null, of: rows.length }; }

  /* ---------- the page and the hover card ---------- */
  async function posts(userId, limit = 30) {
    if (!chat || typeof chat.byAuthor !== 'function') return [];
    try { return (await chat.byAuthor(String(userId), limit)).map((m) => ({ id: m.id, channel: m.channel, body: m.body, createdAt: m.createdAt, score: m.score || 0, reply: !!m.parentId })); } catch (_) { return []; }
  }
  async function page(userId, viewerId = '') {
    const id = String(userId); if (!SNOWFLAKE.test(id)) return null;
    const s = await settingsOf(id);
    const [tier, server, pap, rank, counts, feed] = await Promise.all([tierOf(id), s.flags.showServer === false ? null : mainServer(id), s.flags.showPaper === false ? null : paperSummary(id), s.flags.showPaper === false ? null : rankOf(id), followCounts(id, viewerId), s.flags.showFeed === false ? [] : posts(id, 30)]);
    return {
      userId: id, own: String(viewerId) === id, settings: s, layouts: LAYOUTS.map(([lid, name]) => ({ id: lid, name })),
      tier, tierLabel: tierLabel(tier), server, paper: pap ? { ...pap, rank: rank && rank.rank, of: rank && rank.of } : null,
      followers: counts.followers, following: counts.following, viewerFollows: counts.viewerFollows, posts: feed, asOf: now()
    };
  }
  async function card(userId, viewerId = '') {
    const id = String(userId); if (!SNOWFLAKE.test(id)) return null;
    const s = await settingsOf(id);
    const [tier, server, rank, counts, feed] = await Promise.all([tierOf(id), s.flags.showServer === false ? null : mainServer(id), s.flags.showPaper === false ? null : rankOf(id), followCounts(id, viewerId), s.flags.showFeed === false ? [] : posts(id, 3)]);
    return { userId: id, own: String(viewerId) === id, displayName: s.displayName, tagline: s.tagline, accent: s.theme.accent || '', layout: s.layout, tier, tierLabel: tierLabel(tier), server, paper: rank && rank.rank ? { rank: rank.rank, of: rank.of, returnPct: rank.returnPct, equity: rank.equity } : (rank ? { rank: null, of: rank.of } : null), followers: counts.followers, following: counts.following, viewerFollows: counts.viewerFollows, posts: feed };
  }

  return { ensureSchema, settingsOf, save, page, card, follow, followCounts, followers, beat, mainServer, leaderboard, rankOf, linkCard, linkImage, registerImage, audioStream, LAYOUTS };
}

module.exports = { createProfilePages, cleanSettings, parseOg, LAYOUTS, TEXTURES, DESKS, LIGHTS, ORBS };
