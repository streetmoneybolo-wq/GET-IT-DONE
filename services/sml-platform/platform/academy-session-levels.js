/* Session levels for the Academy Live Chart Lab: the intraday reference levels a futures or index desk plans the day around,
   computed from the bars the chart already has. Pure functions over OHLCV bars ({ t, o, h, l, c, v }); works in node
   (module.exports) and inline in the page (window.SmlSessionLevels). ES2019, no dependencies.
     - VWAP with 1st and 2nd standard-deviation bands, reset every New York day (or at the 09:30 open with anchor 'rth')
     - Initial Balance: the first hour's high and low, its extensions, and the first close that broke it
     - session ranges: Asia (20:00 to 04:00), London (04:00 to 09:30), New York (09:30 to 16:00), after hours (16:00 to 20:00),
       each with its high and low and whether New York swept the overnight extremes
     - volume nodes: the session's volume profile with point of control, value area, high-volume nodes and low-volume nodes
     - Fibonacci retracement of the last completed swing, with how far price has retraced so far
     - dealer gamma: a per-bar regime (positive above the flip, negative below) and the wall levels, from numbers the caller
       already has (academy-sentiment / the options chain); this module never fetches anything
   Every number is a reading of the bars. Nothing here predicts and nothing is a signal; the read() lines say what price did. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SmlSessionLevels = api;
})(typeof window !== 'undefined' ? window : this, function () {
  const fin = Number.isFinite;
  const RTH_OPEN = 9 * 60 + 30, RTH_CLOSE = 16 * 60, EVENING = 20 * 60, ASIA_END = 4 * 60;
  const SESSIONS = [
    { key: 'asia', name: 'Asia', from: EVENING, to: ASIA_END, overnight: true },
    { key: 'london', name: 'London', from: ASIA_END, to: RTH_OPEN, overnight: false },
    { key: 'newYork', name: 'New York', from: RTH_OPEN, to: RTH_CLOSE, overnight: false },
    { key: 'afterHours', name: 'After hours', from: RTH_CLOSE, to: EVENING, overnight: false }
  ];
  const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.272, 1.618];

  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: 'numeric' });
  const memo = new Map();
  /* New York calendar day and minutes since midnight for one timestamp, memoised because every function asks for every bar */
  function et(t) {
    let v = memo.get(t); if (v) return v;
    const o = {}; for (const p of fmt.formatToParts(new Date(t))) if (p.type !== 'literal') o[p.type] = p.value;
    v = { day: o.year + '-' + o.month + '-' + o.day, min: Number(o.hour) * 60 + Number(o.minute) };
    memo.set(t, v); if (memo.size > 20000) memo.clear();
    return v;
  }
  function clean(bars) {
    return (bars || []).map((b) => ({ t: +b.t, o: +b.o, h: +b.h, l: +b.l, c: +b.c, v: +b.v || 0 }))
      .filter((b) => fin(b.t) && fin(b.o) && fin(b.h) && fin(b.l) && fin(b.c) && b.h >= b.l);
  }
  /* bar size in minutes: the median gap between consecutive bars */
  function interval(b) {
    if (b.length < 2) return 1;
    const d = []; for (let i = 1; i < b.length && d.length < 200; i++) { const g = (b[i].t - b[i - 1].t) / 60000; if (g > 0) d.push(g); }
    if (!d.length) return 1;
    d.sort((x, y) => x - y); return d[Math.floor(d.length / 2)];
  }
  const px = (p) => !fin(p) ? '-' : Math.abs(p) >= 1000 ? p.toFixed(0) : p.toFixed(2);
  const hhmm = (t) => { const m = et(t).min; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

  function pivots(b, k) {
    const highs = [], lows = [];
    for (let i = k; i < b.length - k; i++) {
      let hi = true, lo = true;
      for (let j = 1; j <= k; j++) {
        if (!(b[i].h > b[i - j].h && b[i].h >= b[i + j].h)) hi = false;
        if (!(b[i].l < b[i - j].l && b[i].l <= b[i + j].l)) lo = false;
      }
      if (hi) highs.push({ i, t: b[i].t, price: b[i].h });
      if (lo) lows.push({ i, t: b[i].t, price: b[i].l });
    }
    return { highs, lows };
  }

  /* VWAP and its standard-deviation bands. anchor 'day' (default) restarts at the first bar of each New York day, which on an
     extended-hours feed is the pre-market; anchor 'rth' restarts at 09:30 and leaves the bars before it null. mults are the band
     widths in standard deviations, [1, 2] by default: out[i] = { vwap, sd, up: [+1sd, +2sd], dn: [-1sd, -2sd] }. */
  function vwapBands(source, opts) {
    opts = opts || {};
    const b = clean(source), mults = (opts.mults || [1, 2]).map(Number).filter((m) => fin(m) && m > 0);
    const rth = opts.anchor === 'rth', out = new Array(b.length);
    let s1 = 0, s2 = 0, vv = 0, day = null, live = !rth;
    for (let i = 0; i < b.length; i++) {
      const e = et(b[i].t);
      if (e.day !== day) { day = e.day; s1 = s2 = vv = 0; live = !rth; }
      if (rth && !live && e.min >= RTH_OPEN && e.min < RTH_CLOSE) { live = true; s1 = s2 = vv = 0; }
      if (!live) { out[i] = null; continue; }
      const tp = (b[i].h + b[i].l + b[i].c) / 3, v = b[i].v > 0 ? b[i].v : 1;
      s1 += tp * v; s2 += tp * tp * v; vv += v;
      const vw = s1 / vv, sd = Math.sqrt(Math.max(0, s2 / vv - vw * vw));
      out[i] = { vwap: vw, sd, up: mults.map((m) => vw + m * sd), dn: mults.map((m) => vw - m * sd) };
    }
    return out;
  }

  /* Initial Balance: the high and low of the first `minutes` (60) of the regular session, per New York day. The range is extended
     once and twice above and below (ext.up1, up2, dn1, dn2, the levels a range-extension day heads for). breakUp / breakDown is the
     index of the first close beyond the balance after it completed, null while it still holds. */
  function initialBalance(source, opts) {
    opts = opts || {};
    const b = clean(source), minutes = opts.minutes > 0 ? opts.minutes : 60, open = fin(opts.open) ? opts.open : RTH_OPEN, end = open + minutes;
    const byDay = new Map(), days = [];
    for (let i = 0; i < b.length; i++) {
      const e = et(b[i].t);
      let d = byDay.get(e.day);
      if (!d) { d = { day: e.day, hi: -Infinity, lo: Infinity, startT: null, endT: null, bars: 0, complete: false, breakUp: null, breakDown: null, lastIdx: i }; byDay.set(e.day, d); days.push(d); }
      d.lastIdx = i;
      if (e.min >= open && e.min < end) {
        if (b[i].h > d.hi) d.hi = b[i].h;
        if (b[i].l < d.lo) d.lo = b[i].l;
        if (d.startT == null) d.startT = b[i].t;
        d.endT = b[i].t; d.bars++;
      } else if (e.min >= end && d.bars) {
        d.complete = true;
        if (d.breakUp == null && b[i].c > d.hi) d.breakUp = i;
        if (d.breakDown == null && b[i].c < d.lo) d.breakDown = i;
      }
    }
    for (let k = 0; k < days.length; k++) {
      const d = days[k];
      if (!d.bars) { d.hi = d.lo = null; d.range = d.mid = null; d.ext = null; continue; }
      if (k < days.length - 1) d.complete = true; // the day is over, whatever time its last bar had
      d.range = d.hi - d.lo; d.mid = (d.hi + d.lo) / 2;
      d.ext = { up1: d.hi + d.range, up2: d.hi + 2 * d.range, dn1: d.lo - d.range, dn2: d.lo - 2 * d.range };
    }
    const have = days.filter((d) => d.bars);
    return { days: have, current: have.length ? have[have.length - 1] : null };
  }

  /* Which session a New York minute belongs to, and the trading day that session counts towards: the Asia session that
     starts at 20:00 belongs to the next day's trade. */
  function sessionAt(e) {
    for (const s of SESSIONS) {
      if (s.overnight ? (e.min >= s.from || e.min < s.to) : (e.min >= s.from && e.min < s.to)) return s;
    }
    return null;
  }
  function nextDay(day) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

  /* Session ranges: one entry per session per trading day, oldest first. active marks the session the last bar belongs to.
     The New York entry lists the overnight extremes it took out (sweeps: [{ session, side, i }]), which is where the stops
     above the Asia high and below the London low were run. Sessions with no bars on this feed are simply absent. */
  function sessionRanges(source, opts) {
    opts = opts || {};
    const b = clean(source), keys = opts.sessions ? new Set(opts.sessions) : null, byKey = new Map(), out = [];
    for (let i = 0; i < b.length; i++) {
      const e = et(b[i].t), s = sessionAt(e); if (!s || (keys && !keys.has(s.key))) continue;
      const day = s.overnight && e.min >= s.from ? nextDay(e.day) : e.day, id = day + ':' + s.key;
      let r = byKey.get(id);
      if (!r) { r = { key: s.key, name: s.name, day, startT: b[i].t, endT: b[i].t, startIdx: i, endIdx: i, hi: b[i].h, lo: b[i].l, open: b[i].o, close: b[i].c, bars: 0, active: false, sweeps: [] }; byKey.set(id, r); out.push(r); }
      if (b[i].h > r.hi) r.hi = b[i].h;
      if (b[i].l < r.lo) r.lo = b[i].l;
      r.endT = b[i].t; r.endIdx = i; r.close = b[i].c; r.bars++;
    }
    out.sort((x, y) => x.startT - y.startT);
    for (const r of out) { r.range = r.hi - r.lo; r.mid = (r.hi + r.lo) / 2; }
    if (out.length) out[out.length - 1].active = true;
    for (const ny of out) {
      if (ny.key !== 'newYork') continue;
      for (const r of out) {
        if (r.day !== ny.day || (r.key !== 'asia' && r.key !== 'london')) continue;
        for (let i = ny.startIdx; i <= ny.endIdx; i++) {
          if (b[i].h > r.hi) { ny.sweeps.push({ session: r.key, side: 'high', i, t: b[i].t, price: r.hi }); break; }
        }
        for (let i = ny.startIdx; i <= ny.endIdx; i++) {
          if (b[i].l < r.lo) { ny.sweeps.push({ session: r.key, side: 'low', i, t: b[i].t, price: r.lo }); break; }
        }
      }
      ny.sweeps.sort((x, y) => x.i - y.i);
    }
    return out;
  }

  /* Volume profile of the bars given (the caller picks the session: usually the current New York day) with the nodes read off it.
     Volume is spread evenly over the prices each bar covered. High-volume nodes are the peaks of the smoothed histogram holding
     at least 1.5x the average bin; low-volume nodes are the troughs holding at most half of it: the air pockets price runs through. */
  function volumeNodes(source, opts) {
    opts = opts || {};
    const b = clean(source), bins = opts.bins > 4 ? Math.round(opts.bins) : 40;
    if (!b.length) return null;
    let lo = Infinity, hi = -Infinity; for (const x of b) { if (x.l < lo) lo = x.l; if (x.h > hi) hi = x.h; }
    if (!(hi > lo)) return null;
    const step = (hi - lo) / bins, vol = new Array(bins).fill(0);
    for (const x of b) {
      const a = Math.max(0, Math.floor((x.l - lo) / step)), z = Math.min(bins - 1, Math.floor((x.h - lo) / step)), n = z - a + 1, v = (x.v || 0) / n;
      for (let i = a; i <= z; i++) vol[i] += v;
    }
    const total = vol.reduce((p, q) => p + q, 0); if (!(total > 0)) return null;
    let poc = 0; for (let i = 1; i < bins; i++) if (vol[i] > vol[poc]) poc = i;
    let a = poc, z = poc, acc = vol[poc];
    while (acc / total < 0.7 && (a > 0 || z < bins - 1)) {
      const up = z < bins - 1 ? vol[z + 1] : -1, dn = a > 0 ? vol[a - 1] : -1;
      if (up >= dn) { z++; acc += vol[z]; } else { a--; acc += vol[a]; }
    }
    const smooth = vol.map((v, i) => (v + (vol[i - 1] || 0) + (vol[i + 1] || 0)) / (1 + (i > 0 ? 1 : 0) + (i < bins - 1 ? 1 : 0)));
    const mean = total / bins, nodes = [];
    for (let i = 0; i < bins; i++) {
      const l = i > 0 ? smooth[i - 1] : -1, r = i < bins - 1 ? smooth[i + 1] : -1, s = smooth[i];
      if (s >= l && s >= r && s >= 1.5 * mean && (s > l || s > r)) nodes.push({ kind: 'hvn', bin: i, price: lo + (i + 0.5) * step, lo: lo + i * step, hi: lo + (i + 1) * step, vol: vol[i], share: vol[i] / total });
      else if (i > 0 && i < bins - 1 && s <= l && s <= r && s <= 0.5 * mean && (s < l || s < r)) nodes.push({ kind: 'lvn', bin: i, price: lo + (i + 0.5) * step, lo: lo + i * step, hi: lo + (i + 1) * step, vol: vol[i], share: vol[i] / total });
    }
    return { lo, hi, step, bins: vol.map((v, i) => ({ price: lo + (i + 0.5) * step, lo: lo + i * step, hi: lo + (i + 1) * step, vol: v, share: v / total })), max: vol[poc], total,
      poc: lo + (poc + 0.5) * step, vah: lo + (z + 1) * step, val: lo + a * step, nodes };
  }

  /* Fibonacci retracement of the last completed swing: the most recent pivot high and pivot low, the later one being where the
     swing ended. An up swing (low then high) is measured down from the high, a down swing up from the low; 1.272 and 1.618 extend
     past the start of the swing. pos is how much of the swing price has given back so far (0 at the end of the swing, 1 at its start). */
  function fibRetracement(source, opts) {
    opts = opts || {};
    const b = clean(source), k = opts.k > 0 ? opts.k : 3; if (b.length < 2 * k + 2) return null;
    const piv = pivots(b, k), hi = piv.highs.length ? piv.highs[piv.highs.length - 1] : null, lo = piv.lows.length ? piv.lows[piv.lows.length - 1] : null;
    if (!hi || !lo || hi.i === lo.i || !(hi.price > lo.price)) return null;
    const up = hi.i > lo.i, start = up ? lo : hi, end = up ? hi : lo, range = hi.price - lo.price, last = b[b.length - 1].c;
    const levels = FIB_RATIOS.map((ratio) => ({ ratio, price: up ? hi.price - range * ratio : lo.price + range * ratio }));
    const pos = up ? (hi.price - last) / range : (last - lo.price) / range;
    return { dir: up ? 'up' : 'down', start, end, range, levels, pos };
  }

  /* Dealer gamma, from numbers the caller already has. regime(bars) colours each bar: 'positive' when it closed above the flip
     (dealers hedge against the move, so it drifts), 'negative' below it (dealers hedge with the move, so it runs), 'neutral'
     inside `band` (0.15%) of the flip, or when there is no flip, the regime string given. levels() lists the lines to draw. */
  function gammaRegime(source, g) {
    g = g || {};
    const b = clean(source), flip = Number(g.flip), band = fin(g.band) ? g.band : 0.0015, fallback = g.regime === 'positive' || g.regime === 'negative' ? g.regime : 'neutral';
    return b.map((x) => {
      if (!fin(flip) || flip <= 0) return fallback;
      const d = (x.c - flip) / flip;
      return d > band ? 'positive' : d < -band ? 'negative' : 'neutral';
    });
  }
  function gammaLevels(g) {
    g = g || {}; const out = [];
    if (fin(Number(g.callWall)) && g.callWall > 0) out.push({ key: 'callWall', label: 'CALL WALL', price: Number(g.callWall) });
    if (fin(Number(g.flip)) && g.flip > 0) out.push({ key: 'flip', label: 'GAMMA FLIP', price: Number(g.flip) });
    if (fin(Number(g.putWall)) && g.putWall > 0) out.push({ key: 'putWall', label: 'PUT WALL', price: Number(g.putWall) });
    return out;
  }

  /* Everything at once for the chart and the read. opts.gamma = { callWall, putWall, flip, regime } when the page has it;
     opts.anchor is passed to vwapBands; the volume profile is of the latest New York day (or of every bar when there is none). */
  function analyze(source, opts) {
    opts = opts || {};
    const b = clean(source); if (b.length < 5) return null;
    const n = b.length, last = b[n - 1], step = interval(b);
    const vwap = vwapBands(b, { anchor: opts.anchor, mults: opts.mults });
    const ib = initialBalance(b, { minutes: opts.ibMinutes });
    const sessions = sessionRanges(b);
    const ny = sessions.filter((s) => s.key === 'newYork'), today = ny.length ? ny[ny.length - 1] : null;
    const profile = volumeNodes(today ? b.slice(today.startIdx, today.endIdx + 1) : b, { bins: opts.bins });
    const fib = fibRetracement(b, { k: opts.k });
    const gamma = opts.gamma ? { levels: gammaLevels(opts.gamma), regime: gammaRegime(b, opts.gamma), flip: Number(opts.gamma.flip) || null } : null;
    return { n, last: last.c, t: last.t, interval: step, vwap, ib, sessions, profile, fib, gamma };
  }

  /* Plain-English lines for the panel, each with a tone for its colour: what price did against each level, never what it will do. */
  function read(a) {
    if (!a) return [];
    const out = [], px0 = a.last;
    const vw = a.vwap[a.vwap.length - 1];
    if (vw) {
      const above = px0 >= vw.vwap, u1 = vw.up[0], u2 = vw.up[1], d1 = vw.dn[0], d2 = vw.dn[1];
      let where = above ? 'above VWAP' : 'below VWAP';
      if (fin(u2) && px0 > u2) where = 'above the 2nd upper band'; else if (fin(u1) && px0 > u1) where = 'between the 1st and 2nd upper bands';
      else if (fin(d2) && px0 < d2) where = 'below the 2nd lower band'; else if (fin(d1) && px0 < d1) where = 'between the 1st and 2nd lower bands';
      out.push({ tone: above ? 'up' : 'down', text: 'Price is ' + where + ', ' + px(Math.abs(px0 - vw.vwap)) + ' from VWAP at ' + px(vw.vwap) + (fin(d1) ? ' (bands ' + px(d1) + ' / ' + px(u1) + ')' : '') + '.' });
    }
    const ib = a.ib && a.ib.current;
    if (ib && ib.bars) {
      if (!ib.complete) out.push({ tone: 'warn', text: 'Initial Balance still forming: ' + px(ib.lo) + ' to ' + px(ib.hi) + ' so far.' });
      else if (ib.breakUp != null && (ib.breakDown == null || ib.breakUp < ib.breakDown)) out.push({ tone: 'up', text: 'Initial Balance ' + px(ib.lo) + ' to ' + px(ib.hi) + ' broke to the upside; the extensions sit at ' + px(ib.ext.up1) + ' and ' + px(ib.ext.up2) + '.' });
      else if (ib.breakDown != null) out.push({ tone: 'down', text: 'Initial Balance ' + px(ib.lo) + ' to ' + px(ib.hi) + ' broke to the downside; the extensions sit at ' + px(ib.ext.dn1) + ' and ' + px(ib.ext.dn2) + '.' });
      else out.push({ tone: 'neutral', text: 'Price is still inside the Initial Balance, ' + px(ib.lo) + ' to ' + px(ib.hi) + ' (' + px(ib.range) + ' wide).' });
    }
    const day = a.sessions.length ? a.sessions[a.sessions.length - 1].day : null;
    const todays = a.sessions.filter((s) => s.day === day);
    for (const s of todays) {
      if (s.key === 'afterHours') continue;
      const swept = s.key === 'newYork' && s.sweeps.length ? ' New York swept the ' + s.sweeps.map((w) => (w.session === 'asia' ? 'Asia' : 'London') + ' ' + w.side).join(' and ') + '.' : '';
      out.push({ tone: s.close >= s.open ? 'up' : 'down', text: s.name + (s.active ? ' (live)' : '') + ': ' + px(s.lo) + ' to ' + px(s.hi) + ', ' + px(s.range) + ' wide.' + swept });
    }
    if (!todays.some((s) => s.key === 'asia' || s.key === 'london')) out.push({ tone: 'neutral', text: 'No overnight bars on this feed, so the Asia and London ranges are not shown.' });
    const p = a.profile;
    if (p) {
      const hvn = p.nodes.filter((x) => x.kind === 'hvn').map((x) => px(x.price)), lvn = p.nodes.filter((x) => x.kind === 'lvn').map((x) => px(x.price));
      out.push({ tone: px0 >= p.poc ? 'up' : 'down', text: 'Point of control ' + px(p.poc) + ', value area ' + px(p.val) + ' to ' + px(p.vah) + '.' + (hvn.length ? ' High-volume nodes at ' + hvn.join(', ') + '.' : '') + (lvn.length ? ' Air pockets at ' + lvn.join(', ') + '.' : '') });
    }
    const f = a.fib;
    if (f) {
      const next = f.levels.filter((l) => l.ratio > 0 && l.ratio <= 1 && l.ratio > f.pos)[0];
      out.push({ tone: f.dir === 'up' ? 'up' : 'down', text: 'Last swing ' + f.dir + ' from ' + px(f.start.price) + ' (' + hhmm(f.start.t) + ') to ' + px(f.end.price) + ' (' + hhmm(f.end.t) + '); ' + (f.pos <= 0 ? 'no retracement yet' : f.pos >= 1 ? 'fully retraced' : (f.pos * 100).toFixed(0) + '% retraced') + (next ? ', the ' + (next.ratio * 100).toFixed(1) + '% level is ' + px(next.price) : '') + '.' });
    }
    const g = a.gamma;
    if (g && g.levels.length) {
      const reg = g.regime[g.regime.length - 1], cw = g.levels.find((l) => l.key === 'callWall'), pw = g.levels.find((l) => l.key === 'putWall');
      out.push({ tone: reg === 'positive' ? 'up' : reg === 'negative' ? 'down' : 'neutral', text: 'Dealer gamma ' + reg + (g.flip ? ' (flip ' + px(g.flip) + ')' : '') + (cw ? ', call wall ' + px(cw.price) : '') + (pw ? ', put wall ' + px(pw.price) : '') + '. ' + (reg === 'negative' ? 'Dealers hedge with the move, so moves stay fast.' : reg === 'positive' ? 'Dealers hedge against the move, so moves drift.' : 'Price is at the flip; the regime can change either way.') });
    }
    return out;
  }

  return { analyze, read, vwapBands, initialBalance, sessionRanges, volumeNodes, fibRetracement, gammaRegime, gammaLevels, pivots, et, interval, SESSIONS, FIB_RATIOS, RTH_OPEN, RTH_CLOSE };
});
