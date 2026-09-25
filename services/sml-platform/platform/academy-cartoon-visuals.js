'use strict';

/*
 * Academy whiteboard renderer for the "simple version" worked example.
 *
 * Lessons can carry lesson.example (computed server-side, see
 * platform/academy/examples.js). When the deck reaches that part, this script
 * draws an original hand-drawn style whiteboard card: warm ruled paper,
 * double-stroked marker lines, simple doodle characters, thick labelled
 * arrows and big circled numbers. Every number arrives pre-formatted from the
 * server, so nothing here does finance math.
 *
 * Constraints this renderer keeps:
 *  - CSP: inline SVG and system fonts only (no images, no web fonts).
 *  - The deck is 270-430px wide: one SVG with a fixed 360-unit viewBox that
 *    scales to its container, so it never measures layout (the lesson panel
 *    may still be hidden when the first slide renders).
 *  - The visual lab watches 'style' and 'data-kind' attribute changes inside
 *    the deck, so reveals only toggle classes and data-kind is never touched.
 *  - Reduced motion, manual browsing, or events that stop arriving always end
 *    with the whole board visible.
 *
 * Contract: lesson.example = { id, source, family, title, say[], frames[{ cue,
 * items[] }], facts }. A frame (or a line with its own cue) with cue c appears
 * once the spoken word index inside the example part reaches
 * words('Here is the simple version.') + words(say[0..c-1]).
 */

const MARKER_FONT = "'Segoe Print','Ink Free','Marker Felt','Chalkboard SE','Comic Sans MS',system-ui,sans-serif";
const SCOPE = '.academy-live-deck .academy-slide-visual[data-board]';

const WHITEBOARD_CSS = [
  `${SCOPE}{display:block;min-height:0;margin:0;padding:2px 2px 10px;border:0;border-radius:14px;background:none;box-shadow:none;color:#1d2a33;font:700 14px/1.3 ${MARKER_FONT};letter-spacing:normal;text-align:left;text-transform:none;white-space:normal;overflow:hidden;container-type:inline-size;container-name:academy-board}`,
  `${SCOPE} .wb-board{position:relative;display:block;width:100%;max-width:430px;margin:0 auto;padding:0;background:none;border:0}`,
  `${SCOPE} .wb-svg{display:block;width:100%;height:auto;margin:0;overflow:hidden;border-radius:14px;filter:drop-shadow(0 6px 10px rgba(0,0,0,.32))}`,
  `${SCOPE} .wb-svg text{font-family:${MARKER_FONT};font-weight:700;font-style:normal;white-space:pre}`,
  `${SCOPE} .wb-r{opacity:0}`,
  `${SCOPE} .wb-r.wb-on{opacity:1}`,
  `${SCOPE} .wb-anim .wb-r.wb-go{animation:academy-wb-in .45s ease-out backwards}`,
  `${SCOPE} .wb-anim .wb-r.wb-go .wb-d{animation:academy-wb-draw .8s cubic-bezier(.3,.7,.4,1) backwards}`,
  '@keyframes academy-wb-in{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:none}}',
  '@keyframes academy-wb-draw{from{stroke-dasharray:1 2;stroke-dashoffset:1}to{stroke-dasharray:1 2;stroke-dashoffset:0}}',
  `@container academy-board (max-width:320px){${SCOPE} .wb-svg{border-radius:10px;filter:drop-shadow(0 4px 7px rgba(0,0,0,.28))}}`,
  /* A paged (playing) board draws every frame in the same spot, so forcing its
   * hidden groups visible would overlap them; the runtime redraws it as the
   * static whole board as soon as reduced motion is seen. */
  `@media (prefers-reduced-motion:reduce){${SCOPE} .wb-board:not(.wb-anim) .wb-r{opacity:1!important;animation:none!important}${SCOPE} .wb-r{animation:none!important}${SCOPE} .wb-d{animation:none!important}}`
].join('');

/* Runs in the browser (serialised with Function.prototype.toString) and in
 * Node for tests, with a fake window/document. Keep it self-contained. */
