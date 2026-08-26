/*!
 * SML Stream Countdown — the owner's flip-clock countdown embed, wired to the
 * REAL scheduling API (sml-scheduled-live/v1/creator/{handle}).
 *
 * Design ported verbatim: flip digits, 30/15/5-minute reminder milestones with
 * browser notifications + toasts (localStorage-persisted per target), the
 * sub-60s alert state, and the zero-second reveal. One functional delta: the
 * design's play-button hook navigates to the stream's real watch_url.
 *
 * Mounts as a hero band (the stream's own thumbnail as backdrop + its real
 * title) on /channel/{handle}/ and /live/?room={handle} pages — ONLY when the
 * API says a public stream is genuinely scheduled in the future. No schedule,
 * no render; nothing is ever counted down to an invented time. Scheduled
 * VIDEO premieres join when an API for them exists — same module, second
 * fetch.
 */
(function () {
  'use strict';
  if (window.__smlCountdownBooted) return;
  window.__smlCountdownBooted = true;

  var CSS = ".sml-countdown{--sml-c:#45e0ff;--sml-alert:#ff4553;display:flex;flex-direction:column;align-items:center;gap:26px;font-family:'Space Grotesk',sans-serif;user-select:none}\n.sml-kicker{font-size:13px;font-weight:500;letter-spacing:7px;color:rgba(255,255,255,.72)}\n.sml-countdown.sml-alert .sml-kicker{color:var(--sml-alert)}\n.sml-groups{display:flex;gap:30px;align-items:flex-start;animation:smlJitter 7s linear infinite}\n.sml-group{display:flex;flex-direction:column;align-items:center;gap:12px}\n.sml-digits{display:flex;gap:6px}\n.sml-label{font-size:11px;font-weight:700;letter-spacing:4px;color:rgba(255,255,255,.55)}\n.sml-digit{position:relative;width:74px;height:108px;perspective:340px;animation:smlPulse 1.7s ease-in-out infinite}\n.sml-countdown.sml-alert .sml-digit{animation-duration:.5s}\n.sml-digit .sml-half{position:absolute;left:0;right:0;height:50%;overflow:hidden;backface-visibility:hidden}\n.sml-digit .sml-top{top:0}.sml-digit .sml-bot{top:50%}\n.sml-digit i{position:absolute;left:0;right:0;height:108px;font:600 80px/108px 'Oswald',sans-serif;font-style:normal;text-align:center;color:var(--sml-c);text-shadow:0 0 14px var(--sml-c),0 0 44px rgba(69,224,255,.35)}\n.sml-countdown.sml-alert .sml-digit i{color:var(--sml-alert);text-shadow:0 0 14px var(--sml-alert),0 0 44px rgba(255,69,83,.35)}\n.sml-digit .sml-bot i{top:-54px}\n.sml-digit .sml-flap-top{z-index:2;transform-origin:bottom;animation:smlFlipTop .26s ease-in forwards}\n.sml-digit .sml-flap-bot{z-index:2;transform-origin:top;transform:rotateX(90deg);animation:smlFlipBot .26s .26s ease-out forwards}\n.sml-notify{cursor:pointer;margin-top:4px;padding:13px 30px;border:1px solid rgba(69,224,255,.6);border-radius:3px;background:rgba(5,13,17,.6);backdrop-filter:blur(6px);color:var(--sml-c);font:700 12px 'Space Grotesk',sans-serif;letter-spacing:3px;transition:background .2s,color .2s}\n.sml-notify:hover{background:var(--sml-c);color:#04121a}\n.sml-toasts{position:fixed;top:18px;right:20px;display:flex;flex-direction:column;align-items:flex-end;gap:10px;z-index:9999;pointer-events:none}\n.sml-toast{display:flex;align-items:center;gap:10px;background:rgba(6,14,18,.92);border:1px solid rgba(69,224,255,.5);border-radius:4px;padding:11px 16px;box-shadow:0 8px 30px rgba(0,0,0,.6),0 0 20px rgba(69,224,255,.15);font:500 12px 'Space Grotesk',sans-serif;letter-spacing:.5px;color:#d9f7ff;animation:smlToastIn .35s cubic-bezier(.2,1,.4,1) both}\n.sml-toast::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--sml-c,#45e0ff);box-shadow:0 0 8px #45e0ff}\n.sml-reveal{display:flex;flex-direction:column;align-items:center;gap:34px}\n.sml-ringwrap{position:relative;width:150px;height:150px;display:flex;align-items:center;justify-content:center}\n.sml-ring{position:absolute;inset:0;border:2px solid var(--sml-c);border-radius:50%;animation:smlRing 1s ease-out forwards}\n.sml-ring2{position:absolute;inset:0;border:1px solid rgba(69,224,255,.6);border-radius:50%;opacity:0;animation:smlRing 1.2s .18s ease-out forwards}\n.sml-play{cursor:pointer;width:126px;height:126px;border-radius:50%;border:none;background:var(--sml-c);box-shadow:0 0 60px rgba(69,224,255,.7);display:flex;align-items:center;justify-content:center;animation:smlPop .6s cubic-bezier(.2,1.4,.4,1) both}\n.sml-play:hover{background:#8fecff}\n.sml-play::after{content:'';width:0;height:0;border-left:36px solid #04121a;border-top:22px solid transparent;border-bottom:22px solid transparent;margin-left:9px}\n.sml-started{font:600 28px 'Oswald',sans-serif;letter-spacing:10px;color:#fff;text-shadow:0 0 24px rgba(69,224,255,.9);animation:smlFadeUp .6s .35s both}\n@keyframes smlFlipTop{from{transform:rotateX(0)}to{transform:rotateX(-90deg)}}\n@keyframes smlFlipBot{from{transform:rotateX(90deg)}to{transform:rotateX(0)}}\n@keyframes smlPulse{0%,100%{filter:brightness(1)}50%{filter:brightness(1.28)}}\n@keyframes smlJitter{0%,93%{transform:none}94%{transform:translate(-3px,1px) skewX(1.5deg)}95%{transform:translate(2px,-1px)}96%{transform:translate(-1px,0) skewX(-1deg)}97%,100%{transform:none}}\n@keyframes smlToastIn{from{opacity:0;transform:translateX(26px)}to{opacity:1;transform:none}}\n@keyframes smlRing{from{transform:scale(.3);opacity:.9}to{transform:scale(1.9);opacity:0}}\n@keyframes smlPop{from{transform:scale(.2);opacity:0}to{transform:scale(1);opacity:1}}\n@keyframes smlFadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}";

  function handleFromUrl() {
    var m = location.pathname.match(/^\/channel\/([A-Za-z0-9_-]{1,40})\/?$/);
    if (m) return m[1];
    if (/^\/live\/?$/.test(location.pathname)) {
      try { var r = new URLSearchParams(location.search).get('room'); if (r && /^[A-Za-z0-9_-]{1,40}$/.test(r)) return r; } catch (e) {}
    }
    return (typeof window.SML_CD_HANDLE === 'string' && window.SML_CD_HANDLE) || null;
  }

  var HANDLE = handleFromUrl();
  if (!HANDLE) return;

  function schedFor(handle) {
    return fetch('/wp-json/sml-scheduled-live/v1/creator/' + encodeURIComponent(handle), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; });
  }
  schedFor(HANDLE)
    .then(function (d) {
      if (d) return d;
      // /channel/{handle}/ uses the CHANNEL handle, but the schedule API is
      // keyed by the owner's PROFILE handle (verified live: grandmasterobi
      // answers, making_easy_money 404s) — resolve via the channel data API
      if (!/^\/channel\//.test(location.pathname)) return null;
      return fetch('/wp-json/sml-channel/v1/channel/' + encodeURIComponent(HANDLE), { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (ch) {
          var ph = ch && ch.creator && ch.creator.profile_handle ? String(ch.creator.profile_handle).replace(/^@/, '') : '';
          return ph ? schedFor(ph) : null;
        });
    })
    .then(function (d) {
      if (!d || 'scheduled' !== d.status || !d.scheduled_at || 'public' !== (d.visibility || 'public')) return;
      var t = Date.parse(d.scheduled_at);
      // fail closed: no real target, or the slot is long past (stale schedule) -> nothing
      if (isNaN(t) || t - Date.now() < -60 * 60 * 1000) return;
      mount(d);
    })
    .catch(function () {});

  function mount(d) {
    if (document.getElementById('sml-cdwn-hero')) return;
    window.__SML_CD_WATCH = d.watch_url || null;

    var style = document.createElement('style');
    style.id = 'sml-cdwn-css';
    style.textContent = CSS + '\n#sml-cdwn-hero{position:relative;overflow:hidden;padding:64px 20px 58px;display:flex;flex-direction:column;align-items:center;gap:26px;background:#05080a;}\n#sml-cdwn-hero .cdwn-bg{position:absolute;inset:0;background-size:cover;background-position:center;filter:brightness(0.32) saturate(0.9);}\n#sml-cdwn-hero .cdwn-in{position:relative;display:flex;flex-direction:column;align-items:center;gap:22px;max-width:900px;text-align:center;}\n#sml-cdwn-hero .cdwn-title{font:700 26px/1.3 "Space Grotesk",sans-serif;color:#fff;text-shadow:0 2px 18px rgba(0,0,0,0.7);}\n#sml-cdwn-hero .cdwn-by{font:500 12px "Space Grotesk",sans-serif;letter-spacing:3px;color:rgba(255,255,255,0.6);}\n@media(max-width:640px){#sml-cdwn-hero .sml-digit{width:44px;height:66px;perspective:220px}#sml-cdwn-hero .sml-digit i{font-size:48px;line-height:66px;height:66px}#sml-cdwn-hero .sml-digit .sml-bot i{top:-33px}#sml-cdwn-hero .cdwn-title{font-size:19px}}';
    document.head.appendChild(style);

    if (!document.querySelector('link[href*="Space+Grotesk"]')) {
      var f = document.createElement('link');
      f.rel = 'stylesheet';
      f.href = 'https://fonts.googleapis.com/css2?family=Oswald:wght@600&family=Space+Grotesk:wght@500;700&display=swap';
      document.head.appendChild(f);
    }

    var hero = document.createElement('section');
    hero.id = 'sml-cdwn-hero';
    var bg = document.createElement('div');
    bg.className = 'cdwn-bg';
    if (d.thumbnail_url) bg.style.backgroundImage = 'url("' + String(d.thumbnail_url).replace(/"/g, '') + '")';
    hero.appendChild(bg);
    var inner = document.createElement('div');
    inner.className = 'cdwn-in';
    if (d.title) { var ti = document.createElement('div'); ti.className = 'cdwn-title'; ti.textContent = d.title; inner.appendChild(ti); }
    var by = document.createElement('div');
    by.className = 'cdwn-by';
    by.textContent = (d.creator && d.creator.name ? d.creator.name.toUpperCase() + ' · ' : '') + 'SCHEDULED LIVE STREAM';
    inner.appendChild(by);
    var mountEl = document.createElement('div');
    mountEl.className = 'sml-countdown';
    mountEl.setAttribute('data-target', d.scheduled_at);
    inner.appendChild(mountEl);
    hero.appendChild(inner);

    // Host preference: the /live/ watch takeover hides every body child
    // outside #sml-lw-root (verified live — a body-level hero computes
    // display:none there), so inside the root is the ONLY visible slot on
    // watch pages. Channel/other pages: after the site header.
    var lwRoot = document.getElementById('sml-lw-root');
    var header = document.querySelector('header');
    if (lwRoot) lwRoot.insertBefore(hero, lwRoot.firstChild);
    else if (header && header.parentNode) header.parentNode.insertBefore(hero, header.nextSibling);
    else document.body.insertBefore(hero, document.body.firstChild);

    engine();

    // the takeover can boot well AFTER us and hide a body-mounted hero — keep
    // watching for its root for a full two minutes (measured live: the root
    // can appear 15s+ into a heavy watch-page load) and relocate when it does
    var tries = 0;
    var rt = setInterval(function () {
      var h = document.getElementById('sml-cdwn-hero');
      if (!h) { clearInterval(rt); return; }
      var root2 = document.getElementById('sml-lw-root');
      if (root2 && h.parentNode !== root2 && 'none' === getComputedStyle(h).display) root2.insertBefore(h, root2.firstChild);
      else if (root2 && h.parentNode === root2 && 'none' !== getComputedStyle(h).display) { clearInterval(rt); return; }
      if (++tries > 120) clearInterval(rt);
    }, 1000);
  }

  function engine() {
  var MILESTONES = [
        { id: 'm30', off: -1800, msg: 'Stream starts in 30 minutes' },
        { id: 'm15', off: -900, msg: 'Stream starts in 15 minutes' },
        { id: 'm5', off: -300, msg: 'Stream starts in 5 minutes' },
        { id: 'start', off: 0, msg: 'The live stream has started', watch: true },
        { id: 'live5', off: 300, msg: 'The stream is LIVE NOW — join in', watch: true }
      ];
      function el(tag, cls, parent) { var e = document.createElement(tag); if (cls) e.className = cls; if (parent) parent.appendChild(e); return e; }
      var toastBox = null;
      function toast(msg) {
        if (!toastBox) { toastBox = el('div', 'sml-toasts', document.body); }
        var t = el('div', 'sml-toast', toastBox);
        t.textContent = msg;
        setTimeout(function () { t.remove(); }, 6000);
      }
      function notifySystem(msg) {
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try { new Notification('Stockmarketloop.com', { body: msg }); } catch (e) {}
        }
      }
      function initCountdown(root) {
        var raw = root.getAttribute('data-target') || 'demo';
        var target;
        if (raw === 'demo') target = Date.now() + (1 * 3600 + 58 * 60 + 47) * 1000;
        else if (raw.indexOf('demo-') === 0) target = Date.now() + parseInt(raw.slice(5), 10) * 1000;
        else { target = Date.parse(raw); if (isNaN(target)) target = Date.now() + 3600000; }
        var storeKey = 'sml-notify-' + target;
        var fired, notified;
        try { var s = JSON.parse(localStorage.getItem(storeKey) || 'null'); fired = s ? s.fired : null; } catch (e) { fired = null; }
        notified = !!fired; fired = fired || [];
        function persist() { try { localStorage.setItem(storeKey, JSON.stringify({ fired: fired })); } catch (e) {} }
  
        var kicker = el('div', 'sml-kicker', root); kicker.textContent = 'PREMIERES IN';
        var groupsBox = el('div', 'sml-groups', root);
        var btn = el('button', 'sml-notify', root);
        btn.textContent = notified ? 'REMINDERS ON' : 'NOTIFY ME';
        btn.addEventListener('click', function () {
          if (notified) {
            notified = false; fired = [];
            try { localStorage.removeItem(storeKey); } catch (e) {}
            btn.textContent = 'NOTIFY ME';
            return;
          }
          if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
            try { Notification.requestPermission(); } catch (e) {}
          }
          notified = true;
          fired = MILESTONES.filter(function (m) { return Date.now() >= target + m.off * 1000; }).map(function (m) { return m.id; });
          persist();
          btn.textContent = 'REMINDERS ON';
          toast('Reminders set — 30, 15 & 5 min before, plus when we go live');
        });
  
        var groups = []; // {label, cells:[{node, val}]}
        function buildGroups(defs) {
          groupsBox.innerHTML = ''; groups = [];
          defs.forEach(function (d) {
            var g = el('div', 'sml-group', groupsBox);
            var digits = el('div', 'sml-digits', g);
            var cells = d.val.split('').map(function (ch) {
              var cell = el('span', 'sml-digit', digits);
              cell.innerHTML = '<span class="sml-half sml-top"><i>' + ch + '</i></span><span class="sml-half sml-bot"><i>' + ch + '</i></span>';
              return { node: cell, val: ch };
            });
            var lab = el('div', 'sml-label', g); lab.textContent = d.label;
            groups.push({ label: d.label, cells: cells });
          });
        }
        function flipTo(cell, ch) {
          if (cell.val === ch) return;
          var old = cell.val; cell.val = ch;
          var node = cell.node;
          node.querySelectorAll('.sml-flap-top,.sml-flap-bot').forEach(function (f) { f.remove(); });
          node.querySelector('.sml-top i').textContent = ch;
          var ft = el('span', 'sml-half sml-top sml-flap-top', node); ft.innerHTML = '<i>' + old + '</i>';
          var fb = el('span', 'sml-half sml-bot sml-flap-bot', node); fb.innerHTML = '<i>' + ch + '</i>';
          fb.addEventListener('animationend', function () {
            node.querySelector('.sml-bot:not(.sml-flap-bot) i').textContent = ch;
            ft.remove(); fb.remove();
          });
        }
        var revealed = false;
        function reveal() {
          revealed = true;
          kicker.remove(); groupsBox.remove(); btn.remove();
          var r = el('div', 'sml-reveal', root);
          var rw = el('div', 'sml-ringwrap', r);
          el('div', 'sml-ring', rw); el('div', 'sml-ring2', rw);
          var play = el('button', 'sml-play', rw);
          play.addEventListener('click', function () { if (window.__SML_CD_WATCH) location.href = window.__SML_CD_WATCH; });
          var txt = el('div', 'sml-started', r); txt.textContent = 'STREAM STARTED';
        }
        function pad(n) { return String(n).padStart(2, '0'); }
        function tick() {
          var now = Date.now();
          // notifications
          if (notified) {
            MILESTONES.forEach(function (m) {
              if (fired.indexOf(m.id) !== -1 || now < target + m.off * 1000) return;
              fired.push(m.id); persist();
              if (m.watch && document.visibilityState === 'visible') return; // already watching
              toast(m.msg); notifySystem(m.msg);
            });
          }
          var rem = Math.max(0, Math.ceil((target - now) / 1000));
          if (rem <= 0) { if (!revealed) reveal(); return; }
          var d = Math.floor(rem / 86400), h = Math.floor(rem % 86400 / 3600), mi = Math.floor(rem % 3600 / 60), s = rem % 60;
          var defs = [];
          if (d > 0) defs.push({ label: 'DAYS', val: pad(d) });
          if (d > 0 || h > 0) defs.push({ label: 'HOURS', val: pad(h) });
          defs.push({ label: 'MINUTES', val: pad(mi) }, { label: 'SECONDS', val: pad(s) });
          if (defs.length !== groups.length) buildGroups(defs);
          else defs.forEach(function (df, i) {
            df.val.split('').forEach(function (ch, j) { flipTo(groups[i].cells[j], ch); });
          });
          var alert = rem <= 60 && rem > 0;
          root.classList.toggle('sml-alert', alert);
          kicker.textContent = alert ? 'STARTING ANY SECOND' : 'PREMIERES IN';
        }
        tick();
        var iv = setInterval(function () { tick(); if (revealed) clearInterval(iv); }, 200);
      }
      document.querySelectorAll('.sml-countdown').forEach(initCountdown);
  }
})();
