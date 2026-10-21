/* First-use explainers for the Academy. The first time a member uses a tool (WALLS, SMC, DARK POOL, CHAIN, ...), a short coach
 * card says what it is, how to use it, the edge it gives and what to watch out for, and the Academy voice reads the same thing
 * aloud. Each tool is explained once per device; after that it stays out of the way.
 *
 * The logic, in short:
 *   - it fires on a REAL tap (isTrusted) on a tool, a phone chip, a guide row, or any new button in the toolbar, never for a
 *     tool the page switched on by itself (saved state, restore), and never while the guided tour, the intro video or another
 *     card is up (one card at a time; the others wait their turn, at most three);
 *   - a member who is tapping through tools quickly gets the short card (what it is, your edge); the steps stay one tap away;
 *   - "Try next" chips offer only the related tools they have not met yet, and only the ones that are on screen;
 *   - unknown buttons (a tool added later with no entry in academy/tour-content.js) still get a card, built from their own
 *     label and tooltip, so a new module is never silent;
 *   - TIPS in the tool rail (or "Turn off tool tips" on the card) switches it off; replaying the tour switches it back on.
 * The words live in academy/tour-content.js (injected as window.__smlTourCatalog); the voice is window.smlTourVoice. */
(() => {
  if (window.__smlAutoTour) return;
  const CAT = window.__smlTourCatalog;
  if (!CAT || !CAT.tools) return;
  if (new URLSearchParams(location.search).has('popout')) return;
  window.__smlAutoTour = 1;
  const TOOLS = CAT.tools;
  const SEEN_KEY = 'sml-academy-explained-v1', PREF_KEY = 'sml-academy-explain';
  const $ = (s) => document.querySelector(s);
  const byId = (id) => document.getElementById(id);
  const PHONE = () => window.matchMedia('(max-width:720px)').matches;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* blocked storage: tips then show once per page load, never twice */ } },
    del(k) { try { localStorage.removeItem(k); } catch (_) { /* ignore */ } }
  };
  let seen = new Set();
  try { seen = new Set(JSON.parse(store.get(SEEN_KEY) || '[]')); } catch (_) { seen = new Set(); }
  const saveSeen = () => store.set(SEEN_KEY, JSON.stringify([...seen].slice(-200)));
  const enabled = () => store.get(PREF_KEY) !== 'off';
  let snoozed = false;

  /* phone chips -> the tool they switch on (academy-mobile-shell.js SUBS) */
  const SUBMAP = { walls: 'depth-walls', cost: 'depth-cost', heat: 'heat-toggle', smc: 'smc-toggle', intent: 'intent-btn', targets: 'targets-toggle', buysell: 'buysell-toggle', dark: 'darkpool-toggle', short: 'shortsale-toggle', sent: 'sentiment-toggle', squeeze: 'squeeze-btn', chain: 'chain-toggle', mem: 'mem-algo-toggle', sire: 'sire-toggle', earn: 'earnings-toggle', cat: 'catalysts-toggle', paper: 'paper-toggle', chal: 'challenge-toggle', comments: 'talk-btn' };
  const SKIP_IDS = new Set(['tool-guide-btn', 'tool-quote-btn', 'tour-btn', 'explain-btn', 'tool-quote-close']);

  const css = '#sml-ex{position:fixed;z-index:2147483200;left:14px;bottom:14px;width:min(350px,calc(100vw - 24px));max-height:calc(100dvh - 90px);overflow:auto;padding:14px 14px 12px;border:1px solid #2b5362;border-radius:14px;background:#0a1620;color:#dcebf2;font:500 13px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;box-shadow:0 18px 50px rgba(0,0,0,.65);animation:ex-in .18s ease-out}'
    + '@keyframes ex-in{from{transform:translateY(10px);opacity:0}to{transform:none;opacity:1}}'
    + '#sml-ex .ex-h{display:flex;align-items:center;gap:8px;margin:0 0 8px}#sml-ex .ex-k{flex:none;padding:2px 6px;border-radius:5px;background:#12303b;color:#00e29a;font:800 .56rem ui-monospace,monospace;letter-spacing:.1em}'
    + '#sml-ex h3{flex:1;margin:0;font-size:1rem;line-height:1.2;color:#fff}'
    + '#sml-ex button{border:1px solid #2b5362;border-radius:8px;background:#10222d;color:#dcebf2;padding:7px 11px;font:800 .72rem system-ui,sans-serif;cursor:pointer}'
    + '#sml-ex button.ex-go{background:#00c47d;border-color:#00c47d;color:#04140d}#sml-ex button.ex-quiet{border-color:transparent;background:none;color:#8fa6b3;padding:7px 4px;font-weight:600}'
    + '#sml-ex button.ex-vox{padding:5px 9px;min-width:34px}#sml-ex button.ex-x{border-color:transparent;background:none;color:#8fa6b3;padding:2px 6px;font-size:1.1rem;line-height:1}'
    + '#sml-ex .ex-l{margin:8px 0 2px;color:#5f8fa3;font:800 .56rem ui-monospace,monospace;letter-spacing:.12em}#sml-ex p{margin:0;color:#c9d9e1}'
    + '#sml-ex ol{margin:0;padding-left:19px;color:#c9d9e1}#sml-ex li{margin:2px 0}'
    + '#sml-ex .ex-edge{margin-top:8px;padding:8px 10px;border-radius:9px;background:rgba(0,226,154,.08);border:1px solid rgba(0,226,154,.22);color:#c8f5e3}'
    + '#sml-ex .ex-watch{margin-top:8px;color:#e6c98a;font-size:12px}'
    + '#sml-ex details summary{cursor:pointer;color:#9ed3e6;font-weight:700;margin-top:8px;list-style:none}#sml-ex details summary::-webkit-details-marker{display:none}'
    + '#sml-ex .ex-next{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:10px}#sml-ex .ex-next span{color:#8fa6b3;font-size:12px}'
    + '#sml-ex .ex-f{display:flex;align-items:center;gap:8px;margin-top:10px}#sml-ex .ex-sp{flex:1}'
    + '.sml-ex-ring{outline:2px solid #00e29a!important;outline-offset:3px;animation:ex-pulse 1.4s ease-in-out infinite}'
    + '@keyframes ex-pulse{0%,100%{outline-color:#00e29a}50%{outline-color:rgba(0,226,154,.25)}}'
    + '#explain-btn{flex:none;padding:4px 8px;border:1px solid #2b5362;border-radius:7px;background:#0d1a24;color:#9ed3e6;font:800 .6rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}#explain-btn[data-on="0"]{color:#6f8794;text-decoration:line-through}'
    + '@media(max-width:720px){#sml-ex{left:8px;right:8px;width:auto;bottom:calc(var(--ms-nav-h,54px) + var(--ms-sub-h,0px) + env(safe-area-inset-bottom,0px) + 8px);max-height:48dvh}}'
    + '@media(prefers-reduced-motion:reduce){#sml-ex,.sml-ex-ring{animation:none}}';
  const style = document.createElement('style'); style.id = 'academy-auto-tour-css'; style.textContent = css; document.head.appendChild(style);

  const voice = () => window.smlTourVoice || null;
  const visible = (el) => { if (!el) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 4 && r.height > 4 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const tourUp = () => !!(window.smlTour && window.smlTour.running && window.smlTour.running());
  const introUp = () => { const n = byId('academy-intro'); return !!n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().height > 0; };

  let card = null, current = null, ringEl = null, closeTimer = 0, queue = [], shownAt = [];

  function ring(el) { unring(); if (el) { el.classList.add('sml-ex-ring'); ringEl = el; } }
  function unring() { if (ringEl) { ringEl.classList.remove('sml-ex-ring'); ringEl = null; } }
  function close(why) {
    clearTimeout(closeTimer); unring();
    const v = voice(); if (v) v.stop();
    if (card) { card.remove(); card = null; }
    const was = current; current = null;
    if (why === 'off') { queue = []; return; }
    if (queue.length) setTimeout(() => { if (!card && !tourUp()) show(queue.shift()); }, 700);
    return was;
  }
  function armClose(ms) { clearTimeout(closeTimer); closeTimer = setTimeout(() => { if (card && !card.matches(':hover') && !card.contains(document.activeElement)) close(); else armClose(8000); }, ms); }

  /* the card's content for a request {key, id, el}: a catalog entry, or one built from the button's own label and tooltip */
  function entryFor(req) {
    const t = TOOLS[req.id];
    if (t) return Object.assign({ voiced: true }, t);
    const el = req.el, label = (el && (el.getAttribute('aria-label') || el.textContent) || '').trim().replace(/\s+/g, ' ').slice(0, 28), tip = el && (el.getAttribute('title') || '').trim();
    if (!label || !tip) return null;
    return { name: label.toUpperCase(), group: 'NEW', what: tip.replace(/\s*\(owner\)\s*$/i, ''), use: [], edge: '', watch: '', pairs: [], voiced: false };
  }

  function chips(t) {
    return (t.pairs || []).filter((id) => !seen.has(id) && TOOLS[id] && visible(byId(id))).slice(0, 2)
      .map((id) => '<button type="button" data-next="' + esc(id) + '">' + esc(TOOLS[id].name) + '</button>').join('');
  }

  function show(req, force) {
    if (!req || card || tourUp() || introUp() || (!force && (!enabled() || snoozed))) return;
    const t = entryFor(req); if (!t) return;
    seen.add(req.key); saveSeen();
    const now = Date.now(); shownAt = shownAt.filter((x) => now - x < 60000); shownAt.push(now);
    const quick = PHONE() || shownAt.length >= 3;
    current = req;
    card = document.createElement('aside'); card.id = 'sml-ex'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'About ' + t.name);
    const steps = (t.use || []).length ? '<ol>' + t.use.map((u) => '<li>' + esc(u) + '</li>').join('') + '</ol>' : '';
    const detail = steps || t.watch
      ? '<details' + (quick ? '' : ' open') + '><summary>How to use it</summary>' + (steps ? steps : '') + (t.watch ? '<div class="ex-watch">Watch out: ' + esc(t.watch) + '</div>' : '') + '</details>' : '';
    const nx = chips(t);
    card.innerHTML = '<div class="ex-h"><span class="ex-k">' + esc(t.group || 'TOOL') + '</span><h3>' + esc(t.name) + '</h3>'
      + (t.voiced && voice() ? '<button type="button" class="ex-vox" data-a="vox" aria-label="Voice on or off" title="Hear this in the Academy voice"></button>' : '')
      + '<button type="button" class="ex-x" data-a="close" aria-label="Close">×</button></div>'
      + '<div class="ex-l">WHAT IT IS</div><p>' + esc(t.what) + '</p>'
      + (t.edge ? '<div class="ex-edge"><b>Your edge: </b>' + esc(t.edge) + '</div>' : '')
      + detail
      + (nx ? '<div class="ex-next"><span>Try next:</span>' + nx + '</div>' : '')
      + '<div class="ex-f"><button type="button" class="ex-quiet" data-a="off">Turn off tool tips</button><span class="ex-sp"></span><button type="button" class="ex-go" data-a="close">Got it</button></div>';
    document.body.appendChild(card);
    card.addEventListener('click', onCardClick);
    ring(req.el && visible(req.el) && (!window.smlExposed || window.smlExposed(req.el)) ? req.el : null);
    armClose(45000);
    const v = voice();
    if (t.voiced && v) {
      voxPaint(v.muted() || !v.available() ? 'off' : 'playing');
      const mine = card;
      v.play('tool', req.id, { onend: () => { if (card === mine) armClose(15000); } }).then((state) => { if (card === mine) voxPaint(state); });
      if (!quick) (t.pairs || []).slice(0, 1).forEach((id) => { if (!seen.has(id)) v.preload('tool', id); });
    }
  }
  function voxPaint(state) { const b = card && card.querySelector('.ex-vox'); if (!b) return; b.dataset.s = state; b.textContent = state === 'playing' ? '🔊' : state === 'blocked' ? '▶' : '🔇'; }
  function onCardClick(e) {
    const b = e.target.closest && e.target.closest('button'); if (!b) return;
    if (b.dataset.next) { const el = byId(b.dataset.next); close(); if (el) { try { el.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (_) { /* ignore */ } ring(!window.smlExposed || window.smlExposed(el) ? el : null); setTimeout(() => { if (ringEl === el) unring(); }, 6000); } return; }
    const a = b.dataset.a;
    if (a === 'close') close();
    else if (a === 'off') { setEnabled(false); close('off'); }
    else if (a === 'vox') {
      const v = voice(); if (!v || !current) return;
      if (b.dataset.s === 'playing') { v.setMuted(true); voxPaint('off'); return; }
      v.setMuted(false); voxPaint('playing');
      const mine = card; v.play('tool', current.id, { force: true, onend: () => { if (card === mine) armClose(15000); } }).then((s) => { if (card === mine) voxPaint(s); });
    }
  }

  /* which tool a tap belongs to, or null */
  function requestFor(target) {
    if (!target || !target.closest) return null;
    const sub = target.closest('#ms-sub button[data-sub]'); if (sub) { const id = SUBMAP[sub.dataset.sub]; return id ? { key: id, id, el: byId(id) && visible(byId(id)) ? byId(id) : sub } : null; }
    const px = target.closest('#ms-nav button[data-proxy]'); if (px && TOOLS[px.dataset.proxy]) return { key: px.dataset.proxy, id: px.dataset.proxy, el: px };
    const row = target.closest('#tool-guide [data-tool]'); if (row && TOOLS[row.dataset.tool]) return { key: row.dataset.tool, id: row.dataset.tool, el: byId(row.dataset.tool) };
    for (let n = target, k = 0; n && k < 4; n = n.parentElement, k += 1) {
      if (n.id && SKIP_IDS.has(n.id)) return null;
      if (n.id && TOOLS[n.id]) return { key: n.id, id: n.id, el: n };
    }
    const b = target.closest('#tool-rail .row button, .toolbar > button'); if (b && b.id && !SKIP_IDS.has(b.id) && !TOOLS[b.id]) return { key: 'x:' + b.id, id: b.id, el: b };
    return null;
  }
  function onTap(e) {
    if (!e.isTrusted || !enabled() || snoozed) return;
    if (e.target && e.target.closest && e.target.closest('#sml-ex,#sml-tour')) return;
    const req = requestFor(e.target); if (!req || seen.has(req.key)) return;
    if (card || tourUp() || introUp()) { if (!tourUp() && !introUp() && queue.length < 3 && !queue.some((q) => q.key === req.key) && (!current || current.key !== req.key)) queue.push(req); return; }
    /* let the tool open first, so the card never covers what the tap just did */
    setTimeout(() => show(req), 450);
  }
  document.addEventListener('click', onTap, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && card) close(); });

  function setEnabled(on) { if (on) store.del(PREF_KEY); else store.set(PREF_KEY, 'off'); paintBtn(); }
  function reset() { seen = new Set(); store.del(SEEN_KEY); store.del(PREF_KEY); snoozed = false; paintBtn(); }
  function paintBtn() { const b = byId('explain-btn'); if (!b) return; const on = enabled(); b.dataset.on = on ? '1' : '0'; b.title = on ? 'Tool tips are ON: the first time you use a tool it is explained. Click to turn them off.' : 'Tool tips are OFF. Click to turn them on again.'; b.textContent = 'TIPS'; }
  function addButton() {
    const tail = $('#tool-rail .tail'); if (!tail) return false; if (byId('explain-btn')) return true;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'explain-btn';
    b.addEventListener('click', () => { setEnabled(!enabled()); if (!enabled()) close('off'); }); tail.insertBefore(b, tail.firstChild); paintBtn(); return true;
  }
  (function arm(n) { if (!addButton() && n < 60) setTimeout(() => arm(n + 1), 1000); })(0);

  window.smlAutoTour = {
    enabled, setEnabled, reset,
    seen: (id) => seen.has(id),
    /* replay any tool's card on demand (the tour calls this on a fresh start; also handy from the console) */
    explain: (id) => { const req = { key: id, id, el: byId(id) }; if (!TOOLS[id]) return false; if (card) close(); show(req, true); return true; }
  };
})();
