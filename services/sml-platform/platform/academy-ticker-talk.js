'use strict';

/*
 * Ticker Talk: a comment section for every ticker in the Academy Live Chart Lab, the way a broker app has one.
 *
 * A comment is plain text with light markup the panel renders: "# " / "## " headings, **bold**, $TICKER cashtags
 * (tap to load that chart), @mentions picked from the member directory, pictures the member uploads (stored here and
 * served from the Academy's own origin, the only origin Discord lets the page load pictures from), and links, which the
 * panel shows as cards: stockmarketloop.com channels, videos / watch pages, live streams and news articles, YouTube
 * videos, and news articles from other sites. Discord invite / server links are refused. Members reply to each other
 * (one level deep). A comment can be removed by its author or an Academy owner; removed comments keep a deleted_at
 * mark and are never shown again. Posting is rate limited per member. Postgres when a pool is given, memory otherwise.
 */

const SNOWFLAKE = /^\d{15,25}$/;
const MAX_BODY = 2000;
const MAX_IMAGES = 4;
const MAX_LINKS = 4;
const MAX_IMAGE_BYTES = 1_500_000;
const URL_RE = /https?:\/\/[^\s<>"'`)\]]+/g;
const CASHTAG_RE = /\$([A-Za-z]{1,5})(?![A-Za-z0-9])/g;
const DISCORD_HOST = /(^|\.)(discord\.gg|discord\.com|discordapp\.com|discordapp\.net|discord\.new|dsc\.gg|discord\.me|discord\.io)$/i;
const YT_HOST = /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;
const SML_HOST = /(^|\.)stockmarketloop\.com$/i;

const cleanSymbol = (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9.:-]/g, '').slice(0, 10);
const cleanName = (v) => String(v || '').replace(/[\u0000-\u001f<>@]/g, '').trim().slice(0, 80);
const cleanBody = (v) => String(v || '').replace(/\r/g, '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_BODY);

function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch (_) { return ''; } }
function isDiscordLink(url) { return DISCORD_HOST.test(hostOf(url)); }
/* what kind of card a link gets */
function classifyLink(url) {
  let u; try { u = new URL(url); } catch (_) { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase(), path = u.pathname.toLowerCase();
  if (DISCORD_HOST.test(host)) return 'discord';
  if (YT_HOST.test(host)) return 'youtube';
  if (SML_HOST.test(host)) {
    if (/^\/watch(\/|$)/.test(path)) return 'watch';
    if (/^\/channel(\/|$)/.test(path)) return 'channel';
    if (/^\/(live|live-stream|lives|go-live)(\/|$)/.test(path) || /[?&]live=/.test(u.search)) return 'live';
    if (/^\/(n|letters?|loopletters?)(\/|$)/.test(path)) return 'letter';
    if (/^\/members?(\/|$)/.test(path)) return 'profile';
    return 'article';
  }
  return 'link';
}
function youtubeId(url) {
  try { const u = new URL(url); if (/youtu\.be$/i.test(u.hostname)) return u.pathname.slice(1).split('/')[0]; const v = u.searchParams.get('v'); if (v) return v; const m = /\/(embed|shorts|live)\/([\w-]{8,14})/.exec(u.pathname); return m ? m[2] : ''; } catch (_) { return ''; }
}
function extractLinks(body) {
  const seen = new Set(), out = [];
  for (const raw of String(body || '').match(URL_RE) || []) {
    const url = raw.replace(/[.,;:!?]+$/, '');
    if (seen.has(url)) continue; seen.add(url);
    out.push(url);
  }
  return out;
}
function extractCashtags(body) {
  const out = []; let m;
  const re = new RegExp(CASHTAG_RE.source, 'g');
  while ((m = re.exec(String(body || ''))) && out.length < 12) { const t = m[1].toUpperCase(); if (!out.includes(t)) out.push(t); }
  return out;
}
function sniffImage(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return '';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('latin1', 0, 6) === 'GIF87a' || buf.toString('latin1', 0, 6) === 'GIF89a') return 'image/gif';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return '';
}

