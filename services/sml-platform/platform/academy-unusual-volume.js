/* Academy: Unusual volume across the whole US market — today's volume (pre-market included) as a multiple of
 * yesterday's whole day, for ~6,500 liquid stocks. Click a row to put that stock on the chart. Educational only. */
(() => {
  if (window.__smlAcademyUvol) return;
  window.__smlAcademyUvol = 1;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = document.createElement('style');
  css.textContent = '.auv{border:1px solid #1b3540;border-radius:10px;background:#0a1118;color:#dbe7ec;font:500 12px/1.45 system-ui,sans-serif;margin:10px 0;overflow:hidden}'
    + '.auv-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:9px 40px 9px 12px;border-bottom:1px solid #1b3540}.auv-head b{font:900 12px ui-monospace,monospace;letter-spacing:.06em;color:#eaf5f8}.auv-head small{margin-left:auto;color:#7b93a0;font:700 10px ui-monospace,monospace}'
    + '.auv-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px;padding:10px 12px}'
    + '.auv-row{display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:baseline;padding:7px 9px;border:1px solid #13262f;border-radius:8px;background:#0c161d;cursor:pointer;text-align:left;color:inherit;font:inherit}.auv-row:hover,.auv-row:focus-visible{border-color:#00c47d;outline:none}'
    + '.auv-row strong{font:900 13px ui-monospace,monospace;color:#eaf5f8}.auv-row em{font-style:normal;font:900 14px ui-monospace,monospace;color:#ffd166}.auv-row small{color:#8fa6b3;font-size:10.5px}.auv-row .up{color:#00c47d}.auv-row .dn{color:#ff5d6c}'
    + '.auv-foot{padding:7px 12px;border-top:1px solid #13262f;color:#5f7784;font-size:10.5px}.auv-empty{padding:16px 12px;color:#8fa6b3;text-align:center}';
  document.head.appendChild(css);
  const compact = (v) => (Number.isFinite(v) ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : '–');
  const ago = (t) => { const s = Math.max(0, (Date.now() - t) / 1000); return s < 60 ? 'just now' : Math.round(s / 60) + 'm ago'; };
  const SESSION = { pre: 'PRE-MARKET', open: 'MARKET OPEN', after: 'AFTER HOURS', closed: 'MARKET CLOSED' };
  let root = null, body = null, data = null, message = 'Loading…', timer = 0;

  function paint() {
    if (!body) return;
    const head = '<div class="auv-head"><b>UNUSUAL VOLUME</b><span style="color:#8fa6b3">whole US market · today vs yesterday</span><small>' + (data ? (SESSION[data.session] || '') + ' · ' + ago(data.asOf) : '') + '</small></div>';
    if (!data || !data.rows.length) { body.innerHTML = head + '<div class="auv-empty">' + esc(data ? 'Nothing unusual yet today.' : message) + '</div>'; return; }
    body.innerHTML = head + '<div class="auv-list">' + data.rows.map((u) => {
      const x = u.ratio >= 10 ? Math.round(u.ratio) + '×' : u.ratio.toFixed(1) + '×';
      return '<button type="button" class="auv-row" data-sym="' + esc(u.sym) + '" title="Put ' + esc(u.sym) + ' on the chart"><strong>' + esc(u.sym) + '</strong><em>' + x + '</em>'
        + '<small>' + compact(u.vol) + ' shares today</small><small class="' + (u.chg >= 0 ? 'up' : 'dn') + '">' + (u.chg > 0 ? '+' : '') + esc(u.chg) + '%</small></button>';
    }).join('') + '</div><div class="auv-foot">' + (data.universe ? data.universe.toLocaleString('en-US') + ' stocks scanned. ' : '') + 'A multiple of yesterday’s whole-day volume, pre-market included; usually a sign of news. Educational only.</div>';
  }
  async function load() {
    clearTimeout(timer);
    if (document.hidden) { timer = setTimeout(load, 5000); return; }
    let token = window.smlAcademySessionToken;
    if (!token) { message = 'Sign in to the Academy to see unusual volume.'; paint(); timer = setTimeout(load, 5000); return; }
    try {
      let res = await fetch('/academy-activity/unusual-volume', { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' });
      if (res.status === 401 && typeof window.smlAcademyReauth === 'function') { token = await window.smlAcademyReauth(); if (token) res = await fetch('/academy-activity/unusual-volume', { headers: { authorization: 'Bearer ' + token }, cache: 'no-store' }); }
      const j = await res.json();
      if (j && j.ok) data = j; else message = 'Unusual volume is not available right now.';
    } catch (_) { message = 'Unusual volume is not available right now.'; }
    paint();
    timer = setTimeout(load, 60000);
  }
  (function mount() {
    const host = document.getElementById('academy-below');
    if (!host) { setTimeout(mount, 300); return; }
    root = document.createElement('section');
    root.className = 'auv'; root.id = 'academy-unusual-volume'; root.setAttribute('aria-label', 'Unusual volume');
    body = document.createElement('div'); root.appendChild(body); // the panel draws inside; the pop-out button stays on the outside
    const after = document.getElementById('academy-direction');
    if (after) after.after(root); else { const title = host.querySelector('.below-title'); host.insertBefore(root, title ? title.nextSibling : host.firstChild); }
    root.addEventListener('click', (e) => { const b = e.target.closest('[data-sym]'); if (b && typeof window.smlAcademyNavigateMarket === 'function') window.smlAcademyNavigateMarket(b.getAttribute('data-sym')); });
    paint(); load();
    setInterval(() => { if (data && !document.hidden) { const s = root.querySelector('.auv-head small'); if (s) s.textContent = (SESSION[data.session] || '') + ' · ' + ago(data.asOf); } }, 15000);
  })();
  window.addEventListener('sml-academy-session', () => load());
})();
