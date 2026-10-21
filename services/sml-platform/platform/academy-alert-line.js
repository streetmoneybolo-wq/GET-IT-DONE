/* The analyst's live alert on the chart: its price target is a yellow line that can be grabbed and dragged.
     dragged further out than the target      -> PT RAISED (the PT push update)
     dragged in, but still beyond the live price -> PT LOWERED
     dragged through the live price            -> TAKE PROFITS / close the position
   Nothing is previewed. Letting go starts a short window (one minute) with a small confirmation in the corner, away from the chart:
   Send now, or Undo; when the window ends the post goes out through the Click-to-Alert desk (the server decides from the live price,
   posts to the alert's channel as a reply to the newest post on the stock, and records it). Only the trader who posted the alert (or the owner)
   gets the line. Educational: nothing here places a trade. */
(function () {
  /* what a drop at `to` means for an alert whose PT is `pt` on a live price `price` (side from entry vs PT) */
  function classify({ side = 'long', pt, price, to }) {
    pt = Number(pt); price = Number(price); to = Number(to);
    if (!(pt > 0) || !(price > 0) || !(to > 0)) return { kind: 'none' };
    const short = side === 'short';
    if (short ? to >= price : to <= price) return { kind: 'close' };
    if (Math.abs(to - pt) / pt < 0.001) return { kind: 'none' };
    return { kind: (short ? to < pt : to > pt) ? 'raise' : 'lower' };
  }
  const WINDOW_MS = 60_000;
  if (typeof module !== 'undefined' && module.exports) { module.exports = { classify, WINDOW_MS }; }
  if (typeof document === 'undefined') return;

  (function boot(tries) {
    if (window.__smlAlertLine) return;
    if (!document.querySelector('.academy-chart-stage') || !document.getElementById('chart') || !window.smlAlertsDesk) { if (tries < 120) setTimeout(() => boot(tries + 1), 250); return; }
    window.__smlAlertLine = true;
    const canvas = document.getElementById('chart'), stage = document.querySelector('.academy-chart-stage');
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const px = (v) => (Number(v) >= 1 ? Number(v).toFixed(2) : Number(v).toFixed(4));
    const COLOR = '#ffd166';
    const css = document.createElement('style');
    css.textContent = '#al-layer{position:absolute;pointer-events:none;z-index:6;background:transparent;border:0;min-height:0;max-width:none}'
      + '#al-toast{position:fixed;right:12px;bottom:12px;z-index:2147483300;width:min(260px,calc(100vw - 24px));box-sizing:border-box;padding:8px 10px;border-radius:10px;background:rgba(10,16,24,.97);border:1px solid #8a6a1c;color:#e6eef2;font:600 .64rem/1.4 system-ui,sans-serif;box-shadow:0 6px 22px rgba(0,0,0,.45)}'
      + '#al-toast b{color:#ffd166}#al-toast.ok{border-color:#1f8a5f}#al-toast.ok b{color:#7dffc4}#al-toast.err{border-color:#6b2234}#al-toast.err b{color:#ffb3c0}'
      + '#al-toast .bar{height:3px;margin:6px 0 0;border-radius:2px;background:#2a2410;overflow:hidden}#al-toast .bar i{display:block;height:100%;background:#ffd166}'
      + '#al-toast .row{display:flex;gap:6px;margin:6px 0 0}#al-toast button{flex:1;padding:5px 6px;border-radius:7px;border:1px solid #2a4a58;background:#0d1a24;color:#e6eef2;font:800 .6rem ui-monospace,monospace;cursor:pointer}#al-toast button.go{background:#3a2d10;border-color:#8a6a1c;color:#ffd166}';
    document.head.appendChild(css);
    const layer = document.createElement('canvas'); layer.id = 'al-layer'; const ctx = layer.getContext('2d');
    const toast = document.createElement('div'); toast.id = 'al-toast'; toast.style.display = 'none'; toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite'); document.body.appendChild(toast);

    const S = { alert: null, pt: null, drag: null, pending: null, over: {}, note: null };
    const desk = () => window.smlAlertsDesk.state;
    const chartSym = () => { const M = window.smlChartModel && window.smlChartModel(); return M ? M.symbol : ''; };
    /* the alert the line belongs to: the newest open one the member can act on, on the symbol on the chart */
    function pick() {
      const D = desk(), sym = chartSym(); if (!D || !sym || !Array.isArray(D.alerts) || !D.me) return null;
      const mine = D.alerts.filter((a) => a.symbol === sym && a.channelId && a.next && !a.closed && (D.me.owner || (a.authorId && a.authorId === D.me.userId)));
      mine.sort((a, b) => b.at - a.at);
      return mine[0] || null;
    }
    const ptOf = (a) => {
      const ups = Array.isArray(a.ptUpdates) ? a.ptUpdates : [];
      const fromDesk = ups.length && Number(ups[ups.length - 1].target) > 0 ? Number(ups[ups.length - 1].target) : Number(a.target0);
      const o = S.over[a.id];
      if (o) { if (Math.abs(o.price - fromDesk) / fromDesk < 0.001 || Date.now() - o.at > 600_000) delete S.over[a.id]; else return o.price; }
      return fromDesk;
    };
    const sideOf = (a) => (Number(a.target0) < Number(a.entry) ? 'short' : 'long');

    /* the chart's smart range keeps the line on screen */
    (function reg(n) { if (window.smlChartLevels) { window.smlChartLevels.register('alert-line', (s) => (S.alert && S.alert.symbol === s && S.pt > 0 ? [S.pt] : [])); return; } if (n < 60) setTimeout(() => reg(n + 1), 500); })(0);

    const geom = () => {
      const M = window.smlChartModel && window.smlChartModel(); if (!M || !S.alert || M.symbol !== S.alert.symbol) return null;
      const top = M.pad.t, bot = M.pad.t + (M.priceH || M.ph);
      return { M, top, bot, left: M.pad.l, right: M.pad.l + M.pw, yOf: (p) => M.y(p), pOf: (y) => M.hi - (y - M.pad.t) / M.ph * (M.hi - M.lo) };
    };
    const LABEL = { raise: 'RAISE PT', lower: 'LOWER PT', close: 'CLOSE POSITION', none: '' };
    function draw() {
      const w = canvas.clientWidth, h = canvas.clientHeight, dpr = window.smlChartDpr ? window.smlChartDpr() : (window.devicePixelRatio || 1);
      if (canvas.parentElement && layer.parentElement !== canvas.parentElement) canvas.parentElement.appendChild(layer);
      layer.style.left = canvas.offsetLeft + 'px'; layer.style.top = canvas.offsetTop + 'px'; layer.style.width = w + 'px'; layer.style.height = h + 'px';
      if (layer.width !== Math.round(w * dpr) || layer.height !== Math.round(h * dpr)) { layer.width = Math.round(w * dpr); layer.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const g = geom(); if (!g || !(S.pt > 0)) return;
      const line = (p, solid, label, alpha) => {
        const y = g.yOf(p); if (y < g.top || y > g.bot) return;
        ctx.save(); ctx.globalAlpha = alpha; ctx.setLineDash(solid ? [] : [8, 5]); ctx.lineWidth = solid ? 2 : 1.6; ctx.strokeStyle = COLOR; ctx.beginPath(); ctx.moveTo(g.left, y); ctx.lineTo(g.right, y); ctx.stroke(); ctx.restore();
        ctx.font = '800 10px ui-monospace,monospace'; const tw = ctx.measureText(label).width + 12;
        ctx.fillStyle = COLOR; ctx.fillRect(g.right - tw - 4, y - 9, tw, 18); ctx.fillStyle = '#241a02'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(label, g.right - tw + 2, y);
      };
      if (S.drag) {
        line(S.pt, false, 'PT ' + px(S.pt), 0.4);
        const k = S.drag.kind;
        line(S.drag.price, true, (LABEL[k] ? LABEL[k] + ' → ' : '') + px(S.drag.price), 1);
      } else if (S.pending) line(S.pending.price, true, 'PT → ' + px(S.pending.price) + ' pending', 1);
      else line(S.pt, false, 'PT ' + px(S.pt) + ' ⇅', 0.95);
    }
    const refresh = () => {
      const a = pick(); S.alert = a; S.pt = a ? ptOf(a) : null;
      draw();
    };
    window.addEventListener('sml-chart-view', draw); window.addEventListener('resize', draw);
    setInterval(() => { if (!S.drag && !window.smlChartGesture) refresh(); }, 2500);
    refresh();

    /* ---------- grab and drag ---------- */
    const rel = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    const near = (e) => {
      if (!S.alert || !(S.pt > 0) || (e.target && e.target.closest && e.target.closest('button,input,select,textarea,a,.academy-pro-panel,.academy-pro-palette'))) return false;
      const g = geom(); if (!g) return false; const { x, y } = rel(e);
      const yy = g.yOf(S.pending ? S.pending.price : S.pt);
      return x >= g.left && x <= g.right && y >= g.top && y <= g.bot && Math.abs(y - yy) <= 7;
    };
    stage.addEventListener('pointermove', (e) => {
      if (S.drag) {
        const g = geom(); if (!g) return; const { y } = rel(e);
        const yc = Math.min(Math.max(y, g.top + 2), g.bot - 2); const p = g.pOf(yc); if (!(p > 0)) return;
        const price = Math.round(p * (p >= 1 ? 100 : 10000)) / (p >= 1 ? 100 : 10000);
        S.drag.price = price; S.drag.kind = classify({ side: sideOf(S.alert), pt: S.pt, price: S.alert.price, to: price }).kind;
        e.stopImmediatePropagation(); draw(); return;
      }
      stage.style.cursor = near(e) ? 'ns-resize' : '';
    }, true);
    stage.addEventListener('pointerdown', (e) => {
      if (e.button != null && e.button !== 0) return;
      if (!near(e)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      S.drag = { id: S.alert.id, price: S.pending ? S.pending.price : S.pt, kind: 'none', pointerId: e.pointerId };
      try { stage.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      window.smlChartGesture = true;
      draw();
    }, true);
    const finish = (e, cancel) => {
      if (!S.drag) return;
      const d = S.drag; S.drag = null; window.smlChartGesture = false;
      try { stage.releasePointerCapture(d.pointerId); } catch (_) { /* ignore */ }
      if (e) e.stopImmediatePropagation();
      if (cancel || d.kind === 'none') { draw(); return; }
      queue(d);
    };
    stage.addEventListener('pointerup', (e) => finish(e, false), true);
    stage.addEventListener('pointercancel', (e) => finish(e, true), true);
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (S.drag) finish(null, true); else if (S.pending) undo(); } });

    /* ---------- the one-minute window and the post ---------- */
    function queue(d) {
      if (S.pending && S.pending.timer) clearTimeout(S.pending.timer);
      S.pending = { id: d.id, price: d.price, kind: d.kind, symbol: S.alert.symbol, at: Date.now(), timer: setTimeout(() => void send(), WINDOW_MS) };
      showPending(); draw();
    }
    const what = (p) => (p.kind === 'close' ? 'Close ' + esc(p.symbol) + ' (take profits)' : (p.kind === 'raise' ? 'Raise' : 'Lower') + ' ' + esc(p.symbol) + ' PT to $' + px(p.price));
    let tick = 0;
    function showPending() {
      clearInterval(tick);
      const paint = () => {
        const p = S.pending; if (!p) { clearInterval(tick); return; }
        const left = Math.max(0, WINDOW_MS - (Date.now() - p.at));
        toast.className = ''; toast.style.display = 'block';
        toast.innerHTML = '<b>' + what(p) + '</b> posts in ' + Math.ceil(left / 1000) + 's<div class="bar"><i style="width:' + (left / WINDOW_MS * 100).toFixed(1) + '%"></i></div><div class="row"><button type="button" data-al="undo">Undo</button><button type="button" class="go" data-al="now">Send now</button></div>';
      };
      paint(); tick = setInterval(paint, 500);
    }
    function undo() {
      if (!S.pending) return; clearTimeout(S.pending.timer); clearInterval(tick); S.pending = null; toast.style.display = 'none'; draw();
    }
    const note = (cls, html, ms) => { toast.className = cls; toast.style.display = 'block'; toast.innerHTML = html; clearTimeout(S.note); S.note = setTimeout(() => { toast.style.display = 'none'; }, ms); };
    toast.addEventListener('click', (e) => { const b = e.target.closest && e.target.closest('[data-al]'); if (!b) return; if (b.dataset.al === 'undo') undo(); else if (b.dataset.al === 'now') void send(); });
    const WHY = { not_your_alert: 'Only the trader who posted an alert can update it.', channel_unavailable: 'The alert’s channel is not reachable right now.', you_cannot_post_there: 'You cannot post in that channel.', app_cannot_post_there: 'The Academy app cannot post in that channel.', click_alert_subscription_required: 'Click-to-Alert is needed to post updates.', rate_limited: 'Too many alerts too fast. Try again later.', target_unchanged: 'That is the same target.', no_live_price: 'No live price right now.' };
    async function call(body, again) {
      const res = await fetch('/academy-activity/click-alert/desk', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + String(window.smlAcademySessionToken || '') }, body: JSON.stringify(body) });
      if (res.status === 401 && !again && typeof window.smlAcademyReauth === 'function') { await Promise.resolve(window.smlAcademyReauth()).catch(() => ''); return call(body, true); }
      return { status: res.status, j: await res.json().catch(() => ({})) };
    }
    async function send() {
      const p = S.pending; if (!p) return; clearTimeout(p.timer); clearInterval(tick);
      toast.className = ''; toast.innerHTML = '<b>Posting…</b>';
      try {
        const { j } = await call({ alertId: p.id, action: 'move', target: p.price });
        S.pending = null;
        if (j && j.ok) {
          if (j.move !== 'close') S.over[p.id] = { price: p.price, at: Date.now() };
          note('ok', '<b>' + (j.move === 'close' ? 'Position closed' : j.move === 'raise' ? 'PT raised to $' + px(p.price) : 'PT lowered to $' + px(p.price)) + '</b> and posted' + (j.repliedTo ? ' as a reply to your last post' : '') + '.', 7000);
          try { window.smlAlertsDesk.reload(); } catch (_) { /* desk not ready */ }
        } else note('err', '<b>Not posted.</b> ' + esc((j && (j.detail || WHY[j.error])) || 'Try again in a moment.'), 9000);
      } catch (_) { S.pending = null; note('err', '<b>Not posted.</b> The connection dropped. Drag the line again to retry.', 9000); }
      refresh();
    }
    window.smlAlertLine = { state: S, classify, refresh, send, undo };
  })(0);
})();