function whiteboardRuntime(win, doc) {
  const W = 360;
  const PAD = 16;
  const INNER = W - PAD * 2;
  const MID = W / 2;
  const INK = '#1d2a33';
  const TONES = { good: '#1f9d57', bad: '#d6333b', key: '#2458c6', note: '#6b7780' };
  const TINTS = { good: '#d8f1e2', bad: '#f9dcdd', key: '#dce5fa', note: '#e8eaeb' };
  const FONT = "'Segoe Print','Ink Free','Marker Felt','Chalkboard SE','Comic Sans MS',system-ui,sans-serif";
  const INTRO = 'Here is the simple version.';
  /* Making Easy Money Academy palette: neon green, gold, black and white. The characters are branded arrow mascots, never drawn people. */
  const BRAND = { green: '#19e36b', greenDark: '#0a9a45', gold: '#ffd84d', black: '#0b0f12', white: '#ffffff' };
  const WATCHDOG_MS = 4000;

  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (value, max) => {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return max && text.length > max ? text.slice(0, max - 1).trim() + '...' : text;
  };
  const num = (value) => { const n = Number(value); return Number.isFinite(n) ? n : 0; };
  const r1 = (n) => Math.round(n * 10) / 10;
  const tone = (name) => TONES[name] || INK;
  const tint = (name) => TINTS[name] || '#efe9da';
  const listOf = (value, max) => (Array.isArray(value) ? value : []).filter((entry) => entry != null).slice(0, max);
  const countWords = (text) => (String(text == null ? '' : text).match(/\S+/g) || []).length;
  /* Candle prices only: same money style as the server lines ($5, $5.60). */
  const money = (value) => { const n = num(value); const text = Number.isInteger(n) ? String(Math.abs(n)) : Math.abs(n).toFixed(2); return (n < 0 ? '-' : '') + '$' + text.replace(/\B(?=(\d{3})+(?!\d))/g, ','); };

  /* Conservative width estimate for the marker font stack (Segoe Print is the
   * widest), so text is shrunk before it could leave its slot. */
  const glyph = (c) => (c === ' ' ? 0.3 : /[A-Z0-9$%#&@]/.test(c) ? 0.7 : /[mw]/.test(c) ? 0.82 : /[.,:;'!|ilj()\-]/.test(c) ? 0.33 : 0.6);
  const measure = (text, size) => { let width = 0; for (const c of String(text)) width += glyph(c); return width * size; };
  const wrap = (text, width, size, maxLines) => {
    const out = [];
    let line = '';
    String(text).split(/\s+/).filter(Boolean).forEach((token) => {
      const next = line ? line + ' ' + token : token;
      if (line && measure(next, size) > width) { out.push(line); line = token; } else line = next;
    });
    if (line) out.push(line);
    while (out.length > maxLines) { const tail = out.pop(); out[out.length - 1] += ' ' + tail; }
    return out.length ? out : [''];
  };
  /* Smallest label size (viewBox units) that stays readable on the narrowest
   * 270px deck; fit() reports anything smaller or squeezed. */
  const READABLE = 11;
  let fitLog = null;
  const label = (x, y, text, opts) => {
    const o = opts || {};
    const value = String(text == null ? '' : text);
    if (!value) return '';
    const max = o.max || INNER;
    const spacing = o.spacing || 0;
    let size = o.size || 14;
    let width = measure(value, size) + spacing * value.length;
    if (width > max) {
      size = Math.max(o.min || 9, size * max / width);
      width = measure(value, size) + spacing * value.length;
    }
    /* Shrinking to fit lands on max give or take rounding noise; only a real
     * overflow (the minimum size is still too wide) is squeezed. */
    const squeezed = width > max + 0.5;
    if (fitLog && (squeezed || size < READABLE - 1e-9)) fitLog.push('"' + value + '" drops to ' + r1(size) + (squeezed ? ' and is squeezed' : ''));
    let px = x;
    if (o.anchor === 'middle' && o.keepInside) {
      const half = Math.min(width, max) / 2;
      px = Math.max(PAD + half, Math.min(W - PAD - half, x));
    }
    return '<text x="' + r1(px) + '" y="' + r1(y) + '" font-size="' + r1(size) + '" fill="' + (o.color || INK) + '"'
      + (o.anchor ? ' text-anchor="' + o.anchor + '"' : '')
      + (spacing ? ' letter-spacing="' + spacing + '"' : '')
      + (squeezed ? ' textLength="' + r1(max) + '" lengthAdjust="spacingAndGlyphs"' : '')
      + '>' + esc(value) + '</text>';
  };
  /* Where a label ends up (after shrinking and keepInside), for overlap checks. */
  const extent = (x, text, size, max) => {
    const value = String(text == null ? '' : text);
    let width = measure(value, size);
    if (width > max) width = measure(value, Math.max(9, size * max / width));
    const half = Math.min(width, max) / 2;
    const px = Math.max(PAD + half, Math.min(W - PAD - half, x));
    return { left: px - half, right: px + half };
  };

  const seeded = (seed) => {
    let h = 2166136261;
    const text = String(seed);
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    let a = (h >>> 0) || 1;
    return () => {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /* Deterministic "hand" for one board: every wobble comes from a seeded
   * generator, so the same example always draws the same doodle. */
  const makePen = (seed) => {
    const rand = seeded(seed);
    const j = (amount) => (rand() - 0.5) * 2 * amount;
    const pt = (x, y) => r1(x) + ' ' + r1(y);
    const bend = (x1, y1, x2, y2, amount) => {
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const bow = j(Math.min(2.8, len * 0.028) + amount * 0.35);
      return pt((x1 + x2) / 2 - (dy / len) * bow, (y1 + y2) / 2 + (dx / len) * bow);
    };
    const seg = (x1, y1, x2, y2, amount) => {
      const a = amount == null ? 1.2 : amount;
      const sx = x1 + j(a * 0.5);
      const sy = y1 + j(a * 0.5);
      const ex = x2 + j(a * 0.5);
      const ey = y2 + j(a * 0.5);
      return 'M' + pt(sx, sy) + 'Q' + bend(sx, sy, ex, ey, a) + ' ' + pt(ex, ey);
    };
    const poly = (points, closed, amount) => {
      const a = amount == null ? 1 : amount;
      const pts = points.map((p) => [p[0] + j(a * 0.45), p[1] + j(a * 0.45)]);
      if (closed) pts.push([pts[0][0] + j(a * 0.5), pts[0][1] + j(a * 0.5)]);
      let d = 'M' + pt(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) d += 'Q' + bend(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], a) + ' ' + pt(pts[i][0], pts[i][1]);
      return d;
    };
    const curve = (pts, closed) => {
      const n = pts.length;
      const at = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))]);
      let d = 'M' + pt(pts[0][0], pts[0][1]);
      const count = closed ? n : n - 1;
      for (let i = 0; i < count; i++) {
        const p0 = at(i - 1);
        const p1 = at(i);
        const p2 = at(i + 1);
        const p3 = at(i + 2);
        d += 'C' + pt(p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6) + ' '
          + pt(p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6) + ' ' + pt(p2[0], p2[1]);
      }
      return d + (closed ? 'Z' : '');
    };
    const oval = (cx, cy, rx, ry, wobble, loop) => {
      const n = 10;
      const w = wobble == null ? 0.045 : wobble;
      const start = rand() * Math.PI * 2;
      const pts = [];
      for (let i = 0; i < n; i++) {
        const angle = start + (i / n) * Math.PI * 2;
        const k = 1 + j(w);
        pts.push([cx + Math.cos(angle) * rx * k, cy + Math.sin(angle) * ry * k]);
      }
      if (!loop) return curve(pts, true);
      const end = start + Math.PI * 2 + 0.55;
      return curve(pts.concat([[pts[0][0], pts[0][1]], [cx + Math.cos(end) * rx * 1.08, cy + Math.sin(end) * ry * 1.08]]), false);
    };
    const stroke = (d, color, width, extra) => '<path class="wb-d" pathLength="1" d="' + d + '" fill="none" stroke="' + (color || INK)
      + '" stroke-width="' + r1(width || 2.4) + '" stroke-linecap="round" stroke-linejoin="round"' + (extra || '') + '/>';
    const twice = (make, color, width) => stroke(make(), color, width) + stroke(make(), color, (width || 2.4) * 0.5, ' opacity=".45"');
    const fill = (d, color, extra) => '<path d="' + d + '" fill="' + color + '"' + (extra || '') + '/>';
    const rect = (x, y, w, h) => 'M' + pt(x, y) + 'H' + r1(x + w) + 'V' + r1(y + h) + 'H' + r1(x) + 'Z';
    const shape = (points) => 'M' + points.map((p) => pt(p[0], p[1])).join('L') + 'Z';
    const box = (x, y, w, h, amount) => poly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], true, amount);
    const arrow = (x1, y1, x2, y2, color, width, head) => {
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const h = head || 10;
      const wd = width || 3;
      const tip = 'M' + pt(x2 - h * Math.cos(angle - 0.5) + j(0.6), y2 - h * Math.sin(angle - 0.5) + j(0.6)) + 'L' + pt(x2, y2)
        + 'L' + pt(x2 - h * Math.cos(angle + 0.5) + j(0.6), y2 - h * Math.sin(angle + 0.5) + j(0.6));
      return stroke(seg(x1, y1, x2, y2, 1), color, wd) + stroke(seg(x1, y1 + 0.9, x2, y2 + 0.9, 1.4), color, wd * 0.45, ' opacity=".4"') + stroke(tip, color, wd);
    };
    const dot = (x, y, r, color, extra) => '<circle cx="' + r1(x) + '" cy="' + r1(y) + '" r="' + r1(r) + '" fill="' + color + '"' + (extra || '') + '/>';
    const scribble = (x, y, w, h, color) => {
      if (w < 6 || h < 6) return '';
      const pts = [];
      let left = true;
      for (let yy = y + h - 3; yy > y + 2; yy -= 6) { pts.push([left ? x + 3 : x + w - 3, yy]); left = !left; }
      return pts.length > 1 ? stroke(poly(pts, false, 0.5), color, 1.3, ' opacity=".5"') : '';
    };
    return { j, seg, poly, curve, oval, stroke, twice, fill, rect, shape, box, arrow, dot, scribble };
  };

  /* ---------- Original doodle icons, each in a 60 x 60 box ---------- */
  const face = (P, cx, cy) => P.dot(cx - 4.6, cy - 1.2, 1.7, INK) + P.dot(cx + 4.6, cy - 1.2, 1.7, INK)
    + P.dot(cx - 7.6, cy + 3.4, 2.2, '#f19c9c', ' opacity=".6"') + P.dot(cx + 7.6, cy + 3.4, 2.2, '#f19c9c', ' opacity=".6"')
    + P.stroke('M' + r1(cx - 4.4) + ' ' + r1(cy + 3.4) + 'Q' + r1(cx) + ' ' + r1(cy + 7.8) + ' ' + r1(cx + 4.4) + ' ' + r1(cy + 3.4), INK, 1.7);
  const torso = (P, x, y, color) => {
    const pts = [[x + 12, y + 59], [x + 14.5, y + 45], [x + 30, y + 36.5], [x + 45.5, y + 45], [x + 48, y + 59]];
    return P.fill(P.curve(pts, false) + 'Z', color) + P.stroke(P.curve(pts.map((p) => [p[0] + P.j(0.6), p[1] + P.j(0.6)]), false), INK, 2.2);
  };
  const head = (P, cx, cy, rx, ry, color) => P.fill(P.oval(cx, cy, rx, ry, 0.02, false), color) + P.twice(() => P.oval(cx, cy, rx, ry, 0.04, true), INK, 2.1);
  /* The Making Easy Money "Arrow" mascot: the up-arrow from the brand mark with a friendly face, in green (or gold for the second character). */
  const arrowHead = (P, cx, cy, s, color) => {
    const pts = [[cx, cy - 17 * s], [cx + 13 * s, cy + 1 * s], [cx + 5.2 * s, cy + 1 * s], [cx + 5.2 * s, cy + 14 * s], [cx - 5.2 * s, cy + 14 * s], [cx - 5.2 * s, cy + 1 * s], [cx - 13 * s, cy + 1 * s]];
    return P.fill(P.shape(pts), color) + P.twice(() => P.poly(pts, true, 0.35), INK, 2.1)
      + P.stroke(P.seg(cx - 1.4 * s, cy - 11 * s, cx - 8 * s, cy - 0.4 * s, 0.2), BRAND.white, 1.8 * s, ' opacity=".85"');
  };
  const arrowFace = (P, cx, cy, s) => P.dot(cx - 2.5 * s, cy + 6.2 * s, 1.35 * s, INK) + P.dot(cx + 2.5 * s, cy + 6.2 * s, 1.35 * s, INK)
    + P.stroke('M' + r1(cx - 2.6 * s) + ' ' + r1(cy + 9.4 * s) + 'Q' + r1(cx) + ' ' + r1(cy + 12.2 * s) + ' ' + r1(cx + 2.6 * s) + ' ' + r1(cy + 9.4 * s), INK, 1.4 * s);
  const person = (P, x, y, shirt, variant) => {
    const cx = x + 30;
    const cy = y + 21;
    return torso(P, x, y, shirt) + arrowHead(P, cx, cy, 1, variant === 2 ? BRAND.gold : BRAND.green) + arrowFace(P, cx, cy, 1);
  };
  const company = (P, x, y) => {
    let out = P.fill(P.rect(x + 13, y + 11, 34, 47), '#e2eaf3') + P.twice(() => P.box(x + 13, y + 11, 34, 47, 0.9), INK, 2.2);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 2; col++) {
        out += P.fill(P.rect(x + 18 + col * 14, y + 16 + row * 10.5, 9, 6.5), '#9fc4ea') + P.stroke(P.box(x + 18 + col * 14, y + 16 + row * 10.5, 9, 6.5, 0.3), INK, 1.2);
      }
    }
    return out + P.fill(P.rect(x + 25.5, y + 48, 9, 10), '#8d6b4b') + P.stroke(P.seg(x + 30, y + 11, x + 30, y + 1.5, 0.4), INK, 1.8)
      + P.fill(P.shape([[x + 30, y + 1.5], [x + 40, y + 4.5], [x + 30, y + 7.5]]), TONES.key);
  };
  const bank = (P, x, y) => {
    const roof = [[x + 5, y + 22], [x + 30, y + 5], [x + 55, y + 22]];
    let out = P.fill(P.shape(roof), '#efe5cf') + P.twice(() => P.poly(roof, true, 0.8), INK, 2.2);
    out += '<text x="' + r1(x + 30) + '" y="' + r1(y + 19.5) + '" font-size="11" fill="' + TONES.good + '" text-anchor="middle">$</text>';
    out += P.stroke(P.seg(x + 7, y + 25, x + 53, y + 25, 0.6), INK, 2.2);
    [13, 24, 36, 47].forEach((dx) => {
      out += P.fill(P.rect(x + dx - 2.6, y + 27, 5.2, 23), '#f7f2e6') + P.stroke(P.box(x + dx - 2.6, y + 27, 5.2, 23, 0.35), INK, 1.6);
    });
    return out + P.stroke(P.seg(x + 7, y + 53, x + 53, y + 53, 0.6), INK, 2.2) + P.stroke(P.seg(x + 3.5, y + 58, x + 56.5, y + 58, 0.6), INK, 2.4);
  };
  const shop = (P, x, y) => {
    const w = 42 / 5;
    let out = P.fill(P.rect(x + 9, y + 24, 42, 34), '#fff4e2') + P.twice(() => P.box(x + 9, y + 24, 42, 34, 0.8), INK, 2.2);
    let scallop = 'M' + r1(x + 9) + ' ' + r1(y + 24);
    for (let i = 0; i < 5; i++) {
      const sx = x + 9 + i * w;
      out += P.fill('M' + r1(sx) + ' ' + r1(y + 13) + 'H' + r1(sx + w) + 'V' + r1(y + 24) + 'Q' + r1(sx + w / 2) + ' ' + r1(y + 31) + ' ' + r1(sx) + ' ' + r1(y + 24) + 'Z', i % 2 ? '#fffaf0' : TONES.bad);
      scallop += 'Q' + r1(sx + w / 2) + ' ' + r1(y + 31) + ' ' + r1(sx + w) + ' ' + r1(y + 24);
    }
    out += P.stroke(P.seg(x + 7, y + 13, x + 53, y + 13, 0.6), INK, 2.2) + P.stroke(scallop, INK, 1.8)
      + P.stroke(P.seg(x + 9, y + 13, x + 9, y + 24, 0.3), INK, 1.6) + P.stroke(P.seg(x + 51, y + 13, x + 51, y + 24, 0.3), INK, 1.6);
    return out + P.fill(P.rect(x + 14, y + 35, 14, 11), '#bfe0f5') + P.stroke(P.box(x + 14, y + 35, 14, 11, 0.4), INK, 1.5)
      + P.fill(P.rect(x + 34, y + 36, 11, 22), '#b98a5a') + P.stroke(P.box(x + 34, y + 36, 11, 22, 0.4), INK, 1.5);
  };
  const robot = (P, x, y) => P.stroke(P.seg(x + 30, y + 11, x + 30, y + 4, 0.3), INK, 1.8) + P.dot(x + 30, y + 3.2, 2.8, TONES.bad)
    + P.fill(P.rect(x + 17, y + 11, 26, 20), '#dfe8ef') + P.twice(() => P.box(x + 17, y + 11, 26, 20, 0.7), INK, 2.2)
    + P.dot(x + 24, y + 19.5, 3, TONES.key) + P.dot(x + 36, y + 19.5, 3, TONES.key) + P.dot(x + 24.9, y + 18.6, 0.9, '#ffffff') + P.dot(x + 36.9, y + 18.6, 0.9, '#ffffff')
    + P.stroke(P.box(x + 24, y + 24.5, 12, 3.6, 0.2), INK, 1.4)
    + P.fill(P.rect(x + 19, y + 34, 22, 21), '#cbd8e3') + P.twice(() => P.box(x + 19, y + 34, 22, 21, 0.7), INK, 2.2) + P.dot(x + 30, y + 44, 3.2, TONES.good)
    + P.stroke(P.seg(x + 19, y + 38, x + 11, y + 47, 0.5), INK, 2) + P.stroke(P.seg(x + 41, y + 38, x + 49, y + 47, 0.5), INK, 2)
    + P.stroke(P.seg(x + 25, y + 55, x + 25, y + 59, 0.2), INK, 2.2) + P.stroke(P.seg(x + 35, y + 55, x + 35, y + 59, 0.2), INK, 2.2);
  const city = (P, x, y) => {
    let out = '';
    [[4, 32, 12, 26, '#dfe6ee'], [16, 16, 13, 42, '#cddaea'], [30, 26, 12, 32, '#e8dfcd'], [42, 9, 14, 49, '#d3e3d8']].forEach((b) => {
      out += P.fill(P.rect(x + b[0], y + b[1], b[2], b[3]), b[4]) + P.stroke(P.box(x + b[0], y + b[1], b[2], b[3], 0.5), INK, 1.8);
      for (let wy = y + b[1] + 5; wy < y + 54; wy += 7) {
        for (let wx = x + b[0] + 3; wx < x + b[0] + b[2] - 3; wx += 5) out += P.fill(P.rect(wx, wy, 2.4, 2.8), '#f2c14e');
      }
    });
    return out + P.twice(() => P.seg(x + 1, y + 58.5, x + 59, y + 58.5, 0.5), INK, 2.2);
  };
  const crowd = (P, x, y) => {
    const body = (cx, top, w, color) => {
      const pts = [[cx - w, y + 59], [cx - w + 2.5, top + 8], [cx, top], [cx + w - 2.5, top + 8], [cx + w, y + 59]];
      return P.fill(P.curve(pts, false) + 'Z', color) + P.stroke(P.curve(pts, false), INK, 1.9);
    };
    const eyes = (cx, cy) => P.dot(cx - 3, cy, 1.3, INK) + P.dot(cx + 3, cy, 1.3, INK);
    return body(x + 15, y + 30, 11, '#a9c0d6') + arrowHead(P, x + 15, y + 22, 0.6, BRAND.green) + arrowFace(P, x + 15, y + 22, 0.6)
      + body(x + 45, y + 30, 11, '#b7d3bd') + arrowHead(P, x + 45, y + 22, 0.6, BRAND.gold) + arrowFace(P, x + 45, y + 22, 0.6)
      + body(x + 30, y + 40, 14, '#e9a35a') + arrowHead(P, x + 30, y + 31, 0.75, BRAND.green) + arrowFace(P, x + 30, y + 31, 0.75);
  };
  const judge = (P, x, y) => {
    const cx = x + 28;
    const cy = y + 21;
    let out = torso(P, x - 2, y, '#2f3b48') + P.fill(P.shape([[cx - 4.5, y + 37], [cx, y + 44], [cx + 4.5, y + 37]]), '#ffffff');
    out += arrowHead(P, cx, cy, 0.95, BRAND.green) + arrowFace(P, cx, cy, 0.95);
    const cap = [[cx - 12, cy - 12], [cx, cy - 18], [cx + 12, cy - 12], [cx, cy - 6.5]];
    out += P.fill(P.shape(cap), BRAND.black) + P.stroke(P.poly(cap, true, 0.3), INK, 1.4) + P.stroke(P.seg(cx + 12, cy - 12, cx + 14.5, cy - 4, 0.2), BRAND.gold, 1.6);
    const mallet = [[x + 47.5, y + 38.5], [x + 53.5, y + 32.5], [x + 59, y + 38], [x + 53, y + 44]];
    return out + P.stroke(P.seg(x + 44, y + 56, x + 54.5, y + 42, 0.3), '#8a5a33', 2.8) + P.fill(P.shape(mallet), '#8a5a33') + P.stroke(P.poly(mallet, true, 0.3), INK, 1.4);
  };
  const coin = (P, x, y) => P.fill(P.oval(x + 30, y + 30, 22, 22, 0.015, false), '#f5c542') + P.twice(() => P.oval(x + 30, y + 30, 22, 22, 0.03, true), INK, 2.3)
    + P.stroke(P.oval(x + 30, y + 30, 16.5, 16.5, 0.03, false), '#b8860b', 1.4)
    + '<text x="' + r1(x + 30) + '" y="' + r1(y + 38) + '" font-size="22" fill="#8a6400" text-anchor="middle">$</text>'
    + P.stroke(P.seg(x + 15.5, y + 23, x + 20.5, y + 15.5, 0.2), '#ffffff', 2, ' opacity=".8"');
  const chart = (P, x, y) => P.fill(P.rect(x + 8, y + 5, 49, 49), '#ffffff', ' opacity=".7"')
    + P.twice(() => P.poly([[x + 8, y + 5], [x + 8, y + 54], [x + 57, y + 54]], false, 0.6), INK, 2.2)
    + P.stroke(P.poly([[x + 13, y + 46], [x + 22, y + 37], [x + 30, y + 41], [x + 40, y + 27], [x + 46, y + 20]], false, 0.4), TONES.good, 2.8)
    + P.arrow(x + 44, y + 22.5, x + 52, y + 12, TONES.good, 2.8, 7);
  const house = (P, x, y) => {
    const roof = [[x + 6, y + 30], [x + 30, y + 8], [x + 54, y + 30]];
    return P.fill(P.rect(x + 40, y + 11, 6, 12), '#b0674f') + P.stroke(P.box(x + 40, y + 11, 6, 12, 0.3), INK, 1.6)
      + P.fill(P.rect(x + 12, y + 28, 36, 30), '#fff0da') + P.twice(() => P.box(x + 12, y + 28, 36, 30, 0.7), INK, 2.2)
      + P.fill(P.shape(roof), '#e07b5f') + P.twice(() => P.poly(roof, true, 0.7), INK, 2.2)
      + P.fill(P.rect(x + 26, y + 42, 9, 16), '#8d6b4b') + P.stroke(P.box(x + 26, y + 42, 9, 16, 0.3), INK, 1.5)
      + P.fill(P.rect(x + 15, y + 35, 8, 8), '#bfe0f5') + P.stroke(P.box(x + 15, y + 35, 8, 8, 0.3), INK, 1.4);
  };
  const ICONS = {
    person: (P, x, y, shirt) => person(P, x, y, shirt || '#7aa2f0', 1),
    person2: (P, x, y, shirt) => person(P, x, y, shirt || '#f2a64f', 2),
    company, bank, shop, robot, city, crowd, judge, coin, chart, house
  };
  const icon = (P, id, x, y, who) => {
    const draw = ICONS[id] || ICONS.person;
    return draw(P, x, y, who && TONES[who.tone] ? TONES[who.tone] : null);
  };

  /* Footer strip on every board: the brand arrow and the academy name. */
  const BRAND_FOOT = 12;
  const brandFooter = (height) => {
    const y = height - BRAND_FOOT + 1;
    const arrow = 'M' + 17 + ' ' + (y + 1) + 'L' + 22 + ' ' + (y + 6.5) + 'L' + 19.2 + ' ' + (y + 6.5) + 'L' + 19.2 + ' ' + (y + 10) + 'L' + 14.8 + ' ' + (y + 10) + 'L' + 14.8 + ' ' + (y + 6.5) + 'L' + 12 + ' ' + (y + 6.5) + 'Z';
    return '<path d="M12 ' + (y - 2) + 'H348" stroke="#dfd6c0" stroke-width="1"/><path d="' + arrow + '" fill="' + BRAND.green + '" stroke="' + INK + '" stroke-width="1.2" stroke-linejoin="round"/>'
      + '<text x="29" y="' + (y + 9.6) + '" font-size="11" letter-spacing="0.6" fill="' + INK + '" font-family="system-ui,sans-serif" font-weight="800">MAKING EASY MONEY <tspan fill="' + BRAND.greenDark + '">ACADEMY</tspan></text>';
  };

  /* ---------- Item kinds: each returns { h, svg } for a slot at y ---------- */
  const actors = (item, y, P) => {
    const left = item.left || {};
    const right = item.right || {};
    const span = 176;
    const blocks = listOf(item.flows, 2).map((flow) => {
      const lines = wrap(clean(flow.text, 70), span, 13.5, 2);
      return { flow, lines, h: lines.length * 15 + 16 };
    });
    const flowsH = blocks.reduce((sum, block) => sum + block.h, 0) + Math.max(0, blocks.length - 1) * 6;
    const areaH = Math.max(62, flowsH);
    const top = y + 4;
    const iconTop = top + (areaH - 62) / 2;
    let svg = icon(P, left.icon || 'person', 20, iconTop, left) + icon(P, right.icon || 'person2', W - 80, iconTop, right);
    svg += label(50, top + areaH + 18, clean(left.name || 'You', 32), { size: 15, max: 92, anchor: 'middle', color: tone(left.tone), keepInside: true });
    svg += label(W - 50, top + areaH + 18, clean(right.name, 32), { size: 15, max: 92, anchor: 'middle', color: tone(right.tone), keepInside: true });
    let cursor = top + (areaH - flowsH) / 2;
    blocks.forEach((block, index) => {
      const color = index === 0 ? TONES.key : INK;
      block.lines.forEach((line, k) => { svg += label(MID, cursor + 12 + k * 15, line, { size: 13.5, anchor: 'middle', color, max: span }); });
      const ay = cursor + block.lines.length * 15 + 8;
      svg += block.flow.dir === 'left' ? P.arrow(MID + span / 2, ay, MID - span / 2, ay, color, 3.2) : P.arrow(MID - span / 2, ay, MID + span / 2, ay, color, 3.2);
      cursor += block.h + 6;
    });
    return { h: areaH + 30, svg };
  };
  const big = (item, y, P) => {
    const text = clean(item.text, 28);
    const color = tone(item.tone);
    let size = 30;
    const raw = measure(text, size);
    if (raw > 230) size = Math.max(16, size * 230 / raw);
    const rx = Math.min(160, measure(text, size) / 2 + 24);
    const ry = size * 0.78 + 7;
    const cy = y + ry + 5;
    let svg = P.fill(P.oval(MID, cy, rx, ry, 0.03, false), item.tone ? tint(item.tone) : '#f6edcf', ' opacity=".7"')
      + P.twice(() => P.oval(MID, cy, rx, ry, 0.05, true), color, 2.6)
      + label(MID, cy + size * 0.36, text, { size, anchor: 'middle', color, max: rx * 2 - 18 });
    let h = ry * 2 + 12;
    if (item.label) {
      svg += label(MID, y + h + 11, clean(item.label, 70), { size: 14, anchor: 'middle', color: TONES.note });
      h += 20;
    }
    return { h, svg };
  };
  const line = (item, y, P) => {
    const color = tone(item.tone);
    return {
      h: 27,
      svg: P.stroke(P.seg(PAD + 3, y + 13.5, PAD + 12, y + 13.5, 0.6), color, 3) + label(PAD + 20, y + 19, clean(item.text, 70), { size: 16, color, max: INNER - 22 })
    };
  };
  const numberLine = (item, y, P) => {
    const marks = listOf(item.marks, 5).map((mark) => ({ at: num(mark.at), label: clean(mark.label, 32), tone: mark.tone })).sort((a, b) => a.at - b.at);
    const dotSpec = item.dot && Number.isFinite(Number(item.dot.from)) && Number.isFinite(Number(item.dot.to)) ? { from: num(item.dot.from), to: num(item.dot.to) } : null;
    const values = marks.map((mark) => mark.at).concat(dotSpec ? [dotSpec.from, dotSpec.to] : []);
    let lo = values.length ? Math.min.apply(null, values) : 0;
    let hi = values.length ? Math.max.apply(null, values) : 1;
    if (hi === lo) { lo -= 1; hi += 1; }
    const margin = (hi - lo) * 0.08;
    lo -= margin;
    hi += margin;
    const x1 = PAD + 22;
    const x2 = W - PAD - 22;
    const X = (value) => x1 + ((value - lo) / (hi - lo)) * (x2 - x1);
    const ly = y + 44;
    let svg = P.twice(() => P.seg(PAD + 6, ly, W - PAD - 6, ly, 0.9), INK, 2.6)
      + P.stroke('M' + r1(W - PAD - 13) + ' ' + r1(ly - 5) + 'L' + r1(W - PAD - 6) + ' ' + r1(ly) + 'L' + r1(W - PAD - 13) + ' ' + r1(ly + 5), INK, 2.2)
      + P.stroke('M' + r1(PAD + 13) + ' ' + r1(ly - 5) + 'L' + r1(PAD + 6) + ' ' + r1(ly) + 'L' + r1(PAD + 13) + ' ' + r1(ly + 5), INK, 2.2);
    if (dotSpec) {
      const a = X(dotSpec.from);
      const b = X(dotSpec.to);
      svg += P.stroke(P.seg(a, ly, b, ly, 0.3), TONES.key, 9, ' opacity=".28"')
        + '<circle cx="' + r1(a) + '" cy="' + r1(ly) + '" r="5" fill="#fbf7ee" stroke="' + TONES.key + '" stroke-width="2"/>'
        + '<circle cx="' + r1(b) + '" cy="' + r1(ly) + '" r="6.5" fill="' + TONES.key + '" stroke="#ffffff" stroke-width="2">'
        + '<animate attributeName="cx" from="' + r1(a) + '" to="' + r1(b) + '" dur="1.3s" begin="indefinite" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".4 0 .2 1"/></circle>';
    }
    const xs = marks.map((mark) => X(mark.at));
    /* Labels sit below the line; when two neighbours would touch (by gap or by
     * their real widths), every second label moves above the line instead. */
    const touching = (max) => marks.some((mark, i) => {
      if (!i) return false;
      const a = extent(xs[i - 1], marks[i - 1].label, 13.5, max);
      const b = extent(xs[i], mark.label, 13.5, max);
      return a.right + 4 > b.left;
    });
    const crowded = xs.some((x, i) => i > 0 && x - xs[i - 1] < 92) || touching(150);
    const max = crowded ? 118 : 150;
    if (fitLog) {
      const rows = [[], []];
      marks.forEach((mark, i) => {
        const row = rows[crowded && i % 2 === 1 ? 1 : 0];
        const box = extent(xs[i], mark.label, 13.5, max);
        if (row.some((other) => box.left < other.box.right + 2 && other.box.left < box.right + 2)) {
          fitLog.push('number line labels "' + row.at(-1).text + '" and "' + mark.label + '" overlap');
        }
        row.push({ box, text: mark.label });
      });
    }
    marks.forEach((mark, i) => {
      const x = xs[i];
      const color = tone(mark.tone);
      const above = crowded && i % 2 === 1;
      svg += P.stroke(P.seg(x, ly - 8, x, ly + 8, 0.4), color, 2.6);
      if (mark.tone) {
        svg += P.stroke(P.seg(x, ly - 8, x, ly - 26, 0.3), INK, 1.6) + P.fill(P.shape([[x, ly - 26], [x + 11, ly - 22.5], [x, ly - 19]]), color);
      }
      svg += label(x, above ? ly - 31 : ly + 25, mark.label, { size: 13.5, anchor: 'middle', color, max, keepInside: true });
    });
    return { h: 80, svg };
  };
  const bars = (item, y, P) => {
    const entries = listOf(item.items, 4).map((bar) => ({ label: clean(bar.label, 24), value: num(bar.value), text: clean(bar.text, 28), tone: bar.tone || (num(bar.value) < 0 ? 'bad' : null) }));
    const n = Math.max(1, entries.length);
    const gap = 22;
    const bw = Math.min(64, (INNER - 24 - gap * (n - 1)) / n);
    const startX = (W - (n * bw + (n - 1) * gap)) / 2;
    const base = y + 104;
    const peak = Math.max.apply(null, entries.map((bar) => Math.abs(bar.value)).concat([0])) || 1;
    let svg = P.twice(() => P.seg(PAD + 8, base, W - PAD - 8, base, 0.8), INK, 2.4);
    entries.forEach((bar, i) => {
      const x = startX + i * (bw + gap);
      const height = bar.value ? Math.max(4, (Math.abs(bar.value) / peak) * 72) : 0;
      const top = base - height;
      const color = bar.tone ? tone(bar.tone) : INK;
      if (height) {
        svg += P.fill(P.rect(x, top, bw, height), bar.tone ? tint(bar.tone) : '#ece5d4') + P.scribble(x, top, bw, height, color)
          + P.twice(() => P.box(x, top, bw, height, 0.8), color, 2.4);
      }
      svg += label(x + bw / 2, top - 7, bar.text, { size: 14.5, anchor: 'middle', color, max: bw + gap - 4 });
      svg += label(x + bw / 2, base + 18, bar.label, { size: 13, anchor: 'middle', color: TONES.note, max: bw + gap - 2 });
    });
    return { h: 126, svg };
  };
  const tree = (item, y, P) => {
    const branches = listOf(item.branches, 3);
    const rootLines = wrap(clean(item.root, 70), 250, 13.5, 2);
    const rw = Math.min(300, Math.max.apply(null, rootLines.map((text) => measure(text, 13.5))) + 28);
    const rh = rootLines.length * 16 + 12;
    let svg = P.fill(P.rect(MID - rw / 2, y + 2, rw, rh), '#fffdf6') + P.twice(() => P.box(MID - rw / 2, y + 2, rw, rh, 1), INK, 2.2);
    rootLines.forEach((text, k) => { svg += label(MID, y + 19 + k * 16, text, { size: 13.5, anchor: 'middle', max: rw - 14 }); });
    const n = Math.max(1, branches.length);
    const colW = INNER / n;
    const rootBottom = y + 2 + rh;
    const by = rootBottom + 28;
    let maxLines = 0;
    branches.forEach((branch, i) => {
      const cx = PAD + colW * (i + 0.5);
      const color = tone(branch.tone);
      svg += P.arrow(MID + (cx - MID) * 0.15, rootBottom + 3, cx, by - 2, color, 2.2, 8);
      svg += label(cx, by + 13, clean(branch.label, 40), { size: 14.5, anchor: 'middle', color, max: colW - 8 });
      const lines = wrap(clean(branch.text, 70), colW - 10, 13, 2);
      lines.forEach((text, k) => { svg += label(cx, by + 31 + k * 16, text, { size: 13, anchor: 'middle', max: colW - 8 }); });
      maxLines = Math.max(maxLines, lines.length);
    });
    return { h: by - y + 21 + maxLines * 16, svg };
  };
  const steps = (item, y, P) => {
    const entries = listOf(item.items, 4).map((text) => clean(text, 28));
    const n = Math.max(1, entries.length);
    const gap = 20;
    const bw = (INNER - gap * (n - 1)) / n;
    const size = n >= 4 ? 12.5 : 13.5;
    const wrapped = entries.map((text) => wrap(text, bw - 10, size, 2));
    const lines = Math.max.apply(null, wrapped.map((w) => w.length).concat([1]));
    const bh = lines * 15 + 16;
    let svg = '';
    entries.forEach((text, i) => {
      const x = PAD + i * (bw + gap);
      svg += P.fill(P.rect(x, y + 4, bw, bh), i === n - 1 ? TINTS.key : '#fffdf6') + P.twice(() => P.box(x, y + 4, bw, bh, 0.9), INK, 2.2);
      const first = y + 4 + bh / 2 - (wrapped[i].length - 1) * 7.5 + 4.5;
      wrapped[i].forEach((part, k) => { svg += label(x + bw / 2, first + k * 15, part, { size, anchor: 'middle', max: bw - 8 }); });
      if (i < n - 1) svg += P.arrow(x + bw + 3, y + 4 + bh / 2, x + bw + gap - 3, y + 4 + bh / 2, TONES.key, 2.2, 6);
    });
    return { h: bh + 10, svg };
  };
  const compare = (item, y, P) => {
    const colW = (INNER - 16) / 2;
    let maxLines = 0;
    let svg = '';
    [item.left || {}, item.right || {}].forEach((column, i) => {
      const x = PAD + i * (colW + 16);
      const mark = column.mark === 'check' || column.mark === 'cross' ? column.mark : null;
      const color = mark === 'check' ? TONES.good : mark === 'cross' ? TONES.bad : INK;
      const title = clean(column.title, 40);
      const room = colW - (mark ? 34 : 8);
      svg += label(x + 4, y + 20, title, { size: 14.5, color, max: room });
      svg += P.stroke(P.seg(x + 2, y + 27, x + 6 + Math.min(room, measure(title, 14.5)), y + 27, 0.8), color, 2);
      const rows = listOf(column.lines, 3).map((text) => clean(text, 36));
      rows.forEach((text, k) => {
        svg += P.dot(x + 6, y + 44 + k * 19, 2, TONES.note) + label(x + 13, y + 48.5 + k * 19, text, { size: 13.5, max: colW - 16 });
      });
      if (mark === 'check') svg += P.twice(() => P.poly([[x + colW - 26, y + 12], [x + colW - 19, y + 21], [x + colW - 5, y + 2]], false, 0.8), TONES.good, 3.2);
      if (mark === 'cross') {
        svg += P.twice(() => P.seg(x + colW - 24, y + 4, x + colW - 8, y + 20, 0.8), TONES.bad, 3.2)
          + P.twice(() => P.seg(x + colW - 8, y + 4, x + colW - 24, y + 20, 0.8), TONES.bad, 3.2);
      }
      maxLines = Math.max(maxLines, rows.length);
    });
    svg += P.stroke(P.seg(MID, y + 4, MID, y + 36 + maxLines * 19, 1.2), TONES.note, 1.8);
    return { h: 42 + maxLines * 19, svg };
  };
  const candle = (item, y, P) => {
    const open = num(item.open);
    const close = num(item.close);
    const high = num(item.high);
    const low = num(item.low);
    const top = Math.max(high, open, close, low);
    const bottom = Math.min(low, open, close, high);
    const span = top - bottom || 1;
    const Y = (value) => y + 14 + ((top - value) / span) * 92;
    const cx = 150;
    const bw = 30;
    const up = close >= open;
    const color = up ? TONES.good : TONES.bad;
    const bodyTop = Math.min(Y(open), Y(close));
    const bodyH = Math.max(3, Math.abs(Y(open) - Y(close)));
    let svg = P.twice(() => P.seg(cx, Y(high), cx, Y(low), 0.6), INK, 2.4)
      + P.fill(P.rect(cx - bw / 2, bodyTop, bw, bodyH), tint(up ? 'good' : 'bad')) + P.scribble(cx - bw / 2, bodyTop, bw, bodyH, color)
      + P.twice(() => P.box(cx - bw / 2, bodyTop, bw, bodyH, 0.8), color, 2.6);
    const right = [
      { y: Y(high), from: cx + 3, text: 'high ' + money(high), color: INK },
      { y: Y(close), from: cx + bw / 2 + 2, text: 'close ' + money(close), color },
      { y: Y(low), from: cx + 3, text: 'low ' + money(low), color: INK }
    ].sort((a, b) => a.y - b.y);
    right.forEach((entry, i) => { entry.ty = i ? Math.max(entry.y, right[i - 1].ty + 16) : entry.y; });
    for (let i = right.length - 1; i >= 0; i--) right[i].ty = Math.min(right[i].ty, i === right.length - 1 ? y + 112 : right[i + 1].ty - 16);
    right.forEach((entry) => {
      svg += P.stroke(P.seg(entry.from, entry.y, 206, entry.ty, 0.3), TONES.note, 1.2, ' stroke-dasharray=".04 .05"')
        + label(212, entry.ty + 5, entry.text, { size: 14, color: entry.color, max: W - PAD - 212 });
    });
    const oy = Y(open);
    svg += P.stroke(P.seg(cx - bw / 2 - 2, oy, 96, oy, 0.3), TONES.note, 1.2, ' stroke-dasharray=".04 .05"')
      + label(90, oy + 5, 'open ' + money(open), { size: 14, anchor: 'end', max: 90 - PAD });
    return { h: 124, svg };
  };
  const stamp = (item, y, P) => {
    const text = clean(item.text, 60).toUpperCase();
    const color = tone(item.tone);
    let size = 16;
    const raw = measure(text, size) + text.length * 1.2;
    if (raw > 272) size = Math.max(10, size * 272 / raw);
    const w = Math.min(304, measure(text, size) + text.length * 1.2 + 34);
    const top = y + 7;
    const x = MID - w / 2;
    return {
      h: 56,
      svg: '<g transform="rotate(-3.5 ' + MID + ' ' + r1(top + 18) + ')" opacity=".92">' + P.stroke(P.box(x, top, w, 36, 0.8), color, 3)
        + P.stroke(P.box(x + 4, top + 4, w - 8, 28, 0.5), color, 1.3)
        + label(MID, top + 18 + size * 0.36, text, { size, anchor: 'middle', color, spacing: 1.2, max: w - 16 }) + '</g>'
    };
  };
  const RENDER = { actors, big, line, numberLine, bars, tree, steps, compare, candle, stamp };

  const cueOffsets = (say) => {
    const offsets = [];
    let total = countWords(INTRO);
    say.forEach((sentence) => { offsets.push(total); total += countWords(sentence); });
    if (!offsets.length) offsets.push(total);
    return offsets.map((value) => Math.max(0, Math.min(value, total - 1)));
  };

  /* Builds the board as one SVG string. Groups whose word offset is at or
   * below revealUpTo are marked visible (Infinity = everything).
   *  - stacked (default): frames sit one under another, so a static board
   *    (manual browsing, paused audio, reduced motion) shows everything.
   *  - paged: every frame is drawn in the same spot and only the frame the
   *    voice has reached is visible, so a playing board stays about one frame
   *    tall and the synced caption under it stays in view. */
  const build = (example, revealUpTo, paged) => {
    const ex = example && typeof example === 'object' ? example : {};
    const say = listOf(ex.say, 12).map((sentence) => String(sentence));
    const offsets = cueOffsets(say);
    const at = (cue) => offsets[Math.max(0, Math.min(offsets.length - 1, Math.floor(num(cue))))];
    const P = makePen('academy-whiteboard:' + (ex.id || '') + ':' + (ex.family || '') + ':' + (ex.title || ''));
    const title = clean(ex.title || 'The simple version', 60);
    const groups = [];
    const frameAts = [];
    const top = 54;
    let y = top;
    let bottom = top;
    listOf(ex.frames, 3).forEach((frame, index) => {
      const frameAt = at(frame.cue);
      frameAts.push(frameAt);
      const own = [];
      let content = '';
      if (paged) {
        y = top;
      } else if (index > 0) {
        content += P.stroke(P.poly([[MID - 42, y + 7], [MID - 28, y + 3], [MID - 14, y + 8], [MID, y + 3], [MID + 14, y + 8], [MID + 28, y + 3], [MID + 42, y + 7]], false, 0.4), TONES.note, 1.6);
        y += 16;
      }
      listOf(frame.items, 6).forEach((item) => {
        const draw = item && RENDER[item.k];
        if (!draw) return;
        const out = draw(item, y, P);
        const itemAt = item.k === 'line' && item.cue != null ? Math.max(frameAt, at(item.cue)) : frameAt;
        if (itemAt > frameAt) own.push({ at: itemAt, frame: index, svg: out.svg });
        else content += out.svg;
        y += out.h + 8;
      });
      bottom = Math.max(bottom, y);
      groups.push({ at: frameAt, frame: index, svg: content }, ...own);
    });
    const height = Math.ceil(bottom + 8) + BRAND_FOOT;
    const limit = revealUpTo == null ? Infinity : revealUpTo;
    let current = -1;
    if (paged) frameAts.forEach((frameAt, index) => { if (frameAt <= limit) current = index; });
    const visible = (group) => group.at <= limit && (!paged || group.frame === current);
    let paper = '<rect x="1" y="1" width="358" height="' + (height - 2) + '" rx="14" fill="#fbf7ee" stroke="#e0d5bf" stroke-width="1.5"/>';
    for (let ly = 58; ly < height - 10; ly += 24) paper += '<path d="M14 ' + ly + 'H346" stroke="#ece4d1" stroke-width="1"/>';
    paper += '<path d="M152 1 L210 3.6 L208.6 14.4 L150.8 11.8 Z" fill="#bff5d3" opacity=".85"/>';
    paper += brandFooter(height);
    let titleSize = 19;
    const titleRaw = measure(title, titleSize);
    if (titleRaw > INNER - 10) titleSize = Math.max(12, titleSize * (INNER - 10) / titleRaw);
    const titleW = Math.min(INNER - 10, measure(title, titleSize));
    const heading = P.stroke(P.seg(PAD + 3, 29, PAD + 9 + titleW, 28, 0.8), BRAND.green, 12, ' opacity=".4"')
      + label(PAD + 6, 34, title, { size: titleSize, max: INNER - 10 })
      + P.stroke(P.seg(PAD + 4, 42, PAD + 10 + titleW, 41, 1), INK, 2);
    const markup = '<svg class="wb-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + height + '" role="img" aria-label="' + esc('Making Easy Money Academy whiteboard: ' + title)
      + '" font-family="' + esc(FONT) + '" font-weight="700"><title>' + esc(title) + '</title>' + paper + heading
      + groups.map((group) => '<g class="wb-r' + (visible(group) ? ' wb-on' : '') + '" data-at="' + group.at + '" data-frame="' + group.frame + '">' + (group.svg || '') + '</g>').join('')
      + '</svg>';
    return { markup, height, offsets, groups: groups.length, frames: frameAts };
  };

  /* Labels that would be unreadable on the narrowest (270px) deck: shrunk
   * below READABLE, squeezed, or number line labels that overlap. The server
   * validator rejects examples with any of these (see examples.js). */
  const fit = (example) => {
    fitLog = [];
    try {
      build(example, Infinity, false);
      return Array.from(new Set(fitLog));
    } finally {
      fitLog = null;
    }
  };

  /* ---------- Live deck wiring ---------- */
  const state = { key: '', visual: null, board: null, example: null, groups: [], frames: [], current: -1, anim: false, paged: false, timer: 0 };
  let heard = { key: '', word: -1, playing: false };
  const usable = (example) => Boolean(example && typeof example === 'object' && Array.isArray(example.frames) && example.frames.length);
  const partKey = (detail) => String(detail.lessonKey || '') + '#' + String(detail.partIndex);
  const reducedMotion = () => {
    try { return Boolean(win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (_) { return false; }
  };
  const stopTimer = () => { if (state.timer) { win.clearTimeout(state.timer); state.timer = 0; } };
  const frameFor = (word) => {
    let current = -1;
    state.frames.forEach((frameAt, index) => { if (frameAt <= word) current = index; });
    return current;
  };
  /* Paged: only groups of the current (or a later) frame can still appear. */
  const pending = () => state.groups.some((group) => !group.on && (!state.paged || group.frame >= state.current));
  const show = (group, animate) => {
    if (group.on) return;
    group.on = true;
    group.el.classList.add('wb-on');
    if (animate && state.anim) {
      group.el.classList.add('wb-go');
      Array.prototype.forEach.call(group.el.querySelectorAll('animate'), (node) => { try { node.beginElement(); } catch (_) { /* static fallback */ } });
    }
  };
  const hide = (group) => {
    if (!group.on) return;
    group.on = false;
    group.el.classList.remove('wb-on');
    group.el.classList.remove('wb-go');
  };
  /* (Re)draws the current board element in one layout. */
  const draw = (paged, word) => {
    const built = build(state.example, word, paged);
    stopTimer();
    state.board.className = paged ? 'wb-board wb-anim' : 'wb-board';
    state.board.innerHTML = built.markup;
    state.paged = paged;
    state.anim = paged;
    state.frames = built.frames;
    state.current = paged ? frameFor(word) : -1;
    state.groups = Array.prototype.map.call(state.board.querySelectorAll('.wb-r'), (el) => ({
      el, at: Number(el.getAttribute('data-at')) || 0, frame: Number(el.getAttribute('data-frame')) || 0, on: el.classList.contains('wb-on')
    }));
  };
  /* Everything visible: a paged board is redrawn stacked (whole board). */
  const revealAll = (animate) => {
    stopTimer();
    if (state.paged) draw(false, Infinity);
    else state.groups.forEach((group) => show(group, animate));
  };
  /* Safety net: if progress events stop while lines are still hidden (audio
   * paused, tab throttled, script error elsewhere), show the whole board. */
  const arm = () => {
    stopTimer();
    if (pending()) state.timer = win.setTimeout(() => { state.timer = 0; revealAll(true); }, WATCHDOG_MS);
  };
  /* Playing: turn to the frame the voice is on and reveal its lines in order
   * (seeking back turns the page back too). */
  const follow = (word) => {
    state.current = frameFor(word);
    state.groups.forEach((group) => {
      if (group.frame === state.current && group.at <= word) show(group, true);
      else hide(group);
    });
  };
  const reset = () => {
    stopTimer();
    Object.assign(state, { key: '', visual: null, board: null, example: null, groups: [], frames: [], current: -1, anim: false, paged: false });
  };
  const release = (visual) => {
    [visual, state.visual].forEach((node) => { if (node && node.hasAttribute && node.hasAttribute('data-board')) node.removeAttribute('data-board'); });
    reset();
  };
  const onSync = (event) => {
    const detail = (event && event.detail) || {};
    const visual = detail.visual && detail.visual.nodeType === 1 ? detail.visual : doc.querySelector('.academy-slide-visual');
    if (!visual) return;
    if (!detail.isExample || !usable(detail.example)) { release(visual); return; }
    const key = partKey(detail);
    const playing = Boolean(detail.playing);
    if (key === state.key && state.board && state.board.parentNode === visual) {
      if (!visual.hasAttribute('data-board')) visual.setAttribute('data-board', 'whiteboard');
      if (!playing) revealAll(false); else if (pending()) arm();
      return;
    }
    const anim = playing && !reducedMotion();
    const word = anim ? (heard.key === key && heard.playing ? heard.word : -1) : Infinity;
    stopTimer();
    const board = doc.createElement('div');
    Object.assign(state, { key, visual, board, example: detail.example });
    try { draw(anim, word); } catch (_) { release(visual); return; }
    visual.replaceChildren(board);
    visual.setAttribute('data-board', 'whiteboard');
    if (anim) arm();
  };
  const onProgress = (event) => {
    const detail = (event && event.detail) || {};
    const word = Number(detail.wordIndex);
    heard = { key: partKey(detail), word: Number.isFinite(word) ? word : -1, playing: Boolean(detail.playing) };
    if (!state.board || heard.key !== state.key) return;
    if (!state.board.isConnected) { reset(); return; }
    if (!heard.playing || (state.paged && reducedMotion())) { revealAll(false); return; }
    if (!state.paged) {
      /* Playback (re)started on a static board: page it again. */
      if (!reducedMotion()) { draw(true, heard.word); arm(); }
      return;
    }
    follow(heard.word);
    arm();
  };

  const api = {
    svg: (example, showAll) => build(example, showAll === false ? -1 : Infinity).markup,
    build,
    fit,
    offsets: (example) => cueOffsets(listOf(example && example.say, 12).map((sentence) => String(sentence)))
  };
  if (win) {
    win.SMLWhiteboard = api;
    if (typeof win.addEventListener === 'function') {
      win.addEventListener('sml-academy-slide-sync', onSync);
      win.addEventListener('sml-academy-slide-progress', onProgress);
    }
  }
  return api;
}

let cachedScript = '';
function academyCartoonVisualsScript() {
  if (!cachedScript) {
    cachedScript = `<style>${WHITEBOARD_CSS}</style><script>(${whiteboardRuntime.toString()})(window,document);</script>`;
  }
  return cachedScript;
}

/* The same runtime, run in Node without a page, so the server-side example
 * validator measures labels exactly the way the browser draws them. */
let nodeApi = null;
function whiteboardFit(example) {
  if (!nodeApi) nodeApi = whiteboardRuntime(null, null);
  return nodeApi.fit(example);
}

module.exports = { academyCartoonVisualsScript, whiteboardFit };
