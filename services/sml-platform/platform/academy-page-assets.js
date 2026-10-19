'use strict';

/* The Academy Activity page is assembled from one HTML shell and about eighty inline scripts (2 MB of JavaScript that
 * never changes between requests) plus a few blocks that carry the request's own market data. Served inline, every open
 * downloads and gzips all of it again; the browser cannot cache any of it. This module splits the served page: runs of
 * adjacent inline <script> (or <style>) blocks whose content is the same on every request become one external file,
 * named by the hash of its content and served with a year-long immutable cache, so a repeat open downloads the small
 * shell only. The replacement tag is a classic blocking <script src>, which keeps the exact execution order of the
 * inline version (a deferred or async tag would not); preload hints in <head> fetch every bundle at once.
 *
 * Which blocks are static is learned, not guessed: the first request for a page variant renders the page twice with
 * two different synthetic markets and keeps the block hashes that match in both. A bundle that does not compile as one
 * file (a top-level name declared twice, say) falls back to one file per block, which is exactly the inline semantics.
 * A page whose bundle is missing (a restart with a page from an older deploy and a cold cache) reloads itself once. */

const crypto = require('node:crypto');
const zlib = require('node:zlib');
const vm = require('node:vm');

const BLOCK_RE = /<(script|style)(\s[^>]*)?>([\s\S]*?)<\/\1\s*>/g;
const MIN_BLOCK = 512;
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 20);

function blocksOf(html) {
  const out = [];
  let m;
  BLOCK_RE.lastIndex = 0;
  while ((m = BLOCK_RE.exec(html))) out.push({ kind: m[1], attrs: (m[2] || '').trim(), body: m[3], start: m.index, end: m.index + m[0].length, hash: sha(m[1] + '\n' + m[3]) });
  return out;
}

function compiles(js) {
  try { new vm.Script(js, { filename: 'academy-bundle.js' }); return true; } catch (_) { return false; }
}

