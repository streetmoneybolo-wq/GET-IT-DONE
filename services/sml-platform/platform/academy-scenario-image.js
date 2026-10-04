'use strict';

/* Draws the two Click-to-Alert scenarios (academy-scenarios.js) as chart images: candles, the zones and levels from the smart-money map, the entry / target / stop,
 * and the schematic price path with numbered waypoints. The drawing is SVG (also shown in the Academy panel's preview); the PNG that goes to Discord is that SVG
 * rendered by resvg with the bundled DejaVu fonts. If resvg cannot be loaded on this machine, png() returns null and the alert is still posted, without pictures. */

const path = require('node:path');

const W = 1200, H = 675;
const FONT_DIR = path.join(__dirname, 'assets', 'fonts');
const FONTS = [path.join(FONT_DIR, 'DejaVuSans.ttf'), path.join(FONT_DIR, 'DejaVuSans-Bold.ttf')];
const FAMILY = 'DejaVu Sans';
const fin = Number.isFinite;

let resvg; // undefined = not tried, null = unavailable
function loadResvg() {
  if (resvg !== undefined) return resvg;
  try { resvg = require('@resvg/resvg-js'); } catch (_) { resvg = null; }
  return resvg;
}

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const price = (v) => (v >= 1 ? v.toFixed(2) : v.toFixed(4));
const clipText = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
/* greedy word wrap by character count (the font is proportional, so this is a safe over-estimate) */
function wrap(text, max) {
  const out = []; let line = '';
  for (const word of String(text).split(/\s+/)) { if ((line + ' ' + word).trim().length > max && line) { out.push(line); line = word; } else line = (line + ' ' + word).trim(); }
  if (line) out.push(line);
  return out;
}

const THEME = {
  base: { accent: '#35e6a0', soft: 'rgba(53,230,160,.16)', label: 'BASE CASE' },
  risk: { accent: '#ff6b86', soft: 'rgba(255,107,134,.16)', label: 'WATCH OUT' }
};