function createTickerTalk({ pool = null, now = Date.now, logger = () => {}, linkCard = null, perMinute = 4, perHour = 40, limitDefault = 20, limitMax = 50, imagesPerHour = 30 } = {}) {
  const db = pool && typeof pool.query === 'function' ? pool : null;
  const mem = [], media = new Map(); let seq = 0, mseq = 0;
  const recent = new Map(), recentImg = new Map();

  async function ensureSchema() {
    if (!db) return;
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS academy_ticker_talk (id BIGSERIAL PRIMARY KEY, symbol TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
        parent_id BIGINT, images JSONB NOT NULL DEFAULT '[]', links JSONB NOT NULL DEFAULT '[]', mentions JSONB NOT NULL DEFAULT '[]', tickers JSONB NOT NULL DEFAULT '[]',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), deleted_at TIMESTAMPTZ, deleted_by TEXT)`);
      await db.query('CREATE INDEX IF NOT EXISTS academy_ticker_talk_symbol_idx ON academy_ticker_talk (symbol, id DESC)');
      await db.query('CREATE INDEX IF NOT EXISTS academy_ticker_talk_parent_idx ON academy_ticker_talk (parent_id)');
      await db.query('CREATE TABLE IF NOT EXISTS academy_ticker_media (id BIGSERIAL PRIMARY KEY, author_id TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, bytes BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    } catch (error) { logger('warn', 'academy_ticker_talk_schema_failed', { error: String(error && error.message || error) }); }
  }

  const iso = (v) => (v instanceof Date ? v.toISOString() : typeof v === 'number' ? new Date(v).toISOString() : String(v));
  const arr = (v) => (Array.isArray(v) ? v : (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch (_) { return []; } })() : []));
  const out = (r) => ({ id: String(r.id), symbol: String(r.symbol), authorId: String(r.author_id), authorName: String(r.author_name || ''), body: String(r.body), parentId: r.parent_id == null ? null : String(r.parent_id), images: arr(r.images).map(String), links: arr(r.links), mentions: arr(r.mentions), tickers: arr(r.tickers), createdAt: iso(r.created_at) });
  const memOut = (m) => out({ id: m.id, symbol: m.symbol, author_id: m.authorId, author_name: m.authorName, body: m.body, parent_id: m.parentId, images: m.images, links: m.links, mentions: m.mentions, tickers: m.tickers, created_at: m.createdAt });

  function allowed(map, id, perMin, perHr) {
    const t = now(), list = (map.get(id) || []).filter((x) => t - x < 3_600_000);
    map.set(id, list); if (map.size > 20_000) map.delete(map.keys().next().value);
    if (perMin && list.filter((x) => t - x < 60_000).length >= perMin) return 'slow_down';
    if (list.length >= perHr) return 'too_many_today';
    return '';
  }

  async function cardsFor(urls) {
    const cards = [];
    for (const url of urls.slice(0, MAX_LINKS)) {
      const kind = classifyLink(url); if (!kind || kind === 'discord') continue;
      let card = { url, kind, title: '', image: '', site: hostOf(url) };
      if (typeof linkCard === 'function') { try { const c = await Promise.race([linkCard(url), new Promise((r) => setTimeout(() => r(null), 6_000))]); if (c) card = Object.assign(card, { title: String(c.title || '').slice(0, 160), image: String(c.image || '').slice(0, 500), site: String(c.site || card.site).slice(0, 80) }); } catch (_) { /* a card without a title is still a card */ } }
      if (kind === 'youtube' && !card.image) { const id = youtubeId(url); if (id) card.image = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'; }
      if (kind === 'youtube') card.videoId = youtubeId(url);
      cards.push(card);
    }
    return cards;
  }

  async function findRoot(id, symbol) {
    if (db) { const r = await db.query('SELECT id, symbol, parent_id, deleted_at FROM academy_ticker_talk WHERE id = $1', [String(id)]); const row = r.rows[0]; return row && !row.deleted_at && row.parent_id == null && String(row.symbol) === symbol ? row : null; }
    const m = mem.find((x) => String(x.id) === String(id)); return m && !m.deletedAt && m.parentId == null && m.symbol === symbol ? m : null;
  }

  async function post(symbolRaw, author, { body: bodyRaw, parentId = null, imageIds = [], mentions = [] } = {}) {
    const symbol = cleanSymbol(symbolRaw); if (!symbol) return { ok: false, error: 'invalid_symbol' };
    const authorId = String(author && author.id || ''); if (!SNOWFLAKE.test(authorId)) return { ok: false, error: 'invalid_author' };
    const body = cleanBody(bodyRaw);
    const images = (Array.isArray(imageIds) ? imageIds : []).map(String).filter((x) => /^\d{1,12}$/.test(x)).slice(0, MAX_IMAGES);
    if (!body && !images.length) return { ok: false, error: 'empty_body' };
    const links = extractLinks(body);
    if (links.some(isDiscordLink)) return { ok: false, error: 'discord_links_not_allowed' };
    const limited = allowed(recent, authorId, perMinute, perHour); if (limited) return { ok: false, error: limited };
    let parent = null;
    if (parentId != null && parentId !== '') { parent = await findRoot(parentId, symbol); if (!parent) return { ok: false, error: 'parent_not_found' }; }
    for (const id of images) { if (!(await imageOwned(id, authorId))) return { ok: false, error: 'image_not_found' }; }
    const tagged = (Array.isArray(mentions) ? mentions : []).map((m) => ({ id: String(m && m.id || ''), name: cleanName(m && m.name) })).filter((m) => SNOWFLAKE.test(m.id) && m.name && body.indexOf('@' + m.name) >= 0).slice(0, 10);
    const cards = await cardsFor(links);
    const tickers = extractCashtags(body);
    const row = { symbol, author_id: authorId, author_name: cleanName(author.name), body, parent_id: parent ? String(parent.id) : null, images, links: cards, mentions: tagged, tickers };
    (recent.get(authorId) || []).push(now());
    if (db) {
      try {
        const r = await db.query('INSERT INTO academy_ticker_talk (symbol, author_id, author_name, body, parent_id, images, links, mentions, tickers) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb) RETURNING *',
          [row.symbol, row.author_id, row.author_name, row.body, row.parent_id, JSON.stringify(row.images), JSON.stringify(row.links), JSON.stringify(row.mentions), JSON.stringify(row.tickers)]);
        return { ok: true, comment: Object.assign(out(r.rows[0]), { replies: [] }) };
      } catch (error) { logger('warn', 'academy_ticker_talk_write_failed', { error: String(error && error.message || error) }); return { ok: false, error: 'storage_unavailable' }; }
    }
    const m = { id: ++seq, symbol, authorId, authorName: row.author_name, body, parentId: row.parent_id, images, links: cards, mentions: tagged, tickers, createdAt: now(), deletedAt: null };
    mem.push(m); if (mem.length > 5000) mem.shift();
    return { ok: true, comment: Object.assign(memOut(m), { replies: [] }) };
  }

  async function list(symbolRaw, { limit = limitDefault, before = '' } = {}) {
    const symbol = cleanSymbol(symbolRaw); if (!symbol) return { ok: false, error: 'invalid_symbol', comments: [], hasMore: false, count: 0 };
    const n = Math.max(1, Math.min(limitMax, Number(limit) || limitDefault));
    const beforeId = /^\d+$/.test(String(before || '')) ? String(before) : null;
    let roots, replies, total;
    if (db) {
      try {
        const r = await db.query('SELECT * FROM academy_ticker_talk WHERE symbol = $1 AND parent_id IS NULL AND deleted_at IS NULL AND ($2::bigint IS NULL OR id < $2::bigint) ORDER BY id DESC LIMIT $3', [symbol, beforeId, n + 1]);
        roots = r.rows.map(out);
        const ids = roots.slice(0, n).map((x) => x.id);
        replies = ids.length ? (await db.query('SELECT * FROM academy_ticker_talk WHERE parent_id = ANY($1::bigint[]) AND deleted_at IS NULL ORDER BY id ASC', [ids])).rows.map(out) : [];
        total = Number((await db.query('SELECT count(*)::int AS n FROM academy_ticker_talk WHERE symbol = $1 AND deleted_at IS NULL', [symbol])).rows[0].n) || 0;
      } catch (error) { logger('warn', 'academy_ticker_talk_read_failed', { error: String(error && error.message || error) }); return { ok: false, error: 'storage_unavailable', comments: [], hasMore: false, count: 0 }; }
    } else {
      const live = mem.filter((m) => m.symbol === symbol && !m.deletedAt);
      roots = live.filter((m) => m.parentId == null && (!beforeId || Number(m.id) < Number(beforeId))).sort((a, b) => b.id - a.id).slice(0, n + 1).map(memOut);
      const ids = new Set(roots.slice(0, n).map((x) => x.id));
      replies = live.filter((m) => m.parentId != null && ids.has(String(m.parentId))).sort((a, b) => a.id - b.id).map(memOut);
      total = live.length;
    }
    const hasMore = roots.length > n; roots = roots.slice(0, n);
    const byId = new Map(roots.map((r) => [r.id, Object.assign(r, { replies: [] })]));
    for (const rp of replies) { const p = byId.get(String(rp.parentId)); if (p) p.replies.push(rp); }
    return { ok: true, symbol, comments: roots, hasMore, count: total };
  }

  async function count(symbolRaw) {
    const symbol = cleanSymbol(symbolRaw); if (!symbol) return 0;
    if (db) { try { return Number((await db.query('SELECT count(*)::int AS n FROM academy_ticker_talk WHERE symbol = $1 AND deleted_at IS NULL', [symbol])).rows[0].n) || 0; } catch (_) { return 0; } }
    return mem.filter((m) => m.symbol === symbol && !m.deletedAt).length;
  }

  async function remove(id, byUserId, { elevated = false } = {}) {
    const who = String(byUserId || '');
    if (db) {
      try {
        const r = await db.query('SELECT id, author_id, deleted_at FROM academy_ticker_talk WHERE id = $1', [String(id)]); const row = r.rows[0];
        if (!row || row.deleted_at) return { ok: false, error: 'not_found' };
        if (String(row.author_id) !== who && !elevated) return { ok: false, error: 'forbidden' };
        await db.query('UPDATE academy_ticker_talk SET deleted_at = now(), deleted_by = $2 WHERE id = $1 OR parent_id = $1', [String(id), who]);
        return { ok: true, id: String(id) };
      } catch (error) { logger('warn', 'academy_ticker_talk_delete_failed', { error: String(error && error.message || error) }); return { ok: false, error: 'storage_unavailable' }; }
    }
    const m = mem.find((x) => String(x.id) === String(id) && !x.deletedAt); if (!m) return { ok: false, error: 'not_found' };
    if (m.authorId !== who && !elevated) return { ok: false, error: 'forbidden' };
    m.deletedAt = now(); m.deletedBy = who;
    for (const c of mem) if (String(c.parentId) === String(m.id) && !c.deletedAt) { c.deletedAt = now(); c.deletedBy = who; }
    return { ok: true, id: String(m.id) };
  }

  /* ---- pictures: stored here, served from the Academy's own origin ---- */
  async function storeImage(authorId, bytes) {
    const who = String(authorId || ''); if (!SNOWFLAKE.test(who)) return { ok: false, error: 'invalid_author' };
    if (!Buffer.isBuffer(bytes) || bytes.length < 64) return { ok: false, error: 'empty_file' };
    if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, error: 'file_too_large' };
    const contentType = sniffImage(bytes); if (!contentType) return { ok: false, error: 'not_an_image' };
    const limited = allowed(recentImg, who, 0, imagesPerHour); if (limited) return { ok: false, error: limited };
    (recentImg.get(who) || []).push(now());
    if (db) {
      try { const r = await db.query('INSERT INTO academy_ticker_media (author_id, content_type, size, bytes) VALUES ($1,$2,$3,$4) RETURNING id', [who, contentType, bytes.length, bytes]); return { ok: true, id: String(r.rows[0].id), contentType, size: bytes.length }; }
      catch (error) { logger('warn', 'academy_ticker_media_write_failed', { error: String(error && error.message || error) }); return { ok: false, error: 'storage_unavailable' }; }
    }
    const id = String(++mseq); media.set(id, { authorId: who, contentType, bytes, createdAt: now() });
    return { ok: true, id, contentType, size: bytes.length };
  }
  async function imageOwned(id, authorId) {
    if (db) { try { const r = await db.query('SELECT author_id FROM academy_ticker_media WHERE id = $1', [String(id)]); return !!(r.rows[0] && String(r.rows[0].author_id) === String(authorId)); } catch (_) { return false; } }
    const m = media.get(String(id)); return !!(m && m.authorId === String(authorId));
  }
  async function image(id) {
    if (!/^\d{1,12}$/.test(String(id || ''))) return null;
    if (db) { try { const r = await db.query('SELECT content_type, bytes FROM academy_ticker_media WHERE id = $1', [String(id)]); const row = r.rows[0]; return row ? { contentType: String(row.content_type), bytes: Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes) } : null; } catch (_) { return null; } }
    const m = media.get(String(id)); return m ? { contentType: m.contentType, bytes: m.bytes } : null;
  }

  return { configured: !!db, ensureSchema, post, list, count, remove, storeImage, image, MAX_BODY, MAX_IMAGE_BYTES, MAX_IMAGES };
}

module.exports = { createTickerTalk, classifyLink, isDiscordLink, extractLinks, extractCashtags, youtubeId, sniffImage, cleanSymbol, MAX_BODY, MAX_IMAGE_BYTES, MAX_IMAGES };
