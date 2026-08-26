/* SML Terminal — rail media card (under Short sale analysis).
   Shows the platform's OWN recent videos / streams for the current symbol from
   the real public endpoint /wp-json/sml-video-upload-studio/v1/rail?ticker=SYM
   (the same feed the watch pages use; `related` = uploads tagged with this
   ticker). If the symbol has no related media, the SEO "Market summary" section
   (which the clean render moved to the bottom of the page) is adopted into this
   card instead — so the space under Short sale analysis is never dead. Nothing
   is fabricated: no media and no summary section → no card at all. */
(function () {
  'use strict';
  if (window.__smlTerminalMediaBooted) return;
  window.__smlTerminalMediaBooted = true;
  if (window.SML_TV2_LIVE !== 1 && !/[?&]tv2=1(&|$)/.test(location.search)) return;

  var SYM = ((new URLSearchParams(location.search)).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '') || 'SPY';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  var CSS = '' +
    '.tv2-med{position:relative;border:1px solid #16202b;border-radius:10px;background:#080c12;overflow:hidden}' +
    '.tv2-med::before{content:"";position:absolute;inset:0 0 auto 0;height:2px;border-radius:10px 10px 0 0;background:linear-gradient(90deg,transparent,#00ff88 30%,#00ff88 70%,transparent);opacity:.5;pointer-events:none}' +
    '.tv2-med-h{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border-bottom:1px solid #131c26}' +
    '.tv2-med-h .t{font:700 12px/1 Archivo,sans-serif;color:#e6edf3;display:flex;align-items:center;gap:7px}' +
    '.tv2-med-h .t::before{content:"";width:6px;height:6px;border-radius:50%;background:#00ff88;box-shadow:0 0 7px #00ff88}' +
    '.tv2-med-h .d{font:500 10px/1 "IBM Plex Mono",monospace;color:#5d7085}' +
    '.tv2-med-body{padding:10px 12px 12px;display:flex;flex-direction:column;gap:8px}' +
    '.tv2-med-item{display:flex;gap:10px;align-items:flex-start;text-decoration:none;border:1px solid #131c26;border-radius:9px;background:linear-gradient(180deg,#0b1119,#090e15);padding:7px;transition:border-color .18s,transform .15s}' +
    '.tv2-med-item:hover{border-color:rgba(0,255,136,.4);transform:translateY(-1px)}' +
    '.tv2-med-item .th{position:relative;flex:0 0 108px;height:62px;border-radius:6px;overflow:hidden;background:#0d141c}' +
    '.tv2-med-item .th img{width:100%;height:100%;object-fit:cover;display:block}' +
    '.tv2-med-item .th .dur{position:absolute;right:4px;bottom:4px;font:600 8.5px/1 "IBM Plex Mono",monospace;color:#e6edf3;background:rgba(4,6,10,.85);border-radius:4px;padding:3px 5px}' +
    '.tv2-med-item .meta{flex:1 1 auto;min-width:0;display:flex;flex-direction:column;gap:4px;padding-top:2px}' +
    '.tv2-med-item .ttl{font:600 11px/1.35 Archivo,sans-serif;color:#e6edf3;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}' +
    '.tv2-med-item .sub{font:400 9.5px/1.4 Archivo,sans-serif;color:#5d7085}' +
    '.tv2-med-item .sub .vf{color:#00ccff}' +
    '.tv2-med-item .sub .tk{color:#00ff88;font-weight:600}' +
    /* adopted market summary — compact rail fit */
    '.tv2-med-sum{max-height:430px;overflow-y:auto;scrollbar-width:thin}' +
    '.tv2-med-sum .sml-ticker-summary{padding:0!important;margin:0!important;background:transparent!important;border:none!important;width:auto!important;max-width:none!important}' +
    '.tv2-med-sum h1,.tv2-med-sum h2{font-size:13px!important;line-height:1.4!important;margin:0 0 8px!important}' +
    '.tv2-med-sum h3{font-size:11.5px!important;line-height:1.4!important;margin:10px 0 5px!important}' +
    '.tv2-med-sum p,.tv2-med-sum li{font-size:10.5px!important;line-height:1.55!important;color:#a9bccd!important;margin:0 0 7px!important}' +
    '.tv2-med-sum table{font-size:10px!important;width:100%!important}';

  var EL = null, MODE = null;

  function card(title) {
    var el = document.createElement('div');
    el.className = 'tv2-med'; el.setAttribute('data-tv2-keep', '1'); el.setAttribute('data-tv2-media', '1');
    el.innerHTML = '<div class="tv2-med-h"><span class="t">' + esc(title) + '</span><span class="d">$' + esc(SYM) + '</span></div><div class="tv2-med-body" id="tv2med-body"></div>';
    return el;
  }

  function renderVideos(el, items) {
    items = (items || []).filter(function (v) { return v && v.watch_url && v.title && v.thumbnail && /^https:\/\//i.test(String(v.thumbnail)); });
    el.querySelector('#tv2med-body').innerHTML = items.slice(0, 5).map(function (v) {
      var sub = [];
      if (v.creator) sub.push(esc(v.creator) + (v.verified ? ' <span class="vf">✓</span>' : ''));
      if (v.views_label) sub.push(esc(v.views_label));
      if (v.ago) sub.push(esc(v.ago));
      return '<a class="tv2-med-item" href="' + esc(v.watch_url) + '">' +
        '<span class="th"><img loading="lazy" src="' + esc(v.thumbnail) + '" alt="' + esc(v.title) + '">' + (v.duration ? '<i class="dur">' + esc(v.duration) + '</i>' : '') + '</span>' +
        '<span class="meta"><span class="ttl">' + esc(v.title) + '</span><span class="sub">' + (v.ticker ? '<span class="tk">$' + esc(v.ticker) + '</span> · ' : '') + sub.join(' · ') + '</span></span></a>';
    }).join('');
  }

  function adoptSummary(el) {
    var below = document.querySelector('.tv2-summary-below');
    var sec = below ? below.querySelector('.sml-ticker-summary') : document.querySelector('.sml-ticker-summary');
    if (!sec) return false;
    var body = el.querySelector('#tv2med-body');
    body.classList.add('tv2-med-sum');
    body.appendChild(sec);
    if (below && !below.querySelector('.sml-ticker-summary')) below.parentNode && below.parentNode.removeChild(below);
    return true;
  }

  function place() {
    if (!EL) return;
    var rail = document.querySelector('#sml-tv2-root [data-tv2-zone="rail"]');
    if (!rail) return;
    var short = rail.querySelector('[data-tv2-short]');
    if (short) short.insertAdjacentElement('afterend', EL); else rail.appendChild(EL);
  }

  function boot() {
    var rail = document.querySelector('#sml-tv2-root [data-tv2-zone="rail"]');
    if (!rail || !rail.children.length) return false;
    if (!document.getElementById('tv2-med-css')) { var st = document.createElement('style'); st.id = 'tv2-med-css'; st.textContent = CSS; document.head.appendChild(st); }
    fetch('/wp-json/sml-video-upload-studio/v1/rail?ticker=' + encodeURIComponent(SYM), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (d) {
        var rel = (d && Array.isArray(d.related)) ? d.related.filter(function (v) { return v && v.watch_url && v.title && v.thumbnail && /^https:\/\//i.test(String(v.thumbnail)); }) : [];
        if (rel.length) {
          MODE = 'videos';
          EL = card('Related videos & streams');
          renderVideos(EL, rel);
          place();
        } else {
          MODE = 'summary';
          EL = card('Market summary');
          if (adoptSummary(EL)) place(); else EL = null; /* no media AND no summary → nothing to show */
        }
      })
      .catch(function () {
        /* media feed unreachable → still fill the space with the summary if it exists */
        MODE = 'summary';
        EL = card('Market summary');
        if (adoptSummary(EL)) place(); else EL = null;
      });
    /* the shell / data modules may re-render the rail — put the card back */
    try {
      if (window.MutationObserver) {
        var mo = new MutationObserver(function () { if (EL && !document.contains(EL)) place(); });
        mo.observe(rail, { childList: true });
        var zp = rail.parentElement; if (zp) mo.observe(zp, { childList: true, subtree: true });
      }
    } catch (e) {}
    return true;
  }

  var tries = 0;
  var t = setInterval(function () { var ok = false; try { ok = boot(); } catch (e) {} if (ok || ++tries > 60) clearInterval(t); }, 300);
})();
