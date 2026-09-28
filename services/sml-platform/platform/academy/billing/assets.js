'use strict';

/* Brand assets for the billing pages (logo, hero video, mascots, optional intro audio), served from this folder at
   /v1/academy/billing/assets/<name>. Only the names listed here are served, straight from disk, long-cached and with
   byte-range support so the hero video and the audio can seek. The pages' CSP allows 'self' only, so these are the
   only images and media the store can show. store-music.mp3 gives the store pages a "Music on" button, and thank-you.mp4
   plays on the thank-you page after a purchase (browsers start it muted; a tap turns the sound on). */

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, 'assets');
const TYPES = Object.freeze({
  'academy-hero.mp4': 'video/mp4',
  'academy-hero.webm': 'video/webm',
  'academy-poster.webp': 'image/webp',
  'academy-hero-poster.webp': 'image/webp',
  'banner-bull-bear.webp': 'image/webp',
  'grandmaster-obi.webp': 'image/webp',
  'grandmaster-obi-chibi.gif': 'image/gif',
  'me-crown.webp': 'image/webp',
  'store-music.mp3': 'audio/mpeg',
  'thank-you.mp4': 'video/mp4',
  'thank-you.webm': 'video/webm',
  'thank-you-poster.webp': 'image/webp'
});
const PREFIX = '/v1/academy/billing/assets/';

function assetPath(name) { return TYPES[name] ? path.join(DIR, name) : ''; }
function hasAsset(name) { const file = assetPath(name); if (!file) return false; try { return fs.statSync(file).isFile(); } catch (_) { return false; } }
function assetUrl(name) { return PREFIX + name; }

/* GET/HEAD with ETag, 304 and single byte ranges (206). Anything not in TYPES is a 404. */
function sendAsset(request, response, name) {
  const file = assetPath(name);
  let stat;
  try { stat = file ? fs.statSync(file) : null; } catch (_) { stat = null; }
  if (!stat || !stat.isFile()) { response.writeHead(404, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end('{"ok":false,"error":"not_found"}'); return; }
  const size = stat.size;
  const etag = `"mab-${name}-${size}-${Math.floor(stat.mtimeMs)}"`;
  const common = { 'content-type': TYPES[name], 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=86400', etag, 'x-content-type-options': 'nosniff' };
  if (!request.headers.range && request.headers['if-none-match'] === etag) { response.writeHead(304, common); response.end(); return; }
  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(request.headers.range || ''));
  let start = 0, end = size - 1;
  if (request.headers.range) {
    if (!match || (!match[1] && !match[2])) { response.writeHead(416, { ...common, 'content-range': `bytes */${size}` }); response.end(); return; }
    if (!match[1]) start = size - Math.min(size, Number(match[2]));
    else { start = Number(match[1]); if (match[2]) end = Math.min(size - 1, Number(match[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) { response.writeHead(416, { ...common, 'content-range': `bytes */${size}` }); response.end(); return; }
  }
  const partial = Boolean(request.headers.range);
  response.writeHead(partial ? 206 : 200, { ...common, 'content-length': end - start + 1, ...(partial ? { 'content-range': `bytes ${start}-${end}/${size}` } : {}) });
  if (request.method === 'HEAD') { response.end(); return; }
  fs.createReadStream(file, { start, end }).pipe(response);
}

module.exports = { sendAsset, hasAsset, assetUrl, TYPES, PREFIX };
