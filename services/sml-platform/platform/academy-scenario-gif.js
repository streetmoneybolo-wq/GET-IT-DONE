'use strict';

/* The scenario GIF: the real candles, then the move the setup needs, drawn step by step to the price target.
 * Frames are SVG (same look as the Academy's scenario images), rendered by resvg to RGBA and encoded by gif-encode.js.
 * Without resvg on the machine, frames() still returns the SVG frames and gif() returns null. */

const path = require('node:path');
const { encodeGif, encodeGifAsync } = require('./gif-encode');

const W = 960, H = 540;
const FONT_DIR = path.join(__dirname, 'assets', 'fonts');
const FONTS = [path.join(FONT_DIR, 'DejaVuSans.ttf'), path.join(FONT_DIR, 'DejaVuSans-Bold.ttf')];
const FAMILY = 'DejaVu Sans';
let resvg; function loadResvg() { if (resvg !== undefined) return resvg; try { resvg = require('@resvg/resvg-js'); } catch (_) { resvg = null; } return resvg; }
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => (v >= 1 ? '$' + Number(v).toFixed(2) : '$' + Number(v).toFixed(4));
const clean = (bars) => (bars || []).map((b) => ({ t: Number(b.t), o: Number(b.o), h: Number(b.h), l: Number(b.l), c: Number(b.c) })).filter((b) => [b.o, b.h, b.l, b.c].every(Number.isFinite));

/* The projected path: from the last close through the waypoints to the target, with a little realistic wobble (seeded). */
function pathPoints({ last, waypoints, target, slots = 18, seed = 1 }) {
  const pts = [], anchors = [{ k: 0, p: last }];
  const wps = (waypoints || []).filter((w) => Number.isFinite(Number(w.price)));
  wps.forEach((w, i) => anchors.push({ k: Math.round(((i + 1) / (wps.length + 1)) * slots * 0.8), p: Number(w.price), label: w.label }));
  anchors.push({ k: slots, p: Number(target), label: 'TARGET' });
  let rnd = seed || 1; const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff - 0.5; };
  for (let k = 0; k <= slots; k++) {
    let a = anchors[0], b = anchors[anchors.length - 1];
    for (let i = 0; i < anchors.length - 1; i++) if (k >= anchors[i].k && k <= anchors[i + 1].k) { a = anchors[i]; b = anchors[i + 1]; break; }
    const f = b.k === a.k ? 1 : (k - a.k) / (b.k - a.k);
    const base = a.p + (b.p - a.p) * (f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2);
    const wob = k === 0 || k === slots ? 0 : rand() * Math.abs(b.p - a.p) * 0.18;
    const lab = anchors.find((x) => x.k === k && x.label);
    pts.push({ k, p: base + wob, label: lab ? lab.label : null, anchor: !!lab });
  }
  return pts;
}

