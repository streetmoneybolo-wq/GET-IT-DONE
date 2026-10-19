/* The Academy chart kit (window.smlViz): one look for every graph, bar, meter and pie in the Academy, so they read the same
   way everywhere and are easy to compare.
     - palette: eight categorical hues validated for colour-blind separation and 3:1 contrast on the Academy's dark surface
       (assigned in fixed order, never cycled past eight), green/red reserved for up/down, text in text tokens, never series colour
     - marks: bars at most 24px thick with a 4px rounded data-end and a square baseline, 2px surface gaps between touching bars and
       stacked segments, 2px lines, 8px end markers with a 2px surface ring, hairline solid gridlines, nice rounded tick values
     - donuts: segments separated by a 2px surface gap, no glow, a direct label on any slice large enough, the legend carries the rest
     - meters (HTML): a thin rounded track one step off the surface, a rounded fill, the value beside it
     - hover: every canvas chart gets a tooltip (bars: the bar under the pointer; lines: the nearest x) that lists every series
   Canvas only, no libraries. Loaded before every module that draws. */
(function () {
  if (window.smlViz) return;
  var T = {
    surface: '#0a1118',
    ink: '#eaf2f6', ink2: '#b9c7d0', muted: '#8fa3ae',
    grid: '#1a2832', baseline: '#2d3f4b', track: 'rgba(255,255,255,.08)',
    /* categorical, fixed order (validated on #0a1118: adjacent CVD dE >= 8.4, normal-vision dE >= 19.3, contrast >= 3:1) */
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
    up: '#00d084', down: '#ff5470', upSoft: 'rgba(0,208,132,.14)', downSoft: 'rgba(255,84,112,.14)',
    accent: '#52e6ad', neutral: '#5b6f7c',
    font: '600 10px system-ui,-apple-system,"Segoe UI",sans-serif', fontBold: '800 10px system-ui,-apple-system,"Segoe UI",sans-serif', mono: '700 10px ui-monospace,monospace'
  };
  var MAX_THICK = 24, GAP = 2, RADIUS = 4;

  /* ---- numbers ---- */
  function compact(v, money) {
    if (v == null || !isFinite(v)) return '—';
    var a = Math.abs(v), s = v < 0 ? '-' : '', p = money ? '$' : '';
    if (a === 0) return p + '0';
    var t = a >= 1e12 ? (a / 1e12).toFixed(a >= 1e13 ? 0 : 1) + 'T' : a >= 1e9 ? (a / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e4 ? (a / 1e3).toFixed(0) + 'K' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'K' : a >= 100 ? a.toFixed(0) : a >= 10 ? a.toFixed(1) : a.toFixed(2);
    return s + p + t.replace(/\.0(?=[KMBT]|$)/, '');
  }
  function pct(v, d) { return v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + Number(v).toFixed(d == null ? 1 : d) + '%'; }
  /* nice rounded tick values that cover [lo, hi] */
  function ticks(lo, hi, n) {
    n = n || 4; if (!(hi > lo)) { hi = lo + 1; }
    var raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
    var a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
    for (var v = a; v <= b + step / 2; v += step) out.push(Math.round(v / step) * step);
    return { lo: a, hi: b, ticks: out, step: step };
  }

  /* ---- canvas ---- */
  function setup(canvas, h) {
    var dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 600, hh = h || canvas.clientHeight || 160;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); if (h) canvas.style.height = h + 'px';
    var c = canvas.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, hh);
    return { c: c, w: w, h: hh };
  }
  /* hairline solid gridlines at the given y positions, with their labels in muted ink on the left */
  function grid(c, x0, x1, rows) {
    c.save(); c.strokeStyle = T.grid; c.lineWidth = 1; c.fillStyle = T.muted; c.font = T.font; c.textAlign = 'right'; c.textBaseline = 'middle';
    (rows || []).forEach(function (r) { var y = Math.round(r.y) + 0.5; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); if (r.label != null) c.fillText(String(r.label), x0 - 5, y); });
    c.restore();
  }
  function baseline(c, x0, x1, y) { c.save(); c.strokeStyle = T.baseline; c.lineWidth = 1; c.beginPath(); c.moveTo(x0, Math.round(y) + 0.5); c.lineTo(x1, Math.round(y) + 0.5); c.stroke(); c.restore(); }
  /* a bar from the baseline to `yEnd`: rounded at the data end, square at the baseline */
  function bar(c, x, w, yBase, yEnd, color) {
    var up = yEnd <= yBase, top = Math.min(yBase, yEnd), bot = Math.max(yBase, yEnd), h = Math.max(1, bot - top), r = Math.min(RADIUS, w / 2, h);
    c.fillStyle = color; c.beginPath();
    if (up) { c.moveTo(x, bot); c.lineTo(x, top + r); c.arcTo(x, top, x + r, top, r); c.lineTo(x + w - r, top); c.arcTo(x + w, top, x + w, top + r, r); c.lineTo(x + w, bot); }
    else { c.moveTo(x, top); c.lineTo(x + w, top); c.lineTo(x + w, bot - r); c.arcTo(x + w, bot, x + w - r, bot, r); c.lineTo(x + r, bot); c.arcTo(x, bot, x, bot - r, r); }
    c.closePath(); c.fill();
  }
  /* the thickness bars get inside a slot: never the whole slot, never more than 24px, always leaving the gap */
  function thick(slot, perSlot) { perSlot = perSlot || 1; return Math.max(2, Math.min(MAX_THICK, Math.floor((slot - GAP * (perSlot + 1)) / perSlot))); }
  /** a column chart: items [{label, values:[..], colors:[..]}], one or more series per slot; returns the hit geometry for hover */
  function columns(c, o) {
    var items = o.items || [], x0 = o.x0, x1 = o.x1, yTop = o.yTop, yBot = o.yBot, per = Math.max(1, (items[0] && items[0].values.length) || 1);
    var all = []; items.forEach(function (it) { it.values.forEach(function (v) { if (isFinite(v)) all.push(v); }); });
    var lo = Math.min(0, o.lo != null ? o.lo : Math.min.apply(null, all.length ? all : [0])), hi = Math.max(0, o.hi != null ? o.hi : Math.max.apply(null, all.length ? all : [1]));
    var minV = Math.min.apply(null, all.length ? all : [0]), maxV = Math.max.apply(null, all.length ? all : [1]);
    var tk = ticks(Math.min(0, minV), Math.max(0, maxV), o.ticks || 4); lo = tk.lo; hi = tk.hi;
    if (minV < 0 && Math.abs(minV) < tk.step) { var half = tk.step / 2; lo = -Math.ceil(Math.abs(minV) / half) * half; }
    if (maxV > 0 && maxV < tk.step && hi > tk.step) hi = tk.step;
    var tickRows = tk.ticks.filter(function (v) { return v >= lo - 1e-9 && v <= hi + 1e-9; });
    var y = function (v) { return yTop + (hi - v) / (hi - lo || 1) * (yBot - yTop); };
    if (o.grid !== false) grid(c, x0, x1, tickRows.map(function (v) { return { y: y(v), label: o.fmt ? o.fmt(v) : compact(v) }; }));
    var slot = (x1 - x0) / Math.max(1, items.length), bw = thick(slot, per), groupW = bw * per + GAP * (per - 1), geoms = [];
    items.forEach(function (it, i) {
      var gx = x0 + i * slot + (slot - groupW) / 2;
      it.values.forEach(function (v, k) {
        if (!isFinite(v)) return;
        var x = gx + k * (bw + GAP), col = (it.colors && it.colors[k]) || (o.colors && o.colors[k]) || T.series[k % 8];
        bar(c, x, bw, y(0), y(v), col);
        geoms.push({ x: x, w: bw, y0: Math.min(y(0), y(v)), y1: Math.max(y(0), y(v)), i: i, k: k, v: v, color: col });
      });
      if (o.xLabel !== false && it.label != null && (o.every ? i % o.every === 0 : true)) { c.fillStyle = T.ink2; c.font = T.font; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText(String(it.label), gx + groupW / 2, yBot + 13); }
    });
    baseline(c, x0, x1, y(0));
    /* selective value labels: the last column and the extremes of the first series, never every bar */
    if (o.labels !== false && items.length) {
      var vals = items.map(function (it) { return it.values[0]; }), iMax = vals.indexOf(Math.max.apply(null, vals.filter(isFinite))), iMin = vals.indexOf(Math.min.apply(null, vals.filter(isFinite)));
      var want = {}; want[items.length - 1] = 1; if (items.length > 3) { want[iMax] = 1; want[iMin] = 1; }
      Object.keys(want).forEach(function (i) { i = Number(i); var it = items[i], v = it.values[0]; if (!isFinite(v)) return; var g = geoms.filter(function (q) { return q.i === i && q.k === 0; })[0]; if (!g) return; var below = v < 0 && g.y1 + 20 <= yBot; pill(c, g.x + g.w / 2, v >= 0 ? g.y0 - 4 : below ? g.y1 + 4 : g.y0 - 4, o.fmt ? o.fmt(v) : compact(v), v >= 0 || !below ? 'above' : 'below'); });
    }
    return { geoms: geoms, y: y, lo: lo, hi: hi, slot: slot };
  }
  /** a stacked column chart: items [{label, parts:[v..]}], colors per part (categorical slots); 2px surface gap between segments */
  function stacks(c, o) {
    var items = o.items || [], x0 = o.x0, x1 = o.x1, yTop = o.yTop, yBot = o.yBot, hi = o.hi != null ? o.hi : Math.max.apply(null, items.map(function (it) { return it.parts.reduce(function (s, v) { return s + Math.max(0, v || 0); }, 0); }).concat([1]));
    var tk = ticks(0, hi, o.ticks || 4); hi = tk.hi;
    var y = function (v) { return yTop + (hi - v) / hi * (yBot - yTop); };
    if (o.grid !== false) grid(c, x0, x1, tk.ticks.map(function (v) { return { y: y(v), label: o.fmt ? o.fmt(v) : compact(v) }; }));
    var slot = (x1 - x0) / Math.max(1, items.length), bw = thick(slot, 1), geoms = [];
    items.forEach(function (it, i) {
      var x = x0 + i * slot + (slot - bw) / 2, acc = 0;
      it.parts.forEach(function (v, k) {
        if (!(v > 0)) return;
        var top = y(acc + v), bot = y(acc), col = (o.colors && o.colors[k]) || T.series[k % 8];
        c.fillStyle = col; c.fillRect(x, top + (k ? 0 : 0), bw, Math.max(1, bot - top - (acc > 0 ? GAP : 0)));
        geoms.push({ x: x, w: bw, y0: top, y1: bot, i: i, k: k, v: v, color: col });
        acc += v;
      });
      if (it.label != null) { c.fillStyle = T.ink2; c.font = T.font; c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillText(String(it.label), x + bw / 2, yBot + 13); }
      it.top = y(acc);
    });
    baseline(c, x0, x1, y(0));
    return { geoms: geoms, y: y, hi: hi, slot: slot };
  }
  /** a 2px line with a 10% wash under it, and an end marker with a surface ring */
  function line(c, pts, o) {
    o = o || {}; var good = pts.filter(function (p) { return p && isFinite(p[0]) && isFinite(p[1]); }); if (good.length < 2) return;
    if (o.fill && isFinite(o.yBase)) { c.save(); c.globalAlpha = 0.10; c.fillStyle = o.color || T.series[0]; c.beginPath(); good.forEach(function (p, i) { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }); c.lineTo(good[good.length - 1][0], o.yBase); c.lineTo(good[0][0], o.yBase); c.closePath(); c.fill(); c.restore(); }
    c.save(); c.strokeStyle = o.color || T.series[0]; c.lineWidth = o.width || 2; c.lineJoin = 'round'; c.lineCap = 'round';
    if (o.dash) c.setLineDash(o.dash);
    c.beginPath(); good.forEach(function (p, i) { if (i) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]); }); c.stroke(); c.restore();
    if (o.marker !== false) marker(c, good[good.length - 1][0], good[good.length - 1][1], o.color || T.series[0]);
    if (o.markers) good.forEach(function (p) { marker(c, p[0], p[1], o.color || T.series[0], 3.5); });
  }
  function marker(c, x, y, color, r) { r = r || 4; c.save(); c.beginPath(); c.arc(x, y, r + 2, 0, Math.PI * 2); c.fillStyle = T.surface; c.fill(); c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = color; c.fill(); c.restore(); }
  /** a donut: slices [{value, color, label}] with a 2px surface gap between segments; labels the slices that are big enough; returns hit geometry */
  function donut(c, o) {
    var slices = (o.slices || []).filter(function (s) { return s && s.value > 0; }), total = slices.reduce(function (s, x) { return s + x.value; }, 0);
    var cx = o.cx, cy = o.cy, R = o.R, r = o.r != null ? o.r : R * 0.62, geoms = [];
    if (!(total > 0)) return { geoms: geoms, total: 0 };
    var a = -Math.PI / 2;
    slices.forEach(function (s, i) {
      var b = a + s.value / total * Math.PI * 2, col = s.color || T.series[i % 8];
      c.beginPath(); c.arc(cx, cy, R, a, b); c.arc(cx, cy, r, b, a, true); c.closePath(); c.fillStyle = col; c.fill();
      geoms.push({ a0: a, a1: b, v: s.value, share: s.value / total, label: s.label, color: col, i: i });
      a = b;
    });
    /* the gaps: a 2px surface stroke along every segment edge (only when there is more than one slice) */
    if (slices.length > 1) { c.save(); c.strokeStyle = o.surface || T.surface; c.lineWidth = GAP; geoms.forEach(function (g) { c.beginPath(); c.moveTo(cx + Math.cos(g.a0) * (r - 1), cy + Math.sin(g.a0) * (r - 1)); c.lineTo(cx + Math.cos(g.a0) * (R + 1), cy + Math.sin(g.a0) * (R + 1)); c.stroke(); }); c.restore(); }
    /* direct labels on slices with room (8% or more): the share, in ink on a dark pill so it clears any fill */
    if (o.labels !== false) geoms.forEach(function (g) { if (g.share < 0.08) return; var m = (g.a0 + g.a1) / 2, rr = (R + r) / 2, x = cx + Math.cos(m) * rr, y = cy + Math.sin(m) * rr, txt = Math.round(g.share * 100) + '%'; c.font = T.fontBold; c.textAlign = 'center'; c.textBaseline = 'middle'; var tw = c.measureText(txt).width + 8; if (tw > (R - r) * 1.6) return; c.fillStyle = 'rgba(7,11,16,.78)'; roundRect(c, x - tw / 2, y - 8, tw, 16, 8); c.fill(); c.fillStyle = T.ink; c.fillText(txt, x, y + 0.5); });
    var room = r * 2 - 10, fit = function (txt, font) { c.font = font; var t = String(txt); if (c.measureText(t).width > room) { c.font = font.replace(/(\d+)px/, function (_, n) { return Math.max(8, n - 2) + 'px'; }); } while (t.length > 2 && c.measureText(t).width > room) t = t.slice(0, -2).replace(/\s+$/, '') + '…'; return t; };
    if (o.title) { c.fillStyle = T.ink; c.textAlign = 'center'; c.textBaseline = 'middle'; var tf = '800 ' + (r >= 44 ? 15 : 12) + 'px system-ui,-apple-system,"Segoe UI",sans-serif'; c.fillText(fit(o.title, tf), cx, cy - (o.sub ? 6 : 0)); }
    if (o.sub) { c.fillStyle = T.muted; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(fit(o.sub, T.font), cx, cy + 10); }
    return { geoms: geoms, total: total, cx: cx, cy: cy, R: R, r: r };
  }
  /* a value label on a dark pill, centred on x, sitting above or below y */
  function pill(c, x, y, txt, where) { c.save(); c.font = T.fontBold; c.textAlign = 'center'; c.textBaseline = 'middle'; var tw = c.measureText(txt).width + 8, cy = where === 'below' ? y + 8 : y - 8; c.fillStyle = 'rgba(7,11,16,.82)'; roundRect(c, x - tw / 2, cy - 8, tw, 16, 8); c.fill(); c.fillStyle = T.ink; c.fillText(txt, x, cy + 0.5); c.restore(); }
  function roundRect(c, x, y, w, h, r) { r = Math.min(r, w / 2, h / 2); c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
  /* an in-canvas legend row: a 10px swatch (rect for bars, a short line for lines) and the name in secondary ink */
  function legend(c, x, y, entries) {
    c.save(); c.font = T.font; c.textAlign = 'left'; c.textBaseline = 'middle';
    entries.forEach(function (e) { if (e.line) { c.strokeStyle = e.color; c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 12, y); c.stroke(); } else { c.fillStyle = e.color; roundRect(c, x, y - 5, 10, 10, 2); c.fill(); } c.fillStyle = T.ink2; c.fillText(e.name, x + 16, y); x += 16 + c.measureText(e.name).width + 12; });
    c.restore(); return x;
  }

  /* ---- hover: one tooltip for every chart ---- */
  var tip = null;
  function tipEl() { if (tip) return tip; tip = document.createElement('div'); tip.className = 'viz-tip'; tip.setAttribute('role', 'status'); document.body.appendChild(tip); return tip; }
  /** rows [{label, value, color, line}]; title optional. Everything goes in as text, never markup. */
  function tipShow(clientX, clientY, title, rows) {
    var el = tipEl(); while (el.firstChild) el.removeChild(el.firstChild);
    if (title) { var h = document.createElement('div'); h.className = 'viz-tip-t'; h.textContent = String(title); el.appendChild(h); }
    (rows || []).forEach(function (r) {
      var row = document.createElement('div'); row.className = 'viz-tip-r';
      var key = document.createElement('i'); key.className = r.line ? 'ln' : 'sw'; key.style.background = r.color || T.muted; row.appendChild(key);
      var val = document.createElement('b'); val.textContent = String(r.value == null ? '—' : r.value); row.appendChild(val);
      var lab = document.createElement('span'); lab.textContent = String(r.label == null ? '' : r.label); row.appendChild(lab);
      el.appendChild(row);
    });
    el.style.display = 'block';
    var W = el.offsetWidth || 160, H = el.offsetHeight || 40, x = clientX + 14, y = clientY + 14;
    if (x + W > window.innerWidth - 8) x = clientX - W - 14; if (y + H > window.innerHeight - 8) y = clientY - H - 14;
    el.style.left = Math.max(4, x) + 'px'; el.style.top = Math.max(4, y) + 'px';
  }
  function tipHide() { if (tip) tip.style.display = 'none'; }
  /** wire a canvas: `find(px, py)` returns { title, rows } or null for the pointer position in CSS pixels */
  function hover(canvas, find) {
    if (!canvas || canvas.__vizHover) { if (canvas) canvas.__vizFind = find; return; }
    canvas.__vizHover = true; canvas.__vizFind = find;
    var move = function (e) { var r = canvas.getBoundingClientRect(), hit = canvas.__vizFind ? canvas.__vizFind(e.clientX - r.left, e.clientY - r.top) : null; if (hit) tipShow(e.clientX, e.clientY, hit.title, hit.rows); else tipHide(); };
    canvas.addEventListener('pointermove', move); canvas.addEventListener('pointerleave', tipHide); canvas.addEventListener('pointerdown', move);
  }
  /* hit helpers */
  function hitColumn(geoms, px, py, slack) { slack = slack == null ? 6 : slack; for (var i = 0; i < geoms.length; i++) { var g = geoms[i]; if (px >= g.x - slack && px <= g.x + g.w + slack) return g; } return null; }
  function hitSlice(d, px, py) { if (!d || !d.geoms) return null; var dx = px - d.cx, dy = py - d.cy, dist = Math.sqrt(dx * dx + dy * dy); if (dist > d.R + 2 || dist < d.r - 2) return null; var a = Math.atan2(dy, dx); if (a < -Math.PI / 2) a += Math.PI * 2; for (var i = 0; i < d.geoms.length; i++) { var g = d.geoms[i]; if (a >= g.a0 && a <= g.a1) return g; } return null; }
  function nearestX(xs, px) { var best = -1, bd = Infinity; for (var i = 0; i < xs.length; i++) { var d = Math.abs(xs[i] - px); if (d < bd) { bd = d; best = i; } } return best; }

  /* ---- HTML meters and legends ---- */
  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); };
  /** a thin rounded meter: label, value and a fill (0..100) in `color`, on the same track everywhere */
  function meter(label, valueText, pctFill, color, title) {
    var w = Math.max(0, Math.min(100, Number(pctFill) || 0));
    return '<div class="viz-meter"' + (title ? ' title="' + esc(title) + '"' : '') + '><span>' + esc(label) + '</span><b>' + esc(valueText) + '</b><i><em style="width:' + w.toFixed(1) + '%;background:' + esc(color || T.series[0]) + '"></em></i></div>';
  }
  function legendHtml(entries) { return '<div class="viz-legend">' + entries.map(function (e) { return '<span><i style="background:' + esc(e.color) + '"' + (e.line ? ' class="ln"' : '') + '></i>' + esc(e.name) + (e.value != null ? ' <b>' + esc(e.value) + '</b>' : '') + '</span>'; }).join('') + '</div>'; }

  var css = document.createElement('style');
  css.id = 'sml-viz-css';
  css.textContent = ''
    + '.viz-tip{position:fixed;z-index:2147483500;display:none;min-width:120px;max-width:280px;padding:7px 9px;border:1px solid #223241;border-radius:9px;background:rgba(10,17,24,.96);color:#eaf2f6;font:600 11px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.5);pointer-events:none}'
    + '.viz-tip-t{color:#b9c7d0;font-weight:700;font-size:10px;letter-spacing:.04em;margin:0 0 3px}.viz-tip-r{display:flex;align-items:center;gap:6px;white-space:nowrap}.viz-tip-r b{color:#fff;font-weight:800}.viz-tip-r span{color:#b9c7d0}'
    + '.viz-tip-r i{flex:none;display:inline-block;width:8px;height:8px;border-radius:2px}.viz-tip-r i.ln{width:12px;height:2px;border-radius:1px}'
    + '.viz-meter{display:grid;grid-template-columns:auto 1fr;grid-template-areas:"l v" "m m";gap:2px 8px;align-items:baseline;margin:0 0 6px}.viz-meter span{grid-area:l;color:#8fa3ae;font:700 10px ui-monospace,monospace;letter-spacing:.06em}.viz-meter b{grid-area:v;justify-self:end;color:#eaf2f6;font:800 11px ui-monospace,monospace}'
    + '.viz-meter i{grid-area:m;display:block;height:6px;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden}.viz-meter em{display:block;height:100%;border-radius:0 3px 3px 0;min-width:2px}'
    + '.viz-legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:6px 0 0;color:#b9c7d0;font:600 10px system-ui,-apple-system,"Segoe UI",sans-serif}.viz-legend span{display:inline-flex;align-items:center;gap:5px}.viz-legend i{display:inline-block;width:10px;height:10px;border-radius:2px}.viz-legend i.ln{width:12px;height:2px;border-radius:1px}.viz-legend b{color:#eaf2f6}';
  (document.head || document.documentElement).appendChild(css);

  window.smlViz = { T: T, pill: pill, compact: compact, pct: pct, ticks: ticks, setup: setup, grid: grid, baseline: baseline, bar: bar, thick: thick, columns: columns, stacks: stacks, line: line, marker: marker, donut: donut, roundRect: roundRect, legend: legend, hover: hover, tipShow: tipShow, tipHide: tipHide, hitColumn: hitColumn, hitSlice: hitSlice, nearestX: nearestX, meter: meter, legendHtml: legendHtml, GAP: GAP, MAX_THICK: MAX_THICK };
})();
