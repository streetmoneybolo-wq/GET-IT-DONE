/* SML StockTwits — per-ticker community feed (Layer 3)
 *
 * Renders /wp-json/sml-stocktwits/v1/feed into a container, alongside the
 * existing moomoo feed rather than replacing it.
 *
 * Three site-specific rules are load-bearing here:
 *   1. CSS is appended at RUNTIME. Page Optimize strips server-printed inline
 *      <style> tags, so a stylesheet shipped in the markup would vanish.
 *   2. No inline event handlers — CSP blocks them on several templates.
 *   3. The mount point can render AFTER first paint, so we watch for it rather
 *      than assuming it exists. Fixed retry windows have failed on this site.
 *
 * Every field is escaped on the way in. This is third-party user text.
 */
(function () {
  'use strict';
  if (window.__smlStocktwitsBooted) { return; }
  window.__smlStocktwitsBooted = true;

  var API = '/wp-json/sml-stocktwits/v1/feed';
  var MOUNT = '[data-sml-stocktwits]';
  var timers = {};

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* $TICKER cashtags are the one bit of markup we add back, and only after the
     whole string has already been escaped. */
  function linkCashtags(safeText) {
    return safeText.replace(/(^|\s)\$([A-Za-z][A-Za-z0-9.\-]{0,11})\b/g, function (m, pre, sym) {
      var s = sym.toUpperCase();
      return pre + '<a class="smlst-cash" href="/stock-chart/?symbol=' + encodeURIComponent(s) + '">$' + s + '</a>';
    });
  }

  function ago(iso) {
    var t = Date.parse(iso);
    if (!t) { return ''; }
    var s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) { return Math.floor(s) + 's'; }
    if (s < 3600) { return Math.floor(s / 60) + 'm'; }
    if (s < 86400) { return Math.floor(s / 3600) + 'h'; }
    return Math.floor(s / 86400) + 'd';
  }

  function css() {
    if (document.getElementById('smlst-css')) { return; }
    var st = document.createElement('style');
    st.id = 'smlst-css';
    st.textContent = [
      '.smlst{--up:#38F58A;--down:#F2495C;--txt:#E6EDF5;--mut:#7E8A96;--line:rgba(255,255,255,.09);',
      '  font-family:Inter,system-ui,sans-serif;color:var(--txt);}',
      '.smlst-head{display:flex;align-items:center;gap:9px;padding:2px 2px 12px;}',
      '.smlst-dot{width:7px;height:7px;border-radius:50%;background:var(--up);box-shadow:0 0 9px rgba(56,245,138,.8);flex:none;}',
      '.smlst-src{font:700 10px/1 "IBM Plex Mono",monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--mut);}',
      '.smlst-count{margin-left:auto;font:600 11px/1 "IBM Plex Mono",monospace;color:var(--mut);}',
      '.smlst-item{display:flex;gap:11px;padding:13px 2px;border-top:1px solid var(--line);}',
      '.smlst-av{width:34px;height:34px;border-radius:50%;flex:none;object-fit:cover;background:#16202b;}',
      '.smlst-body{min-width:0;flex:1;}',
      '.smlst-top{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;}',
      '.smlst-user{font-weight:700;font-size:13.5px;color:var(--txt);text-decoration:none;}',
      '.smlst-user:hover{text-decoration:underline;}',
      '.smlst-time{font:500 11px/1 "IBM Plex Mono",monospace;color:var(--mut);}',
      '.smlst-tag{font:700 9px/1 "IBM Plex Mono",monospace;letter-spacing:.08em;padding:3px 6px;border-radius:4px;text-transform:uppercase;}',
      '.smlst-tag.bull{color:#04140b;background:var(--up);}',
      '.smlst-tag.bear{color:#fff;background:var(--down);}',
      '.smlst-text{margin:5px 0 0;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;}',
      '.smlst-cash{color:#7ae6ff;text-decoration:none;font-weight:600;}',
      '.smlst-cash:hover{text-decoration:underline;}',
      '.smlst-meta{display:flex;gap:14px;margin-top:7px;font:600 11px/1 "IBM Plex Mono",monospace;color:var(--mut);}',
      '.smlst-meta a{color:var(--mut);text-decoration:none;}',
      '.smlst-meta a:hover{color:var(--txt);}',
      '.smlst-empty,.smlst-err{padding:22px 2px;font-size:13px;color:var(--mut);text-align:center;}',
      '.smlst-err{color:var(--down);}',
      '.smlst-sk{height:58px;border-top:1px solid var(--line);opacity:.5;',
      '  background:linear-gradient(90deg,transparent,rgba(255,255,255,.05),transparent);',
      '  background-size:200% 100%;animation:smlst-sh 1.1s linear infinite;}',
      '@keyframes smlst-sh{0%{background-position:200% 0}100%{background-position:-200% 0}}'
    ].join('');
    document.head.appendChild(st);
  }

  function skeleton(host) {
    host.innerHTML = '<div class="smlst"><div class="smlst-head"><span class="smlst-dot"></span>' +
      '<span class="smlst-src">StockTwits</span></div>' +
      '<div class="smlst-sk"></div><div class="smlst-sk"></div><div class="smlst-sk"></div></div>';
  }

  function render(host, data) {
    var posts = (data && data.posts) || [];
    var rows = posts.map(function (p) {
      var tagCls = /bull/i.test(p.sentiment) ? 'bull' : (/bear/i.test(p.sentiment) ? 'bear' : '');
      var tag = tagCls ? '<span class="smlst-tag ' + tagCls + '">' + esc(p.sentiment) + '</span>' : '';
      var avatar = p.avatar_url
        ? '<img class="smlst-av" loading="lazy" alt="" src="' + esc(p.avatar_url) + '">'
        : '<div class="smlst-av"></div>';
      var replies = p.reply_count ? '<span>' + p.reply_count + ' replies</span>' : '';
      return '<div class="smlst-item">' + avatar +
        '<div class="smlst-body"><div class="smlst-top">' +
          '<a class="smlst-user" rel="noopener nofollow" target="_blank" href="' + esc(p.profile_url) + '">' +
            esc(p.display || p.username) + '</a>' +
          '<span class="smlst-time">' + esc(ago(p.timestamp)) + '</span>' + tag +
        '</div>' +
        '<p class="smlst-text">' + linkCashtags(esc(p.comment)) + '</p>' +
        '<div class="smlst-meta"><span>' + (p.likes || 0) + ' likes</span>' + replies +
          '<a rel="noopener nofollow" target="_blank" href="' + esc(p.source_url) + '">View on StockTwits</a>' +
        '</div></div></div>';
    }).join('');

    var head = '<div class="smlst-head"><span class="smlst-dot"></span>' +
      '<span class="smlst-src">StockTwits</span>' +
      '<span class="smlst-count">' + posts.length + ' posts</span></div>';

    var inner = rows || '<div class="smlst-empty">No StockTwits posts for $' +
      esc(data && data.symbol) + ' right now.</div>';

    host.innerHTML = '<div class="smlst">' + head + inner + '</div>';
  }

  function fail(host, symbol) {
    host.innerHTML = '<div class="smlst"><div class="smlst-head"><span class="smlst-dot"></span>' +
      '<span class="smlst-src">StockTwits</span></div>' +
      '<div class="smlst-err">Could not load StockTwits for $' + esc(symbol) + '.</div></div>';
  }

  function load(host) {
    var symbol = (host.getAttribute('data-sml-stocktwits') || '').toUpperCase();
    if (!symbol) { return; }
    css();
    if (!host.getAttribute('data-loaded')) { skeleton(host); }

    fetch(API + '?symbol=' + encodeURIComponent(symbol), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r.status); })
      .then(function (data) {
        host.setAttribute('data-loaded', '1');
        render(host, data);
        /* The server owns the cadence — it knows its own cache window, so the
           client never polls faster than the data can actually change. */
        var next = Math.max(20, (data && data.refresh_seconds) || 45) * 1000;
        clearTimeout(timers[symbol]);
        timers[symbol] = setTimeout(function () { load(host); }, next);
      })
      .catch(function () {
        if (!host.getAttribute('data-loaded')) { fail(host, symbol); }
        clearTimeout(timers[symbol]);
        timers[symbol] = setTimeout(function () { load(host); }, 60000);
      });
  }

  /* ---- auto-mount into the Ticker Terminal's Stocktwits pane ----------------
     The terminal (tv2) renders a .tv2-lf-pane per tab and its markup comes from
     a plugin, and plugin edits get reverted on this site. So rather than asking
     that renderer for a mount point, we claim its Stocktwits pane ourselves:
     find the tab with data-tab="stocktwits", take the pane at the same index,
     and drop our host inside it. Nothing upstream has to change. */
  function paneForStocktwits() {
    var tabs = document.querySelectorAll('.tv2-lf-tabs [data-tab]');
    if (!tabs.length) { return null; }
    var idx = -1;
    for (var i = 0; i < tabs.length; i++) {
      if ((tabs[i].getAttribute('data-tab') || '').toLowerCase() === 'stocktwits') { idx = i; break; }
    }
    if (idx < 0) { return null; }
    var panes = document.querySelectorAll('.tv2-lf > .tv2-lf-pane');
    return panes[idx] || null;
  }

  function urlSymbol() {
    try {
      var s = new URL(location.href).searchParams.get('symbol') || '';
      return s.toUpperCase().replace(/[^A-Z0-9.\-]/g, '');
    } catch (e) { return ''; }
  }

  function autoMount() {
    var pane = paneForStocktwits();
    if (!pane) { return; }
    var sym = urlSymbol();
    if (!sym) { return; }

    var host = pane.querySelector('[data-sml-stocktwits]');
    if (!host) {
      /* The pane ships a "opens on stocktwits.com" placeholder. Replacing it is
         the point — the whole change is that the conversation is now on-site. */
      pane.innerHTML = '';
      host = document.createElement('div');
      host.setAttribute('data-sml-stocktwits', sym);
      pane.appendChild(host);
      host.setAttribute('data-bound', '1');
      load(host);
      return;
    }
    /* The terminal swaps symbols without a page load, so follow it. */
    if (host.getAttribute('data-sml-stocktwits') !== sym) {
      host.setAttribute('data-sml-stocktwits', sym);
      host.removeAttribute('data-loaded');
      load(host);
    }
  }

  function scan() {
    var hosts = document.querySelectorAll(MOUNT);
    for (var i = 0; i < hosts.length; i++) {
      if (!hosts[i].getAttribute('data-bound')) {
        hosts[i].setAttribute('data-bound', '1');
        load(hosts[i]);
      }
    }
    autoMount();
  }

  scan();
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', scan); }
  /* childList only: we write innerHTML and attributes, so watching attributes
     here would make this observer retrigger itself. */
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });

  window.SMLStockTwits = { reload: scan };
})();
