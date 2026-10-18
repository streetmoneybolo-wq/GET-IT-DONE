'use strict';

/*
 * Academy scene renderer: the visual for every slide that is not the whiteboard example.
 *
 * A designed slide carries a small `scene` ({ labels[], values[], steps[], note }) that its
 * visualKind interprets: a price path for `chart`, candles for `candles`, a bid/ask ladder for
 * `auction`, prints for `tape`, a stop/entry/target bar for `risk`, a worked equation for
 * `formula`, two columns for `comparison`, dots on a line for `timeline`, boxes to tick for
 * `checklist`, nodes and arrows for `flow`, a payoff curve for `options`. The deck draws it as
 * one SVG that scales to the lesson rail, reveals its pieces as the narration moves through
 * the part, and answers touch: tap any element for its label, scrub a chart, tick a checklist,
 * move the target or the price slider and the numbers follow.
 *
 * Constraints (shared with the whiteboard renderer):
 *  - CSP: inline SVG and system fonts only. One fixed 360-unit viewBox, no layout measuring.
 *  - The visual lab watches `style` and `data-kind` on the deck; reveals toggle classes only
 *    and `data-kind` is never touched. The whiteboard owns the example part: this renderer
 *    stays out of it.
 *  - Reduced motion, manual browsing, or events that stop arriving end with everything shown.
 *  - Every number is illustrative teaching data from the lesson text or the design, never a
 *    live quote; a scene's note says so when the design marks it.
 */

const SCOPE = '.academy-live-deck .academy-slide-visual[data-board="scene"]';
const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

const SCENE_CSS = [
  `${SCOPE} .sc-board{position:relative;display:block;width:100%;max-width:460px;margin:0 auto;font:600 12px/1.3 ${FONT};color:#d8e7ed}`,
  `${SCOPE} .sc-svg{display:block;width:100%;height:auto;border-radius:12px;background:linear-gradient(160deg,rgba(255,255,255,.035),rgba(255,255,255,0)),rgba(3,12,18,.55);border:1px solid rgba(80,239,177,.16);touch-action:pan-y}`,
  `${SCOPE} .sc-svg text{font-family:${FONT};white-space:pre}`,
  `${SCOPE} .sc-r{opacity:0;transform:translateY(4px);transition:opacity .35s ease-out,transform .35s ease-out}`,
  `${SCOPE} .sc-r.on{opacity:1;transform:none}`,
  `${SCOPE} [data-tip],${SCOPE} [data-act]{cursor:pointer}`,
  `${SCOPE} [data-tip]:hover,${SCOPE} [data-act]:hover,${SCOPE} .sc-focus{filter:brightness(1.25)}`,
  `${SCOPE} .sc-tipbar{min-height:18px;margin:6px 2px 0;padding:0 2px;color:#aef5d5;font:700 11.5px/1.35 ${FONT};letter-spacing:.01em}`,
  `${SCOPE} .sc-tipbar:empty{display:none}`,
  `${SCOPE} .sc-ctl{display:flex;align-items:center;gap:8px;margin:6px 2px 0;color:#9fb6c2;font:700 11px/1.2 ${FONT};text-transform:uppercase;letter-spacing:.06em}`,
  `${SCOPE} .sc-ctl[hidden]{display:none}`,
  `${SCOPE} .sc-ctl input{flex:1 1 auto;min-width:0;accent-color:#00d084;height:22px;margin:0}`,
  `${SCOPE} .sc-ctl output{min-width:52px;text-align:right;color:#fff;font:800 12px/1 ${FONT};text-transform:none;letter-spacing:0}`,
  `@media (prefers-reduced-motion:reduce){${SCOPE} .sc-r{opacity:1!important;transform:none!important;transition:none!important}}`
].join('');

