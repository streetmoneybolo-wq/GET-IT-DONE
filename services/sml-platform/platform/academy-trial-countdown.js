/* The free-trial countdown: a member on the 15-day Academy trial sees how long is left, all the time, in the top bar.
   The chip reads the real pass from the server (GET /academy-activity/trial-status, the same pass the access check uses),
   counts down locally every half minute and re-reads every ten minutes. Green with more than five days left, amber at five,
   red on the last day (hours), and "TRIAL ENDED" once it is over. Tapping it opens a small card with the end date and a
   See-my-options button that opens the plan picker (academy-plans-ui.js) right here in Discord: Trader, Analyst, and team
   seats for a member who runs their own server. The old behaviour - one button that threw the member out to a browser -
   is kept as the fallback for when no SKUs are configured or the Activity is not running inside Discord, so the card
   never ends up with a dead button. Members with a paid pass see nothing. */
(function boot(tries) {
  if (window.__smlTrialCountdown) return;
  const bar = document.querySelector('.bar');
  if (!bar) { if (tries < 100) setTimeout(() => boot(tries + 1), 200); return; }
  window.__smlTrialCountdown = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const token = () => String(window.smlAcademySessionToken || '');
  const openOut = (url) => { if (!url) return; if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url); else { try { window.open(url, '_blank', 'noopener'); } catch (_) { /* blocked */ } } };
  const S = { data: null, checked: '', timer: 0, tick: 0, open: false };
  /* the picker is a separate module and may not have loaded (or may have nothing to offer) */
  const canPick = () => Boolean(window.smlAcademyPlans && window.smlAcademyPlans.available());

  const css = document.createElement('style');
  css.textContent = '.academy-trial-chip{display:none;align-items:center;gap:6px;margin-left:4px;padding:4px 9px;border:1px solid #1f8a5f;border-radius:999px;background:#0b2219;color:#7dffc4;font:900 .62rem ui-monospace,monospace;letter-spacing:.05em;cursor:pointer;white-space:nowrap;line-height:1.2}.academy-trial-chip.show{display:inline-flex}'
    + '.academy-trial-chip.warn{border-color:#b07a1f;background:#2a1e07;color:#ffd27a}.academy-trial-chip.urgent{border-color:#a3253a;background:#2a0e14;color:#ff9fb0;animation:academyTrialPulse 1.6s ease-in-out infinite}.academy-trial-chip.ended{border-color:#a3253a;background:#3a0f1a;color:#ffb3c0}'
    + '.academy-trial-chip i{font-style:normal}.academy-trial-chip b{font-weight:900}@keyframes academyTrialPulse{50%{box-shadow:0 0 0 4px rgba(255,84,112,.18)}}'
    + '@media(max-width:720px){.academy-trial-chip{padding:3px 7px;font-size:.56rem}.academy-trial-chip .long{display:none}}'
    + '#academy-trial-card{position:fixed;z-index:2147483200;top:48px;right:12px;width:min(340px,calc(100vw - 24px));padding:12px 14px;border:1px solid #1f8a5f;border-radius:12px;background:#0b141c;color:#dbe6ec;font:500 .72rem/1.5 system-ui,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.6);display:none}#academy-trial-card.open{display:block}'
    + '#academy-trial-card h3{margin:0 0 4px;font:900 .8rem ui-monospace,monospace;letter-spacing:.06em;color:#7dffc4}#academy-trial-card.warn h3{color:#ffd27a}#academy-trial-card.urgent h3,#academy-trial-card.ended h3{color:#ff9fb0}'
    + '#academy-trial-card .big{font:900 1.5rem ui-monospace,monospace;color:#fff;margin:2px 0 6px}#academy-trial-card p{margin:0 0 8px;color:#b8c9d3}#academy-trial-card .row{display:flex;gap:6px;flex-wrap:wrap}'
    + '#academy-trial-card button{border:1px solid #2b5362;border-radius:7px;background:#10212b;color:#eaf5f8;font:800 .66rem system-ui;padding:7px 11px;cursor:pointer}#academy-trial-card button.keep{border-color:#00c47d;background:#092b23;color:#79efbd}#academy-trial-card small{display:block;margin-top:8px;color:#6f8794;font-size:.58rem}';
  document.head.appendChild(css);

  const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'academy-trial-chip'; chip.setAttribute('aria-live', 'polite');
  const status = bar.querySelector('#status'); if (status) bar.insertBefore(chip, status); else bar.appendChild(chip);
  const card = document.createElement('section'); card.id = 'academy-trial-card'; card.setAttribute('aria-label', 'Your free trial'); document.body.appendChild(card);

  const fmtDate = (iso) => { try { return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (_) { return String(iso || ''); } };
  function left(ms) {
    const s = Math.max(0, Math.floor(ms / 1000)), d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d >= 1) return { d, h, m, short: d + 'd ' + h + 'h', long: d + ' day' + (d === 1 ? '' : 's') + ' ' + h + ' hour' + (h === 1 ? '' : 's') };
    if (h >= 1) return { d, h, m, short: h + 'h ' + m + 'm', long: h + ' hour' + (h === 1 ? '' : 's') + ' ' + m + ' min' };
    return { d, h, m, short: m + 'm', long: m + ' minute' + (m === 1 ? '' : 's') };
  }
  function tone(ms, ended) { if (ended || ms <= 0) return 'ended'; if (ms <= 86400000) return 'urgent'; if (ms <= 5 * 86400000) return 'warn'; return ''; }
  function paint() {
    const d = S.data;
    if (!d || !d.ok || !d.trial) { chip.classList.remove('show'); card.classList.remove('open'); S.open = false; return; }
    const ends = d.endsAt ? new Date(d.endsAt).getTime() : 0, ms = ends ? ends - Date.now() : 0, ended = !d.active || ms <= 0, t = tone(ms, ended), L = left(ms);
    chip.className = 'academy-trial-chip show ' + t;
    chip.innerHTML = ended ? '<i>⏳</i><b>TRIAL ENDED</b><span class="long"> · keep access</span>' : '<i>⏳</i><b>FREE TRIAL</b> · ' + esc(L.short) + '<span class="long"> left</span>';
    chip.title = ended ? 'Your free trial has ended. Tap to keep your access.' : 'Your ' + (d.days || 15) + '-day free trial ends ' + fmtDate(d.endsAt) + '. Tap for details.';
    card.className = (S.open ? 'open ' : '') + t;
    card.innerHTML = '<h3>' + (ended ? 'YOUR FREE TRIAL HAS ENDED' : 'YOUR FREE TRIAL') + '</h3>'
      + (ended ? '<div class="big">0 days left</div><p>It ended ' + esc(fmtDate(d.endsAt)) + '. Keep the live chart lab, every lesson, the scanner, options, Level 2, the alerts desk and your profile by picking a plan.</p>'
        : '<div class="big">' + esc(L.long) + ' left</div><p>Ends ' + esc(fmtDate(d.endsAt)) + (d.startsAt ? ' · started ' + esc(fmtDate(d.startsAt)) : '') + '. Everything stays unlocked until then. Pick a plan any time and nothing changes on the day.</p>')
      + '<div class="row">' + (canPick() ? '<button type="button" class="keep" data-plans="1">See my options</button>' : (d.buyUrl ? '<button type="button" class="keep" data-keep="1">Keep my access</button>' : '')) + '<button type="button" data-close="1">' + (ended ? 'Later' : 'Got it') + '</button></div>'
      + '<small>The countdown reads the pass on your Discord account; it is the same pass the Academy checks on every open.</small>';
  }
  async function check() {
    const t = token(); if (!t) return;
    try {
      const res = await fetch('/academy-activity/trial-status', { headers: { authorization: 'Bearer ' + t }, cache: 'no-store' });
      const j = await res.json().catch(() => null);
      if (res.ok && j && j.ok) S.data = j; else if (res.status === 401) S.data = null;
    } catch (_) { /* keep what we have */ }
    paint();
  }
  chip.addEventListener('click', () => { S.open = !S.open; paint(); });
  card.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('[data-keep],[data-plans],[data-close]'); if (!t) return;
    if (t.dataset.plans) { S.open = false; paint(); window.smlAcademyPlans.open(S.data && S.data.buyUrl); return; }
    if (t.dataset.keep) { openOut(S.data && S.data.buyUrl); }
    S.open = false; paint();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.open) { S.open = false; paint(); } });
  window.addEventListener('sml-academy-session', () => { const t = token(); if (t !== S.checked) { S.checked = t; void check(); } });
  if (token()) { S.checked = token(); void check(); }
  S.tick = setInterval(paint, 30_000);
  S.timer = setInterval(() => { if (!document.hidden) void check(); }, 10 * 60_000);
  window.smlTrialCountdown = { check, state: () => S.data };
})(0);
