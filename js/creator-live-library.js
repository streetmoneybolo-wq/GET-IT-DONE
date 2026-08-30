/* SML Creator Studio — scheduled/live library.
 * Adds the creator's real upcoming streams and replay-ready recordings to the
 * existing #creator-dashboard without replacing the studio or inventing data.
 */
(function () {
  'use strict';
  if (window.__smlCreatorLiveLibrary) return;
  window.__smlCreatorLiveLibrary = true;

  var API = '/wp-json/sml-scheduled-live/v1/creator';
  var STYLE_ID = 'sml-creator-live-library-css';

  function esc(value) {
    var node = document.createElement('div');
    node.textContent = String(value == null ? '' : value);
    return node.innerHTML;
  }
  function safeImage(value) { return /^https:\/\//i.test(String(value || '')) ? String(value) : ''; }
  function when(value) {
    var at = Date.parse(value || '');
    return isFinite(at) ? new Date(at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Start time unavailable';
  }
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = '.cs-live-library{margin:0 0 18px}.cs-live-library .cs-dash-panel-head{margin-bottom:12px}.cs-live-library-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}.cs-live-library-card{display:grid;grid-template-columns:118px minmax(0,1fr);gap:13px;align-items:center;padding:12px;border:1px solid #1b2a3c;background:#0d1724;border-radius:12px;color:inherit;text-decoration:none}.cs-live-library-thumb{aspect-ratio:16/9;border-radius:8px;background:#101b2a center/cover no-repeat;border:1px solid #203047;display:grid;place-items:center;color:#60758d;font-size:10px}.cs-live-library-copy{grid-column:1/-1;display:flex;gap:8px;align-items:center}.cs-live-library-copy input{min-width:0;flex:1;height:34px;border:1px solid #223146;border-radius:7px;background:#07101b;color:#9fb4c9;padding:0 9px;font-size:11px}.cs-live-library-copy button{height:34px;border:1px solid #2b6cff;border-radius:7px;background:#2b6cff;color:#fff;font-size:11px;font-weight:800;padding:0 11px;cursor:pointer}.cs-live-library-card b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cs-live-library-card small{display:block;color:#71859b;font-size:11.5px;margin-top:5px}.cs-live-library-badge{display:inline-flex;margin-top:7px;padding:3px 7px;border-radius:999px;background:rgba(43,108,255,.13);color:#72a8ff;font-size:9px;font-weight:800;letter-spacing:.5px;text-transform:uppercase}@media(max-width:640px){.cs-live-library-card{grid-template-columns:92px minmax(0,1fr)}}';
    document.head.appendChild(style);
  }
  function card(row, replay) {
    var image = safeImage(row.thumbnail_url);
    var url = replay && row.recording_url ? row.recording_url : row.watch_url;
    return '<article class="cs-live-library-card">'
      + '<a class="cs-live-library-thumb" href="' + esc(url) + '"' + (image ? ' style="background-image:url(&quot;' + esc(image) + '&quot;)"' : '') + '>' + (image ? '' : 'No thumbnail') + '</a>'
      + '<div><a href="' + esc(url) + '"><b>' + esc(row.title || 'Untitled stream') + '</b></a><small>' + esc(when(row.scheduled_at)) + '</small><span class="cs-live-library-badge">' + esc(replay ? 'Replay ready' : 'Upcoming live') + '</span></div>'
      + '<div class="cs-live-library-copy"><input readonly value="' + esc(url) + '" aria-label="Stream link"><button type="button" data-copy-stream="' + esc(url) + '">Copy link</button></div>'
      + '</article>';
  }
  function render(root, payload) {
    var old = root.querySelector('[data-cs-live-library]');
    if (old) old.remove();
    var rows = Array.isArray(payload && payload.streams) ? payload.streams : [];
    // A future-dated stream must keep showing as "Upcoming" even if its status
    // wobbles off 'scheduled' — e.g. the backend flips it to live/open when the
    // creator opens the Watch Page early. Show every scheduled stream, plus any
    // not-yet-ended stream whose start time is still ahead; only ended /
    // cancelled ones drop off (cancelled never reach the client anyway).
    var nowMs = Date.now();
    var upcoming = rows.filter(function (row) {
      if (!row || row.status === 'ended' || row.status === 'cancelled') return false;
      if (row.status === 'scheduled') return true;
      var startMs = Date.parse(row.scheduled_at || '');
      return isFinite(startMs) && startMs > nowMs;
    });
    var replays = rows.filter(function (row) { return row && row.recording_status === 'ready' && row.recording_url; });
    var section = document.createElement('section');
    section.className = 'cs-dash-panel cs-live-library';
    section.setAttribute('data-cs-live-library', '');
    section.innerHTML = '<div class="cs-dash-panel-head"><h2>Upcoming live streams</h2><a href="/go-live/">Schedule another</a></div>'
      + (upcoming.length ? '<div class="cs-live-library-list">' + upcoming.map(function (row) { return card(row, false); }).join('') + '</div>' : '<div class="cs-dash-empty">No upcoming stream is scheduled yet.</div>')
      + (replays.length ? '<div class="cs-dash-panel-head" style="margin-top:18px"><h2>Saved live replays</h2><span>Recorded streams</span></div><div class="cs-live-library-list">' + replays.map(function (row) { return card(row, true); }).join('') + '</div>' : '');
    var grid = root.querySelector('.cs-dash-grid');
    root.insertBefore(section, grid || root.lastChild);
  }
  function load(root) {
    if (!root || root.dataset.liveLibraryLoading === '1') return;
    root.dataset.liveLibraryLoading = '1';
    fetch(API, { credentials: 'same-origin', cache: 'no-store', headers: window.smlCreatorDashboardConfig && window.smlCreatorDashboardConfig.nonce ? { 'X-WP-Nonce': window.smlCreatorDashboardConfig.nonce } : {} })
      .then(function (response) { return response.ok ? response.json() : Promise.reject(new Error('unavailable')); })
      .then(function (payload) { render(root, payload); })
      .catch(function () { /* fail closed: keep the existing dashboard untouched */ })
      .then(function () { root.dataset.liveLibraryLoading = '0'; });
  }
  function boot() {
    injectStyle();
    var root = document.getElementById('cs-dashboard');
    if (root) load(root);
  }
  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-copy-stream]');
    if (!button) return;
    var url = button.getAttribute('data-copy-stream') || '';
    if (!url || !navigator.clipboard) return;
    navigator.clipboard.writeText(url).then(function () {
      button.textContent = 'Copied';
      window.setTimeout(function () { button.textContent = 'Copy link'; }, 1800);
    });
  });
  new MutationObserver(boot).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