/* Runs in the browser (serialised with Function.prototype.toString) and in Node for tests. Self-contained. */
function sceneRuntime(win, doc) {
  const W = 360, H = 200, PAD = 14;
  const C = { ink: '#d8e7ed', dim: '#7f98a6', faint: 'rgba(216,231,237,.16)', good: '#1fd48a', bad: '#ff5a6a', key: '#5fb3ff', gold: '#ffc857', panel: 'rgba(255,255,255,.045)', dark: 'rgba(3,12,18,.7)' };
  const KINDS = ['chart', 'candles', 'auction', 'tape', 'risk', 'formula', 'comparison', 'timeline', 'checklist', 'flow', 'options'];
  const WATCHDOG_MS = 7000;
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const fmt = (v) => {
    const n = num(v); if (n === null) return '';
    const a = Math.abs(n);
    if (a >= 10000) return Math.round(n).toLocaleString('en-US');
    if (a >= 100) return (Math.round(n * 10) / 10).toLocaleString('en-US');
    return String(Math.round(n * 100) / 100);
  };
  const r2 = (n) => Math.round(n * 100) / 100;
  /* word-wrap by character budget: no layout measuring, at most `max` lines, last one ellipsised */
  const wrap = (text, chars, max) => {
    const words = String(text || '').trim().split(/\s+/).filter(Boolean);
    const out = []; let line = '';
    for (const w of words) {
      if (!line) { line = w; continue; }
      if ((line + ' ' + w).length <= chars) line += ' ' + w;
      else { out.push(line); line = w; if (out.length === max) break; }
    }
    if (out.length < max && line) out.push(line);
    else if (out.length === max && line && out.join(' ').length < words.join(' ').length) out[max - 1] = out[max - 1].replace(/\s*\S*$/, '') + '…';
    return out.length ? out : [''];
  };
  const txt = (x, y, s, o = {}) => `<text x="${r2(x)}" y="${r2(y)}" font-size="${o.size || 11}" font-weight="${o.weight || 600}" fill="${o.fill || C.ink}" text-anchor="${o.anchor || 'start'}"${o.op ? ` opacity="${o.op}"` : ''}>${esc(s)}</text>`;
  const para = (x, y, lines, o = {}) => lines.map((l, i) => txt(x, y + i * (o.lh || 13), l, o)).join('');
  const rect = (x, y, w, h, fill, o = {}) => `<rect x="${r2(x)}" y="${r2(y)}" width="${r2(Math.max(0, w))}" height="${r2(Math.max(0, h))}" rx="${o.rx == null ? 4 : o.rx}" fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 1}"` : ''}${o.op ? ` opacity="${o.op}"` : ''}/>`;
  const line = (x1, y1, x2, y2, stroke, w = 1.4, dash = '') => `<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`;
  const circle = (x, y, r, fill, o = {}) => `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r}" fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 1.5}"` : ''}/>`;
  const grp = (at, inner, o = {}) => `<g class="sc-r${o.cls ? ' ' + o.cls : ''}" data-at="${r2(Math.max(0, Math.min(1, at)))}"${o.tip ? ` data-tip="${esc(o.tip)}" tabindex="0" role="button"` : ''}${o.act ? ` data-act="${esc(o.act)}"` : ''}>${inner}</g>`;
  const noteLine = (note, y = H - 8) => (note ? txt(W - PAD, y, wrap(note, 60, 1)[0], { size: 9.5, fill: C.dim, anchor: 'end', weight: 600 }) : '');
  const header = (s) => (s ? txt(PAD, 16, wrap(s, 52, 1)[0], { size: 10, fill: C.dim, weight: 700 }) : '');
  const nums = (scene) => (Array.isArray(scene.values) ? scene.values.map(num).filter((v) => v !== null) : []);
  const strs = (list, n) => (Array.isArray(list) ? list.map((s) => String(s || '').trim()).filter(Boolean).slice(0, n) : []);
  const trendOf = (scene) => /\b(fall|drop|down|bear|loss|lose|sell-?off|decline|crash|red)\b/i.test([scene.note, ...(scene.labels || []), ...(scene.steps || [])].join(' ')) ? -1 : 1;
  const series = (scene, n = 7) => {
    const v = nums(scene);
    if (v.length >= 2) return v.slice(0, 10);
    const up = trendOf(scene) > 0;
    const base = [40, 46, 43, 52, 58, 55, 66];
    return base.slice(0, n).map((x) => (up ? x : 106 - x));
  };
  const spanOf = (vals) => { const lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo || Math.abs(hi) || 1) * 0.12; return { lo: lo - pad, hi: hi + pad }; };

  /* ---------- builders: (scene, state) -> { svg, h, control? } ---------- */
  const B = {};

  B.chart = (scene, st) => {
    const v = series(scene), labels = strs(scene.labels, 10);
    const n = v.length, { lo, hi } = spanOf(v);
    const x0 = PAD + 6, x1 = W - PAD - 6, y0 = 30, y1 = H - 34;
    const X = (i) => x0 + ((x1 - x0) * i) / Math.max(1, n - 1), Y = (val) => y1 - ((val - lo) / (hi - lo)) * (y1 - y0);
    const up = v[n - 1] >= v[0], tone = up ? C.good : C.bad;
    let out = header(scene.title) + line(x0, y1, x1, y1, C.faint) + line(x0, y0, x0, y1, C.faint);
    const pts = v.map((val, i) => `${r2(X(i))},${r2(Y(val))}`);
    out += grp(0, `<path d="M${pts[0]} L${pts.join(' L')} L${r2(X(n - 1))},${y1} L${r2(X(0))},${y1} Z" fill="${tone}" opacity=".13"/><polyline points="${pts.join(' ')}" fill="none" stroke="${tone}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>`);
    v.forEach((val, i) => {
      const at = n > 1 ? (i / (n - 1)) * 0.85 : 0;
      const focus = st.focus === i;
      const lab = labels[i] || '';
      let g = circle(X(i), Y(val), focus ? 5 : 3.2, focus ? '#fff' : tone, { stroke: C.dark, sw: 1.5 });
      if (lab) g += para(Math.min(Math.max(X(i), PAD + 28), W - PAD - 28), Y(val) - 14, wrap(lab, 14, 1), { size: 9.5, anchor: 'middle', weight: 700, fill: C.ink });
      if (focus) g += line(X(i), y0, X(i), y1, C.faint, 1, '3 3') + rect(Math.min(Math.max(X(i) - 26, PAD), W - PAD - 52), y1 + 6, 52, 16, C.dark, { stroke: tone }) + txt(Math.min(Math.max(X(i), PAD + 26), W - PAD - 26), y1 + 18, fmt(val), { size: 10, anchor: 'middle', weight: 800, fill: '#fff' });
      out += grp(at, g, { tip: (lab ? lab + ' · ' : '') + fmt(val), act: 'focus:' + i });
    });
    out += grp(0.9, txt(PAD, H - 8, (up ? '▲ ' : '▼ ') + fmt(v[0]) + ' → ' + fmt(v[n - 1]), { size: 10, fill: tone, weight: 800 }));
    out += grp(0.9, noteLine(scene.note));
    return { svg: out, h: H, scrub: n };
  };

  B.candles = (scene, st) => {
    const closes = series(scene), labels = strs(scene.labels, 10);
    const n = closes.length;
    const opens = closes.map((c, i) => (i ? closes[i - 1] : c * (trendOf(scene) > 0 ? 0.985 : 1.015)));
    const all = []; const bars = closes.map((c, i) => {
      const o = opens[i], span = Math.abs(c - o) || Math.abs(c) * 0.01 || 1;
      const hi = Math.max(o, c) + span * (0.25 + ((i * 7) % 5) / 10), lo = Math.min(o, c) - span * (0.25 + ((i * 3) % 5) / 10);
      all.push(hi, lo); return { o, c, hi, lo };
    });
    const { lo, hi } = spanOf(all);
    const x0 = PAD + 6, x1 = W - PAD - 6, y0 = 30, y1 = H - 34;
    const slot = (x1 - x0) / n, bw = Math.min(22, slot * 0.6);
    const Y = (val) => y1 - ((val - lo) / (hi - lo)) * (y1 - y0);
    let out = header(scene.title) + line(x0, y1, x1, y1, C.faint);
    bars.forEach((b, i) => {
      const x = x0 + slot * i + slot / 2, up = b.c >= b.o, tone = up ? C.good : C.bad, focus = st.focus === i;
      const top = Y(Math.max(b.o, b.c)), bot = Y(Math.min(b.o, b.c));
      let g = line(x, Y(b.hi), x, Y(b.lo), tone, 1.4) + rect(x - bw / 2, top, bw, Math.max(2, bot - top), up ? tone : C.bad, { rx: 2, stroke: focus ? '#fff' : '', sw: 1.5 });
      const lab = labels[i] || '';
      if (lab) g += para(Math.min(Math.max(x, PAD + 26), W - PAD - 26), Y(b.hi) - 8, wrap(lab, 14, 1), { size: 9.5, anchor: 'middle', weight: 700 });
      if (focus) g += rect(Math.min(Math.max(x - 34, PAD), W - PAD - 68), y1 + 6, 68, 16, C.dark, { stroke: tone }) + txt(Math.min(Math.max(x, PAD + 34), W - PAD - 34), y1 + 18, 'O ' + fmt(b.o) + '  C ' + fmt(b.c), { size: 9.5, anchor: 'middle', weight: 800, fill: '#fff' });
      out += grp(n > 1 ? (i / (n - 1)) * 0.85 : 0, g, { tip: (lab ? lab + ' · ' : '') + 'open ' + fmt(b.o) + ', close ' + fmt(b.c) + (up ? ' (green)' : ' (red)'), act: 'focus:' + i });
    });
    const upCount = bars.filter((b) => b.c >= b.o).length;
    out += grp(0.9, txt(PAD, H - 8, upCount + ' green · ' + (n - upCount) + ' red', { size: 10, fill: C.dim, weight: 700 }) + noteLine(scene.note));
    return { svg: out, h: H, scrub: n };
  };

  B.auction = (scene) => {
    let v = nums(scene).slice(0, 8), labels = strs(scene.labels, 8);
    if (v.length < 2) { v = [99.9, 99.95, 100, 100.05, 100.1, 100.15]; labels = labels.length ? labels : ['Bid', 'Bid', 'Bid', 'Ask', 'Ask', 'Ask']; }
    const sorted = v.map((p, i) => ({ p, lab: labels[i] || '' })).sort((a, b) => a.p - b.p);
    const tagged = sorted.map((row) => ({ ...row, side: /ask|offer|sell/i.test(row.lab) ? 'ask' : /bid|buy/i.test(row.lab) ? 'bid' : '' }));
    const untagged = tagged.filter((r) => !r.side).length;
    if (untagged) { const half = Math.floor(sorted.length / 2); tagged.forEach((r, i) => { if (!r.side) r.side = i < half ? 'bid' : 'ask'; }); }
    const bids = tagged.filter((r) => r.side === 'bid').sort((a, b) => b.p - a.p), asks = tagged.filter((r) => r.side === 'ask').sort((a, b) => a.p - b.p);
    const rows = Math.max(bids.length, asks.length, 1), top = 38, rh = Math.min(24, (H - top - 30) / rows);
    const colW = (W - PAD * 2 - 60) / 2, lx = PAD, rx = W - PAD - colW, mid = W / 2;
    let out = header(scene.title) + txt(lx + colW / 2, 30, 'BIDS · buyers', { size: 9.5, fill: C.good, anchor: 'middle', weight: 800 }) + txt(rx + colW / 2, 30, 'ASKS · sellers', { size: 9.5, fill: C.bad, anchor: 'middle', weight: 800 });
    const best = { bid: bids[0] ? bids[0].p : null, ask: asks[0] ? asks[0].p : null };
    const maxP = Math.max(...v), minP = Math.min(...v), range = maxP - minP || 1;
    bids.forEach((r, i) => {
      const y = top + i * rh, w = colW * (0.35 + 0.65 * ((r.p - minP) / range)), lab = r.lab && !/^bid$/i.test(r.lab) ? r.lab : '';
      out += grp(0.05 + (i / rows) * 0.4, rect(lx + colW - w, y, w, rh - 4, C.good, { op: i ? '.45' : '.8', rx: 3 }) + txt(lx + colW - 6, y + rh / 2 + 2, fmt(r.p) + (lab ? '  ' + wrap(lab, 10, 1)[0] : ''), { size: 10.5, anchor: 'end', weight: 800, fill: '#fff' }), { tip: 'Bid ' + fmt(r.p) + (lab ? ' · ' + lab : '') + (i === 0 ? ' (best bid)' : '') });
    });
    asks.forEach((r, i) => {
      const y = top + i * rh, w = colW * (0.35 + 0.65 * ((r.p - minP) / range)), lab = r.lab && !/^ask$/i.test(r.lab) ? r.lab : '';
      out += grp(0.5 + (i / rows) * 0.4, rect(rx, y, w, rh - 4, C.bad, { op: i ? '.45' : '.8', rx: 3 }) + txt(rx + 6, y + rh / 2 + 2, fmt(r.p) + (lab ? '  ' + wrap(lab, 10, 1)[0] : ''), { size: 10.5, weight: 800, fill: '#fff' }), { tip: 'Ask ' + fmt(r.p) + (lab ? ' · ' + lab : '') + (i === 0 ? ' (best ask)' : '') });
    });
    if (best.bid !== null && best.ask !== null) {
      out += grp(0.92, line(mid, top - 4, mid, top + rows * rh, C.faint, 1, '3 3') + rect(mid - 28, top + rows * rh / 2 - 12, 56, 24, C.dark, { stroke: C.gold }) + txt(mid, top + rows * rh / 2 - 1, 'SPREAD', { size: 8, anchor: 'middle', fill: C.gold, weight: 800 }) + txt(mid, top + rows * rh / 2 + 9, fmt(r2(best.ask - best.bid)), { size: 10, anchor: 'middle', fill: '#fff', weight: 800 }), { tip: 'Spread: best ask ' + fmt(best.ask) + ' minus best bid ' + fmt(best.bid) + ' = ' + fmt(r2(best.ask - best.bid)) });
    }
    out += grp(0.95, noteLine(scene.note));
    return { svg: out, h: H };
  };

  B.tape = (scene) => {
    let rows = strs(scene.steps, 7); if (!rows.length) rows = strs(scene.labels, 7);
    if (!rows.length) rows = ['10:01:02  BUY  500 @ 20.01', '10:01:03  BUY  1,200 @ 20.02', '10:01:03  SELL 300 @ 20.01', '10:01:05  BUY  2,000 @ 20.03'];
    const sizes = nums(scene), maxSize = Math.max(1, ...sizes);
    const top = 30, rh = Math.min(24, (H - top - 26) / rows.length);
    let out = header(scene.title || 'Time and sales') + txt(PAD, 24, 'TIME', { size: 8.5, fill: C.dim, weight: 800 }) + txt(W - PAD, 24, 'SIDE · SIZE · PRICE', { size: 8.5, fill: C.dim, weight: 800, anchor: 'end' });
    rows.forEach((row, i) => {
      const buy = /\b(buy|bought|ask|lift|green|up)\b/i.test(row), sell = /\b(sell|sold|bid|hit|red|down)\b/i.test(row), tone = buy ? C.good : sell ? C.bad : C.key;
      const y = top + i * rh, w = sizes[i] != null ? (W - PAD * 2) * (0.15 + 0.85 * (sizes[i] / maxSize)) : 0;
      out += grp(0.05 + (i / rows.length) * 0.85, (w ? rect(PAD, y, w, rh - 4, tone, { op: '.14', rx: 3 }) : '') + rect(PAD, y, 3, rh - 4, tone, { rx: 1 }) + txt(PAD + 9, y + rh / 2 + 2, wrap(row, 48, 1)[0], { size: 10.5, weight: 700, fill: i === rows.length - 1 ? '#fff' : C.ink }), { tip: row });
    });
    out += grp(0.95, noteLine(scene.note));
    return { svg: out, h: H };
  };

  B.risk = (scene, st) => {
    const v = nums(scene), labels = strs(scene.labels, 3);
    let entry, stop, target;
    if (v.length >= 3) { [entry, stop, target] = v; } else { const risk = v[0] > 0 ? v[0] : 1; const reward = v[1] > 0 ? v[1] : 3; entry = 100; stop = 100 - risk; target = 100 + reward; }
    if (stop === entry) stop = entry - Math.abs(entry) * 0.01 - 0.01;
    const longSide = stop < entry;
    const riskAmt = Math.abs(entry - stop);
    const mult = st.mult == null ? r2(Math.abs(target - entry) / (riskAmt || 1)) : st.mult;
    target = longSide ? entry + riskAmt * mult : entry - riskAmt * mult;
    const lo = Math.min(stop, target, entry), hi = Math.max(stop, target, entry), span = hi - lo || 1;
    const x0 = PAD + 10, x1 = W - PAD - 10, X = (p) => x0 + ((p - lo) / span) * (x1 - x0), y = 96;
    const [eLab, sLab, tLab] = [labels[0] || 'Entry', labels[1] || 'Stop', labels[2] || 'Target'];
    let out = header(scene.title || 'Risk and reward');
    out += grp(0, rect(x0, y - 14, x1 - x0, 28, C.panel, { rx: 6 }));
    const riskX = [Math.min(X(entry), X(stop)), Math.max(X(entry), X(stop))], rewX = [Math.min(X(entry), X(target)), Math.max(X(entry), X(target))];
    out += grp(0.15, rect(riskX[0], y - 14, riskX[1] - riskX[0], 28, C.bad, { op: '.55', rx: 6 }) + txt((riskX[0] + riskX[1]) / 2, y + 4, 'RISK ' + fmt(riskAmt), { size: 9.5, anchor: 'middle', weight: 800, fill: '#fff' }), { tip: sLab + ' ' + fmt(stop) + ': you lose ' + fmt(riskAmt) + ' per share if price gets here' });
    out += grp(0.45, rect(rewX[0], y - 14, rewX[1] - rewX[0], 28, C.good, { op: '.55', rx: 6 }) + txt((rewX[0] + rewX[1]) / 2, y + 4, 'REWARD ' + fmt(r2(riskAmt * mult)), { size: 9.5, anchor: 'middle', weight: 800, fill: '#fff' }), { tip: tLab + ' ' + fmt(target) + ': you make ' + fmt(r2(riskAmt * mult)) + ' per share if price gets here' });
    const mark = (p, lab, tone, dy) => line(X(p), y - 24, X(p), y + 24, tone, 2) + txt(Math.min(Math.max(X(p), PAD + 22), W - PAD - 22), y + dy, lab + ' ' + fmt(p), { size: 10, anchor: 'middle', weight: 800, fill: tone });
    out += grp(0.3, mark(stop, sLab, C.bad, 40), { tip: sLab + ' at ' + fmt(stop) });
    out += grp(0.1, mark(entry, eLab, '#fff', -32), { tip: eLab + ' at ' + fmt(entry) });
    out += grp(0.6, mark(target, tLab, C.good, 40), { tip: tLab + ' at ' + fmt(target) });
    out += grp(0.8, rect(W / 2 - 70, 150, 140, 30, C.dark, { stroke: C.gold, rx: 8 }) + txt(W / 2, 170, '1 : ' + fmt(mult) + '  risk to reward', { size: 12, anchor: 'middle', weight: 800, fill: C.gold }), { tip: 'Risk one unit to make ' + fmt(mult) + '. You need to be right more than ' + Math.round((1 / (1 + mult)) * 100) + '% of the time to break even.' });
    out += grp(0.9, txt(W / 2, H - 8, 'Move the slider: the target moves, the ratio follows', { size: 9, anchor: 'middle', fill: C.dim }) + noteLine(scene.note, 24));
    return { svg: out, h: H, control: { key: 'mult', label: 'Target', min: 0.5, max: 5, step: 0.5, value: mult, show: (x) => '1 : ' + fmt(x) } };
  };

  B.formula = (scene) => {
    let tokens = strs(scene.labels, 9); const v = nums(scene);
    if (!tokens.length) tokens = ['Profit', '=', 'Revenue', '−', 'Costs'];
    const isOp = (t) => /^[=+\-−×x*\/÷<>≤≥%]+$|^(plus|minus|times|over|equals)$/i.test(t);
    const boxes = tokens.map((t) => ({ t, op: isOp(t) }));
    const cap = boxes.length > 5 ? 2 : 1, per = Math.ceil(boxes.length / cap);
    const bw = Math.min(92, (W - PAD * 2 - 8 * (per - 1)) / per);
    let out = header(scene.title || 'The formula'); let vi = 0;
    boxes.forEach((b, i) => {
      const row = Math.floor(i / per), col = i % per, rowW = Math.min(per, boxes.length - row * per) * bw + (Math.min(per, boxes.length - row * per) - 1) * 8;
      const x = (W - rowW) / 2 + col * (bw + 8), y = 46 + row * 70;
      if (b.op) { out += grp(i / boxes.length * 0.8, txt(x + bw / 2, y + 24, b.t, { size: 20, anchor: 'middle', weight: 800, fill: C.gold })); return; }
      const val = v[vi] != null ? v[vi] : null; vi += 1;
      const lines = wrap(b.t, Math.max(8, Math.floor(bw / 6.2)), 2);
      out += grp(i / boxes.length * 0.8, rect(x, y, bw, 38, C.panel, { stroke: C.key, rx: 7 }) + para(x + bw / 2, y + (lines.length > 1 ? 16 : 23), lines, { size: 10.5, anchor: 'middle', weight: 800, lh: 12 }) + (val !== null ? txt(x + bw / 2, y + 54, fmt(val), { size: 12, anchor: 'middle', weight: 800, fill: C.good }) : ''), { tip: b.t + (val !== null ? ' = ' + fmt(val) : '') });
    });
    out += grp(0.9, noteLine(scene.note));
    return { svg: out, h: H };
  };

  B.comparison = (scene, st) => {
    const heads = strs(scene.labels, 2), items = strs(scene.steps, 8);
    const L = heads[0] || 'One side', R = heads[1] || 'Other side';
    const left = items.filter((_, i) => i % 2 === 0), right = items.filter((_, i) => i % 2 === 1);
    const colW = (W - PAD * 2 - 12) / 2, lx = PAD, rx = PAD + colW + 12, top = 48, rh = Math.min(30, (H - top - 20) / Math.max(1, Math.max(left.length, right.length)));
    const col = (x, title, rows, tone, idx) => {
      const dim = st.focus != null && st.focus !== idx;
      let g = rect(x, 24, colW, 20, tone, { op: dim ? '.25' : '.85', rx: 6 }) + txt(x + colW / 2, 38, wrap(title, 22, 1)[0], { size: 10.5, anchor: 'middle', weight: 800, fill: '#fff' });
      let out = grp(0.02, g, { tip: title, act: 'focus:' + idx });
      rows.forEach((row, i) => {
        const lines = wrap(row, Math.floor(colW / 5.6), 2), y = top + i * rh;
        out += grp(0.1 + ((i * 2 + idx) / Math.max(1, left.length + right.length)) * 0.8, circle(x + 6, y + 8, 3, tone, { op: dim ? '.3' : '1' }) + para(x + 14, y + 11, lines, { size: 10, lh: 11.5, op: dim ? '.35' : '1' }), { tip: title + ': ' + row });
      });
      return out;
    };
    let out = header(scene.title) + col(lx, L, left, C.key, 0) + col(rx, R, right, C.gold, 1) + grp(0, line(W / 2, 24, W / 2, H - 20, C.faint, 1, '3 3')) + grp(0.95, noteLine(scene.note));
    return { svg: out, h: H };
  };

  B.timeline = (scene) => {
    const events = strs(scene.labels, 6).length ? strs(scene.labels, 6) : strs(scene.steps, 6);
    const list = events.length ? events : ['Before', 'Event', 'After'];
    const v = nums(scene);
    const n = list.length, x0 = PAD + 20, x1 = W - PAD - 20, y = 104;
    const pos = v.length === n && new Set(v).size === n ? (() => { const lo = Math.min(...v), hi = Math.max(...v); return v.map((p) => x0 + ((p - lo) / (hi - lo || 1)) * (x1 - x0)); })() : list.map((_, i) => x0 + ((x1 - x0) * i) / Math.max(1, n - 1));
    let out = header(scene.title) + grp(0, line(x0 - 10, y, x1 + 10, y, C.faint, 2) + `<path d="M${r2(x1 + 10)},${y - 4} L${r2(x1 + 16)},${y} L${r2(x1 + 10)},${y + 4} Z" fill="${C.faint}"/>`);
    list.forEach((ev, i) => {
      const x = pos[i], above = i % 2 === 0, lines = wrap(ev, 16, 2), tone = i === n - 1 ? C.good : C.key;
      const ty = above ? y - 24 - (lines.length - 1) * 11.5 : y + 26;
      out += grp(0.05 + (i / n) * 0.85, line(x, y, x, above ? y - 14 : y + 14, tone, 1.2) + circle(x, y, 6, C.dark, { stroke: tone, sw: 2.5 }) + txt(x, y + 3.5, String(i + 1), { size: 8, anchor: 'middle', weight: 800, fill: '#fff' }) + para(Math.min(Math.max(x, PAD + 36), W - PAD - 36), ty, lines, { size: 9.8, anchor: 'middle', weight: 700, lh: 11.5 }) + (v[i] != null && v.length === n ? txt(x, above ? y + 22 : y - 14, fmt(v[i]), { size: 9, anchor: 'middle', fill: C.dim, weight: 700 }) : ''), { tip: (i + 1) + '. ' + ev + (v[i] != null && v.length === n ? ' (' + fmt(v[i]) + ')' : '') });
    });
    out += grp(0.95, noteLine(scene.note));
    return { svg: out, h: H };
  };

  B.checklist = (scene, st) => {
    const items = strs(scene.steps, 6).length ? strs(scene.steps, 6) : strs(scene.labels, 6);
    const list = items.length ? items : ['Plan the trade', 'Know the stop', 'Size the position', 'Take the trade'];
    const ticks = st.ticks || new Set();
    const rh = Math.min(30, (H - 42 - 22) / list.length);
    let out = header(scene.title || 'Checklist');
    list.forEach((it, i) => {
      const y = 30 + i * rh, on = ticks.has(i), lines = wrap(it, 46, 2);
      out += grp(0.05 + (i / list.length) * 0.85, rect(PAD, y, W - PAD * 2, rh - 5, on ? 'rgba(31,212,138,.12)' : C.panel, { rx: 6 }) + rect(PAD + 7, y + (rh - 5) / 2 - 7, 14, 14, on ? C.good : 'transparent', { stroke: on ? C.good : C.dim, sw: 1.6, rx: 3 }) + (on ? `<path d="M${PAD + 10},${r2(y + (rh - 5) / 2)} l3,3 l6,-7" fill="none" stroke="#03130c" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>` : '') + para(PAD + 28, y + (lines.length > 1 ? (rh - 5) / 2 - 2 : (rh - 5) / 2 + 4), lines, { size: 10.5, weight: on ? 800 : 600, lh: 11, fill: on ? '#fff' : C.ink }), { act: 'tick:' + i, tip: it });
    });
    out += grp(0.95, txt(PAD, H - 8, ticks.size + ' of ' + list.length + ' checked · tap a line to tick it', { size: 9.5, fill: ticks.size === list.length ? C.good : C.dim, weight: 700 }) + noteLine(scene.note));
    return { svg: out, h: H };
  };

  B.flow = (scene, st) => {
    const steps = strs(scene.steps, 6).length ? strs(scene.steps, 6) : strs(scene.labels, 6);
    const list = steps.length ? steps : ['Idea', 'Plan', 'Trade', 'Review'];
    const n = list.length, per = n <= 3 ? n : 3, rows = Math.ceil(n / per);
    const bw = Math.min(104, (W - PAD * 2 - 22 * (per - 1)) / per), bh = 44, gapY = 26;
    const top = 30 + ((H - 30 - 34) - (rows * bh + (rows - 1) * gapY)) / 2;
    const place = (i) => { const row = Math.floor(i / per); let col = i % per; if (row % 2 === 1) col = per - 1 - col; const count = Math.min(per, n - row * per); const rowW = count * bw + (count - 1) * 22; let x = (W - rowW) / 2 + col * (bw + 22); if (row % 2 === 1 && count < per) x = (W - rowW) / 2 + (count - 1 - (i % per)) * (bw + 22); return { x, y: top + row * (bh + gapY), row }; };
    let out = header(scene.title);
    list.forEach((s, i) => {
      const p = place(i), focus = st.focus === i, lines = wrap(s, Math.max(8, Math.floor((bw - 26) / 5.3)), 2), tone = i === n - 1 ? C.good : C.key;
      /* the number sits in its own column on the left; the words start after it so neither covers the other */
      let g = rect(p.x, p.y, bw, bh, focus ? 'rgba(95,179,255,.22)' : C.panel, { stroke: tone, sw: focus ? 2 : 1.2, rx: 8 }) + circle(p.x + 12, p.y + bh / 2, 7.5, tone) + txt(p.x + 12, p.y + bh / 2 + 3, String(i + 1), { size: 8.5, anchor: 'middle', weight: 800, fill: '#03130c' }) + para(p.x + 24, p.y + (lines.length > 1 ? bh / 2 - 2 : bh / 2 + 4), lines, { size: 9.8, weight: 700, lh: 11.5 });
      if (i < n - 1) {
        const q = place(i + 1);
        if (q.row === p.row) { const dir = q.x > p.x ? 1 : -1, ax = dir > 0 ? p.x + bw : p.x, bx = dir > 0 ? q.x : q.x + bw, y = p.y + bh / 2; g += line(ax + dir * 2, y, bx - dir * 6, y, C.dim, 1.6) + `<path d="M${r2(bx - dir * 7)},${y - 4} L${r2(bx - dir)},${y} L${r2(bx - dir * 7)},${y + 4} Z" fill="${C.dim}"/>`; }
        else { const x = p.x + bw / 2, y1 = p.y + bh, y2 = q.y; g += line(x, y1 + 2, x, y2 - 6, C.dim, 1.6) + `<path d="M${r2(x - 4)},${r2(y2 - 7)} L${r2(x)},${r2(y2 - 1)} L${r2(x + 4)},${r2(y2 - 7)} Z" fill="${C.dim}"/>`; }
      }
      out += grp(0.05 + (i / n) * 0.85, g, { tip: (i + 1) + '. ' + s, act: 'focus:' + i });
    });
    out += grp(0.95, noteLine(scene.note));
    return { svg: out, h: H };
  };

  B.options = (scene, st) => {
    const v = nums(scene);
    const strike = v[0] > 0 ? v[0] : 100, premium = v[1] > 0 ? v[1] : 5;
    const put = /\bput\b/i.test([scene.note, scene.title, ...(scene.labels || [])].join(' '));
    const lo = strike * 0.6, hi = strike * 1.4;
    const price = st.price == null ? strike : st.price;
    const pl = (p) => (put ? Math.max(0, strike - p) : Math.max(0, p - strike)) - premium;
    const maxPl = pl(put ? lo : hi), minPl = -premium, yLo = Math.min(minPl, -premium * 1.2), yHi = Math.max(maxPl, premium * 1.2);
    const x0 = PAD + 34, x1 = W - PAD - 6, y0 = 30, y1 = H - 36;
    const X = (p) => x0 + ((p - lo) / (hi - lo)) * (x1 - x0), Y = (val) => y1 - ((val - yLo) / (yHi - yLo)) * (y1 - y0);
    const be = put ? strike - premium : strike + premium;
    const steps = 40, pts = [];
    for (let i = 0; i <= steps; i += 1) { const p = lo + ((hi - lo) * i) / steps; pts.push(`${r2(X(p))},${r2(Y(pl(p)))}`); }
    let out = header(scene.title || ((put ? 'Put' : 'Call') + ' option payoff at expiry'));
    out += grp(0, line(x0, Y(0), x1, Y(0), C.faint, 1.2) + line(x0, y0, x0, y1, C.faint) + txt(x0 - 4, Y(0) + 3, '0', { size: 9, anchor: 'end', fill: C.dim }) + txt(x0 - 4, Y(maxPl) + 3, '+' + fmt(maxPl), { size: 9, anchor: 'end', fill: C.good }) + txt(x0 - 4, Y(minPl) + 3, fmt(minPl), { size: 9, anchor: 'end', fill: C.bad }));
    out += grp(0.15, `<polyline points="${pts.join(' ')}" fill="none" stroke="${C.key}" stroke-width="2.4" stroke-linejoin="round"/>`, { tip: 'Profit or loss at expiry for every price' });
    out += grp(0.35, line(X(strike), y0, X(strike), y1, C.gold, 1.2, '4 3') + txt(X(strike), y1 + 12, 'Strike ' + fmt(strike), { size: 9.5, anchor: 'middle', weight: 800, fill: C.gold }), { tip: 'Strike ' + fmt(strike) + ': the price the option lets you ' + (put ? 'sell' : 'buy') + ' at' });
    out += grp(0.5, line(X(be), y0, X(be), y1, C.good, 1.2, '4 3') + txt(Math.min(Math.max(X(be), x0 + 30), x1 - 30), y0 - 4, 'Break-even ' + fmt(be), { size: 9.5, anchor: 'middle', weight: 800, fill: C.good }), { tip: 'Break-even ' + fmt(be) + ': strike ' + (put ? 'minus' : 'plus') + ' the ' + fmt(premium) + ' premium' });
    const cur = pl(price), tone = cur >= 0 ? C.good : C.bad;
    out += grp(0.7, circle(X(price), Y(cur), 5.5, tone, { stroke: '#fff', sw: 1.5 }) + rect(Math.min(Math.max(X(price) - 46, x0), x1 - 92), y1 + 4, 92, 18, C.dark, { stroke: tone }) + txt(Math.min(Math.max(X(price), x0 + 46), x1 - 46), y1 + 17, 'At ' + fmt(price) + ': ' + (cur >= 0 ? '+' : '') + fmt(r2(cur)), { size: 10, anchor: 'middle', weight: 800, fill: '#fff' }), { tip: 'Price ' + fmt(price) + ' at expiry: ' + (cur >= 0 ? 'profit ' : 'loss ') + fmt(Math.abs(r2(cur))) + ' per share' });
    out += grp(0.9, txt(W - PAD, H - 8, 'Premium paid ' + fmt(premium) + ' · max loss ' + fmt(premium), { size: 9.5, anchor: 'end', fill: C.dim, weight: 700 }));
    return { svg: out, h: H, control: { key: 'price', label: 'Price', min: r2(lo), max: r2(hi), step: r2(Math.max(0.01, (hi - lo) / 80)), value: price, show: (x) => fmt(x) } };
  };

  function build(kind, scene, state = {}) {
    const fn = B[kind]; if (!fn) return null;
    const sc = scene && typeof scene === 'object' ? scene : {};
    const made = fn(sc, state);
    const markup = `<svg class="sc-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${made.h || H}" role="img" aria-label="${esc((sc.title || kind) + ' illustration')}">${made.svg}</svg>`;
    return { markup, control: made.control || null, scrub: made.scrub || 0, groups: (made.svg.match(/class="sc-r/g) || []).length };
  }

  /* ---------- browser side ---------- */
  const state = { key: '', visual: null, board: null, kind: '', scene: null, ui: {}, timer: 0, progress: 0, playing: false };
  const reducedMotion = () => { try { return Boolean(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; } };
  const usableExample = (ex) => Boolean(ex && typeof ex === 'object' && Array.isArray(ex.frames) && ex.frames.length);
  const stopTimer = () => { if (state.timer) { win.clearTimeout(state.timer); state.timer = 0; } };
  function reveal(progress, all) {
    if (!state.board) return;
    const groups = state.board.querySelectorAll('.sc-r');
    for (let i = 0; i < groups.length; i += 1) {
      const el = groups[i], at = Number(el.getAttribute('data-at')) || 0;
      if (all || at <= progress) el.classList.add('on'); else el.classList.remove('on');
    }
  }
  function arm() {
    stopTimer();
    if (!state.board || !state.playing) return;
    state.timer = win.setTimeout(() => { state.timer = 0; reveal(1, true); }, WATCHDOG_MS);
  }
  function draw(all) {
    if (!state.board) return;
    const made = build(state.kind, state.scene, state.ui);
    if (!made) return;
    const svgHost = state.board.querySelector('.sc-host');
    svgHost.innerHTML = made.markup;
    reveal(all ? 1 : state.progress, all || !state.playing || reducedMotion());
    const ctl = state.board.querySelector('.sc-ctl');
    if (made.control) {
      ctl.hidden = false;
      const input = ctl.querySelector('input'), out = ctl.querySelector('output'), label = ctl.querySelector('span');
      label.textContent = made.control.label;
      input.min = made.control.min; input.max = made.control.max; input.step = made.control.step; input.value = made.control.value;
      input.setAttribute('aria-label', made.control.label);
      out.textContent = made.control.show(made.control.value);
      ctl.dataset.key = made.control.key;
    } else ctl.hidden = true;
  }
  function mount(visual, kind, scene, key) {
    const board = doc.createElement('div'); board.className = 'sc-board';
    board.innerHTML = '<div class="sc-host"></div><label class="sc-ctl" hidden><span></span><input type="range"><output></output></label><div class="sc-tipbar" aria-live="polite"></div>';
    Object.assign(state, { key, visual, board, kind, scene, ui: {}, progress: 0 });
    board.addEventListener('click', (event) => {
      let el = event.target;
      while (el && el !== board && !(el.getAttribute && (el.getAttribute('data-act') || el.getAttribute('data-tip')))) el = el.parentNode;
      if (!el || el === board) return;
      const act = el.getAttribute('data-act') || '', tip = el.getAttribute('data-tip') || '';
      const bar = board.querySelector('.sc-tipbar');
      if (act.startsWith('tick:')) { const i = Number(act.slice(5)); const set = state.ui.ticks || (state.ui.ticks = new Set()); if (set.has(i)) set.delete(i); else set.add(i); draw(true); }
      else if (act.startsWith('focus:')) { const i = Number(act.slice(6)); state.ui.focus = state.ui.focus === i ? null : i; draw(true); }
      if (bar) bar.textContent = bar.textContent === tip ? '' : tip;
    });
    board.addEventListener('input', (event) => {
      const ctl = board.querySelector('.sc-ctl');
      if (!event.target || event.target.tagName !== 'INPUT' || !ctl) return;
      state.ui[ctl.dataset.key] = Number(event.target.value);
      draw(true);
    });
    board.addEventListener('pointermove', (event) => {
      const svg = board.querySelector('.sc-svg'); if (!svg) return;
      const made = build(state.kind, state.scene, state.ui); if (!made || !made.scrub) return;
      const box = svg.getBoundingClientRect(); if (!box.width) return;
      const x = ((event.clientX - box.left) / box.width) * W;
      const i = Math.max(0, Math.min(made.scrub - 1, Math.round(((x - PAD - 6) / (W - PAD * 2 - 12)) * (made.scrub - 1))));
      if (state.ui.focus !== i) { state.ui.focus = i; draw(true); }
    });
    visual.replaceChildren(board);
    visual.setAttribute('data-board', 'scene');
    draw(false);
    arm();
  }
  function drop() {
    stopTimer();
    if (state.board && state.visual && state.board.parentNode === state.visual) {
      state.visual.replaceChildren();
      if (state.visual.getAttribute('data-board') === 'scene') state.visual.removeAttribute('data-board');
    }
    Object.assign(state, { key: '', visual: null, board: null, kind: '', scene: null, ui: {}, progress: 0 });
  }
  const onSync = (event) => {
    const d = (event && event.detail) || {};
    const visual = d.visual && d.visual.nodeType === 1 ? d.visual : doc.querySelector('.academy-slide-visual');
    if (!visual) return;
    const slide = d.slide || {}, scene = slide.scene, kind = String(slide.visualKind || '');
    if ((d.isExample && usableExample(d.example)) || !scene || typeof scene !== 'object' || !B[kind]) { drop(); return; }
    const key = String(d.lessonKey || '') + '#' + String(d.partIndex);
    state.playing = Boolean(d.playing);
    if (key === state.key && state.board && state.board.parentNode === visual) {
      if (!state.playing) reveal(1, true); else arm();
      if (!visual.hasAttribute('data-board')) visual.setAttribute('data-board', 'scene');
      return;
    }
    drop();
    try { mount(visual, kind, scene, key); } catch (_) { drop(); }
  };
  const onProgress = (event) => {
    const d = (event && event.detail) || {};
    if (!state.board) return;
    if (String(d.lessonKey || '') + '#' + String(d.partIndex) !== state.key) return;
    if (!state.board.isConnected) { drop(); return; }
    state.playing = Boolean(d.playing);
    state.progress = Math.max(0, Math.min(1, Number(d.partProgress) || 0));
    if (!state.playing || reducedMotion()) { reveal(1, true); stopTimer(); return; }
    reveal(state.progress, false);
    arm();
  };

  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('sml-academy-slide-sync', onSync);
    win.addEventListener('sml-academy-slide-progress', onProgress);
  }
  const api = { build, kinds: KINDS.slice() };
  if (win) win.smlAcademyScenes = api;
  return api;
}

let cachedScript = null;
function academySceneVisualsScript() {
  if (!cachedScript) cachedScript = `<style>${SCENE_CSS}</style><script>(${sceneRuntime.toString()})(window,document);</script>`;
  return cachedScript;
}

/* The same runtime in Node: the server-side tests build every kind without a page. */
let nodeApi = null;
function sceneBuild(kind, scene, state) {
  if (!nodeApi) nodeApi = sceneRuntime(null, null);
  return nodeApi.build(kind, scene, state);
}

module.exports = { academySceneVisualsScript, sceneBuild, SCENE_KINDS: ['chart', 'candles', 'auction', 'tape', 'risk', 'formula', 'comparison', 'timeline', 'checklist', 'flow', 'options'] };
