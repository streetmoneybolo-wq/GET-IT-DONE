/* DISCORD PHONE EDGES: inside the Discord mobile app the top and bottom strips of an Activity sit under Discord's own controls (the sheet header
   above, the call bar below) and never receive a tap, so anything the Academy put there was behind them: buttons that could not be pressed.
   Discord says it is the mobile app in the launch URL (platform=mobile). Then:
     - the page gets two edge sizes, --sml-inset-top and --sml-inset-bottom (48 px and 78 px by default, plus the device's safe areas), which the
       member can change in Settings if their phone's controls are taller or shorter (kept on the device);
     - every fixed-position element that is pinned near the bottom or the top edge (the bottom tabs, the sub-tabs, the floating buttons, banners,
       toasts, panels, and anything added later) is lifted or dropped by that much, found by a sweep, so no control can end up behind Discord's strips;
     - the page's own bottom padding grows by the same amount so the last line can always be scrolled into view.
   Nothing here runs outside the Discord mobile app. */
(() => {
  if (window.__smlDiscordEdges) return;
  const params = new URLSearchParams(location.search);
  const mobile = params.get('platform') === 'mobile' || (params.has('frame_id') && window.matchMedia('(max-width:720px)').matches && ('ontouchstart' in window));
  window.__smlDiscordEdges = 1;
  const KEY = 'sml-discord-edges';
  const DEFAULT = { top: 48, bottom: 78 };
  const clampEdge = (v, d) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(200, Math.max(0, n)) : d; };
  const read = () => { try { const j = JSON.parse(localStorage.getItem(KEY) || '{}'); return { top: clampEdge(j.top, DEFAULT.top), bottom: clampEdge(j.bottom, DEFAULT.bottom) }; } catch (_) { return Object.assign({}, DEFAULT); } };
  let edges = read();
  const root = document.documentElement;
  function apply() {
    root.style.setProperty('--sml-inset-top', 'calc(' + edges.top + 'px + env(safe-area-inset-top,0px))');
    root.style.setProperty('--sml-inset-bottom', 'calc(' + edges.bottom + 'px + env(safe-area-inset-bottom,0px))');
  }
  const api = { active: mobile, defaults: DEFAULT, get: () => Object.assign({}, edges), set(next) { edges = { top: clampEdge((next || {}).top == null ? edges.top : next.top, edges.top), bottom: clampEdge((next || {}).bottom == null ? edges.bottom : next.bottom, edges.bottom) }; try { localStorage.setItem(KEY, JSON.stringify(edges)); } catch (_) { /* private mode */ } apply(); sweep(); return api.get(); }, reset() { return api.set(DEFAULT); }, sweep: () => sweep() };
  window.smlDiscordEdges = api;
  if (!mobile) return;
  root.classList.add('academy-discord-mobile', 'sml-dm');
  apply();
  const style = document.createElement('style');
  style.id = 'academy-discord-edges';
  style.textContent = '.sml-dm-lift{margin-bottom:var(--sml-inset-bottom,0px)!important}.sml-dm-drop{margin-top:var(--sml-inset-top,0px)!important}'
    + 'html.sml-dm body{padding-bottom:calc(var(--sml-inset-bottom,0px) + 8px)}';
  document.head.appendChild(style);

  /* find the fixed elements pinned to an edge: not full-screen layers (those cover both edges on purpose) */
  function sweep() {
    if (!document.body) return;
    const H = window.innerHeight;
    const check = (el) => {
      if (!el || el.nodeType !== 1 || el.id === 'sml-tour' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' || cs.display === 'none') { el.classList.remove('sml-dm-lift', 'sml-dm-drop'); return; }
      const top = cs.top === 'auto' ? null : parseFloat(cs.top), bottom = cs.bottom === 'auto' ? null : parseFloat(cs.bottom);
      if (top != null && bottom != null && top < 2 && bottom < 2) { el.classList.remove('sml-dm-lift', 'sml-dm-drop'); return; } // a full-screen layer
      const lift = bottom != null && bottom < 200 && (top == null || bottom <= top);
      const drop = !lift && top != null && top < 60;
      el.classList.toggle('sml-dm-lift', lift); el.classList.toggle('sml-dm-drop', drop);
    };
    for (const el of document.body.children) check(el);
    for (const id of ['ms-nav', 'ms-sub', 'ms-more']) check(document.getElementById(id));
  }
  setInterval(sweep, 1200);
  if (typeof MutationObserver === 'function') new MutationObserver(() => { clearTimeout(sweep.t); sweep.t = setTimeout(sweep, 80); }).observe(document.body || document.documentElement, { childList: true });
  sweep();
})();
