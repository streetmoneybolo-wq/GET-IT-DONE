'use strict';

/* The session recap's chart, drawn on the server as SVG: one trading day of intraday candles from the pre-market through the close,
 * coloured by dealer gamma regime when the chain is known, with VWAP and its 1st and 2nd bands, the Initial Balance, the call and
 * put walls and the gamma flip, the pre-market shaded, and the lettered markers the written recap refers to. Everything is escaped;
 * nothing here emits script or external references. academy-scenario-image.png() turns the SVG into the PNG Discord gets. */

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r1 = (v) => Math.round(v * 10) / 10;
const BG = '#0b1119', INK = '#dbe6ee', MUT = '#8aa0ad', LINE = 'rgba(255,255,255,.08)';
const REGIME = { positive: '#4dc3ff', negative: '#ff5470', neutral: '#c879ff' };
const UP = '#19c37d', DN = '#ff5c7a';
const FONT = 'DejaVu Sans, system-ui, sans-serif';
const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', hour: 'numeric', minute: 'numeric' });
function etMin(t) { const o = {}; for (const p of fmt.formatToParts(new Date(t))) if (p.type !== 'literal') o[p.type] = p.value; return Number(o.hour) * 60 + Number(o.minute); }
const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const px = (v) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4));

function niceStep(range, ticks) {
  const raw = range / Math.max(1, ticks), pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / pow; const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

/* opts: { symbol, title, subtitle, bars [{t,o,h,l,c,v}] (one day, oldest first), vwap [{vwap, sd, up:[], dn:[]}|null] aligned to bars,
          regime ['positive'|'negative'|'neutral'] aligned to bars (optional), ib { hi, lo, startT, endT } (optional),
          levels [{ label, price, key }] (walls, flip; optional), markers [{ letter, i, price, side:'high'|'low', phase:'morning'|'afternoon' }],
          prevClose, width 1600, height 900, footer } */
function intradaySvg(opts = {}) {
  const W = num(opts.width, 1600), H = num(opts.height, 900);
  const bars = (opts.bars || []).filter((b) => b && num(b.o) != null && num(b.h) != null && num(b.l) != null && num(b.c) != null);
  if (bars.length < 5) return { svg: '', ok: false, reason: 'too_few_bars' };
  const vwap = Array.isArray(opts.vwap) ? opts.vwap : [], regime = Array.isArray(opts.regime) ? opts.regime : [];
  const levels = (opts.levels || []).filter((l) => l && num(l.price) != null).slice(0, 6), markers = (opts.markers || []).filter((m) => m && Number.isInteger(m.i) && m.i >= 0 && m.i < bars.length);
  const ib = opts.ib && num(opts.ib.hi) != null && num(opts.ib.lo) != null ? opts.ib : null;
  const padL = 18, padR = 96, padT = 56, padB = 92;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const ys = [];
  for (const b of bars) ys.push(num(b.h), num(b.l));
  for (const v of vwap) if (v) ys.push(v.up[v.up.length - 1], v.dn[v.dn.length - 1]);
  if (ib) ys.push(ib.hi, ib.lo);
  if (num(opts.prevClose) != null) ys.push(num(opts.prevClose));
  let lo = Math.min(...ys), hi = Math.max(...ys);
  /* walls inside one chart height of the candles are shown; a wall miles away would squash the day into a line */
  const span0 = hi - lo || hi * 0.01;
  for (const l of levels) if (l.price > hi && l.price - hi <= span0 * 0.5) hi = l.price; else if (l.price < lo && lo - l.price <= span0 * 0.5) lo = l.price;
  const span = Math.max(hi - lo, (hi || 1) * 0.004); lo -= span * 0.07; hi += span * 0.09;
  const yOf = (v) => padT + (hi - v) / (hi - lo) * plotH;
  const slot = plotW / bars.length, cw = Math.max(1.5, Math.min(12, slot * 0.64));
  const xOf = (i) => padL + slot * (i + 0.5);
  const parts = [];
  parts.push('<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="' + FONT + '">');
  parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" fill="' + BG + '"/>');
  if (opts.title) parts.push('<text x="' + padL + '" y="26" fill="#fff" font-size="20" font-weight="700">' + esc(opts.title) + '</text>');
  if (opts.subtitle) parts.push('<text x="' + padL + '" y="46" fill="' + MUT + '" font-size="13">' + esc(opts.subtitle) + '</text>');
  /* the pre-market shaded, the regular session clear */
  const mins = bars.map((b) => etMin(num(b.t)));
  let preEnd = -1; for (let i = 0; i < bars.length; i++) if (mins[i] < 570) preEnd = i;
  if (preEnd >= 0) parts.push('<rect x="' + padL + '" y="' + padT + '" width="' + r1(slot * (preEnd + 1)) + '" height="' + plotH + '" fill="rgba(255,255,255,.035)"/>');
  /* grid, price axis on the right */
  const step = niceStep(hi - lo, 10);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const y = yOf(v);
    parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + r1(y) + '" y2="' + r1(y) + '" stroke="' + LINE + '"/>');
    parts.push('<text x="' + (W - padR + 10) + '" y="' + r1(y + 4) + '" fill="' + MUT + '" font-size="12">' + esc(px(v)) + '</text>');
  }
  /* time axis every 30 minutes */
  for (let i = 0; i < bars.length; i++) {
    if (mins[i] % 30 !== 0 || (i > 0 && mins[i - 1] === mins[i])) continue;
    const x = xOf(i);
    parts.push('<line x1="' + r1(x) + '" x2="' + r1(x) + '" y1="' + padT + '" y2="' + (padT + plotH) + '" stroke="' + LINE + '"/>');
    parts.push('<text x="' + r1(x) + '" y="' + (padT + plotH + 18) + '" fill="' + MUT + '" font-size="12" text-anchor="middle">' + hhmm(mins[i]) + '</text>');
  }
  /* Initial Balance: the first hour boxed, its high and low carried to the close */
  if (ib) {
    let i0 = -1, i1 = -1;
    for (let i = 0; i < bars.length; i++) { const t = num(bars[i].t); if (i0 < 0 && t >= ib.startT) i0 = i; if (t <= ib.endT) i1 = i; }
    if (i0 >= 0 && i1 >= i0) {
      const x1 = xOf(i0) - slot / 2, x2 = xOf(i1) + slot / 2;
      parts.push('<rect x="' + r1(x1) + '" y="' + r1(yOf(ib.hi)) + '" width="' + r1(x2 - x1) + '" height="' + r1(Math.max(1, yOf(ib.lo) - yOf(ib.hi))) + '" fill="rgba(255,255,255,.07)"/>');
      for (const p of [ib.hi, ib.lo]) parts.push('<line x1="' + r1(x1) + '" x2="' + (W - padR) + '" y1="' + r1(yOf(p)) + '" y2="' + r1(yOf(p)) + '" stroke="rgba(235,243,255,.8)" stroke-width="1.4" stroke-dasharray="9 5"/>');
      parts.push('<text x="' + r1(x1 + 4) + '" y="' + r1(yOf(ib.hi) - 5) + '" fill="#eef4ff" font-size="11" font-weight="700">IB ' + esc(px(ib.lo)) + ' to ' + esc(px(ib.hi)) + '</text>');
    }
  }
  /* yesterday's close */
  if (num(opts.prevClose) != null) { const y = yOf(num(opts.prevClose)); parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + r1(y) + '" y2="' + r1(y) + '" stroke="rgba(138,160,173,.6)" stroke-dasharray="2 5"/><text x="' + (padL + 4) + '" y="' + r1(y - 4) + '" fill="' + MUT + '" font-size="11">PREV CLOSE ' + esc(px(num(opts.prevClose))) + '</text>'); }
  /* VWAP and the bands */
  const path = (get, stroke, width, dash) => {
    let d = '', pen = false;
    for (let i = 0; i < bars.length; i++) { const v = vwap[i]; if (!v) { pen = false; continue; } const val = get(v); if (num(val) == null) { pen = false; continue; } d += (pen ? 'L' : 'M') + r1(xOf(i)) + ' ' + r1(yOf(val)) + ' '; pen = true; }
    if (d) parts.push('<path d="' + d.trim() + '" fill="none" stroke="' + stroke + '" stroke-width="' + width + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>');
  };
  path((v) => v.up[1], 'rgba(200,121,255,.8)', 1.4, '4 5'); path((v) => v.dn[1], 'rgba(200,121,255,.8)', 1.4, '4 5');
  path((v) => v.up[0], 'rgba(255,99,99,.9)', 1.6, null); path((v) => v.dn[0], 'rgba(255,99,99,.9)', 1.6, null); path((v) => v.vwap, '#ffd166', 2.6, null);
  /* the walls and the flip, each with a label pill at the right edge */
  for (const l of levels) {
    if (l.price < lo || l.price > hi) continue;
    const y = yOf(l.price), col = l.key === 'callWall' ? '#4dc3ff' : l.key === 'putWall' ? '#ff5470' : l.key === 'flip' ? '#c879ff' : '#9fb3bd';
    parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + r1(y) + '" y2="' + r1(y) + '" stroke="' + col + '" stroke-width="1.6" stroke-dasharray="10 6"/>');
    const label = String(l.label || l.key || '').toUpperCase() + ' ' + px(l.price), tw = label.length * 7.2 + 14;
    parts.push('<rect x="' + r1(W - padR - tw - 6) + '" y="' + r1(y - 10) + '" width="' + r1(tw) + '" height="19" rx="5" fill="rgba(7,14,20,.92)" stroke="' + col + '"/><text x="' + r1(W - padR - tw + 1) + '" y="' + r1(y + 4) + '" fill="' + col + '" font-size="11" font-weight="700">' + esc(label) + '</text>');
  }
  /* candles, coloured by regime when known */
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], o = num(b.o), h = num(b.h), l = num(b.l), c = num(b.c), x = xOf(i);
    const col = regime[i] ? (REGIME[regime[i]] || REGIME.neutral) : (c >= o ? UP : DN);
    parts.push('<line x1="' + r1(x) + '" x2="' + r1(x) + '" y1="' + r1(yOf(h)) + '" y2="' + r1(yOf(l)) + '" stroke="' + col + '" stroke-width="1"/>');
    const top = yOf(Math.max(o, c)), bh = Math.max(1, Math.abs(yOf(o) - yOf(c)));
    parts.push('<rect x="' + r1(x - cw / 2) + '" y="' + r1(top) + '" width="' + r1(cw) + '" height="' + r1(bh) + '" fill="' + (c >= o ? col : BG) + '" stroke="' + col + '" stroke-width="1"/>');
  }
  /* lettered markers: morning in yellow, afternoon in green, above a high or below a low */
  const placed = [];
  for (const m of markers) {
    const b = bars[m.i], x = xOf(m.i), above = m.side !== 'low'; let y = above ? yOf(num(b.h)) - 14 : yOf(num(b.l)) + 24;
    /* two letters on neighbouring bars on the same side step away from each other instead of overprinting */
    for (const q of placed) if (Math.abs(q.x - x) < 22 && Math.abs(q.y - y) < 26) y = above ? q.y - 26 : q.y + 26;
    placed.push({ x, y });
    const col = m.phase === 'afternoon' ? '#19c37d' : '#ffd166';
    parts.push('<text x="' + r1(x) + '" y="' + r1(y) + '" fill="' + col + '" font-size="26" font-weight="700" text-anchor="middle" stroke="' + BG + '" stroke-width="5" paint-order="stroke">' + esc(m.letter) + '</text>');
  }
  /* legend */
  const ly = H - 40, items = [['#ffd166', 'VWAP'], ['rgba(255,99,99,.9)', '1st band'], ['rgba(200,121,255,.8)', '2nd band'], ['rgba(235,243,255,.8)', 'Initial Balance'], ['#4dc3ff', 'Call wall · positive gamma'], ['#ff5470', 'Put wall · negative gamma'], ['#c879ff', 'Flip · neutral']];
  let lx = padL;
  for (const [col, name] of items) { parts.push('<rect x="' + lx + '" y="' + (ly - 9) + '" width="22" height="5" rx="2" fill="' + col + '"/><text x="' + (lx + 28) + '" y="' + ly + '" fill="' + INK + '" font-size="12">' + esc(name) + '</text>'); lx += 28 + name.length * 7.4 + 22; }
  parts.push('<text x="' + padL + '" y="' + (H - 14) + '" fill="#6f8794" font-size="11">' + esc(opts.footer || 'What price did against the day\'s reference levels. Educational, not a prediction and not advice. Making Easy Money Academy') + '</text>');
  parts.push('</svg>');
  return { svg: parts.join(''), ok: true, lo, hi, bars: bars.length };
}

module.exports = { intradaySvg, etMin, esc };