/* One SVG frame: candles on the left, the path drawn up to `upto` slots on the right, levels, labels. */
function frameSvg({ symbol, bars, target, stop = null, levels = [], points, upto, title = '', subtitle = '', lean = 'bullish' }) {
  const b = clean(bars).slice(-40), n = b.length;
  const slots = points.length - 1;
  const px0 = 20, px1 = 900, py0 = 70, py1 = 470, plotW = px1 - px0, plotH = py1 - py0;
  const cols = n + slots + 2, step = plotW / cols;
  const X = (i) => px0 + (i + 0.5) * step;
  let lo = Infinity, hi = -Infinity;
  for (const x of b) { lo = Math.min(lo, x.l); hi = Math.max(hi, x.h); }
  for (const p of [target, stop, ...points.map((q) => q.p), ...levels.map((l) => Number(l.price))]) if (Number.isFinite(Number(p)) && p != null) { lo = Math.min(lo, Number(p)); hi = Math.max(hi, Number(p)); }
  if (!(hi > lo)) { hi = lo + 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const Y = (p) => py0 + (hi - p) / (hi - lo) * plotH;
  const col = lean === 'bearish' ? '#ff6b86' : '#35e6a0';
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FAMILY}">`);
  out.push(`<rect width="${W}" height="${H}" fill="#070d14"/><rect x="0" y="0" width="${W}" height="52" fill="#0b1520"/><rect x="0" y="50" width="${W}" height="2" fill="${col}" opacity=".8"/>`);
  out.push(`<text x="20" y="24" font-size="18" font-weight="bold" fill="${col}">${esc(title || ('$' + symbol + ' path to ' + money(target)))}</text>`);
  out.push(`<text x="20" y="42" font-size="12" fill="#9fb3be">${esc(subtitle || 'Real candles, then the move the setup needs. Speculative scenario, not advice.')}</text>`);
  for (let g = 0; g <= 4; g++) { const y = py0 + plotH * g / 4, p = hi - (hi - lo) * g / 4; out.push(`<line x1="${px0}" y1="${y.toFixed(1)}" x2="${px1}" y2="${y.toFixed(1)}" stroke="#13222e" stroke-width="1"/><text x="${px1 + 6}" y="${(y + 4).toFixed(1)}" font-size="11" fill="#6f8794">${esc(money(p))}</text>`); }
  // candles
  b.forEach((x, i) => { const up = x.c >= x.o, cx = X(i), w = Math.max(2, step * 0.6); out.push(`<line x1="${cx.toFixed(1)}" y1="${Y(x.h).toFixed(1)}" x2="${cx.toFixed(1)}" y2="${Y(x.l).toFixed(1)}" stroke="${up ? '#35e6a0' : '#ff6b86'}" stroke-width="1"/><rect x="${(cx - w / 2).toFixed(1)}" y="${Y(Math.max(x.o, x.c)).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(1, Y(Math.min(x.o, x.c)) - Y(Math.max(x.o, x.c))).toFixed(1)}" fill="${up ? '#35e6a0' : '#ff6b86'}"/>`); });
  // levels
  for (const l of levels || []) { const p = Number(l.price); if (!Number.isFinite(p)) continue; const y = Y(p); out.push(`<line x1="${px0}" y1="${y.toFixed(1)}" x2="${px1}" y2="${y.toFixed(1)}" stroke="#4d7fa3" stroke-width="1" stroke-dasharray="4 4"/><text x="${px0 + 4}" y="${(y - 4).toFixed(1)}" font-size="11" fill="#9fc3df">${esc(l.label)} ${esc(money(p))}</text>`); }
  if (stop != null && Number.isFinite(Number(stop))) { const y = Y(Number(stop)); out.push(`<line x1="${px0}" y1="${y.toFixed(1)}" x2="${px1}" y2="${y.toFixed(1)}" stroke="#ff6b86" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${px0 + 4}" y="${(y + 14).toFixed(1)}" font-size="11" font-weight="bold" fill="#ff9aa4">INVALIDATION ${esc(money(Number(stop)))}</text>`); }
  { const y = Y(Number(target)); out.push(`<line x1="${px0}" y1="${y.toFixed(1)}" x2="${px1}" y2="${y.toFixed(1)}" stroke="${col}" stroke-width="1.5" stroke-dasharray="6 4"/><text x="${px0 + 4}" y="${(y - 6).toFixed(1)}" font-size="12" font-weight="bold" fill="${col}">TARGET ${esc(money(Number(target)))}</text>`); }
  // the projected path up to this frame
  const shown = points.slice(0, Math.max(1, Math.min(points.length, upto + 1)));
  const d = shown.map((q, i) => `${i ? 'L' : 'M'}${X(n - 1 + q.k).toFixed(1)} ${Y(q.p).toFixed(1)}`).join(' ');
  out.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" opacity=".95"/>`);
  shown.forEach((q) => { if (!q.anchor && q.k !== 0) return; const cx = X(n - 1 + q.k), cy = Y(q.p); out.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="5" fill="${col}"/>`); if (q.label) out.push(`<text x="${(cx + 8).toFixed(1)}" y="${(cy - 8).toFixed(1)}" font-size="12" font-weight="bold" fill="#eaf5f8">${esc(q.label)}</text>`); });
  const head = shown[shown.length - 1]; out.push(`<circle cx="${X(n - 1 + head.k).toFixed(1)}" cy="${Y(head.p).toFixed(1)}" r="7" fill="none" stroke="${col}" stroke-width="2"/>`);
  // step strip
  const steps = points.filter((q) => q.label); out.push(`<rect x="0" y="${H - 48}" width="${W}" height="48" fill="#0b1520"/>`);
  steps.forEach((s, i) => { const on = head.k >= s.k; out.push(`<text x="${20 + i * 300}" y="${H - 20}" font-size="12" font-weight="bold" fill="${on ? col : '#4a5c68'}">${i + 1}. ${esc(s.label)} ${esc(money(s.p))}</text>`); });
  out.push(`<text x="${W - 16}" y="${H - 20}" font-size="10" fill="#6f8794" text-anchor="end">Making Easy Money data desk</text>`);
  out.push('</svg>');
  return out.join('');
}

function frames({ symbol, bars, last, target, stop = null, levels = [], waypoints = [], count = 16, seed = 7, title = '', subtitle = '', lean = 'bullish' }) {
  const b = clean(bars); const lastPx = Number.isFinite(Number(last)) ? Number(last) : (b.length ? b[b.length - 1].c : Number(target));
  const points = pathPoints({ last: lastPx, waypoints, target: Number(target), slots: Math.max(8, count), seed });
  const out = [];
  for (let k = 0; k <= points.length - 1; k++) out.push(frameSvg({ symbol, bars: b, target, stop, levels, points, upto: k, title, subtitle, lean }));
  return out;
}
function rasterize(svg) {
  const lib = loadResvg(); if (!lib) return null;
  const r = new lib.Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: FAMILY } });
  const img = r.render();
  return { width: img.width, height: img.height, pixels: Buffer.from(img.pixels) };
}
/* the GIF, or null when resvg is not available here */
function gif(opts) {
  const svgs = frames(opts);
  const lib = loadResvg(); if (!lib) return { gif: null, frames: svgs.length, firstSvg: svgs[0], lastSvg: svgs[svgs.length - 1] };
  const raster = svgs.map(rasterize);
  return { gif: encodeGif(raster, { delayMs: opts.delayMs || 140, lastHoldMs: opts.lastHoldMs || 2200 }), frames: svgs.length, firstSvg: svgs[0], lastSvg: svgs[svgs.length - 1], width: raster[0].width, height: raster[0].height };
}

/* the same GIF with the event loop given a turn after every frame (rasterizing and encoding 16 frames at once pinned
   the API's half core long enough for its health check to time out) */
async function gifAsync(opts) {
  const svgs = frames(opts);
  const lib = loadResvg(); if (!lib) return { gif: null, frames: svgs.length, firstSvg: svgs[0], lastSvg: svgs[svgs.length - 1] };
  const raster = [];
  for (const svg of svgs) { raster.push(rasterize(svg)); await new Promise((r) => setImmediate(r)); }
  return { gif: await encodeGifAsync(raster, { delayMs: opts.delayMs || 140, lastHoldMs: opts.lastHoldMs || 2200 }), frames: svgs.length, firstSvg: svgs[0], lastSvg: svgs[svgs.length - 1], width: raster[0].width, height: raster[0].height };
}

module.exports = { frames, frameSvg, pathPoints, gif, gifAsync, available: () => !!loadResvg(), W, H };
