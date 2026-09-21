/* SML Terminal — NATIVE alert box (Phase 3, rich ALERT BOX design).
   Data: /wp-json/sml/v1/ticker-alerts?symbol=  → {alerts:[{id, t, alertAt,
   group, icon, raw, entry, target, expires, direction, status, outcome,
   peakGainPct, peakPrice, peakAt, timeToPeakSeconds,
   author:{name,handle,avatar,role}, marketData:{quality}}]}
   Renders the full performance card: avatar+name, entry→now, peak gain,
   max drawdown, alert date, peak price, time to peak, direction badge,
   expiry countdown. Sets window.SML_TV2_NATIVE_ALERTS=1. */
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
  function fmtDate(iso) { if (!iso) return '—'; var d = new Date(iso); if (isNaN(d)) return String(iso); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }); }
  function fmtDuration(sec) { if (sec == null || isNaN(sec)) return '—'; sec = Math.max(0, Number(sec)); var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60); if (h >= 24) { var days = Math.floor(h / 24); h = h % 24; return days + 'd ' + h + 'h' + (m ? ' ' + m + 'm' : ''); } return h + 'h ' + m + 'm'; }
  function until(ts) { if (!ts) return ''; var sec = Math.max(0, (ts * 1000 - Date.now()) / 1000); if (sec <= 0) return 'expired'; var d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600); return d + 'd ' + h + 'h'; }
  function pct(n) { return (n == null || isNaN(n)) ? null : (n >= 0 ? '+' : '') + Number(n).toFixed(2) + '%'; }

  var CSS = '' +
    '.tv2-al{display:flex;flex-direction:column;gap:12px}' +
    '.tv2-al-card{border:1px solid #0e4d6e;border-radius:12px;background:linear-gradient(170deg,#0b1722 0%,#080c12 100%);overflow:hidden;box-shadow:0 0 18px rgba(0,180,255,.06)}' +
    '.tv2-al-card-head{display:flex;align-items:center;gap:10px;padding:12px 14px 10px}' +
    '.tv2-al-avatar{width:38px;height:38px;border-radius:10px;flex:none;background:#131c26 center/cover no-repeat;display:flex;align-items:center;justify-content:center;font:700 13px Archivo,sans-serif;color:#00ccff}' +
    '.tv2-al-identity{flex:1;min-width:0}.tv2-al-name{font:700 13px/1.2 Archivo,sans-serif;color:#e6edf3;display:flex;align-items:center;gap:6px}' +
    '.tv2-al-dot{width:6px;height:6px;border-radius:50%;background:#00ff88;flex:none}' +
    '.tv2-al-role{font:500 9px/1 Archivo,sans-serif;color:#5d7085;border:1px solid #1d2b39;border-radius:4px;padding:2px 5px;margin-left:4px}' +
    '.tv2-al-time{font:500 10px/1 "IBM Plex Mono",monospace;color:#5d7085}' +
    '.tv2-al-msg{font:400 12px/1.5 Archivo,sans-serif;color:#c9d6e2;padding:0 14px;word-break:break-word}' +
    '.tv2-al-msg b{color:#00ccff}' +
    '.tv2-al-prices{display:flex;align-items:baseline;gap:8px;padding:8px 14px;font:600 12px/1 "IBM Plex Mono",monospace;flex-wrap:wrap}' +
    '.tv2-al-prices .lbl{color:#5d7085;font-weight:500;font-size:10px}.tv2-al-prices .val{color:#e6edf3}' +
    '.tv2-al-prices .arr{color:#3a4d5e}.tv2-al-prices .chg{font-size:11px}.tv2-al-prices .up{color:#00ff88}.tv2-al-prices .dn{color:#ff4d6a}' +
    '.tv2-al-prices .pt{color:#00ff88}' +
    '.tv2-al-scores{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:8px 14px}' +
    '.tv2-al-score{border:1px solid #1d2b39;border-radius:8px;background:#0b1119;padding:10px 12px;text-align:center}' +
    '.tv2-al-score .v{font:700 22px/1 "IBM Plex Mono",monospace;letter-spacing:-.5px}.tv2-al-score .v.gain{color:#00ff88}.tv2-al-score .v.loss{color:#ff4d6a}' +
    '.tv2-al-score .k{font:500 9px/1 Archivo,sans-serif;color:#8fa3b5;margin-top:6px;text-transform:uppercase;letter-spacing:.5px}' +
    '.tv2-al-details{display:grid;grid-template-columns:1fr 1fr;gap:0;padding:4px 14px 8px}' +
    '.tv2-al-detail{padding:8px 0;border-top:1px solid #131c26}.tv2-al-detail .k{font:500 8px/1 Archivo,sans-serif;color:#5d7085;text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px}' +
    '.tv2-al-detail .v{font:600 11px/1.3 "IBM Plex Mono",monospace;color:#c9d6e2}' +
    '.tv2-al-badge{display:inline-flex;align-items:center;gap:6px;margin:4px 14px 0;padding:5px 12px;border-radius:6px;font:700 11px/1 Archivo,sans-serif;width:fit-content}' +
    '.tv2-al-badge.bull{background:rgba(0,255,136,.12);color:#00ff88;border:1px solid rgba(0,255,136,.2)}' +
    '.tv2-al-badge.bear{background:rgba(255,77,106,.12);color:#ff4d6a;border:1px solid rgba(255,77,106,.2)}' +
    '.tv2-al-exp{padding:4px 14px 12px;font:500 10px/1 "IBM Plex Mono",monospace;color:#5d7085}' +
    '.tv2-al-empty{padding:14px 12px;font:500 11.5px/1.6 "IBM Plex Mono",monospace;color:#5d7085;text-align:center;border:1px dashed #1b3a4d;border-radius:10px}' +
    '.tv2-al-empty.err{color:#ff859f;border-color:#3d1524}' +
    '.tv2-al-foot{font:400 10px/1.5 Archivo,sans-serif;color:#4c5d6d}';

  var S = { alerts: null, err: null };
  function countEl(card) {
    var leaves = [].slice.call(card.querySelectorAll('span,div,b,strong')).filter(function (e) { return e.children.length === 0 && /\bACTIVE\b/i.test(e.textContent || ''); });
    return leaves[0] || null;
  }

  function alertCard(a) {
    var grp = a.group || a.source || 'PUBLIC ALERTS';
    var author = a.author || {};
    var ic = author.avatar || a.icon || a.group_icon || '';
    var name = author.name || grp;
    var role = author.role || '';
    var text = a.raw || a.text || a.body || a.message || a.title || a.headline || '';
    var entry = f2(a.entry);
    var target = f2(a.target) || f2(a.pt);
    var peakG = pct(a.peakGainPct);
    var dir = (a.direction || 'long').toLowerCase();
    var isBull = dir !== 'short';
    var alertTime = a.t || a.time || a.created_at || a.created;
    var alertISO = a.alertAt || '';
    var peakISO = a.peakAt || '';
    var peakPrice = f2(a.peakPrice);
    var ttpSec = a.timeToPeakSeconds;
    var expiresTs = a.expires;
    var daysSince = alertTime ? Math.floor(Math.max(0, (Date.now() / 1000 - (typeof alertTime === 'number' ? (alertTime < 2e10 ? alertTime : alertTime / 1000) : Date.parse(alertTime) / 1000)) / 86400)) : 0;
    var trackDays = 30;
    var dayNum = Math.min(daysSince + 1, trackDays);

    var html = '<div class="tv2-al-card">';
    html += '<div class="tv2-al-card-head">';
    html += ic ? '<div class="tv2-al-avatar" style="background-image:url(\'' + esc(ic) + '\')"></div>' : '<div class="tv2-al-avatar">' + esc(String(name).slice(0, 2).toUpperCase()) + '</div>';
    html += '<div class="tv2-al-identity"><div class="tv2-al-name">' + esc(name);
    if (role) html += '<span class="tv2-al-role">' + esc(role) + '</span>';
    html += '<span class="tv2-al-dot"></span>';
    html += '</div><span class="tv2-al-time">' + esc(rel(alertTime)) + '</span></div></div>';

    if (text) {
      html += '<div class="tv2-al-msg">' + esc(text).replace(/\$([A-Za-z]{1,6})\b/g, function (m, s) { return '<b>$' + s.toUpperCase() + '</b>'; }) + '</div>';
    }

    if (entry) {
      html += '<div class="tv2-al-prices">';
      html += '<span class="lbl">Entry</span> <span class="val">' + entry + '</span>';
      html += ' <span class="arr">→</span> ';
      if (peakG) {
        var chgClass = a.peakGainPct >= 0 ? 'up' : 'dn';
        html += '<span class="lbl">Peak</span> <span class="val">' + (peakPrice || '—') + '</span>';
        html += ' <span class="chg ' + chgClass + '">' + peakG + '</span>';
      }
      if (target) html += ' <span class="lbl">PT</span> <span class="pt">' + target + '</span>';
      html += '</div>';
    }

    html += '<div class="tv2-al-scores">';
    html += '<div class="tv2-al-score"><div class="v gain">' + (peakG || '—') + '</div><div class="k">Peak gain</div></div>';
    html += '<div class="tv2-al-score"><div class="v loss">—</div><div class="k">Max drawdown</div></div>';
    html += '</div>';

    html += '<div class="tv2-al-details">';
    html += '<div class="tv2-al-detail"><div class="k">Alert date</div><div class="v">' + esc(fmtDate(alertISO)) + '</div></div>';
    html += '<div class="tv2-al-detail"><div class="k">Peak price</div><div class="v">' + (peakPrice ? '$' + peakPrice : '—') + '</div></div>';
    html += '<div class="tv2-al-detail"><div class="k">Time to peak</div><div class="v">' + esc(fmtDuration(ttpSec)) + '</div></div>';
    html += '<div class="tv2-al-detail"><div class="k">Peak reached</div><div class="v">' + esc(fmtDate(peakISO)) + '</div></div>';
    html += '</div>';

    html += '<div class="tv2-al-badge ' + (isBull ? 'bull' : 'bear') + '">' + (isBull ? 'Bullish' : 'Bearish') + ' – Day ' + dayNum + ' of ' + trackDays + '</div>';
    html += '<div class="tv2-al-exp">expires in ' + esc(until(expiresTs)) + '</div>';

    html += '</div>';
    return html;
  }

  function render(card, body) {
    var c = countEl(card);
    if (S.err) { body.innerHTML = '<div class="tv2-al-empty err">' + esc(S.err) + '</div>'; if (c) c.textContent = '— ACTIVE'; return; }
    var list = S.alerts || [];
    if (c) c.textContent = list.length + ' ACTIVE';
    if (!list.length) { body.innerHTML = '<div class="tv2-al-empty">No active alerts for <b>$' + esc(SYM) + '</b>.</div><div class="tv2-al-foot">Alerts from PUBLIC ALERTS channels are tracked for 30 days.</div>'; return; }
    body.innerHTML = '<div class="tv2-al">' + list.map(alertCard).join('') + '</div><div class="tv2-al-foot">Alerts from PUBLIC ALERTS channels are tracked for 30 days.</div>';
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
    var body = document.createElement('div'); body.setAttribute('data-tv2-alerts', '1'); body.setAttribute('data-tv2-keep', '1'); body.style.padding = '12px 14px 14px';
    body.innerHTML = '<div class="tv2-al-empty">Loading alerts…</div>';
    card.appendChild(body);
    load(card, body); setInterval(function () { if (!document.hidden) load(card, body); }, 30000);
    return true;
  }
  var tries = 0;
  var t = setInterval(function () { var ok = false; try { ok = mount(); } catch (e) {} if (ok || ++tries > 60) clearInterval(t); }, 250);
})();
