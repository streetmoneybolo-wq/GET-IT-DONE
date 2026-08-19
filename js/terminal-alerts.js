/* SML Terminal — NATIVE alert box (Phase 2, replaces the adopted legacy #sml-alert-list).
   Data: /wp-json/sml/v1/ticker-alerts?symbol=  → {alerts|items:[{id, t|time|created|created_at,
   group, group_icon|icon|avatar, source, text|body|message|title|headline, entry, target, pt,
   expires, url|link, image|image_url|thumbnail}]} — the PUBLIC ALERTS channels feed the legacy
   module rendered. Honest states: count unknown while the feed is down (never "0 ACTIVE" on an
   error), empty when the feed says empty. The design card's sample buttons ("Create price alert",
   "Alert history") had no handlers and are not rendered. Sets window.SML_TV2_NATIVE_ALERTS=1. */
(function () {
  'use strict';
  if (window.__smlTerminalAlertsBooted) return;
  window.__smlTerminalAlertsBooted = true;
  if (window.SML_TV2_LIVE !== 1 && !/[?&]tv2=1(&|$)/.test(location.search)) return;
  window.SML_TV2_NATIVE_ALERTS = 1;

  var SYM = ((new URLSearchParams(location.search)).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '') || 'SPY';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function rel(ts) { var t = typeof ts === 'number' ? (ts < 2e10 ? ts * 1000 : ts) : Date.parse(String(ts).replace(' ', 'T')); if (isNaN(t)) return ''; var d = Math.max(0, (Date.now() - t) / 1000); if (d < 60) return 'now'; if (d < 3600) return Math.floor(d / 60) + 'm ago'; if (d < 86400) return Math.floor(d / 3600) + 'h ago'; return Math.floor(d / 86400) + 'd ago'; }
  function f2(n) { return (n == null || n === '' || isNaN(n)) ? null : Number(n).toFixed(2); }

  var CSS = '' +
    '.tv2-al{display:flex;flex-direction:column;gap:8px}' +
    '.tv2-al-item{border:1px solid #1b3a4d;border-radius:10px;background:#0b1119;padding:10px 12px;display:flex;gap:10px}' +
    '.tv2-al-ic{width:30px;height:30px;border-radius:8px;flex:none;background:#131c26 center/cover no-repeat;display:flex;align-items:center;justify-content:center;font:700 11px Archivo,sans-serif;color:#00ccff}' +
    '.tv2-al-bd{flex:1;min-width:0}.tv2-al-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}' +
    '.tv2-al-grp{font:700 11.5px/1 Archivo,sans-serif;color:#e6edf3}.tv2-al-time{font:500 10px/1 "IBM Plex Mono",monospace;color:#5d7085}' +
    '.tv2-al-text{font:400 12px/1.5 Archivo,sans-serif;color:#c9d6e2;margin-top:4px;word-break:break-word}' +
    '.tv2-al-nums{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;font:600 10.5px/1 "IBM Plex Mono",monospace}' +
    '.tv2-al-nums span{color:#8fa3b5}.tv2-al-nums b{color:#00ccff;font-weight:700}.tv2-al-nums b.pt{color:#00ff88}' +
    '.tv2-al-link{font:600 10.5px/1 Archivo,sans-serif;color:#00ccff;margin-top:6px;display:inline-block}' +
    '.tv2-al-empty{padding:14px 12px;font:500 11.5px/1.6 "IBM Plex Mono",monospace;color:#5d7085;text-align:center;border:1px dashed #1b3a4d;border-radius:10px}' +
    '.tv2-al-empty.err{color:#ff859f;border-color:#3d1524}' +
    '.tv2-al-foot{font:400 10px/1.5 Archivo,sans-serif;color:#4c5d6d}';

  var S = { alerts: null, err: null };
  function countEl(card) { /* the design header's "N ACTIVE" pill — find the leaf that ends with ACTIVE */
    var leaves = [].slice.call(card.querySelectorAll('span,div,b,strong')).filter(function (e) { return e.children.length === 0 && /\bACTIVE\b/i.test(e.textContent || ''); });
    return leaves[0] || null;
  }
  function render(card, body) {
    var c = countEl(card);
    if (S.err) { body.innerHTML = '<div class="tv2-al-empty err">' + esc(S.err) + '</div>'; if (c) c.textContent = '— ACTIVE'; return; }
    var list = S.alerts || [];
    if (c) c.textContent = list.length + ' ACTIVE';
    if (!list.length) { body.innerHTML = '<div class="tv2-al-empty">No active alerts for $' + esc(SYM) + '.</div><div class="tv2-al-foot">Alerts from PUBLIC ALERTS channels are tracked for 5 days.</div>'; return; }
    body.innerHTML = '<div class="tv2-al">' + list.map(function (a) {
      var grp = a.group || a.source || 'PUBLIC ALERTS';
      var ic = a.group_icon || a.icon || a.avatar || '';
      var text = a.text || a.body || a.message || a.title || a.headline || '';
      var nums = [];
      if (f2(a.entry)) nums.push('<span>entry <b>' + f2(a.entry) + '</b></span>');
      if (f2(a.target) || f2(a.pt)) nums.push('<span>target <b class="pt">' + (f2(a.target) || f2(a.pt)) + '</b></span>');
      if (a.expires) nums.push('<span>expires ' + esc(rel(a.expires).replace(' ago', '')) + '</span>');
      var link = a.url || a.link || a.video || '';
      return '<div class="tv2-al-item">' + (ic ? '<div class="tv2-al-ic" style="background-image:url(\'' + esc(ic) + '\')"></div>' : '<div class="tv2-al-ic">' + esc(String(grp).slice(0, 2).toUpperCase()) + '</div>') +
        '<div class="tv2-al-bd"><div class="tv2-al-top"><span class="tv2-al-grp">' + esc(grp) + '</span><span class="tv2-al-time">' + esc(rel(a.t || a.time || a.created_at || a.created)) + '</span></div>' +
        (text ? '<div class="tv2-al-text">' + esc(text).replace(/\$([A-Za-z]{1,6})\b/g, function (m, s) { return '<b>$' + s.toUpperCase() + '</b>'; }) + '</div>' : '') +
        (nums.length ? '<div class="tv2-al-nums">' + nums.join('') + '</div>' : '') +
        (link ? '<a class="tv2-al-link" href="' + esc(link) + '" target="_blank" rel="noopener">open alert ↗</a>' : '') + '</div></div>';
    }).join('') + '</div><div class="tv2-al-foot">Alerts from PUBLIC ALERTS channels are tracked for 5 days.</div>';
  }
  function load(card, body) {
    fetch('/wp-json/sml/v1/ticker-alerts?symbol=' + encodeURIComponent(SYM), { credentials: 'same-origin' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        var list = res.ok && res.j ? (res.j.alerts || res.j.items || (Array.isArray(res.j) ? res.j : null)) : null;
        if (!res.ok || !Array.isArray(list)) { S.err = 'The alert feed is temporarily unavailable.'; S.alerts = null; }
        else { S.err = null; S.alerts = list; }
        render(card, body);
      }).catch(function () { S.err = 'The alert feed is not responding right now.'; render(card, body); });
  }
  function mount() {
    var rail = document.querySelector('#sml-tv2-root [data-tv2-zone="rail"]');
    if (!rail || !rail.children.length) return false;
    var card = null;
    Array.prototype.forEach.call(rail.children, function (c) { if (!card && !c.hasAttribute('data-tv2-keep') && !/(^|\s)tv2-/.test(c.className || '') && /alert box/i.test(c.textContent || '')) card = c; });
    if (!card) return false;
    if (card.querySelector('[data-tv2-alerts]')) return true;
    if (!document.getElementById('tv2-al-css')) { var st = document.createElement('style'); st.id = 'tv2-al-css'; st.textContent = CSS; document.head.appendChild(st); }
    var kids = [].slice.call(card.children);
    for (var i = 1; i < kids.length; i++) if (!kids[i].hasAttribute('data-tv2-keep')) kids[i].style.display = 'none';
    var body = document.createElement('div'); body.setAttribute('data-tv2-alerts', '1'); body.setAttribute('data-tv2-keep', '1'); body.style.padding = '12px 16px 16px';
    body.innerHTML = '<div class="tv2-al-empty">Loading alerts…</div>';
    card.appendChild(body);
    load(card, body); setInterval(function () { if (!document.hidden) load(card, body); }, 30000);
    return true;
  }
  var tries = 0;
  var t = setInterval(function () { var ok = false; try { ok = mount(); } catch (e) {} if (ok || ++tries > 60) clearInterval(t); }, 250);
})();
