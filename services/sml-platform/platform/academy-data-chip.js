/* Data-status chip: one small badge in the Academy toolbar that says whether the market data behind the screen can be trusted right now.
 *   green  = every provider answering   amber = a provider is slow, rate limited or reconnecting   red = a provider is down
 * Hover/tap shows the market session (ET), each provider's state, and what the chart on screen is made of (source, adjusted, live or lagging).
 * It never says "real-time" or "delayed": the feed class is not something this page can know. Educational display only. */
(() => {
  if (window.__smlDataChip) return;
  window.__smlDataChip = true;
  const toolbar = document.querySelector('.toolbar');
  if (!toolbar) return;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const style = document.createElement('style');
  style.textContent = '.data-chip{position:relative;margin-left:6px;display:inline-flex;align-items:center;gap:5px;padding:4px 8px;border:1px solid #284357;border-radius:7px;background:#08121b;color:#cfe4ef;font:800 .6rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}'
    + '.data-chip i{width:8px;height:8px;border-radius:50%;background:#7a8a96;display:inline-block}.data-chip.ok i{background:#37e08f}.data-chip.warn i{background:#ffc247}.data-chip.bad i{background:#ff5d6c}'
    + '.data-chip-pop{display:none;position:absolute;top:calc(100% + 6px);right:0;z-index:60;min-width:250px;max-width:320px;padding:10px 12px;border:1px solid #284357;border-radius:10px;background:#07101a;box-shadow:0 12px 40px #000c;font:600 .62rem system-ui,sans-serif;color:#c7d5dc;text-align:left;letter-spacing:0;white-space:normal}'
    + '.data-chip.open .data-chip-pop{display:block}.data-chip-pop h4{margin:0 0 6px;font:800 .58rem ui-monospace;letter-spacing:.08em;color:#8fd8ff}'
    + '.data-chip-pop .row{display:flex;justify-content:space-between;gap:10px;margin:2px 0}.data-chip-pop .row span:last-child{font-weight:800}'
    + '.data-chip-pop .ok{color:#5df0b0}.data-chip-pop .warn{color:#ffd166}.data-chip-pop .bad{color:#ff8a95}.data-chip-pop small{display:block;margin-top:6px;color:#6f8794;font-weight:500;line-height:1.35}';
  document.head.appendChild(style);
  const chip = document.createElement('button');
  chip.type = 'button'; chip.className = 'data-chip'; chip.setAttribute('aria-label', 'Market data status');
  chip.innerHTML = '<i></i><span class="lbl">DATA</span><div class="data-chip-pop" role="status"></div>';
  toolbar.appendChild(chip);
  const place = () => {
    const pop = chip.querySelector('.data-chip-pop'); pop.style.left = ''; pop.style.right = '';
    const r = chip.getBoundingClientRect(), w = Math.min(320, window.innerWidth - 16);
    pop.style.width = w + 'px';
    if (r.right - w < 8) { pop.style.left = '0'; pop.style.right = 'auto'; if (r.left + w > window.innerWidth - 8) pop.style.left = (-(r.left - 8)) + 'px'; } else { pop.style.right = '0'; pop.style.left = 'auto'; }
  };
  chip.addEventListener('click', (e) => { if (e.target.closest('.data-chip-pop')) return; chip.classList.toggle('open'); if (chip.classList.contains('open')) place(); });
  document.addEventListener('click', (e) => { if (!chip.contains(e.target)) chip.classList.remove('open'); });

  const S = { status: null, chart: null, failed: false };
  const NAMES = { 'massive-rest': 'Massive candles', 'massive-options': 'Massive options', 'massive-indices': 'Massive indices (VIX)', websocket: 'Live stream', 'wordpress-history': 'Site history', 'wordpress-scanner': 'Scanner', 'wordpress-depth': 'Level 2 depth', 'wordpress-orderflow': 'Order flow', 'wordpress-hub': 'Site data', 'moomoo-bridge': 'Options bridge' };
  const cls = (st) => (st === 'down' ? 'bad' : (st === 'degraded' || st === 'rate_limited') ? 'warn' : st === 'ok' ? 'ok' : '');
  const WORD = { ok: 'OK', degraded: 'SLOW', rate_limited: 'LIMITED', down: 'DOWN', unknown: 'idle', unconfigured: 'off' };
  const SESSION = { regular: 'MARKET OPEN', pre: 'PRE-MARKET', post: 'AFTER HOURS', closed: 'MARKET CLOSED' };

  function paint() {
    const s = S.status;
    const pop = chip.querySelector('.data-chip-pop'), lbl = chip.querySelector('.lbl');
    chip.classList.remove('ok', 'warn', 'bad');
    if (!s) { lbl.textContent = S.failed ? 'DATA ?' : 'DATA'; pop.innerHTML = '<h4>MARKET DATA</h4><small>' + (S.failed ? 'Status could not be loaded.' : 'Checking...') + '</small>'; return; }
    const c = cls(s.overall) || 'ok'; chip.classList.add(c);
    lbl.textContent = s.overall === 'down' ? 'DATA DOWN' : (s.overall === 'degraded' || s.overall === 'rate_limited') ? 'DATA SLOW' : 'DATA OK';
    let h = '<h4>MARKET DATA</h4><div class="row"><span>Session (ET ' + esc(s.et || '') + ')</span><span>' + esc(SESSION[s.session] || s.session || '') + '</span></div>';
    Object.keys(s.providers || {}).sort().forEach((k) => {
      const p = s.providers[k];
      if (p.state === 'unknown') return;
      h += '<div class="row"><span>' + esc(NAMES[k] || k) + (p.detail ? ' (' + esc(p.detail) + ')' : '') + '</span><span class="' + cls(p.state) + '">' + esc(WORD[p.state] || p.state) + (p.retryInMs ? ' ' + Math.ceil(p.retryInMs / 1000) + 's' : '') + '</span></div>';
    });
    const ch = S.chart;
    if (ch) {
      const bits = [ch.source || 'unknown source'];
      bits.push(ch.adjusted === true ? 'split/dividend adjusted' : ch.adjusted === false ? 'unadjusted' : 'adjustment unknown');
      if (ch.stale) bits.push('STALE copy');
      if (ch.liveness === 'live') bits.push('live'); else if (ch.liveness === 'lagging') bits.push('last bar is behind'); else if (ch.liveness === 'closed') bits.push('market closed');
      if (ch.repairedBars) bits.push(ch.repairedBars + ' bad bar' + (ch.repairedBars === 1 ? '' : 's') + ' repaired');
      h += '<small><b>Chart on screen:</b> ' + esc(bits.join(' \u00b7 ')) + '</small>';
    }
    h += '<small>Prices come from licensed vendors and can differ from your broker. This panel reports what the system can verify; it does not state whether a feed is real-time or delayed.</small>';
    pop.innerHTML = h;
  }

  async function poll() {
    if (document.hidden) return;
    try { const r = await fetch('/academy-activity/data-status', { cache: 'no-store' }); const j = await r.json(); if (j && j.ok) { S.status = j; S.failed = false; } else S.failed = true; }
    catch (_) { S.failed = true; }
    paint();
  }

  const base = window.fetch;
  window.fetch = function (input, init) {
    const p = base.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.indexOf('/academy-activity/market') === 0 || url.indexOf('/market-data/candles') === 0) {
        p.then((res) => { if (!res || !res.ok) return; res.clone().json().then((j) => { if (j && Array.isArray(j.bars)) { S.chart = { source: j.source, adjusted: j.adjusted, stale: !!j.stale, liveness: j.liveness, repairedBars: j.repairedBars || 0 }; paint(); } }).catch(() => {}); }).catch(() => {});
      }
    } catch (_) { /* never let the chip break a request */ }
    return p;
  };

  paint(); void poll();
  setInterval(poll, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void poll(); });
})();