function svgFor(scn, which, meta = {}) {
  const sc = which === 'risk' ? scn.risk : scn.base, th = THEME[which === 'risk' ? 'risk' : 'base'];
  const { start, i0, iEnd } = scn.window;
  const px0 = 22, px1 = 1084, py0 = 76, py1 = 458, plotW = px1 - px0, plotH = py1 - py0;
  const cols = iEnd - start + 3, step = plotW / cols;
  const X = (i) => px0 + (i - start + 0.5) * step;

  // price range: the candles, the levels that matter, and the whole path
  let lo = Infinity, hi = -Infinity;
  for (const b of scn.bars) { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); }
  for (const p of [scn.entry, scn.target, scn.stop, ...sc.path.map((q) => q.p)]) { lo = Math.min(lo, p); hi = Math.max(hi, p); }
  const pad = (hi - lo) * 0.07; lo -= pad; hi += pad;
  const Y = (p) => py0 + (hi - p) / (hi - lo) * plotH;
  const inY = (p) => p >= lo && p <= hi;

  const parts = [];
  const add = (s) => parts.push(s);
  add('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="' + FAMILY + '">');
  add('<rect width="' + W + '" height="' + H + '" fill="#070d14"/>');
  // header
  add('<rect x="0" y="0" width="' + W + '" height="58" fill="#0b1520"/><rect x="0" y="56" width="' + W + '" height="2" fill="' + th.accent + '" opacity=".8"/>');
  add('<text x="22" y="26" font-size="20" font-weight="bold" fill="' + th.accent + '">' + esc(sc.title) + '</text>');
  add('<text x="22" y="46" font-size="13" fill="#9fb3be">' + esc(sc.subtitle) + '</text>');
  const side = scn.side === 'short' ? 'SHORT' : 'LONG';
  add('<text x="' + (W - 22) + '" y="26" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="end">' + esc(scn.symbol) + ' · ' + side + (meta.horizonLabel ? ' · ' + esc(String(meta.horizonLabel).toUpperCase()) : '') + '</text>');
  add('<text x="' + (W - 22) + '" y="46" font-size="13" fill="#9fb3be" text-anchor="end">' + esc(scn.tf) + ' chart · entry $' + price(scn.entry) + ' → target $' + price(scn.target) + ' · stop $' + price(scn.stop) + '</text>');
  // plot
  add('<rect x="' + px0 + '" y="' + py0 + '" width="' + plotW + '" height="' + plotH + '" fill="#0a1118"/>');
  const ticks = 6;
  for (let t = 0; t <= ticks; t++) { const p = lo + (hi - lo) * (t / ticks), y = Y(p); add('<line x1="' + px0 + '" y1="' + y.toFixed(1) + '" x2="' + px1 + '" y2="' + y.toFixed(1) + '" stroke="#16222d" stroke-width="1"/><text x="' + (px1 + 8) + '" y="' + (y + 4).toFixed(1) + '" font-size="12" fill="#6f8794">' + price(p) + '</text>'); }
  // the projected region
  const nowX = X(i0) + step / 2;
  add('<rect x="' + nowX.toFixed(1) + '" y="' + py0 + '" width="' + (px1 - nowX).toFixed(1) + '" height="' + plotH + '" fill="#ffffff" opacity=".035"/>');
  add('<line x1="' + nowX.toFixed(1) + '" y1="' + py0 + '" x2="' + nowX.toFixed(1) + '" y2="' + py1 + '" stroke="#5d7085" stroke-width="1" stroke-dasharray="4 4"/><text x="' + (nowX + 6).toFixed(1) + '" y="' + (py0 + 14) + '" font-size="11" fill="#7f95a1">NOW · projected path →</text>');
  // how long the projected part is meant to take
  if (scn.expectedDays && scn.expectedDays.mid) { const d = scn.expectedDays.mid, ex = X(iEnd); add('<line x1="' + ex.toFixed(1) + '" y1="' + (py1 - 20) + '" x2="' + ex.toFixed(1) + '" y2="' + py1 + '" stroke="#5d7085" stroke-width="1"/><text x="' + (ex - 4).toFixed(1) + '" y="' + (py1 - 8) + '" font-size="11" fill="#9fb3be" text-anchor="end">≈ ' + (d < 1 ? 'under a day' : d.toFixed(d < 10 ? 1 : 0) + ' trading days') + ' from now</text>'); }
  // zones
  for (const z of scn.zones) {
    if (!(inY(z.top) || inY(z.bottom))) continue;
    const x1 = Math.max(px0, X(z.from)), y1 = Y(Math.min(hi, z.top)), y2 = Y(Math.max(lo, z.bottom));
    const col = z.kind === 'DEMAND' ? '77,195,255' : z.kind === 'SUPPLY' ? '255,170,60' : z.dir > 0 ? '0,208,132' : '255,84,112';
    add('<rect x="' + x1.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + (px1 - x1).toFixed(1) + '" height="' + Math.max(2, y2 - y1).toFixed(1) + '" fill="rgba(' + col + ',.11)" stroke="rgba(' + col + ',.55)" stroke-width="1" stroke-dasharray="3 3"/>');
    add('<text x="' + (x1 + 5).toFixed(1) + '" y="' + (y1 + 12).toFixed(1) + '" font-size="10" font-weight="bold" fill="rgb(' + col + ')">' + esc(z.kind) + '</text>');
  }
  for (const p of scn.pools) if (inY(p.price)) add('<line x1="' + px0 + '" y1="' + Y(p.price).toFixed(1) + '" x2="' + px1 + '" y2="' + Y(p.price).toFixed(1) + '" stroke="' + (p.kind === 'EQH' ? '#ff9f6b' : '#6bd0ff') + '" stroke-width="1.4" stroke-dasharray="2 4"/><text x="' + (px1 - 6) + '" y="' + (Y(p.price) - 4).toFixed(1) + '" font-size="10" fill="' + (p.kind === 'EQH' ? '#ff9f6b' : '#6bd0ff') + '" text-anchor="end">' + p.kind + ' x' + p.count + '</text>');
  // candles
  const bw = Math.max(1.5, step * 0.62);
  scn.bars.forEach((b, k) => {
    const x = X(start + k), up = b.c >= b.o, col = up ? '#26d98a' : '#ff5470', yo = Y(b.o), yc = Y(b.c);
    add('<line x1="' + x.toFixed(1) + '" y1="' + Y(b.h).toFixed(1) + '" x2="' + x.toFixed(1) + '" y2="' + Y(b.l).toFixed(1) + '" stroke="' + col + '" stroke-width="1"/><rect x="' + (x - bw / 2).toFixed(1) + '" y="' + Math.min(yo, yc).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(1, Math.abs(yc - yo)).toFixed(1) + '" fill="' + col + '"/>');
  });
  // entry / target / stop lines
  const hline = (p, color, label) => { if (!inY(p)) return; const y = Y(p); add('<line x1="' + X(i0).toFixed(1) + '" y1="' + y.toFixed(1) + '" x2="' + px1 + '" y2="' + y.toFixed(1) + '" stroke="' + color + '" stroke-width="1.6" stroke-dasharray="7 5"/><rect x="' + (px1 + 2) + '" y="' + (y - 9).toFixed(1) + '" width="110" height="18" rx="3" fill="' + color + '"/><text x="' + (px1 + 8) + '" y="' + (y + 4).toFixed(1) + '" font-size="10.5" font-weight="bold" fill="#04121a">' + label + ' ' + price(p) + '</text>'); };
  hline(scn.entry, '#4dc3ff', 'ENTRY'); hline(scn.target, scn.side === 'short' ? '#ff9db0' : '#35e6a0', 'TARGET'); hline(scn.stop, '#ffb04a', 'STOP');
  // the path: a wide soft stroke, a dashed line on top, an arrowhead, then numbered waypoints
  const pts = sc.path.map((q) => X(q.i).toFixed(1) + ',' + Y(q.p).toFixed(1)).join(' ');
  add('<polyline points="' + pts + '" fill="none" stroke="' + th.accent + '" stroke-opacity=".28" stroke-width="9" stroke-linejoin="round" stroke-linecap="round"/>');
  add('<polyline points="' + pts + '" fill="none" stroke="' + th.accent + '" stroke-width="3" stroke-dasharray="9 6" stroke-linejoin="round" stroke-linecap="round"/>');
  const n = sc.path.length, e = sc.path[n - 1], pr = sc.path[n - 2];
  if (pr) { const ang = Math.atan2(Y(e.p) - Y(pr.p), X(e.i) - X(pr.i)), ax = X(e.i), ay = Y(e.p), s = 12; add('<polygon points="' + [[ax, ay], [ax - s * Math.cos(ang - 0.45), ay - s * Math.sin(ang - 0.45)], [ax - s * Math.cos(ang + 0.45), ay - s * Math.sin(ang + 0.45)]].map((q) => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ') + '" fill="' + th.accent + '"/>'); }
  const placed = [];
  sc.waypoints.forEach((w, k) => {
    const x = X(w.i), y = Y(w.p);
    add('<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="10" fill="#070d14" stroke="' + th.accent + '" stroke-width="2"/><text x="' + x.toFixed(1) + '" y="' + (y + 4).toFixed(1) + '" font-size="12" font-weight="bold" fill="' + th.accent + '" text-anchor="middle">' + (k + 1) + '</text>');
    if (k === 0) return;
    // a label next to the waypoint, nudged away from earlier labels
    const text = clipText(w.label, 44), tw = text.length * 6.6 + 14, lastWay = k === sc.waypoints.length - 1; let lx = lastWay ? Math.max(px0 + 4, x - tw - 18) : Math.min(px1 - tw - 4, Math.max(px0 + 4, x - tw / 2)), ly = lastWay ? y - 11 : y + (w.p >= (sc.waypoints[k - 1] ? sc.waypoints[k - 1].p : w.p) ? -34 : 16);
    for (let tries = 0; tries < 6; tries++) { const hit = placed.find((b) => lx < b.x + b.w && lx + tw > b.x && ly < b.y + 22 && ly + 22 > b.y); if (!hit) break; ly += (w.p >= scn.entry ? -24 : 24); }
    ly = Math.min(py1 - 24, Math.max(py0 + 22, ly)); placed.push({ x: lx, y: ly, w: tw });
    add('<rect x="' + lx.toFixed(1) + '" y="' + ly.toFixed(1) + '" width="' + tw.toFixed(1) + '" height="22" rx="4" fill="#0b1520" stroke="' + th.accent + '" stroke-opacity=".6"/><text x="' + (lx + 7).toFixed(1) + '" y="' + (ly + 15).toFixed(1) + '" font-size="12" fill="#e6eef2">' + esc(text) + '</text>');
  });
  // the reasons
  add('<rect x="' + px0 + '" y="472" width="' + plotW + '" height="' + (H - 472 - 34) + '" fill="#0b1520" rx="6"/>');
  add('<text x="' + (px0 + 14) + '" y="494" font-size="12" font-weight="bold" fill="' + th.accent + '">' + (which === 'risk' ? 'WHAT TO WATCH' : 'WHY THIS PATH') + '</text>');
  let y = 514;
  for (const b of sc.bullets.slice(0, 5)) {
    const lines = wrap(b, 138).slice(0, 2);
    add('<circle cx="' + (px0 + 18) + '" cy="' + (y - 4) + '" r="3" fill="' + th.accent + '"/>');
    lines.forEach((ln, q) => add('<text x="' + (px0 + 30) + '" y="' + (y + q * 15) + '" font-size="12.5" fill="#d3e0e7">' + esc(ln) + '</text>'));
    y += lines.length * 15 + 5;
  }
  add('<text x="' + px0 + '" y="' + (H - 12) + '" font-size="11" fill="#6f8794">Illustrative path built from the Academy\'s data. Not a prediction, not financial advice, not a trade instruction. Making Easy Money Academy</text>');
  add('</svg>');
  return parts.join('');
}

/* the PNG for Discord, or null when resvg is not available on this machine */
function png(svg) {
  const lib = loadResvg(); if (!lib) return null;
  try {
    const r = new lib.Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: false, fontFiles: FONTS, defaultFontFamily: FAMILY } });
    return Buffer.from(r.render().asPng());
  } catch (_) { return null; }
}

/* both images for one alert: { name, alt, svg, png } each */
function renderPair(scn, meta = {}, { withPng = true } = {}) {
  if (!scn) return [];
  const sym = String(scn.symbol || 'chart').toLowerCase().replace(/[^a-z0-9]/g, '');
  const defs = [['base', 'scenario-1-base-case', 'Scenario 1, base case: how the move could play out'], ['risk', 'scenario-2-watch-out', 'Scenario 2, what to watch out for if the trade goes wrong']];
  return defs.map(([which, name, alt]) => { const svg = svgFor(scn, which, meta); return { which, name: sym + '-' + name + '.png', alt: scn.symbol + ' ' + alt, svg, png: withPng ? png(svg) : null }; });
}

module.exports = { svgFor, png, renderPair, available: () => !!loadResvg(), W, H };
