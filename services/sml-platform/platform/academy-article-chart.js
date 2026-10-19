'use strict';

/* The Article Desk's charts, drawn on the server as inline SVG so a published piece carries real price action wherever it
 * lands (a Loop Letter, a syndicated page, an email) with no script and no image host, and so the enhancement script can
 * move a single price line on top of it when the page is allowed to run JavaScript.
 *
 *   candleChart(opts)   daily candles with volume, the levels that matter (call wall, flip, swept level, invalidation), the
 *                       scenario path from the last close through the waypoints to the target, a live-price line the
 *                       script can move (data attributes carry the price scale), axes, a title.
 *   gauge(opts)         a half-circle meter for a 0..100 score (squeeze risk, sentiment, intent strength).
 *   bars(opts)          a short series of bars (short-volume ratio by day, buy versus sell prints).
 *   sparkline(values)   a tiny closing-price line for a stat tile.
 * Everything is escaped; nothing here emits script or external references. */

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r1 = (v) => Math.round(v * 10) / 10;
const px = (v) => (Math.abs(v) >= 1 ? '$' + Number(v).toFixed(2) : '$' + Number(v).toFixed(4));
const UP = '#19c37d', DN = '#ff5c7a', INK = '#dbe6ee', MUT = '#8aa0ad', LINE = 'rgba(255,255,255,.08)', BG = '#0b1119';
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLabel = (t) => { const d = new Date(t); return MONTH[d.getUTCMonth()] + ' ' + d.getUTCDate(); };