function createPageAssets({ prefix = '/academy-activity/a/', maxBundles = 24, logger = () => {}, now = Date.now } = {}) {
  const bundles = new Map();  // id -> { kind, body, gz, br, etag, bytes, at }
  const staticSets = new Map();  // variant key -> Set of block hashes
  const stats = { bundlesBuilt: 0, bundleHits: 0, bundleMisses: 0, pagesTransformed: 0, bytesMoved: 0 };

  function remember(kind, body) {
    const id = sha(kind + '\n' + body);
    const hit = bundles.get(id);
    if (hit) { hit.at = now(); return id; }
    const buf = Buffer.from(body, 'utf8');
    const entry = {
      kind, body: buf, bytes: buf.length, at: now(), etag: `"${id}"`,
      gz: zlib.gzipSync(buf, { level: 9 }),
      br: zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length } })
    };
    bundles.set(id, entry);
    stats.bundlesBuilt += 1;
    if (bundles.size > maxBundles) { const oldest = [...bundles.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (oldest) bundles.delete(oldest[0]); }
    return id;
  }

  /* the block hashes that are the same across two renders of the same variant */
  function staticSetFor(key, canonical) {
    if (staticSets.has(key)) return staticSets.get(key);
    let set = new Set();
    try {
      const pages = canonical();
      if (Array.isArray(pages) && pages.length >= 2) {
        const counts = new Map();
        for (const page of pages) for (const b of new Set(blocksOf(String(page)).map((x) => x.hash))) counts.set(b, (counts.get(b) || 0) + 1);
        for (const [hash, n] of counts) if (n === pages.length) set.add(hash);
      }
    } catch (error) { logger('warn', 'academy_page_assets_canonical_failed', { error: String((error && error.message) || error) }); set = new Set(); }
    staticSets.set(key, set);
    logger('info', 'academy_page_assets_learned', { key, staticBlocks: set.size });
    return set;
  }

  const tagFor = (kind, id) => (kind === 'script'
    ? `<script src="${prefix}${id}.js" onerror="window.__smlAssetFail&&window.__smlAssetFail()"></script>`
    : `<link rel="stylesheet" href="${prefix}${id}.css" onerror="window.__smlAssetFail&&window.__smlAssetFail()">`);
  const preloadFor = (kind, id) => (kind === 'script' ? `<link rel="preload" as="script" href="${prefix}${id}.js">` : `<link rel="preload" as="style" href="${prefix}${id}.css">`);
  /* a missing bundle (restart + an older page + a cold cache) reloads the page once a minute at most */
  const GUARD = '<script>window.__smlAssetFail=function(){try{var k="sml-asset-reload",t=Number(sessionStorage.getItem(k))||0;if(Date.now()-t<60000)return;sessionStorage.setItem(k,String(Date.now()))}catch(_){}setTimeout(function(){location.reload()},200)};</script>';

  /* groups of adjacent static blocks of one kind, separated by whitespace only, become one file each */
  function transform(html, { key = 'default', canonical } = {}) {
    if (typeof html !== 'string' || typeof canonical !== 'function') return html;
    const statics = staticSetFor(key, canonical);
    if (!statics.size) return html;
    const blocks = blocksOf(html).filter((b) => !b.attrs && b.body.length >= MIN_BLOCK && statics.has(b.hash));
    if (!blocks.length) return html;
    const groups = [];
    for (const b of blocks) {
      const g = groups[groups.length - 1];
      if (g && g.kind === b.kind && /^\s*$/.test(html.slice(g.end, b.start))) { g.items.push(b); g.end = b.end; }
      else groups.push({ kind: b.kind, items: [b], start: b.start, end: b.end });
    }
    let out = '', cursor = 0;
    const preloads = [];
    for (const g of groups) {
      const joined = g.items.map((b) => b.body).join(g.kind === 'script' ? '\n;\n' : '\n');
      let tags;
      if (g.kind === 'style' || g.items.length === 1 || compiles(joined)) { const id = remember(g.kind, joined); tags = tagFor(g.kind, id); preloads.push(preloadFor(g.kind, id)); }
      else {
        /* the pieces do not compile as one file: one file per block keeps the inline semantics exactly */
        logger('warn', 'academy_page_assets_split', { kind: g.kind, blocks: g.items.length });
        tags = g.items.map((b) => { const id = remember(g.kind, b.body); preloads.push(preloadFor(g.kind, id)); return tagFor(g.kind, id); }).join('');
      }
      out += html.slice(cursor, g.start) + tags;
      cursor = g.end;
      stats.bytesMoved += joined.length;
    }
    out += html.slice(cursor);
    stats.pagesTransformed += 1;
    const head = out.indexOf('</head>');
    return head < 0 ? out : out.slice(0, head) + GUARD + preloads.join('') + out.slice(head);
  }

  /* GET <prefix><id>.js|css: immutable, content-negotiated, 304 on a matching ETag */
  function serve(request, response) {
    const url = String(request.url || '');
    const path = url.split('?')[0];
    if (!path.startsWith(prefix)) return false;
    const m = /^([a-f0-9]{20})\.(js|css)$/.exec(path.slice(prefix.length));
    const entry = m && bundles.get(m[1]);
    if (!entry || (m[2] === 'js') !== (entry.kind === 'script')) {
      stats.bundleMisses += 1;
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }); response.end('not found');
      return true;
    }
    stats.bundleHits += 1;
    entry.at = now();
    const type = entry.kind === 'script' ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8';
    const headers = { 'content-type': type, 'cache-control': 'public, max-age=31536000, immutable', etag: entry.etag, vary: 'accept-encoding', 'x-content-type-options': 'nosniff' };
    if (request.headers['if-none-match'] === entry.etag) { response.writeHead(304, headers); response.end(); return true; }
    const accept = String(request.headers['accept-encoding'] || '');
    let body = entry.body;
    if (/\bbr\b/.test(accept)) { body = entry.br; headers['content-encoding'] = 'br'; }
    else if (/\bgzip\b/.test(accept)) { body = entry.gz; headers['content-encoding'] = 'gzip'; }
    headers['content-length'] = body.length;
    response.writeHead(200, headers);
    response.end(request.method === 'HEAD' ? undefined : body);
    return true;
  }

  return { transform, serve, stats, prefix, bundles, blocksOf };
}

module.exports = { createPageAssets, blocksOf };
