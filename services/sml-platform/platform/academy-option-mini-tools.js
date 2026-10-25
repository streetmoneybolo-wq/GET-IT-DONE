/* Tools for the contract mini chart (academy-options-desk.js): which of the main chart's CHART and FLOW tools make sense on one
   options contract, the overlay data for the ones that do, and the drawing of them onto the mini canvas.

   THE LOGIC, in one place, because the owner asked for the tools "with logic so it makes sense":
   - A contract has its own premium candles (GET /academy-activity/option-bars), so anything computed FROM CANDLES applies to it
     directly: smart-money structure, fair-value gaps, liquidity and VWAP (SMC); VWAP bands, initial balance, volume nodes and
     fib (LEVELS); chart patterns (PATTERNS). These run the same engines the main chart runs, on the contract's bars.
   - A contract has no per-trade tape and no order-book depth in this product, only its top of book (bid / ask). So FLOW is a
     buy / sell pressure read from the contract's own candles (up-close volume against down-close volume, weighted by where
     each close sits in its range), labelled as such; WALLS and HEAT need depth and are not offered; COST is about holders of
     the stock, not of one contract, and is not offered either.
   - INTENT, DARK POOL, SHORT SALE and SENTIMENT read the STOCK. They are real, but they are not properties of one contract, so
     the mini chart offers them as hand-offs: the button opens that tool on the main chart for the underlying.

   Pure: works in node (module.exports) and in the page (window.SmlOptionMiniTools). The engines are passed in (deps), never
   required, so the module stays testable with stand-ins. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmlOptionMiniTools = api;
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  const TOOLS = Object.freeze([
    { id: 'smc', label: 'SMC', group: 'chart', ok: true, why: 'Structure, fair-value gaps, liquidity and VWAP on the contract’s own premium candles.' },
    { id: 'levels', label: 'LEVELS', group: 'chart', ok: true, why: 'VWAP bands, initial balance, volume nodes and fib, on the premium.' },
    { id: 'patterns', label: 'PATTERNS', group: 'chart', ok: true, why: 'Chart patterns on the premium candles.' },
    { id: 'flow', label: 'FLOW', group: 'flow', ok: true, why: 'Buy / sell pressure from the contract’s own candles: up-close against down-close volume, weighted by where each close sits in its range. Contracts have no per-trade tape here.' },
    { id: 'walls', label: 'WALLS', group: 'chart', ok: false, why: 'Needs the contract’s order book. A contract only has its top of book (bid / ask) here, so there are no walls to draw.' },
    { id: 'heat', label: 'HEAT', group: 'chart', ok: false, why: 'An order-book heat map needs depth over time. A contract only has bid / ask here.' },
    { id: 'cost', label: 'COST', group: 'chart', ok: false, why: 'Cost basis is about who holds the stock, not one contract.' },
    { id: 'intent', label: 'INTENT', group: 'stock', ok: true, target: '#intent-btn', why: 'Smart-money intent reads the stock’s flow, not one contract. Opens it on the main chart.' },
    { id: 'darkpool', label: 'DARK POOL', group: 'stock', ok: true, target: '#darkpool-toggle', why: 'Off-exchange prints belong to the stock. Opens it on the main chart.' },
    { id: 'shortsale', label: 'SHORT SALE', group: 'stock', ok: true, target: '#shortsale-toggle', why: 'Short volume belongs to the stock. Opens it on the main chart.' },
    { id: 'sentiment', label: 'SENTIMENT', group: 'stock', ok: true, target: '#sentiment-toggle', why: 'Sentiment is about the stock. Opens it on the main chart.' }
  ]);
  const DEFAULTS = Object.freeze(['smc']);
  const OVERLAYS = Object.freeze(['smc', 'levels', 'patterns', 'flow']);
  const byId = (id) => TOOLS.find((t) => t.id === id) || null;
  const fin = (v) => typeof v === 'number' && Number.isFinite(v);

  /* only tools that exist can be switched on; unknown and not-offered ids are dropped silently */
  function normalizeEnabled(list) {
    const out = [];
    for (const id of Array.isArray(list) ? list : []) {
      const t = byId(id);
      if (t && t.ok && OVERLAYS.includes(t.id) && !out.includes(t.id)) out.push(t.id);
    }
    return out;
  }

  /* Buy / sell pressure from candles alone. Each bar's volume is split by where the close sits in the bar's range
     (a close at the high is all buying, at the low all selling, mid-range half and half); a bar with no range splits
     by its direction. The last `n` bars are read. */
  function flowFromBars(bars, n = 40) {
    const b = (Array.isArray(bars) ? bars : []).filter((x) => x && fin(+x.c) && fin(+x.o)).slice(-Math.max(5, n | 0));
    let buy = 0, sell = 0;
    for (const x of b) {
      const v = fin(+x.v) ? Math.max(0, +x.v) : 0;
      const h = fin(+x.h) ? +x.h : Math.max(+x.o, +x.c), l = fin(+x.l) ? +x.l : Math.min(+x.o, +x.c);
      const pos = h > l ? (+x.c - l) / (h - l) : (+x.c >= +x.o ? 1 : 0);
      buy += v * pos; sell += v * (1 - pos);
    }
    const total = buy + sell;
    const share = total > 0 ? buy / total : null;
    const read = share == null ? 'no volume in these candles'
      : share >= 0.62 ? 'buyers have had it' : share <= 0.38 ? 'sellers have had it' : 'two-sided';
    return { bars: b.length, buy, sell, share, read };
  }

  /* Everything an enabled overlay needs, computed once per bar set. `deps` carries the engines the page exposes:
     { smartMoney: window.SmlSmartMoney, levels: window.SmlSessionLevels, patterns: window.SmlPatterns }. A missing or
     failing engine leaves its slot null and never takes the others down. */
  function plan(bars, enabled, deps) {
    const on = normalizeEnabled(enabled);
    const d = deps || {};
    const out = { on, n: Array.isArray(bars) ? bars.length : 0, smc: null, levels: null, patterns: null, flow: null, notes: [] };
    if (!out.n) return out;
    const safe = (label, fn) => { try { return fn(); } catch (e) { out.notes.push(label + ' unavailable'); return null; } };
    if (on.includes('smc') && d.smartMoney && typeof d.smartMoney.analyze === 'function') {
      out.smc = safe('SMC', () => d.smartMoney.analyze(bars));
      if (out.smc === null && out.n < 20) out.notes.push('SMC needs 20 candles');
    }
    if (on.includes('levels') && d.levels && typeof d.levels.analyze === 'function') out.levels = safe('Levels', () => d.levels.analyze(bars));
    if (on.includes('patterns') && d.patterns && typeof d.patterns.detect === 'function') out.patterns = safe('Patterns', () => d.patterns.detect(bars));
    if (on.includes('flow')) out.flow = flowFromBars(bars);
    return out;
  }

  /* One line under the canvas saying what the overlays found, in the order the tools are switched on. */
  function readLine(p) {
    if (!p || !p.n) return '';
    const bits = [];
    if (p.on.includes('smc')) {
      const s = p.smc;
      if (s && s.structure) {
        const ev = (s.structure.events || []).slice(-1)[0];
        bits.push(ev ? (ev.type === 'CHoCH' ? 'Change of character ' : 'Break of structure ') + (ev.dir > 0 ? 'up' : 'down') + ' at ' + ev.level.toFixed(2) : (s.structure.trend > 0 ? 'structure up' : s.structure.trend < 0 ? 'structure down' : 'no structure yet'));
        const open = (s.fvg || []).filter((g) => g.filledAt == null).length; if (open) bits.push(open + ' open gap' + (open === 1 ? '' : 's'));
        const vw = Array.isArray(s.vwap) && s.vwap.length ? s.vwap[s.vwap.length - 1] : null;
        if (vw && fin(vw.vwap) && fin(s.last)) bits.push((s.last >= vw.vwap ? 'above' : 'below') + ' VWAP ' + vw.vwap.toFixed(2));
      } else bits.push('SMC: more candles needed');
    }
    if (p.on.includes('levels')) {
      const l = p.levels;
      if (l && l.ib && l.ib.current && fin(l.ib.current.hi)) bits.push('IB ' + l.ib.current.lo.toFixed(2) + '–' + l.ib.current.hi.toFixed(2) + (l.ib.current.breakUp != null ? ', broke up' : l.ib.current.breakDown != null ? ', broke down' : ''));
      else if (l && l.profile && fin(l.profile.poc)) bits.push('POC ' + l.profile.poc.toFixed(2));
      else bits.push('Levels: more candles needed');
    }
    if (p.on.includes('patterns')) {
      const c = p.patterns && Array.isArray(p.patterns.charts) ? p.patterns.charts : [];
      bits.push(c.length ? c.length + ' pattern' + (c.length === 1 ? '' : 's') + ': ' + c.slice(0, 2).map((x) => x.name || x.type || x.kind || 'pattern').join(', ') : 'no pattern forming');
    }
    if (p.on.includes('flow') && p.flow) bits.push(p.flow.share == null ? 'flow: ' + p.flow.read : Math.round(p.flow.share * 100) + '% buy volume, ' + p.flow.read);
    return bits.concat(p.notes).join(' · ');
  }

  /* Draws the overlays onto the mini canvas. `geo` is the mini chart's own geometry ({ padL, padR, padT, pw, ph, lo, hi })
     and `visible` the bars it drew; `offset` is how many bars of the full series sit before the first visible one, so an
     engine index maps to a column with i - offset. Returns how many things were drawn, for tests. */
  function draw(ctx, geo, visible, offset, p, colors) {
    if (!ctx || !geo || !visible || !visible.length || !p) return 0;
    const C = Object.assign({ smc: '#9cc8ff', fvgUp: 'rgba(0,208,132,.16)', fvgDown: 'rgba(255,84,112,.16)', vwap: '#ffd166', band: 'rgba(255,209,102,.35)', ib: '#c879ff', node: 'rgba(158,211,230,.5)', fib: 'rgba(255,255,255,.28)', pattern: '#ff9f43', buy: '#00d084', sell: '#ff5470' }, colors || {});
    const n = visible.length, step = geo.pw / n;
    const x = (i) => geo.padL + (i - offset) * step + step / 2;
    const y = (price) => geo.padT + (geo.hi - price) / (geo.hi - geo.lo) * geo.ph;
    const inY = (price) => fin(price) && price >= geo.lo && price <= geo.hi;
    const left = geo.padL, right = geo.padL + geo.pw;
    let drawn = 0;
    const hline = (price, color, dash, label) => {
      if (!inY(price)) return;
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1; if (dash) ctx.setLineDash(dash);
      ctx.beginPath(); ctx.moveTo(left, y(price)); ctx.lineTo(right, y(price)); ctx.stroke(); ctx.restore();
      if (label) { ctx.fillStyle = color; ctx.font = '700 8px ui-monospace,monospace'; ctx.textAlign = 'left'; ctx.fillText(label, left + 2, y(price) - 2); }
      drawn += 1;
    };
    const series = (arr, pick, color, dash) => {
      if (!Array.isArray(arr)) return;
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 1; if (dash) ctx.setLineDash(dash); ctx.beginPath(); let started = false;
      for (let i = offset; i < offset + n && i < arr.length; i++) { const v = pick(arr[i]); if (!fin(v)) continue; const xx = x(i), yy = y(Math.max(geo.lo, Math.min(geo.hi, v))); if (!started) { ctx.moveTo(xx, yy); started = true; } else ctx.lineTo(xx, yy); }
      if (started) { ctx.stroke(); drawn += 1; } ctx.restore();
    };

    if (p.on.includes('smc') && p.smc) {
      const s = p.smc;
      for (const g of s.fvg || []) {
        if (g.filledAt != null || !fin(g.top) || !fin(g.bottom) || g.i < offset) continue;
        const top = Math.min(geo.hi, g.top), bottom = Math.max(geo.lo, g.bottom); if (!(top > bottom)) continue;
        ctx.fillStyle = g.dir > 0 ? C.fvgUp : C.fvgDown; ctx.fillRect(x(g.i) - step / 2, y(top), right - (x(g.i) - step / 2), y(bottom) - y(top)); drawn += 1;
      }
      series(s.vwap, (v) => v && v.vwap, C.vwap, [3, 3]);
      for (const ev of (s.structure && s.structure.events || []).slice(-3)) {
        if (!fin(ev.level) || ev.idx < offset) continue;
        hline(ev.level, C.smc, [2, 3], (ev.type || 'BOS') + (ev.dir > 0 ? ' ↑' : ' ↓'));
      }
      for (const lq of (s.liquidity || []).slice(-4)) if (fin(lq.level) && lq.takenAt == null) hline(lq.level, C.smc, [1, 4], lq.kind === 'equalHighs' || /high/i.test(String(lq.kind)) ? 'liq ▴' : 'liq ▾');
    }
    if (p.on.includes('levels') && p.levels) {
      const l = p.levels;
      series(l.vwap, (v) => v && v.up && v.up[0], C.band, [2, 2]);
      series(l.vwap, (v) => v && v.dn && v.dn[0], C.band, [2, 2]);
      if (l.ib && l.ib.current) { hline(l.ib.current.hi, C.ib, [4, 2], 'IB hi'); hline(l.ib.current.lo, C.ib, [4, 2], 'IB lo'); }
      if (l.profile) { if (fin(l.profile.poc)) hline(l.profile.poc, C.node, null, 'POC'); for (const nd of (l.profile.nodes || []).filter((q) => q.kind === 'hvn').slice(0, 3)) hline(nd.price, C.node, [1, 2], null); }
      if (l.fib && Array.isArray(l.fib.levels)) for (const f of l.fib.levels) { const price = fin(f.price) ? f.price : fin(f.p) ? f.p : null; const ratio = fin(f.ratio) ? f.ratio : fin(f.r) ? f.r : null; if (price != null && ratio != null && ratio > 0 && ratio < 1) hline(price, C.fib, [1, 3], (ratio * 100).toFixed(1).replace(/\.0$/, '') + '%'); }
    }
    if (p.on.includes('patterns') && p.patterns) {
      for (const ch of (p.patterns.charts || []).slice(0, 3)) {
        for (const ln of ch.lines || []) {
          if (!fin(ln.p1) || !fin(ln.p2) || !fin(ln.i1) || !fin(ln.i2) || ln.i2 < offset) continue;
          ctx.save(); ctx.strokeStyle = C.pattern; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(x(Math.max(ln.i1, offset)), y(Math.max(geo.lo, Math.min(geo.hi, ln.p1)))); ctx.lineTo(x(ln.i2), y(Math.max(geo.lo, Math.min(geo.hi, ln.p2)))); ctx.stroke(); ctx.restore(); drawn += 1;
        }
        if (fin(ch.target)) hline(ch.target, C.pattern, [3, 3], 'target');
        const name = ch.name || ch.type || ch.kind; if (name) { ctx.fillStyle = C.pattern; ctx.font = '700 8px ui-monospace,monospace'; ctx.textAlign = 'right'; ctx.fillText(String(name), right - 2, geo.padT + 9); drawn += 1; }
      }
    }
    if (p.on.includes('flow') && p.flow && p.flow.share != null) {
      /* a thin pressure strip along the top edge of the plot: green for the buy share, red for the rest */
      const w = geo.pw, h = 3, top = geo.padT - 6;
      ctx.fillStyle = C.sell; ctx.fillRect(left, top, w, h);
      ctx.fillStyle = C.buy; ctx.fillRect(left, top, w * p.flow.share, h); drawn += 1;
    }
    return drawn;
  }

  return { TOOLS, DEFAULTS, OVERLAYS, byId, normalizeEnabled, flowFromBars, plan, readLine, draw };
});