function niceStep(range, ticks) {
  const raw = range / Math.max(1, ticks), pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / pow; const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

/* opts: { symbol, bars [{t,o,h,l,c,v}], price, target, stop, levels [{label, price, kind}], path [{label, price}], lean,
          width 960, height 500, count 60, title, subtitle } */
function candleChart(opts = {}) {
  const W = num(opts.width, 960), H = num(opts.height, 500), count = Math.max(20, Math.min(160, num(opts.count, 60)));
  const all = (opts.bars || []).filter((b) => b && num(b.c) != null && num(b.h) != null && num(b.l) != null);
  const bars = all.slice(-count);
  if (bars.length < 5) return { svg: '', ok: false, reason: 'too_few_bars' };
  const price = num(opts.price, bars[bars.length - 1].c), target = num(opts.target), stop = num(opts.stop);
  const levels = (opts.levels || []).filter((l) => l && num(l.price) != null).slice(0, 6);
  const path = (opts.path || []).filter((p) => p && num(p.price) != null).slice(0, 4);
  const padL = 14, padR = 78, padT = opts.title ? 46 : 18, padB = 34;
  const plotW = W - padL - padR, plotH = H - padT - padB, volH = Math.round(plotH * 0.16), priceH = plotH - volH - 6;
  /* the price scale covers the candles, the levels and the path so nothing drawn falls off the chart */
  const ys = [];
  for (const b of bars) { ys.push(num(b.h), num(b.l)); }
  for (const l of levels) ys.push(num(l.price));
  for (const p of path) ys.push(num(p.price));
  if (target != null) ys.push(target); if (stop != null) ys.push(stop); if (price != null) ys.push(price);
  let lo = Math.min(...ys), hi = Math.max(...ys); const span = Math.max(hi - lo, (hi || 1) * 0.02); lo -= span * 0.06; hi += span * 0.06;
  const yOf = (v) => padT + (hi - v) / (hi - lo) * priceH;
  /* the x axis leaves room on the right for the path (one slot per waypoint plus the target) */
  const extra = path.length + (target != null ? 1 : 0) + 1;
  const slot = plotW / (bars.length + extra), cw = Math.max(2, Math.min(14, slot * 0.62));
  const xOf = (i) => padL + slot * (i + 0.5);
  const parts = [];
  parts.push('<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="14" fill="' + BG + '"/>');
  if (opts.title) parts.push('<text x="' + padL + '" y="22" fill="#fff" font-size="15" font-weight="800" font-family="system-ui,sans-serif">' + esc(opts.title) + '</text>' + (opts.subtitle ? '<text x="' + padL + '" y="38" fill="' + MUT + '" font-size="11" font-family="system-ui,sans-serif">' + esc(opts.subtitle) + '</text>' : ''));
  /* grid and the price axis */
  const step = niceStep(hi - lo, 6);
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const y = yOf(v);
    parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + r1(y) + '" y2="' + r1(y) + '" stroke="' + LINE + '"/>');
    parts.push('<text x="' + (W - padR + 6) + '" y="' + r1(y + 4) + '" fill="' + MUT + '" font-size="11" font-family="ui-monospace,monospace">' + esc(px(v)) + '</text>');
  }
  /* volume */
  const vmax = Math.max(1, ...bars.map((b) => num(b.v, 0)));
  const volTop = padT + priceH + 6;
  bars.forEach((b, i) => { const v = num(b.v, 0); const h = v / vmax * volH; const up = num(b.c) >= num(b.o, b.c); parts.push('<rect x="' + r1(xOf(i) - cw / 2) + '" y="' + r1(volTop + volH - h) + '" width="' + r1(cw) + '" height="' + r1(h) + '" fill="' + (up ? UP : DN) + '" opacity=".28"/>'); });
  /* candles */
  bars.forEach((b, i) => {
    const o = num(b.o, b.c), c = num(b.c), h = num(b.h), l = num(b.l), up = c >= o, col = up ? UP : DN, x = xOf(i);
    parts.push('<line x1="' + r1(x) + '" x2="' + r1(x) + '" y1="' + r1(yOf(h)) + '" y2="' + r1(yOf(l)) + '" stroke="' + col + '" stroke-width="1"/>');
    const top = yOf(Math.max(o, c)), bh = Math.max(1, Math.abs(yOf(o) - yOf(c)));
    parts.push('<rect x="' + r1(x - cw / 2) + '" y="' + r1(top) + '" width="' + r1(cw) + '" height="' + r1(bh) + '" fill="' + col + '"/>');
  });
  /* date ticks: six across */
  const every = Math.max(1, Math.floor(bars.length / 6));
  for (let i = 0; i < bars.length; i += every) parts.push('<text x="' + r1(xOf(i)) + '" y="' + (H - 12) + '" fill="' + MUT + '" font-size="10" text-anchor="middle" font-family="ui-monospace,monospace">' + esc(dateLabel(num(bars[i].t, 0))) + '</text>');
  /* levels */
  const labelAt = (y, text, col, anchorRight = true) => '<text x="' + (anchorRight ? W - padR - 4 : padL + 4) + '" y="' + r1(y - 4) + '" fill="' + col + '" font-size="10" font-weight="700" text-anchor="' + (anchorRight ? 'end' : 'start') + '" font-family="ui-monospace,monospace">' + esc(text) + '</text>';
  for (const l of levels) {
    const y = yOf(num(l.price)), col = l.kind === 'resistance' ? '#ffb04a' : l.kind === 'support' ? '#5cc8ff' : '#c7a9ff';
    parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + r1(y) + '" y2="' + r1(y) + '" stroke="' + col + '" stroke-dasharray="4 4" opacity=".8"/>' + labelAt(y, l.label + ' ' + px(num(l.price)), col, false));
  }
  if (stop != null) { const y = yOf(stop); parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + r1(y) + '" y2="' + r1(y) + '" stroke="' + DN + '" stroke-dasharray="2 5"/>' + labelAt(y, 'INVALIDATION ' + px(stop), DN)); }
  if (target != null) { const y = yOf(target); parts.push('<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + r1(y) + '" y2="' + r1(y) + '" stroke="' + UP + '" stroke-dasharray="2 5"/>' + labelAt(y, 'TARGET ' + px(target), UP)); }
  /* the scenario path: last close, waypoints, target */
  const lastI = bars.length - 1, lastC = num(bars[lastI].c);
  const pts = [{ x: xOf(lastI), y: yOf(lastC), label: '' }];
  path.forEach((p, k) => pts.push({ x: xOf(lastI + 1 + k), y: yOf(num(p.price)), label: p.label, price: num(p.price) }));
  if (target != null) pts.push({ x: xOf(lastI + 1 + path.length), y: yOf(target), label: 'TARGET', price: target });
  if (pts.length > 1) {
    const col = opts.lean === 'bearish' ? DN : UP;
    parts.push('<polyline points="' + pts.map((p) => r1(p.x) + ',' + r1(p.y)).join(' ') + '" fill="none" stroke="' + col + '" stroke-width="2" stroke-dasharray="6 5" opacity=".95"/>');
    pts.slice(1).forEach((p, k) => { parts.push('<circle cx="' + r1(p.x) + '" cy="' + r1(p.y) + '" r="4.5" fill="' + BG + '" stroke="' + col + '" stroke-width="2"/>'); if (p.label) parts.push('<text x="' + r1(p.x) + '" y="' + r1(p.y + (k % 2 ? 18 : -10)) + '" fill="' + col + '" font-size="9.5" font-weight="800" text-anchor="middle" font-family="ui-monospace,monospace">' + esc(p.label) + '</text>'); });
  }
  /* the live line: the script moves this group's y by the data attributes below; without script it marks the last price */
  const liveY = yOf(price);
  parts.push('<g class="mem-live" data-price="' + esc(price) + '"><line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + r1(liveY) + '" y2="' + r1(liveY) + '" stroke="#fff" stroke-width="1" opacity=".7"/><rect x="' + (W - padR + 2) + '" y="' + r1(liveY - 9) + '" width="' + (padR - 6) + '" height="18" rx="4" fill="#fff"/><text x="' + (W - padR + 6) + '" y="' + r1(liveY + 4) + '" fill="#000" font-size="11" font-weight="800" font-family="ui-monospace,monospace">' + esc(px(price)) + '</text></g>');
  const svg = '<svg class="mem-chart" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc((opts.symbol || '') + ' daily chart with the scenario path') + '" data-ymin="' + r1(lo) + '" data-ymax="' + r1(hi) + '" data-top="' + padT + '" data-h="' + r1(priceH) + '" data-xr="' + (W - padR) + '" data-xl="' + padL + '" xmlns="http://www.w3.org/2000/svg">' + parts.join('') + '</svg>';
  return { svg, ok: true, lo: r1(lo), hi: r1(hi), bars: bars.length };
}

/* a half-circle meter: { score 0..100, label, caption, width 220, color } */
function gauge(opts = {}) {
  const s = Math.max(0, Math.min(100, num(opts.score, 0))), W = num(opts.width, 220), H = Math.round(W * 0.62), cx = W / 2, cy = H - 18, r = W / 2 - 16;
  const col = opts.color || (s >= 70 ? UP : s >= 45 ? '#ffb04a' : s >= 25 ? '#5cc8ff' : DN);
  const arc = (from, to, stroke, width, dash) => { const a0 = Math.PI * (1 - from / 100), a1 = Math.PI * (1 - to / 100); const x0 = cx + r * Math.cos(a0), y0 = cy - r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy - r * Math.sin(a1); return '<path d="M' + r1(x0) + ' ' + r1(y0) + ' A' + r + ' ' + r + ' 0 ' + (to - from > 50 ? 1 : 0) + ' 1 ' + r1(x1) + ' ' + r1(y1) + '" fill="none" stroke="' + stroke + '" stroke-width="' + width + '" stroke-linecap="round"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') + '/>'; };
  const needle = Math.PI * (1 - s / 100), nx = cx + (r - 4) * Math.cos(needle), ny = cy - (r - 4) * Math.sin(needle);
  return '<svg class="mem-gauge" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" role="img" aria-label="' + esc((opts.label || 'score') + ' ' + Math.round(s) + ' of 100') + '" xmlns="http://www.w3.org/2000/svg">'
    + arc(0, 100, 'rgba(255,255,255,.12)', 10) + (s > 0 ? arc(0, Math.max(1, s), col, 10) : '')
    + '<line x1="' + cx + '" y1="' + cy + '" x2="' + r1(nx) + '" y2="' + r1(ny) + '" stroke="#fff" stroke-width="2"/><circle cx="' + cx + '" cy="' + cy + '" r="4" fill="#fff"/>'
    + '<text x="' + cx + '" y="' + (cy - 14) + '" fill="#fff" font-size="26" font-weight="900" text-anchor="middle" font-family="system-ui,sans-serif">' + Math.round(s) + '</text>'
    + '<text x="' + cx + '" y="' + (cy + 14) + '" fill="' + MUT + '" font-size="10" font-weight="800" text-anchor="middle" letter-spacing="1" font-family="ui-monospace,monospace">' + esc(opts.label || '') + '</text>'
    + (opts.caption ? '<text x="' + cx + '" y="' + (H - 2) + '" fill="' + INK + '" font-size="10" text-anchor="middle" font-family="system-ui,sans-serif">' + esc(opts.caption) + '</text>' : '') + '</svg>';
}

/* a short bar series: { items [{label, value, color}], max, width 420, height 150, format(v), baseline } */
function bars(opts = {}) {
  const items = (opts.items || []).filter((x) => x && num(x.value) != null).slice(0, 16);
  if (!items.length) return '';
  const W = num(opts.width, 420), H = num(opts.height, 150), padB = 22, padT = 16, max = num(opts.max, Math.max(...items.map((x) => Math.abs(num(x.value, 0))), 1)) || 1;
  const slot = W / items.length, bw = Math.max(4, slot * 0.6), fmt = typeof opts.format === 'function' ? opts.format : (v) => String(v);
  const parts = ['<rect x="0" y="0" width="' + W + '" height="' + H + '" rx="10" fill="' + BG + '"/>'];
  if (num(opts.baseline) != null) { const y = padT + (H - padT - padB) * (1 - num(opts.baseline) / max); parts.push('<line x1="0" x2="' + W + '" y1="' + r1(y) + '" y2="' + r1(y) + '" stroke="#ffb04a" stroke-dasharray="4 4" opacity=".8"/>'); }
  items.forEach((it, i) => {
    const v = Math.abs(num(it.value, 0)), h = (H - padT - padB) * Math.min(1, v / max), x = i * slot + (slot - bw) / 2, y = H - padB - h;
    parts.push('<rect x="' + r1(x) + '" y="' + r1(y) + '" width="' + r1(bw) + '" height="' + r1(h) + '" rx="3" fill="' + (it.color || UP) + '"/>');
    parts.push('<text x="' + r1(x + bw / 2) + '" y="' + r1(y - 3) + '" fill="' + INK + '" font-size="9.5" text-anchor="middle" font-family="ui-monospace,monospace">' + esc(fmt(num(it.value, 0))) + '</text>');
    parts.push('<text x="' + r1(x + bw / 2) + '" y="' + (H - 7) + '" fill="' + MUT + '" font-size="9" text-anchor="middle" font-family="ui-monospace,monospace">' + esc(it.label || '') + '</text>');
  });
  return '<svg class="mem-bars" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + esc(opts.label || 'bar chart') + '" xmlns="http://www.w3.org/2000/svg">' + parts.join('') + '</svg>';
}

function sparkline(values, { width = 120, height = 34, color = UP } = {}) {
  const v = (values || []).map((x) => num(x)).filter((x) => x != null).slice(-60);
  if (v.length < 2) return '';
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => r1(i / (v.length - 1) * (width - 2) + 1) + ',' + r1(height - 2 - (x - lo) / span * (height - 4)));
  return '<svg class="mem-spark" viewBox="0 0 ' + width + ' ' + height + '" width="' + width + '" height="' + height + '" aria-hidden="true" xmlns="http://www.w3.org/2000/svg"><polyline points="' + pts.join(' ') + '" fill="none" stroke="' + (v[v.length - 1] >= v[0] ? color : DN) + '" stroke-width="1.8" stroke-linejoin="round"/></svg>';
}

module.exports = { candleChart, gauge, bars, sparkline, esc };
