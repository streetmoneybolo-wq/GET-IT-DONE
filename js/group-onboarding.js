/**
 * SML Group Onboarding v2 — Premium groups: the onboarding sits over Premium channels.
 *
 * Viewers who cannot enter a Premium group's content browse the channels its owner opened to everyone (info / promo) and
 * see the onboarding — welcome, what's inside, membership cards, unlock — over every Premium channel. Owners and admins
 * edit it from the group's ⋮ menu ("Onboarding"). Server: mu-plugin sml-group-onboarding.php 2.0.0 (sml-onboard/v1),
 * which prints this viewer's state inline as window.SML_ONBOARD_ACCESS.
 */
(function () {
  'use strict';
  if (window.__smlOnboardV2) return;
  window.__smlOnboardV2 = true;

  var NONCE = window.SML_ONBOARD_NONCE || '';
  var API = '/wp-json/sml-onboard/v1';
  var state = { access: null, mode: '', channelId: 0, landed: false, activeAt: 0 };

  function slug() {
    var m = location.pathname.match(/^\/groups\/([^/]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var nativeFetch = window.fetch;

  function req(url, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json' };
    if (NONCE) headers['X-WP-Nonce'] = NONCE;
    return nativeFetch.call(window, url, Object.assign({ credentials: 'same-origin', cache: 'no-store', headers: headers }, opts)).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) {
          var e = new Error((d && (d.message || d.error)) || 'Something went wrong. Please try again.');
          e.code = d && d.code;
          e.status = r.status;
          throw e;
        }
        return d;
      });
    });
  }

  function api(path, opts) { return req(API + path, opts); }

  function fmt(n) { return Number(n || 0).toLocaleString(); }

  /* ------------------------------------------------------------------ styles */

  var LOCK_SVG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.4"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>');

  function injectStyle() {
    if (document.getElementById('sml-ob-style')) return;
    var css = [
      '#sml-ob-gate [hidden],#sml-ob-config [hidden],.sml-ob-joinbar [hidden]{display:none!important}',
      'html.sml-ob-preview .sml-gshell__composer,html.sml-ob-preview .sml-gshell__typing,html.sml-ob-preview .sml-gshell__message-actions,html.sml-ob-preview .sml-gshell__thread-composer,html.sml-ob-preview .sml-gshell__attach-wrap{display:none!important}',
      'html.sml-ob-preview .sml-gshell__channel.is-locked::after{content:"";display:inline-block;width:11px;height:11px;margin-left:6px;vertical-align:-1px;background:currentColor;opacity:.65;-webkit-mask:url("' + LOCK_SVG + '") center/contain no-repeat;mask:url("' + LOCK_SVG + '") center/contain no-repeat}',
      '#sml-ob-gate{position:absolute;left:0;right:0;bottom:0;z-index:40;overflow-y:auto;display:flex;justify-content:center;align-items:flex-start;padding:32px 16px 40px;background:radial-gradient(120% 80% at 50% 0%,rgba(0,204,255,.08),rgba(5,8,13,.96) 60%);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}',
      '#sml-ob-gate .sml-ob-card{width:100%;max-width:560px;border:1px solid #1b2a38;border-radius:16px;background:#080c12;box-shadow:0 18px 60px rgba(0,0,0,.55);padding:26px 24px;display:flex;flex-direction:column;gap:16px;color:#dbe6f0;font:400 13px/1.55 Archivo,system-ui,sans-serif}',
      '#sml-ob-gate .sml-ob-eyebrow{display:inline-flex;align-items:center;gap:6px;font:700 10.5px/1 Archivo,sans-serif;letter-spacing:.09em;text-transform:uppercase;color:#00ccff}',
      '#sml-ob-gate h2{margin:0;font:800 22px/1.2 Archivo,sans-serif;color:#f2f7fb;text-wrap:balance;overflow-wrap:anywhere}',
      '#sml-ob-gate .sml-ob-sub{margin:-8px 0 0;color:#8fa3b5;font-size:12.5px}',
      '#sml-ob-gate .sml-ob-welcome{margin:0;padding:12px 14px;border-left:2px solid #00ccff;background:#0b1219;border-radius:0 10px 10px 0;color:#dbe6f0;white-space:pre-line}',
      '#sml-ob-gate h3{margin:0 0 8px;font:700 11px/1 Archivo,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#6f8599}',
      '#sml-ob-gate .sml-ob-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}',
      '#sml-ob-gate .sml-ob-chips li,#sml-ob-gate .sml-ob-open button{padding:6px 10px;border:1px solid #1d2b39;border-radius:999px;background:#0b1219;color:#c7d5e2;font:600 12px/1 Archivo,sans-serif}',
      '#sml-ob-gate .sml-ob-open button{cursor:pointer;border-color:rgba(34,197,94,.35);color:#86efac}',
      '#sml-ob-gate .sml-ob-open button:hover,#sml-ob-gate .sml-ob-open button:focus-visible{background:rgba(34,197,94,.12);outline:none}',
      '#sml-ob-gate .sml-ob-plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}',
      '#sml-ob-gate .sml-ob-plan{border:1px solid #1d2b39;border-radius:12px;padding:14px;background:#0a1016;display:flex;flex-direction:column;gap:6px}',
      '#sml-ob-gate .sml-ob-plan b{font:700 14px/1.2 Archivo,sans-serif;color:#f2f7fb}',
      '#sml-ob-gate .sml-ob-plan .p{font:700 18px/1.2 "IBM Plex Mono",ui-monospace,monospace;color:var(--c,#00ccff)}',
      '#sml-ob-gate .sml-ob-plan .p small{font:400 11px/1 Archivo,sans-serif;color:#6f8599;margin-left:4px}',
      '#sml-ob-gate .sml-ob-plan p{margin:0;color:#8fa3b5;font-size:12px}',
      '#sml-ob-gate .sml-ob-plan .sml-ob-cta{margin-top:auto}',
      '#sml-ob-gate .sml-ob-price{margin:-6px 0 0;text-align:center;color:#8fa3b5;font-size:12px}',
      '#sml-ob-gate .sml-ob-cta,.sml-ob-joinbar .sml-ob-cta{display:inline-flex;justify-content:center;align-items:center;gap:8px;min-height:40px;padding:0 18px;border:0;border-radius:10px;background:#00ccff;color:#04121c;font:700 13px/1 Archivo,sans-serif;text-decoration:none;cursor:pointer}',
      '#sml-ob-gate .sml-ob-cta:hover,.sml-ob-joinbar .sml-ob-cta:hover{filter:brightness(1.08)}',
      '#sml-ob-gate .sml-ob-cta:focus-visible,.sml-ob-joinbar .sml-ob-cta:focus-visible,#sml-ob-gate .sml-ob-open button:focus-visible{outline:2px solid #e6f9ff;outline-offset:2px}',
      '#sml-ob-gate .sml-ob-cta[disabled],.sml-ob-joinbar .sml-ob-cta[disabled]{opacity:.6;cursor:progress}',
      '#sml-ob-gate .sml-ob-main-cta{width:100%}',
      '.sml-ob-status{min-height:1em;margin:0;color:#fca5a5;font-size:12px}',
      '#sml-ob-gate details{border-top:1px solid #16202b;padding-top:12px}',
      '#sml-ob-gate summary{cursor:pointer;color:#8fa3b5;font-weight:600}',
      '#sml-ob-gate ol{margin:10px 0 0;padding-left:20px;color:#c7d5e2}',
      '.sml-ob-joinbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin:8px 16px 14px;padding:12px 14px;border:1px solid #1d2b39;border-radius:12px;background:#0a1016;color:#aebfcd;font:500 12.5px/1.4 Archivo,sans-serif}',
      '.sml-ob-joinbar .sml-ob-status{flex-basis:100%}',
      '#sml-ob-config{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(0,0,0,.72)}',
      '#sml-ob-config .sml-ob-panel{width:100%;max-width:620px;max-height:88vh;overflow-y:auto;border:1px solid #1b2a38;border-radius:16px;background:#080c12;color:#dbe6f0;padding:22px;font:400 13px/1.5 Archivo,system-ui,sans-serif;display:flex;flex-direction:column;gap:16px}',
      '#sml-ob-config h2{margin:0;font:800 18px/1.2 Archivo,sans-serif;color:#f2f7fb}',
      '#sml-ob-config h3{margin:0 0 6px;font:700 12px/1.2 Archivo,sans-serif;color:#8fa3b5}',
      '#sml-ob-config p.note{margin:0;color:#8fa3b5}',
      '#sml-ob-config label.row{display:flex;align-items:center;gap:10px;font-weight:600}',
      '#sml-ob-config textarea,#sml-ob-config input[type=text]{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #1d2b39;border-radius:8px;background:#04070b;color:#e6edf3;font:400 13px/1.45 Archivo,sans-serif}',
      '#sml-ob-config textarea:focus,#sml-ob-config input:focus{outline:2px solid #00ccff55;border-color:#00ccff}',
      '#sml-ob-config .chan{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;padding:8px 10px;border:1px solid #16202b;border-radius:10px;background:#0a1016}',
      '#sml-ob-config .chan + .chan{margin-top:6px}',
      '#sml-ob-config .chan .fixed{font-size:11.5px;color:#6f8599}',
      '#sml-ob-config .seg{display:inline-flex;border:1px solid #1d2b39;border-radius:8px;overflow:hidden}',
      '#sml-ob-config .seg button{padding:6px 10px;border:0;background:transparent;color:#8fa3b5;font:600 11.5px/1 Archivo,sans-serif;cursor:pointer}',
      '#sml-ob-config .seg button[aria-pressed=true]{background:#00ccff;color:#04121c}',
      '#sml-ob-config .seg button.open[aria-pressed=true]{background:#22c55e;color:#04120a}',
      '#sml-ob-config .seg button:focus-visible,#sml-ob-config .ghost:focus-visible,#sml-ob-config .primary:focus-visible{outline:2px solid #e6f9ff;outline-offset:2px}',
      '#sml-ob-config .feat{font-size:11.5px;color:#8fa3b5;display:inline-flex;gap:5px;align-items:center}',
      '#sml-ob-config .rule{display:flex;gap:8px}#sml-ob-config .rule + .rule{margin-top:6px}',
      '#sml-ob-config .ghost{display:inline-flex;align-items:center;padding:8px 12px;border:1px solid #1d2b39;border-radius:8px;background:transparent;color:#8fa3b5;font:600 12px/1 Archivo,sans-serif;cursor:pointer;text-decoration:none}',
      '#sml-ob-config .primary{padding:11px 18px;border:0;border-radius:10px;background:#00ccff;color:#04121c;font:700 13px/1 Archivo,sans-serif;cursor:pointer}',
      '#sml-ob-config .actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px;align-items:center}',
      '#sml-ob-config .status{margin-right:auto;color:#8fa3b5;font-size:12px}',
      '#sml-ob-config .status.err{color:#fca5a5}',
      '@media (max-width:600px){#sml-ob-gate{padding:18px 10px 28px}#sml-ob-gate .sml-ob-card{padding:20px 16px}#sml-ob-config .chan{grid-template-columns:1fr}}',
      '@media (prefers-reduced-motion:reduce){#sml-ob-gate{backdrop-filter:none;-webkit-backdrop-filter:none}}'
    ].join('');
    var st = document.createElement('style');
    st.id = 'sml-ob-style';
    st.textContent = css;
    document.head.appendChild(st);
  }

  var LOCK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" stroke="currentColor" stroke-width="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2"/></svg>';

  /* ------------------------------------------------------------------ shell helpers */

  function shellActive() { return !!document.querySelector('#sml-group-shell[data-smlgs-stage="active"]'); }
  function mainEl() { return shellActive() ? document.querySelector('#sml-group-shell .sml-gshell__main') : null; }
  function channelButtons() { return Array.prototype.slice.call(document.querySelectorAll('#sml-group-shell .sml-gshell__channels [data-smlgs-channel]')); }
  function channelButton(id) { return document.querySelector('#sml-group-shell .sml-gshell__channels [data-smlgs-channel="' + Number(id) + '"]'); }
  function channelName(id) {
    var b = channelButton(id);
    return b ? b.textContent.replace(/\s+/g, ' ').replace(/^#\s*/, '').trim() : '';
  }

  function previewing() { return !!(state.access && state.access.preview); }
  function isOpen(id) { return (state.access && state.access.open_channels || []).indexOf(Number(id)) !== -1; }

  /* ------------------------------------------------------------------ preview: the shell's member-only polls are answered locally */

  function installFetchGuard() {
    if (window.__smlObFetchGuard || typeof nativeFetch !== 'function') return;
    window.__smlObFetchGuard = true;
    var prev = window.fetch;
    window.fetch = function (input, init) {
      try {
        if (previewing()) {
          var u = new URL(typeof input === 'string' ? input : (input && input.url) || '', location.href);
          var p = u.pathname.replace(/\/+$/, '');
          var refuse = false;
          if (u.origin === location.origin && p.indexOf('/wp-json/sml/v1/') === 0) {
            var r = p.slice(15);
            /* not group/posts or group/chat: the hidden legacy renderer alert()s their errors (the server answers posts with an empty feed) */
            if (/^\/group\/(typing|unread|read|roster|mentions)(\/|$)/.test(r)) refuse = true;
            else if (r === '/group/channel/messages' && !isOpen(u.searchParams.get('channel_id'))) refuse = true;
            else if (r.indexOf('/portal/') === 0 && !state.access.logged_in) refuse = true;
          }
          if (refuse) {
            return Promise.resolve(new Response(JSON.stringify({ code: 'sml_ob_preview', message: 'Unlock Premium to see this.', data: { status: 403 } }), { status: 403, headers: { 'Content-Type': 'application/json' } }));
          }
        }
      } catch (e) { /* never let the guard break a request */ }
      return prev.apply(this, arguments);
    };
  }

  /* ------------------------------------------------------------------ the onboarding over Premium channels */

  function priceLine() {
    /* memberships are paid in real money on the owner's checkout page (owner, 2026-09-22) */
    var price = state.access.overlay && state.access.overlay.price_display;
    return price ? '<p class="sml-ob-price">' + esc(price) + ' per month</p>' : '';
  }

  function primaryCta() {
    var a = state.access;
    if (!a.logged_in) return '<a class="sml-ob-cta sml-ob-main-cta" href="' + esc(a.overlay.login_url) + '">Sign in to unlock</a>';
    return '<button type="button" class="sml-ob-cta sml-ob-main-cta" data-sml-ob-unlock>Unlock Premium</button>' + priceLine();
  }

  function isFreePlan(p) {
    return !p || p.slug === 'free' || /^\$?\s*0+(\.0+)?$/.test(String(p.price_display || '').trim());
  }

  function plansHtml() {
    var a = state.access;
    var plans = ((a.overlay && a.overlay.plans) || []).filter(function (p) { return p && p.active !== false && !isFreePlan(p); });
    if (!plans.length) return '';
    return '<div class="sml-ob-plans">' + plans.map(function (p) {
      var interval = p.interval === 'lifetime' ? 'one-time' : '/ ' + (p.interval || 'month');
      var cta = p.cta_url
        ? '<a class="sml-ob-cta" href="' + esc(p.cta_url) + '">' + esc(p.cta_text || 'Choose') + '</a>'
        : (a.logged_in
          ? '<button type="button" class="sml-ob-cta" data-sml-ob-unlock>Choose</button>'
          : '<a class="sml-ob-cta" href="' + esc(a.overlay.login_url) + '">Sign in</a>');
      return '<div class="sml-ob-plan" style="--c:' + esc(/^#[0-9a-fA-F]{3,8}$/.test(p.color || '') ? p.color : '#00ccff') + '"><b>' + esc(p.name) + '</b>' +
        '<span class="p">' + esc(p.price_display) + '<small>' + esc(interval) + '</small></span>' +
        (p.description ? '<p>' + esc(p.description) + '</p>' : '') + cta + '</div>';
    }).join('') + '</div>';
  }

  function gateHtml(cid) {
    var a = state.access;
    var o = a.overlay || {};
    var name = channelName(cid);
    var html = '<div class="sml-ob-card">';
    html += '<span class="sml-ob-eyebrow">' + LOCK + ' Premium channel</span>';
    html += '<h2 id="sml-ob-gate-title">' + esc(name ? '#' + name : (o.group_name || 'Premium')) + '</h2>';
    html += '<p class="sml-ob-sub">Part of <b>' + esc(o.group_name) + '</b> Premium' + (o.owner_name ? ' · run by ' + esc(o.owner_name) : '') + '</p>';
    if (a.onboarding && o.welcome_message) html += '<p class="sml-ob-welcome">' + esc(o.welcome_message) + '</p>';
    if (!a.onboarding) html += '<p class="sml-ob-sub" style="margin:0">Premium members read and post here.</p>';
    if (o.featured && o.featured.length) {
      html += '<div><h3>Inside Premium</h3><ul class="sml-ob-chips">' + o.featured.map(function (c) { return '<li>#' + esc(c.name) + '</li>'; }).join('') + '</ul></div>';
    }
    html += plansHtml();
    html += primaryCta();
    html += '<p class="sml-ob-status" data-sml-ob-status role="status" aria-live="polite"></p>';
    if (o.open && o.open.length) {
      html += '<div class="sml-ob-open"><h3>Free to browse</h3><div class="sml-ob-chips">' + o.open.map(function (c) { return '<button type="button" data-sml-ob-goto="' + Number(c.id) + '">#' + esc(c.name) + '</button>'; }).join('') + '</div></div>';
    }
    if (o.rules && o.rules.length) {
      html += '<details><summary>Group rules (' + o.rules.length + ')</summary><ol>' + o.rules.map(function (r) { return '<li>' + esc(r) + '</li>'; }).join('') + '</ol></details>';
    }
    return html + '</div>';
  }

  function unlock(btn) {
    var a = state.access;
    var o = a.overlay || {};
    var box = btn && btn.closest('.sml-ob-joinbar, #sml-ob-gate');
    var status = box && box.querySelector('[data-sml-ob-status]');
    /* Premium is bought on the group owner's checkout page (real money), never with Loop Bucks */
    var url = o.checkout_url, host = '';
    try { host = /^https:\/\//i.test(url || '') ? new URL(url).host : ''; } catch (e) { host = ''; }
    if (host) {
      if (window.confirm('Membership is paid on ' + host + '. Continue to checkout?')) location.assign(url);
      return;
    }
    var msg = o.checkout_message || ('The owner of ' + (o.group_name || 'this group') + ' has not added a membership checkout link yet.');
    if (status) status.textContent = msg; else window.alert(msg);
  }

  function onClick(e) {
    var go = e.target.closest('[data-sml-ob-goto]');
    if (go) { var b = channelButton(go.getAttribute('data-sml-ob-goto')); if (b) b.click(); return; }
    var u = e.target.closest('[data-sml-ob-unlock]');
    if (u) unlock(u);
  }

  function placeGate(gate, main) {
    var conv = main.querySelector('[data-smlgs-conversation]');
    var head = main.querySelector('.sml-gshell__main-head');
    var top = conv ? conv.offsetTop : (head ? head.offsetTop + head.offsetHeight : 0);
    gate.style.top = Math.max(0, top) + 'px';
  }

  function showGate(cid) {
    var main = mainEl();
    if (!main) return;
    if (window.getComputedStyle(main).position === 'static') main.style.position = 'relative';
    var gate = document.getElementById('sml-ob-gate');
    if (!gate) {
      gate = document.createElement('section');
      gate.id = 'sml-ob-gate';
      gate.setAttribute('aria-labelledby', 'sml-ob-gate-title');
      gate.addEventListener('click', onClick);
      main.appendChild(gate);
      var head = main.querySelector('.sml-gshell__main-head');
      if (head && window.ResizeObserver) new ResizeObserver(function () { var g = document.getElementById('sml-ob-gate'); if (g && g.parentNode) placeGate(g, g.parentNode); }).observe(head);
    }
    placeGate(gate, main);
    if (gate.getAttribute('data-channel') !== String(cid)) {
      gate.setAttribute('data-channel', String(cid));
      gate.innerHTML = gateHtml(cid);
      gate.scrollTop = 0;
    }
  }

  function removeGate() {
    var gate = document.getElementById('sml-ob-gate');
    if (gate) gate.remove();
  }

  function ensureJoinBar() {
    var main = mainEl();
    if (!main || main.querySelector('.sml-ob-joinbar')) return;
    var a = state.access;
    var bar = document.createElement('div');
    bar.className = 'sml-ob-joinbar';
    bar.innerHTML = '<span>You are previewing <b>' + esc(a.overlay.group_name) + '</b>. Premium members can post and read every channel.</span>' +
      (a.logged_in ? '<button type="button" class="sml-ob-cta" data-sml-ob-unlock>Unlock Premium</button>' : '<a class="sml-ob-cta" href="' + esc(a.overlay.login_url) + '">Sign in to join</a>') +
      '<p class="sml-ob-status" data-sml-ob-status role="status" aria-live="polite"></p>';
    bar.addEventListener('click', onClick);
    var composer = main.querySelector('[data-smlgs-composer]');
    if (composer && composer.parentNode === main) main.insertBefore(bar, composer); else main.appendChild(bar);
  }

  /* Premium channels get .is-locked, so the sidebar's landing module (group-categories.js firstOpen) opens an open channel first. */
  function markLocked() {
    channelButtons().forEach(function (b) {
      b.classList.toggle('is-locked', !isOpen(b.getAttribute('data-smlgs-channel')));
    });
  }

  function readContext() {
    var c = window.SMLGroupShellContext;
    if (c) { state.mode = c.mode || ''; state.channelId = Number(c.channelId) || 0; }
  }

  /* Fallback landing: the sidebar module lands on the owner's landing channel or the first open channel. With no open
     channel (or if it has not landed within 3 s of the shell going live) open the first channel so the onboarding shows. */
  function land() {
    if (state.landed || !previewing() || !shellActive()) return;
    if (!state.activeAt) state.activeAt = Date.now();
    readContext();
    if (state.mode === 'channel' && state.channelId) { state.landed = true; return; }
    var buttons = channelButtons();
    if (!buttons.length) return;
    var open = buttons.filter(function (b) { return isOpen(b.getAttribute('data-smlgs-channel')); });
    if (open.length && Date.now() - state.activeAt < 3000) return;
    state.landed = true;
    (open[0] || buttons[0]).click();
  }

  function update() {
    var on = previewing();
    document.documentElement.classList.toggle('sml-ob-preview', on);
    if (!on || !mainEl()) { removeGate(); return; }
    markLocked();
    ensureJoinBar();
    land();
    readContext();
    if (state.mode === 'channel' && state.channelId && !isOpen(state.channelId)) showGate(state.channelId);
    else removeGate(); // open channels, Portal and tools stay usable
  }

  /* ------------------------------------------------------------------ owners: "Onboarding" in the ⋮ menu */

  function installMenu() {
    if (!state.access || !state.access.can_manage) return;
    var menu = document.querySelector('[data-smlgs-owner-menu]');
    if (!menu || menu.querySelector('[data-sml-ob-open]')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('data-sml-ob-open', '');
    b.textContent = 'Onboarding';
    b.addEventListener('click', function () {
      menu.classList.remove('open');
      var dots = document.querySelector('[data-smlgs-owner-dots]');
      if (dots) dots.setAttribute('aria-expanded', 'false');
      openConfig();
    });
    menu.appendChild(b);
  }

  function escClose(e) { if (e.key === 'Escape') closeConfig(); }

  function closeConfig() {
    var o = document.getElementById('sml-ob-config');
    if (o) o.remove();
    document.removeEventListener('keydown', escClose);
  }

  function openConfig() {
    if (document.getElementById('sml-ob-config')) return;
    var overlay = document.createElement('div');
    overlay.id = 'sml-ob-config';
    overlay.innerHTML = '<div class="sml-ob-panel" role="dialog" aria-modal="true" aria-labelledby="sml-ob-cfg-title"><h2 id="sml-ob-cfg-title">Onboarding</h2><p class="note">Loading…</p></div>';
    overlay.addEventListener('click', function (e) { if (e.target === overlay) closeConfig(); });
    document.body.appendChild(overlay);
    document.addEventListener('keydown', escClose);
    api('/config?slug=' + encodeURIComponent(slug()))
      .then(function (d) { renderConfig(overlay.querySelector('.sml-ob-panel'), d); })
      .catch(function (err) { overlay.querySelector('.note').textContent = err.message; });
  }

  function renderConfig(panel, d) {
    var cfg = d.config || {};
    var channels = d.channels || [];
    var open = (cfg.open_channels || []).map(Number);
    if (!cfg.updated) { /* first setup: the default PUBLIC ALERTS channel starts open to everyone */
      channels.forEach(function (c) { if (c.openable && String(c.name).trim().toUpperCase() === 'PUBLIC ALERTS' && open.indexOf(c.id) === -1) open.push(c.id); });
    }
    var featured = (cfg.featured_channels || []).map(Number);
    var rules = (cfg.rules || []).slice();

    if (!d.premium) {
      panel.innerHTML = '<h2 id="sml-ob-cfg-title">Onboarding</h2>' +
        '<p class="note">Onboarding is a Premium group feature. It shows over your Premium channels to everyone who has not joined yet, together with your membership cards, and lets you open chosen channels to everyone for info and promo.</p>' +
        (d.can_set_pricing
          ? '<p class="note">Make <b>' + esc(d.group_name) + '</b> Premium by setting membership pricing, then come back here.</p><div class="actions"><a class="ghost" href="/creator-studio/?tab=groups&amp;group_id=' + encodeURIComponent(String(state.access.group_id || '')) + '">Set price and checkout link</a><button type="button" class="primary" data-close>Close</button></div>'
          : '<p class="note">Ask the group owner to set membership pricing to make this group Premium.</p><div class="actions"><button type="button" class="primary" data-close>Close</button></div>');
      panel.querySelector('[data-close]').addEventListener('click', closeConfig);
      return;
    }

    function chanRow(c) {
      var isOpenCh = open.indexOf(c.id) !== -1;
      var control = c.openable
        ? '<span class="seg" role="group" aria-label="Access for #' + esc(c.name) + '"><button type="button" data-set="premium" aria-pressed="' + (!isOpenCh) + '">Premium</button><button type="button" class="open" data-set="open" aria-pressed="' + isOpenCh + '">Open to everyone</button></span>'
        : '<span class="fixed">Premium · ' + esc(c.type) + ' rooms stay members-only</span>';
      return '<div class="chan" data-id="' + Number(c.id) + '"><span>#' + esc(c.name) + '</span>' + control +
        '<label class="feat"' + (isOpenCh ? ' hidden' : '') + '><input type="checkbox" data-feat' + (featured.indexOf(c.id) !== -1 ? ' checked' : '') + '> Feature</label></div>';
    }

    function ruleRow(r) {
      return '<div class="rule"><input type="text" maxlength="200" value="' + esc(r) + '" data-rule aria-label="Rule"><button type="button" class="ghost" data-del-rule>Remove</button></div>';
    }

    panel.innerHTML = '<h2 id="sml-ob-cfg-title">Onboarding</h2>' +
      (d.private ? '<p class="note">This group is private, so visitors cannot preview it. Onboarding and open channels apply to public Premium groups.</p>' : '') +
      '<div><h3>Channels</h3><p class="note" style="margin-bottom:8px">Premium channels are for members. Open channels can be read by everyone — good for info and promo — and visitors can browse them before joining.</p>' +
      channels.map(chanRow).join('') + '</div>' +
      '<label class="row"><input type="checkbox" data-enabled' + (cfg.premium_onboarding ? ' checked' : '') + '> Show the onboarding over Premium channels</label>' +
      '<div><h3>Welcome message</h3><textarea rows="3" maxlength="400" data-welcome placeholder="What members get, and why it is worth it.">' + esc(cfg.welcome_message) + '</textarea></div>' +
      '<p class="note">Tick <b>Feature</b> on up to 5 Premium channels to show them off in the onboarding. Membership cards come from ⋮ → Membership cards &amp; store.</p>' +
      '<div><h3>Rules</h3><div data-rules>' + rules.map(ruleRow).join('') + '</div><button type="button" class="ghost" data-add-rule style="margin-top:8px">Add rule</button></div>' +
      '<div class="actions"><span class="status" data-status role="status" aria-live="polite"></span><button type="button" class="ghost" data-close>Cancel</button><button type="button" class="primary" data-save>Save onboarding</button></div>';

    panel.addEventListener('click', function (e) {
      var seg = e.target.closest('.seg button');
      if (seg) {
        var row = seg.closest('.chan');
        var toOpen = seg.getAttribute('data-set') === 'open';
        row.querySelectorAll('.seg button').forEach(function (b) { b.setAttribute('aria-pressed', String(b === seg)); });
        row.querySelector('.feat').hidden = toOpen;
        if (toOpen) row.querySelector('[data-feat]').checked = false;
        return;
      }
      if (e.target.closest('[data-add-rule]')) {
        var box = panel.querySelector('[data-rules]');
        if (box.querySelectorAll('[data-rule]').length >= 10) return;
        box.insertAdjacentHTML('beforeend', ruleRow(''));
        box.lastElementChild.querySelector('input').focus();
        return;
      }
      if (e.target.closest('[data-del-rule]')) { e.target.closest('.rule').remove(); return; }
      if (e.target.closest('[data-close]')) { closeConfig(); return; }
      if (e.target.closest('[data-save]')) save(panel);
    });

    panel.addEventListener('change', function (e) {
      if (!e.target.matches('[data-feat]') || !e.target.checked) return;
      if (panel.querySelectorAll('[data-feat]:checked').length > 5) {
        e.target.checked = false;
        panel.querySelector('[data-status]').textContent = 'You can feature up to 5 Premium channels.';
      }
    });

    var first = panel.querySelector('.seg button');
    if (first) first.focus();
  }

  function save(panel) {
    var status = panel.querySelector('[data-status]');
    var btn = panel.querySelector('[data-save]');
    var body = { premium_onboarding: panel.querySelector('[data-enabled]').checked, welcome_message: panel.querySelector('[data-welcome]').value, open_channels: [], featured_channels: [], rules: [] };
    panel.querySelectorAll('.chan').forEach(function (row) {
      var id = Number(row.getAttribute('data-id'));
      var openBtn = row.querySelector('[data-set="open"]');
      if (openBtn && openBtn.getAttribute('aria-pressed') === 'true') body.open_channels.push(id);
      else if (row.querySelector('[data-feat]').checked) body.featured_channels.push(id);
    });
    panel.querySelectorAll('[data-rule]').forEach(function (i) { if (i.value.trim()) body.rules.push(i.value.trim()); });
    btn.disabled = true;
    status.className = 'status';
    status.textContent = 'Saving…';
    api('/config?slug=' + encodeURIComponent(slug()), { method: 'POST', body: JSON.stringify(body) })
      .then(function () { status.textContent = 'Onboarding saved.'; setTimeout(closeConfig, 700); })
      .catch(function (err) { status.className = 'status err'; status.textContent = err.message; })
      .then(function () { btn.disabled = false; });
  }

  /* ------------------------------------------------------------------ boot */

  function tick() {
    installMenu();
    update();
  }

  function start(a) {
    state.access = a || null;
    if (!state.access) return;
    if (previewing()) installFetchGuard();
    tick();
    document.addEventListener('sml:group-shell-ready', function () { setTimeout(tick, 0); });
    document.addEventListener('sml:group-context-change', function (e) {
      var d = (e && e.detail) || {};
      state.mode = d.mode || state.mode;
      state.channelId = Number(d.channelId) || 0;
      setTimeout(tick, 0);
    });
    /* The shell mounts asynchronously and re-renders its sidebar (every few seconds) and ⋮ menu: keep both in step. */
    var tries = 0;
    var timer = setInterval(function () { tick(); if (++tries > 40) clearInterval(timer); }, 500);
    if (window.MutationObserver) {
      var pending = false;
      new MutationObserver(function () {
        if (pending) return;
        pending = true;
        setTimeout(function () { pending = false; installMenu(); if (previewing() && shellActive()) { markLocked(); ensureJoinBar(); } }, 150);
      }).observe(document.body, { childList: true, subtree: true });
    }
  }

  var s = slug();
  if (!s) return;
  injectStyle();
  if (window.SML_ONBOARD_ACCESS !== undefined) {
    start(window.SML_ONBOARD_ACCESS);
  } else {
    api('/access?slug=' + encodeURIComponent(s)).then(start).catch(function () {});
  }
})();
