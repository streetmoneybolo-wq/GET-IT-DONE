<?php
/**
 * Loop Letters - public reader page at /n/{handle}/{slug}/.
 *
 * Rendered server-side so the letter is crawlable and so gated blocks never
 * reach the client. Interaction (bookmark, comments, read beacons)
 * hydrates on top.
 */

if (!defined('ABSPATH')) {
    exit;
}

if (!function_exists('sml_letters_public_styles')) {
    function sml_letters_public_styles() {
        return <<<'SMLLPCSS'
*,*::before,*::after{box-sizing:border-box}
html{margin:0!important;background:#070c15!important;color:#e6edf5!important;color-scheme:dark!important}
body{margin:0;background:#070c15!important;color:#e6edf5!important;font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;-webkit-font-smoothing:antialiased}
html body,body.lp-reader-page{background:#070c15!important;color:#e6edf5!important}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}
svg{display:block}
[hidden]{display:none !important}

.lp-top{display:flex;align-items:center;gap:16px;padding:13px 26px;border-bottom:1px solid #141d2a;
    background:rgba(8,13,23,.94);backdrop-filter:blur(10px);position:sticky;top:0;z-index:50}
.lp-brand{display:flex;align-items:center;gap:11px}
.lp-brand b{font-size:16px;font-weight:800;letter-spacing:-.3px;line-height:1.15}
.lp-brand b em{display:block;font-style:normal;color:#2b6cff}
.lp-top-spacer{flex:1}
.lp-top-btn{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 15px;border-radius:9px;
    border:1px solid #1e2a3a;background:#0d1622;font-size:13.5px;font-weight:600;color:#dbe6f2}
.lp-top-btn:hover{border-color:#2b6cff}
.lp-top-btn.on{border-color:#e0a336;color:#e0a336}
.lp-progress{position:fixed;top:0;left:0;height:2px;background:#2b6cff;width:0;z-index:60;transition:width .12s linear}

.lp-wrap{max-width:1140px;margin:0 auto;padding:34px 26px 90px;
    display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:38px;align-items:start}
.lp-main{min-width:0}
.lp-rail{position:sticky;top:82px;display:flex;flex-direction:column;gap:16px}

.lp-kicker{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:14px}
.lp-tag{height:24px;display:inline-flex;align-items:center;padding:0 10px;border-radius:999px;
    background:#152234;border:1px solid #223146;font-size:11.5px;font-weight:700;letter-spacing:.4px;color:#a9b8ca}
.lp-tag.sym{border-color:#2b6cff;color:#63a4ff}
.lp-tag.paid{border-color:#e0a336;color:#e0a336}
h1.lp-title{margin:0 0 10px;font-size:39px;line-height:1.15;font-weight:800;letter-spacing:-1px}
.lp-sub{margin:0 0 22px;font-size:18px;line-height:1.55;color:#8798ac}

.lp-by{display:flex;align-items:center;gap:12px;padding:14px 0;border-top:1px solid #16202e;
    border-bottom:1px solid #16202e;margin-bottom:28px}
.lp-by img{width:44px;height:44px;border-radius:50%;object-fit:cover}
.lp-by b{display:block;font-size:14.5px;font-weight:700}
.lp-by small{display:block;font-size:12.5px;color:#8798ac;margin-top:2px}
.lp-publication{display:block;font-size:11.5px;color:var(--lp-accent,#63a4ff);margin-top:2px}

.lp-article{font-size:17.5px;line-height:1.78;color:#d5e0ec}
.lp-article p{margin:0 0 22px}
.lp-article h2{font-size:25px;font-weight:700;letter-spacing:-.4px;margin:38px 0 14px;color:#e6edf5}
.lp-article h3{font-size:20px;font-weight:700;margin:30px 0 12px;color:#e6edf5}
.lp-article h4{font-size:17px;font-weight:700;margin:26px 0 10px;color:#e6edf5}
.lp-article ul,.lp-article ol{margin:0 0 22px;padding-left:24px}
.lp-article li{margin-bottom:8px}
.lp-article blockquote{margin:0 0 22px;padding:4px 0 4px 20px;border-left:3px solid #2b6cff;
    color:#c2cede;font-style:italic}
.lp-article figure{margin:0 0 24px}
.lp-article figure img{width:100%;border-radius:12px;display:block}
.lp-article figcaption{margin-top:8px;font-size:13px;color:#7b8ca1;text-align:center}
.lp-article a{color:#63a4ff}
.lp-article a.ll-ticker{display:inline-block;padding:0 5px;border-radius:5px;background:#132238;
    color:#63a4ff;font-weight:700;text-decoration:none}
.lp-article a.ll-ticker:hover{background:#1b3050}
.lp-article hr.ll-paywall-line{border:0;border-top:1px dashed #2a3648;margin:34px 0}

/* Readability firewall: generated/pasted blocks are not allowed to create
   white text on white cards, invisible tables, or unreadable inline styles. */
:root{color-scheme:dark!important}
html,body,.lp-top,.lp-wrap,.lp-main,.lp-rail,.lp-card,.lp-comments,.lp-article{
    --ll-bg:#070c15;--ll-card:#0b131f;--ll-card-2:#101c2c;--ll-text:#dbe7f3;
    --ll-muted:#8fa3b8;--ll-strong:#f6f9ff;--ll-border:#243247;--ll-blue:#63a4ff;
    --ll-green:#22d97a;--ll-red:#ff566e;background-color:var(--ll-bg)!important;color:var(--ll-text)!important;
    --wp--preset--color--background:#070c15;--wp--preset--color--foreground:#e6edf5;
    --wp--preset--color--base:#070c15;--wp--preset--color--contrast:#e6edf5}
.lp-wrap::before,.lp-wrap::after,.lp-main::before,.lp-main::after{background:transparent!important;color:inherit!important}
.lp-article{color:var(--ll-text)!important;text-shadow:0 1px 0 rgba(0,0,0,.16)}
.lp-article :where(*):not(svg):not(path):not(polyline):not(defs):not(stop):not(line):not(circle):not(rect){
    color:var(--ll-text)!important}
.lp-article :where(p,li,dd,dt,td,th,span,div,blockquote,figcaption,summary,label){
    color:var(--ll-text)!important}
.lp-article :where(h1,h2,h3,h4,h5,h6,strong,b){color:var(--ll-strong)!important}
.lp-article :where(small,time,figcaption,.muted,.ll-muted){color:var(--ll-muted)!important}
.lp-article a:not(.ll-action):not(.ll-ticker){color:var(--ll-blue)!important;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
.lp-article :where(.has-white-color,[style*="color:#fff" i],[style*="color: #fff" i],[style*="color:white" i],[style*="color: white" i],[style*="color:rgb(255" i]){
    color:var(--ll-text)!important}
.lp-article :where(.has-white-background-color,[style*="background:#fff" i],[style*="background: #fff" i],[style*="background-color:#fff" i],[style*="background-color: #fff" i],[style*="background:white" i],[style*="background-color:white" i],[style*="background: rgb(255" i],[style*="background-color: rgb(255" i]){
    background:var(--ll-card)!important;color:var(--ll-text)!important;border-color:var(--ll-border)!important}
.lp-article :where(.wp-block-group,.wp-block-cover,.wp-block-column,.wp-block-media-text,.has-background){
    border-radius:14px;border:1px solid var(--ll-border);background:linear-gradient(180deg,#0d1725,#09111d)!important;
    color:var(--ll-text)!important;padding:18px}
.lp-article :where(table,.wp-block-table table){width:100%;border-collapse:separate;border-spacing:0;overflow:hidden;
    border:1px solid var(--ll-border);border-radius:14px;background:var(--ll-card);color:var(--ll-text);
    box-shadow:0 18px 40px rgba(0,0,0,.22)}
.lp-article :where(th,td){padding:12px 14px;border-bottom:1px solid #1a2534;background:transparent!important;color:var(--ll-text)!important}
.lp-article :where(th){background:var(--ll-card-2)!important;color:#a9bdd4!important;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.lp-article tr:last-child :where(th,td){border-bottom:0}
.lp-article :where(pre,code){background:#07101b!important;color:#e9f2ff!important;border:1px solid #1d2a3c;border-radius:10px}
.lp-article pre{padding:14px 16px;overflow:auto}
.lp-article code{padding:2px 6px}
.lp-article :where(img,video,iframe){max-width:100%;height:auto}
.lp-article .aligncenter{margin-left:auto;margin-right:auto}
.lp-article .ll-sym{color:var(--ll-strong)!important}
.lp-article .ll-live{color:var(--ll-muted)!important}
.lp-article .ll-live.up{color:var(--ll-green)!important}
.lp-article .ll-live.down{color:var(--ll-red)!important}

.ll-block{margin:0 0 24px}
.ll-ticker-card{display:flex;align-items:center;justify-content:space-between;gap:14px;
    padding:15px 18px;border-radius:12px;border:1px solid #1e2a3a;background:linear-gradient(135deg,#0b131f,#0f1d30);
    box-shadow:0 16px 36px rgba(0,0,0,.2)}
.ll-ticker-card .ll-sym{font-size:18px;font-weight:800;letter-spacing:-.3px}
.ll-ticker-card .ll-live{font-size:15px;font-weight:700;color:#8798ac;font-variant-numeric:tabular-nums}
.ll-ticker-card .ll-live.up{color:#22d97a}
.ll-ticker-card .ll-live.down{color:#ff566e}
.ll-chart{height:280px;border-radius:16px;border:1px solid #223247;
    background:
      linear-gradient(rgba(99,164,255,.07) 1px,transparent 1px),
      linear-gradient(90deg,rgba(99,164,255,.06) 1px,transparent 1px),
      radial-gradient(circle at 78% 18%,rgba(34,217,122,.12),transparent 28%),
      #07101b;
    background-size:100% 20%,40px 100%,auto,auto;
    padding:14px;position:relative;box-shadow:0 22px 54px rgba(0,0,0,.28),inset 0 0 0 1px rgba(255,255,255,.025)}
.ll-chart svg{width:100%;height:100%;overflow:visible}
.ll-chart .lp-chart-empty{display:grid;place-items:center;height:100%;font-size:13px;color:#8fa3b8}
.ll-chart::after{content:'Live price action';position:absolute;right:14px;top:12px;font-size:10px;font-weight:800;
    letter-spacing:.12em;text-transform:uppercase;color:#79f2ae;background:rgba(5,13,22,.78);
    border:1px solid rgba(34,217,122,.22);border-radius:999px;padding:5px 8px}
.ll-live-data,.ll-price-action,.ll-immersive-chart,.ll-market-panel{margin:0 0 24px;padding:16px 18px;border-radius:16px;
    border:1px solid var(--ll-border);background:linear-gradient(180deg,#0f1b2b,#08111d);color:var(--ll-text);
    box-shadow:0 18px 44px rgba(0,0,0,.24)}
.ll-levels{border:1px solid #253449;border-radius:12px;background:#0b131f;overflow:hidden}
.ll-levels-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;
    background:#101c2c;font-size:14px;font-weight:800;letter-spacing:-.2px}
.ll-levels-head .ll-tf{font-size:11.5px;font-weight:700;letter-spacing:.6px;color:#8798ac;text-transform:uppercase}
.ll-levels dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;margin:0;background:#1a2534}
.ll-levels dl > div{background:#0b131f;padding:13px 16px}
.ll-levels dt{font-size:11.5px;color:#8798ac;margin-bottom:5px;font-weight:600}
.ll-levels dd{margin:0;font-size:16px;font-weight:800;font-variant-numeric:tabular-nums}
.ll-disclosure{padding:13px 16px;border-radius:10px;background:rgba(224,163,54,.07);
    border:1px solid rgba(224,163,54,.26);font-size:13.5px;line-height:1.6;color:#e6c98e}
.ll-disclosure b{color:#e0a336}
.ll-video{padding:15px 18px;border-radius:12px;border:1px solid #1e2a3a;background:#0b131f}
.ll-video a{color:#63a4ff;font-weight:700}
.lp-article .ll-action{display:inline-flex;align-items:center;gap:9px;height:44px;padding:0 20px;
    border-radius:10px;background:#152234;border:1px solid #2b6cff;color:#63a4ff;font-size:14.5px;
    font-weight:700;margin:0 0 24px}
.lp-article .ll-action:hover{background:#2b6cff;color:#fff}
.lp-article .ll-action.done{border-color:#22d97a;color:#22d97a;background:rgba(34,217,122,.1)}

.lp-lock{margin-top:6px;padding:30px 28px;border-radius:16px;border:1px solid #253449;
    background:linear-gradient(180deg,rgba(11,19,31,0) 0%,#0b131f 22%);text-align:center}
.lp-lock::before{content:'';display:block;height:90px;margin:-84px -28px 22px;
    background:linear-gradient(180deg,rgba(7,12,21,0),#070c15 88%)}
.lp-lock h3{margin:0 0 8px;font-size:21px;font-weight:800;letter-spacing:-.4px}
.lp-lock p{margin:0 0 20px;font-size:14.5px;line-height:1.65;color:#8798ac}
.lp-cta{display:inline-flex;align-items:center;justify-content:center;gap:10px;height:50px;padding:0 28px;
    border-radius:11px;background:#2b6cff;color:#fff;font-size:15.5px;font-weight:700}
.lp-cta.gold{background:#e0a336;color:#191203}
.lp-cta:hover{filter:brightness(1.08)}
.lp-lock small{display:block;margin-top:13px;font-size:12.5px;color:#5d7189}

.lp-card{background:#0b131f;border:1px solid #182130;border-radius:14px;padding:16px}
.lp-card h4{margin:0 0 12px;font-size:13.5px;font-weight:800;letter-spacing:.4px;color:#8798ac;text-transform:uppercase}
.lp-stat{display:flex;align-items:baseline;justify-content:space-between;padding:7px 0;font-size:13.5px}
.lp-stat span{color:#8798ac}
.lp-stat b{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
.lp-symrow{display:flex;align-items:center;justify-content:space-between;padding:9px 0;
    border-bottom:1px solid #16202e;font-size:14px}
.lp-symrow:last-child{border-bottom:0}
.lp-symrow b{font-weight:800}
.lp-symrow em{font-style:normal;font-variant-numeric:tabular-nums;color:#8798ac}
.lp-symrow em.up{color:#22d97a}
.lp-symrow em.down{color:#ff566e}

.lp-comments{margin-top:52px;padding-top:30px;border-top:1px solid #16202e}
.lp-comments h3{margin:0 0 18px;font-size:20px;font-weight:700;letter-spacing:-.3px}
.lp-compose{display:flex;gap:12px;margin-bottom:26px}
.lp-compose img{width:38px;height:38px;border-radius:50%;flex:0 0 auto;object-fit:cover}
.lp-compose-body{flex:1;min-width:0}
.lp-compose textarea{width:100%;min-height:78px;background:#0b131f;border:1px solid #1e2a3a;border-radius:11px;
    color:#e6edf5;padding:12px 14px;font-size:14.5px;font-family:inherit;line-height:1.6;resize:vertical}
.lp-compose textarea:focus{outline:none;border-color:#2b6cff}
.lp-compose-bar{display:flex;justify-content:flex-end;margin-top:9px}
.lp-send{height:38px;padding:0 18px;border-radius:9px;background:#2b6cff;color:#fff;font-size:13.5px;font-weight:700}
.lp-send[disabled]{opacity:.45;cursor:not-allowed}
.lp-comment{display:flex;gap:12px;padding:15px 0;border-top:1px solid #131c28}
.lp-comment img{width:38px;height:38px;border-radius:50%;flex:0 0 auto;object-fit:cover}
.lp-comment b{font-size:13.5px;font-weight:700}
.lp-comment small{font-size:12px;color:#5d7189;margin-left:8px}
.lp-comment p{margin:6px 0 0;font-size:14.5px;line-height:1.65;color:#c2cede;white-space:pre-wrap}
.lp-empty{padding:26px;text-align:center;font-size:13.5px;color:#5d7189;
    border:1px dashed #1e2a3a;border-radius:12px}

@media (max-width:1000px){
  .lp-wrap{grid-template-columns:minmax(0,1fr);padding:24px 18px 70px;gap:26px}
  .lp-rail{position:static;order:2}
  h1.lp-title{font-size:30px}
  .lp-sub{font-size:16px}
  .lp-article{font-size:16.5px}
  .ll-levels dl{grid-template-columns:repeat(2,minmax(0,1fr))}
}
SMLLPCSS;
    }
}

if (!function_exists('sml_letters_public_script')) {
    function sml_letters_public_script() {
        return <<<'SMLLPJS'
(function () {
  var cfg = window.smlLetterPage;
  if (!cfg) { return; }

  function api(path, options) {
    options = options || {};
    var headers = { 'Accept': 'application/json' };
    if (options.json) { headers['Content-Type'] = 'application/json'; }
    if (cfg.nonce) { headers['X-WP-Nonce'] = cfg.nonce; }
    return fetch(cfg.base + path, {
      method: options.method || 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: headers,
      body: options.json ? JSON.stringify(options.json) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (p) {
        if (!r.ok) { var e = new Error(p.message || 'Request failed.'); e.status = r.status; throw e; }
        return p;
      });
    });
  }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------- read tracking ---------- */

  var sessionKey;
  try {
    sessionKey = window.sessionStorage.getItem('sml-ll-sid');
    if (!sessionKey) {
      sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
      window.sessionStorage.setItem('sml-ll-sid', sessionKey);
    }
  } catch (e) {
    sessionKey = Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  var started = Date.now();
  var maxScroll = 0;
  var sent = {};

  function beacon(kind, extra) {
    if (sent[kind]) { return; }
    sent[kind] = true;
    var payload = Object.assign({
      id: cfg.letterId, kind: kind, session: sessionKey,
      dwell: Math.round((Date.now() - started) / 1000), scroll: maxScroll
    }, extra || {});
    api('/read', { method: 'POST', json: payload }).catch(function () { sent[kind] = false; });
  }

  beacon('open');

  var bar = document.getElementById('lp-progress');
  var article = document.getElementById('lp-article');

  function onScroll() {
    if (!article) { return; }
    var box = article.getBoundingClientRect();
    var total = Math.max(1, box.height - window.innerHeight);
    var pct = Math.max(0, Math.min(100, Math.round((-box.top / total) * 100)));
    if (pct > maxScroll) { maxScroll = pct; }
    if (bar) { bar.style.width = pct + '%'; }

    // A "read" is 25% down or 30 seconds; a completion is the end of the piece.
    if (maxScroll >= 25) { beacon('read'); }
    if (maxScroll >= 92) { beacon('completion'); }
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  window.setTimeout(function () { beacon('read'); }, 30000);
  onScroll();

  /* ---------- ticker cards and charts ---------- */

  var quoteCache = {};

  function bars(symbol) {
    if (quoteCache[symbol]) { return quoteCache[symbol]; }
    quoteCache[symbol] = fetch(cfg.chartBase + encodeURIComponent(symbol) + '?range=6M&interval=1d', {
      credentials: 'same-origin', headers: { 'Accept': 'application/json' }
    }).then(function (r) { return r.json(); }).then(function (d) {
      var rows = (d && d.data && d.data.bars) || (d && d.bars) || [];
      return rows.filter(function (b) { return b && b.close != null; });
    }).catch(function () { return []; });
    return quoteCache[symbol];
  }

  function fmt(n) { return Number(n).toFixed(2); }

  Array.prototype.forEach.call(document.querySelectorAll('[data-ll-ticker]'), function (el) {
    var symbol = el.getAttribute('data-ll-ticker');
    var out = el.querySelector('[data-ll-price]');
    el.setAttribute('role', 'link');
    el.style.cursor = 'pointer';
    el.addEventListener('click', function () {
      window.location.href = cfg.tickerBase + symbol.toLowerCase() + '/';
    });
    bars(symbol).then(function (rows) {
      if (!out) { return; }
      if (rows.length < 2) { out.textContent = 'Price unavailable'; return; }
      var last = rows[rows.length - 1].close;
      var prev = rows[rows.length - 2].close;
      var pct = prev ? ((last - prev) / prev) * 100 : 0;
      out.textContent = '$' + fmt(last) + '  ' + (pct >= 0 ? '+' : '') + fmt(pct) + '%';
      out.className = 'll-live ' + (pct >= 0 ? 'up' : 'down');
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-ll-chart]'), function (el) {
    var symbol = el.getAttribute('data-ll-chart');
    el.innerHTML = '<div class="lp-chart-empty">Loading ' + esc(symbol) + '…</div>';
    bars(symbol).then(function (rows) {
      if (rows.length < 2) { el.innerHTML = '<div class="lp-chart-empty">No data for ' + esc(symbol) + '</div>'; return; }
      var w = 600, h = 200, pad = 6;
      var closes = rows.map(function (b) { return Number(b.close); });
      var lo = Math.min.apply(null, closes), hi = Math.max.apply(null, closes);
      var span = (hi - lo) || 1;
      var up = closes[closes.length - 1] >= closes[0];
      var stroke = up ? '#22d97a' : '#ff566e';
      var pts = closes.map(function (c, i) {
        var x = pad + (i / (closes.length - 1)) * (w - pad * 2);
        var y = pad + (1 - (c - lo) / span) * (h - pad * 2);
        return x.toFixed(1) + ',' + y.toFixed(1);
      }).join(' ');
      el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
        + '<defs><linearGradient id="ll-fill-' + esc(symbol) + '" x1="0" x2="0" y1="0" y2="1">'
        + '<stop offset="0%" stop-color="' + stroke + '" stop-opacity=".28"/><stop offset="100%" stop-color="' + stroke + '" stop-opacity="0"/></linearGradient></defs>'
        + '<polyline points="' + pts + '" fill="none" stroke="' + stroke + '" stroke-width="3" '
        + 'stroke-linejoin="round" stroke-linecap="round"/>'
        + '<polyline points="' + pts + ' ' + (w - pad) + ',' + (h - pad) + ' ' + pad + ',' + (h - pad) + '" fill="url(#ll-fill-' + esc(symbol) + ')" stroke="none"/></svg>';
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('#lp-article a[href]'), function (link) {
    link.addEventListener('click', function () {
      beacon('click', {
        href: link.href || '',
        text: (link.textContent || '').trim().slice(0, 120)
      });
    }, { capture: true });
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-lp-sym]'), function (el) {
    var symbol = el.getAttribute('data-lp-sym');
    var out = el.querySelector('em');
    bars(symbol).then(function (rows) {
      if (!out || rows.length < 2) { return; }
      var last = rows[rows.length - 1].close;
      var prev = rows[rows.length - 2].close;
      var pct = prev ? ((last - prev) / prev) * 100 : 0;
      out.textContent = '$' + fmt(last) + '  ' + (pct >= 0 ? '+' : '') + fmt(pct) + '%';
      out.className = pct >= 0 ? 'up' : 'down';
    });
  });

  /* ---------- action buttons ---------- */

  Array.prototype.forEach.call(document.querySelectorAll('[data-ll-watchlist]'), function (btn) {
    btn.addEventListener('click', function () {
      if (!cfg.userId) { window.location.href = cfg.loginUrl; return; }
      var symbols = btn.getAttribute('data-ll-watchlist').split(',');
      // No watchlist write endpoint is exposed yet; send the reader to the ticker page.
      window.open(cfg.tickerBase + symbols[0].toLowerCase() + '/', '_blank');
      btn.classList.add('done');
      btn.textContent = 'Opened ' + symbols[0];
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll('[data-ll-alert]'), function (btn) {
    btn.addEventListener('click', function () {
      if (!cfg.userId) { window.location.href = cfg.loginUrl; return; }
      var symbol = btn.getAttribute('data-ll-alert');
      window.open(cfg.tickerBase + symbol.toLowerCase() + '/?alert=' + encodeURIComponent(
        btn.getAttribute('data-trigger') + ':' + btn.getAttribute('data-price')), '_blank');
    });
  });

  /* ---------- bookmark ---------- */

  var mark = document.getElementById('lp-bookmark');
  if (mark) {
    mark.addEventListener('click', function () {
      if (!cfg.userId) { window.location.href = cfg.loginUrl; return; }
      api('/letters/' + cfg.letterId + '/bookmark', { method: 'POST', json: {} })
        .then(function (d) {
          mark.classList.toggle('on', !!d.bookmarked);
          mark.querySelector('span').textContent = d.bookmarked ? 'Saved' : 'Save';
        })
        .catch(function (e) { window.alert(e.message); });
    });
  }

  /* ---------- comments ---------- */

  var list = document.getElementById('lp-comment-list');
  var box = document.getElementById('lp-comment-box');
  var send = document.getElementById('lp-comment-send');

  function when(iso) {
    var t = Date.parse(String(iso).replace(' ', 'T') + 'Z');
    if (!t) { return ''; }
    var mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) { return 'just now'; }
    if (mins < 60) { return mins + 'm ago'; }
    if (mins < 1440) { return Math.round(mins / 60) + 'h ago'; }
    return Math.round(mins / 1440) + 'd ago';
  }

  function paintComments(rows) {
    if (!list) { return; }
    if (!rows.length) {
      list.innerHTML = '<div class="lp-empty">No comments yet.</div>';
      return;
    }
    list.innerHTML = rows.map(function (c) {
      return '<div class="lp-comment"><img src="' + esc(c.avatar) + '" alt="">'
        + '<div><b>' + esc(c.name) + '</b><small>' + esc(when(c.created_at)) + '</small>'
        + '<p>' + esc(c.body) + '</p></div></div>';
    }).join('');
  }

  if (list) {
    api('/letters/' + cfg.letterId + '/comments')
      .then(function (d) { paintComments(d.comments || []); })
      .catch(function () { list.innerHTML = '<div class="lp-empty">Comments unavailable.</div>'; });
  }

  if (send && box) {
    box.addEventListener('input', function () { send.disabled = !box.value.trim(); });
    send.addEventListener('click', function () {
      var body = box.value.trim();
      if (!body) { return; }
      send.disabled = true;
      api('/letters/' + cfg.letterId + '/comment', { method: 'POST', json: { body: body } })
        .then(function (d) {
          box.value = '';
          paintComments(d.comments || []);
        })
        .catch(function (e) { window.alert(e.message); })
        .then(function () { send.disabled = !box.value.trim(); });
    });
  }
})();
SMLLPJS;
    }
}

if (!function_exists('sml_letters_render_public')) {
    function sml_letters_render_public($row) {
        $letter = sml_letters_public($row, true);
        $user_id = get_current_user_id();
        $unlocked = !$letter['locked'];
        $author = $letter['author'];
        $symbols = array_map(function ($t) { return $t['symbol']; }, $letter['tickers']);

        $published = $letter['published_at']
            ? date_i18n(get_option('date_format'), strtotime($letter['published_at'] . ' UTC'))
            : 'Draft preview';

        $config = array(
            'base' => esc_url_raw(rest_url('sml-letters/v1')),
            'nonce' => wp_create_nonce('wp_rest'),
            'letterId' => $letter['id'],
            'userId' => $user_id,
            'chartBase' => esc_url_raw(rest_url('sml-trading-floor/v1/chart/')),
            'tickerBase' => esc_url_raw(home_url('/ticker/')),
            'loginUrl' => esc_url_raw(add_query_arg('redirect_to', rawurlencode($letter['url']), home_url('/sign-up-sign-in/'))),
        );

        status_header(200);
        nocache_headers();
        header('Content-Type: text/html; charset=' . get_bloginfo('charset'));

        $description = $letter['tldr'] ?: $letter['subtitle'] ?: wp_trim_words(wp_strip_all_tags($letter['html']), 32);

        echo '<!doctype html><html ' . get_language_attributes() . '><head>';
        echo '<meta charset="' . esc_attr(get_bloginfo('charset')) . '">';
        echo '<meta name="viewport" content="width=device-width, initial-scale=1">';
        echo '<title>' . esc_html($letter['title']) . ' - ' . esc_html(get_bloginfo('name')) . '</title>';
        echo '<meta name="description" content="' . esc_attr($description) . '">';
        echo '<link rel="canonical" href="' . esc_url($letter['url']) . '">';
        echo '<meta property="og:type" content="article">';
        echo '<meta property="og:title" content="' . esc_attr($letter['title']) . '">';
        echo '<meta property="og:description" content="' . esc_attr($description) . '">';
        echo '<meta property="og:url" content="' . esc_url($letter['url']) . '">';
        if ($letter['cover_url']) {
            echo '<meta property="og:image" content="' . esc_url($letter['cover_url']) . '">';
        }
        echo '<meta name="twitter:card" content="summary_large_image">';
        if ($row['status'] !== 'published') {
            echo '<meta name="robots" content="noindex,nofollow">';
        }
        if (function_exists('sml_dist_letter_head')) {
            sml_dist_letter_head($row, $letter, $unlocked);
        }
        echo '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>';
        echo '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">';
        echo '<style>' . sml_letters_public_styles() . '</style>';
        echo '</head><body class="lp-reader-page" style="--lp-accent:' . esc_attr($author['brand_color']) . '">';

        echo '<div class="lp-progress" id="lp-progress"></div>';

        echo '<header class="lp-top"><a class="lp-brand" href="' . esc_url(home_url('/')) . '">';
        echo '<svg width="30" height="30" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="#2b6cff" stroke-width="2.4"/><path d="M11 25.5l5.4-6.2 4 3.6 7.4-9" stroke="#2b6cff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        echo '<b>StockMarket<em>Loop</em></b></a><div class="lp-top-spacer"></div>';
        echo '<button class="lp-top-btn" id="lp-bookmark"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4h12v17l-6-4.4L6 21z"/></svg><span>Save</span></button>';
        if ((int) $author['id'] === $user_id) {
            echo '<a class="lp-top-btn" href="' . esc_url(home_url('/loop-letters/')) . '">Edit</a>';
        }
        echo '</header>';

        echo '<div class="lp-wrap"><main class="lp-main">';

        echo '<div class="lp-kicker">';
        echo '<span class="lp-tag">' . esc_html($letter['content_type']) . '</span>';
        foreach (array_slice($symbols, 0, 4) as $symbol) {
            echo '<a class="lp-tag sym" href="' . esc_url(home_url('/ticker/' . strtolower($symbol) . '/')) . '">$' . esc_html($symbol) . '</a>';
        }
        echo '</div>';

        echo '<h1 class="lp-title">' . esc_html($letter['title']) . '</h1>';
        if ($letter['subtitle']) {
            echo '<p class="lp-sub">' . esc_html($letter['subtitle']) . '</p>';
        }

        echo '<div class="lp-by"><img src="' . esc_url($author['avatar']) . '" alt="">';
        echo '<div><b>' . esc_html($author['name']) . '</b>';
        echo '<span class="lp-publication">' . esc_html($author['publication_name']) . '</span>';
        echo '<small>' . esc_html($published) . ' &middot; ' . (int) $letter['read_minutes'] . ' min read';
        echo ' &middot; ' . (int) $letter['stats']['reads'] . ' reads</small></div></div>';

        echo '<article class="lp-article" id="lp-article">' . $letter['html'] . '</article>';

        if (!$unlocked) {
            echo '<div class="lp-lock lp-gated">';
            if ($letter['visibility'] === 'subscribers') {
                echo '<h3>This letter is for followers</h3>';
                echo '<p>Follow ' . esc_html($author['name']) . ' to read the rest.</p>';
                echo '<a class="lp-cta" href="' . esc_url(home_url('/members/' . $author['handle'] . '/')) . '">Follow ' . esc_html($author['name']) . '</a>';
            } else {
                echo '<h3>Sign in to keep reading</h3>';
                echo '<p>This letter is for StockMarketLoop members.</p>';
                echo '<a class="lp-cta" href="' . esc_url(add_query_arg('redirect_to', rawurlencode($letter['url']), home_url('/sign-up-sign-in/'))) . '">Sign in</a>';
            }
            echo '</div>';
        }

        echo '<section class="lp-comments"><h3>Discussion (' . (int) $letter['stats']['comments'] . ')</h3>';
        if ($user_id && $unlocked) {
            echo '<div class="lp-compose"><img src="' . esc_url(get_avatar_url($user_id, array('size' => 80))) . '" alt="">';
            echo '<div class="lp-compose-body"><textarea id="lp-comment-box" placeholder="Add to the discussion"></textarea>';
            echo '<div class="lp-compose-bar"><button class="lp-send" id="lp-comment-send" disabled>Post comment</button></div>';
            echo '</div></div>';
        } elseif (!$user_id) {
            echo '<div class="lp-empty"><a href="' . esc_url(add_query_arg('redirect_to', rawurlencode($letter['url']), home_url('/sign-up-sign-in/'))) . '" style="color:#63a4ff">Sign in</a> to join the discussion.</div>';
        } else {
            echo '<div class="lp-empty">Unlock the letter to join the discussion.</div>';
        }
        echo '<div id="lp-comment-list"></div></section>';

        echo '</main><aside class="lp-rail">';

        if ($symbols) {
            echo '<div class="lp-card"><h4>Tickers in this letter</h4>';
            foreach ($symbols as $symbol) {
                echo '<a class="lp-symrow" data-lp-sym="' . esc_attr($symbol) . '" href="'
                    . esc_url(home_url('/ticker/' . strtolower($symbol) . '/')) . '">';
                echo '<b>$' . esc_html($symbol) . '</b><em>&middot;&middot;&middot;</em></a>';
            }
            echo '</div>';
        }

        echo '<div class="lp-card"><h4>About this letter</h4>';
        echo '<div class="lp-stat"><span>Words</span><b>' . number_format((int) $letter['word_count']) . '</b></div>';
        echo '<div class="lp-stat"><span>Reads</span><b>' . number_format((int) $letter['stats']['reads']) . '</b></div>';
        echo '<div class="lp-stat"><span>Bookmarks</span><b>' . number_format((int) $letter['stats']['bookmarks']) . '</b></div>';
        echo '<div class="lp-stat"><span>Access</span><b>' . esc_html(ucfirst($letter['visibility'])) . '</b></div>';
        echo '</div>';

        echo '<div class="lp-card"><h4>More from ' . esc_html($author['name']) . '</h4>';
        $more = sml_letters_more_from($author['id'], $letter['id']);
        if ($more) {
            foreach ($more as $item) {
                echo '<a class="lp-symrow" href="' . esc_url($item['url']) . '" style="display:block;padding:10px 0">';
                echo '<b style="font-weight:600;font-size:13.5px;line-height:1.45;display:block">'
                    . esc_html($item['title']) . '</b>';
                echo '<em style="font-size:12px">' . (int) $item['read_minutes'] . ' min read</em></a>';
            }
        } else {
            echo '<div style="font-size:13px;color:#5d7189">No other letters yet.</div>';
        }
        echo '</div>';

        echo '</aside></div>';

        echo '<script>window.smlLetterPage=' . wp_json_encode($config) . ';</script>';
        echo '<script>' . sml_letters_public_script() . '</script>';
        echo '</body></html>';
        exit;
    }
}

if (!function_exists('sml_letters_more_from')) {
    function sml_letters_more_from($author_id, $exclude_id, $limit = 4) {
        global $wpdb;
        $rows = $wpdb->get_results($wpdb->prepare(
            "SELECT id, slug, title, read_minutes, author_id FROM " . sml_letters_table('posts') . "
              WHERE author_id = %d AND status = 'published' AND id <> %d
              ORDER BY published_at DESC LIMIT %d",
            $author_id, $exclude_id, $limit), ARRAY_A);

        return array_map(function ($row) {
            return array(
                'title' => $row['title'],
                'read_minutes' => (int) $row['read_minutes'],
                'url' => sml_letters_url($row),
            );
        }, $rows ?: array());
    }
}

if (!function_exists('sml_letters_intercept_public')) {
    /**
     * Intercepts /n/{handle}/{slug}/ and legacy /letters/{handle}/{slug}/ before the theme can wash the letter out.
     */
    function sml_letters_intercept_public() {
        global $wpdb;

        if (is_admin() || wp_doing_ajax() || (defined('REST_REQUEST') && REST_REQUEST)) {
            return;
        }
        $path = trim((string) wp_parse_url((string) $_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
        $parts = array_values(array_filter(explode('/', $path)));
        if (count($parts) !== 3 || !in_array($parts[0], array('n', 'letters'), true)) {
            return;
        }

        $slug = sanitize_title($parts[2]);
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM " . sml_letters_table('posts') . " WHERE slug = %s", $slug), ARRAY_A);
        if (!$row) {
            return;
        }

        $user_id = get_current_user_id();
        $is_owner = $user_id && ((int) $row['author_id'] === $user_id || user_can($user_id, 'manage_options'));
        if ($row['status'] !== 'published' && !$is_owner) {
            return;
        }

        // Canonicalise the handle so shared links always resolve to one URL.
        $author = get_userdata((int) $row['author_id']);
        $canonical_handle = $author ? sanitize_title($author->display_name ?: $author->user_nicename) : '';
        if ($author && ($parts[0] !== 'n' || $parts[1] !== $canonical_handle)) {
            wp_safe_redirect(sml_letters_url($row), 301);
            exit;
        }

        sml_letters_render_public($row);
    }
}
add_action('template_redirect', 'sml_letters_intercept_public', 0);
