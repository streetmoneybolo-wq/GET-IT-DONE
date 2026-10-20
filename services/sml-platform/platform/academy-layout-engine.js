/* LAYOUT ENGINE: the page arranges itself around what has data.
   The audit of the Academy page found its dead space in a few places, the same on desktop and phone:
     - three one-line panels below the chart (Market Direction, Unusual Volume, SML VIX) each spanning the full width for
       one sentence: here they share one row on desktop (a grid of three) and sit tight on phones;
     - the Level 2 panel in the side column, which is a 400 to 600 px box saying "temporarily unavailable" outside market
       hours: when it is empty it collapses to its title line and the column is given to TOP OF THE SCANNER, the live
       scanner's rows (symbol, price, % change) as a click-to-load list, so the column always shows something that moves;
     - the indicator strip (three rows: a search row, the active-indicator chips, a legend line): the chips join the search
       row and the legend becomes a tooltip, one row on desktop;
     - the options price calculator, a 950 px form on phones: folded to one tap-to-open line (the fold is remembered);
     - the chat's 340 px log while it says "Connecting…": held at a short height until messages arrive.
   The rules re-run when the page changes (a MutationObserver on the watched blocks) and on resize, never more than a few
   times a second; nothing here fetches anything. */
(function boot(tries) {
  if (window.__smlLayoutEngine) return;
  const below = document.getElementById('academy-below');
  if (!below) { if (tries < 150) setTimeout(() => boot(tries + 1), 200); return; }
  window.__smlLayoutEngine = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const phone = () => window.matchMedia('(max-width:720px)').matches;
  const css = document.createElement('style');
  css.textContent = '.academy-market-trio{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:0 0 8px}@media(max-width:1100px){.academy-market-trio{grid-template-columns:1fr;gap:6px}}.academy-market-trio>section{margin:0!important}'
    + '@media(max-width:720px){.academy-market-trio>section>div{padding:7px 9px!important}}'
    + '.academy-depth.sml-empty{flex:0 0 auto!important;min-height:0!important;padding-top:8px!important;margin-top:8px!important}.academy-depth.sml-empty .academy-depth-empty{padding:0 0 2px;font-size:.62rem}'
    + '.academy-side-fill{flex:1 1 auto;min-height:0;overflow:auto;scrollbar-width:thin;margin-top:8px;border-top:1px solid #1b3540;padding-top:8px}.academy-side-fill h3{font-size:.63rem;margin:0 0 5px;color:#86a2b0;display:flex;justify-content:space-between;align-items:center}.academy-side-fill h3 small{color:#5f7684;font-weight:600;letter-spacing:0;text-transform:none}'
    + '.academy-side-fill .sf-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;gap:6px;padding:3px 0;border-bottom:1px solid rgba(42,66,78,.45);font:700 .6rem ui-monospace,monospace;cursor:pointer;align-items:baseline}.academy-side-fill .sf-row:hover{background:rgba(82,230,173,.06)}.academy-side-fill .sf-row b{color:#eef4f7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.academy-side-fill .sf-row span{color:#c7d5dc}.academy-side-fill .sf-row i{font-style:normal;min-width:52px;text-align:right}.academy-side-fill .up{color:#52e6ad}.academy-side-fill .dn{color:#ff778b}.academy-side-fill .sf-empty{color:#7f98a6;font-size:.62rem}'
    + '.academy-intelligence.sml-compact .academy-indicator-status{display:none}.academy-intelligence.sml-compact .academy-intel-head{flex-wrap:wrap;align-items:center}.academy-intelligence.sml-compact .academy-active-indicators{display:inline-flex;flex-wrap:wrap;gap:4px;align-items:center;margin:0;padding:0 4px;border:0;min-height:0}.academy-intelligence.sml-compact .academy-intel-legend{border:1px solid #294554;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;color:#8fa5b1;font:800 .6rem ui-monospace,monospace;cursor:help;flex:none}'
    + '.sml-fold-head{display:none}@media(max-width:720px){.opt-calc.sml-foldable{position:relative}.sml-fold-head{display:flex;width:100%;align-items:center;justify-content:space-between;gap:8px;border:1px solid #1b3540;border-radius:8px;background:#0b141c;color:#8ee8c1;font:900 .66rem ui-monospace,monospace;letter-spacing:.06em;padding:9px 11px;cursor:pointer;margin:0}.sml-fold-head small{color:#7f98a6;font:700 .58rem ui-monospace,monospace;letter-spacing:0}.opt-calc.sml-folded>:not(.sml-fold-head){display:none!important}.opt-calc.sml-folded{padding:0!important;border:0!important;background:transparent!important;min-height:0!important}}'
    + '.academy-chat.sml-empty .academy-chat-log{height:120px!important;min-height:0!important}@media(max-width:720px){.academy-chat.sml-empty .academy-chat-log{height:96px!important}}';
  document.head.appendChild(css);

  /* 1. the market trio shares one row */
  function trio() {
    const ids = ['academy-direction', 'academy-unusual-volume', 'academy-sml-vix'];
    const els = ids.map((id) => document.getElementById(id)).filter(Boolean);
    if (els.length < 2 || els[0].parentElement.classList.contains('academy-market-trio')) return;
    const wrap = document.createElement('div'); wrap.className = 'academy-market-trio';
    els[0].parentElement.insertBefore(wrap, els[0]);
    for (const el of els) wrap.appendChild(el);
  }

  /* 2. the side column: an empty Level 2 collapses and the column shows the live scanner's top rows */
  const EMPTY_RE = /temporarily unavailable|not available right now|switched off|connecting(?:…|\.{2,3})|no live|unavailable\.?$/i;
  let fill = null;
  function scannerRows(limit) {
    const out = [];
    for (const tr of document.querySelectorAll('#academy-scan-body tr[data-symbol]')) {
      const sym = tr.dataset.symbol; const px = tr.querySelector('td[data-k="price"]'), ch = tr.querySelector('td[data-k="changePct"]');
      if (!sym) continue;
      out.push({ symbol: sym, price: px ? px.textContent.trim() : '', pct: ch ? ch.textContent.trim() : '', up: ch ? ch.classList.contains('academy-positive') : false, down: ch ? ch.classList.contains('academy-negative') : false });
      if (out.length >= limit) break;
    }
    return out;
  }
  function paintFill() {
    if (!fill) return;
    const rows = scannerRows(40);
    const cur = String((document.getElementById('symbol') || {}).value || '').toUpperCase();
    const html = '<h3>TOP OF THE SCANNER<small>tap to load</small></h3>' + (rows.length ? rows.map((r) => '<div class="sf-row" data-sym="' + esc(r.symbol) + '"><b>' + (r.symbol === cur ? '▸ ' : '') + esc(r.symbol) + '</b><span>' + esc(r.price) + '</span><i class="' + (r.up ? 'up' : r.down ? 'dn' : '') + '">' + esc(r.pct) + '</i></div>').join('') : '<div class="sf-empty">The scanner is loading its rows.</div>');
    if (fill.__html !== html) { fill.innerHTML = html; fill.__html = html; }
  }
  function sideColumn() {
    const side = document.querySelector('main .side'); if (!side) return;
    const depth = side.querySelector('.academy-depth');
    const depthEmpty = !!(depth && (depth.querySelector('.academy-depth-empty') || !depth.querySelector('.academy-depth-grid, .academy-depth-row, table, canvas')));
    if (depth) depth.classList.toggle('sml-empty', depthEmpty);
    const tape = side.querySelector('.academy-tape');
    const want = depthEmpty && !tape && !phone();
    if (want && !fill) {
      fill = document.createElement('section'); fill.className = 'academy-side-fill'; fill.setAttribute('aria-label', 'Top of the scanner');
      fill.addEventListener('click', (e) => { const row = e.target.closest ? e.target.closest('.sf-row') : null; if (!row) return; const input = document.getElementById('symbol'), load = document.getElementById('load'); if (input && load) { input.value = row.dataset.sym; load.click(); } });
      (depth || side).insertAdjacentElement(depth ? 'afterend' : 'beforeend', fill);
    } else if (!want && fill) { fill.remove(); fill = null; }
    paintFill();
  }

  /* 3. the indicator strip in one row */
  function indicatorStrip() {
    const intel = document.querySelector('.academy-intelligence'); if (!intel || intel.classList.contains('sml-compact')) return;
    const head = intel.querySelector('.academy-intel-head'), chips = intel.querySelector('.academy-active-indicators'), status = intel.querySelector('.academy-indicator-status');
    if (!head) return;
    intel.classList.add('sml-compact');
    if (chips && chips.parentElement !== head) head.appendChild(chips);
    if (status) { const q = document.createElement('span'); q.className = 'academy-intel-legend'; q.textContent = '?'; q.title = status.textContent.replace(/\s+/g, ' ').trim(); head.appendChild(q); }
  }

  /* 4. the calculator folds on phones */
  function calculator() {
    const calc = document.querySelector('#options-dock .opt-calc, section.opt-calc'); if (!calc || calc.classList.contains('sml-foldable')) return;
    calc.classList.add('sml-foldable');
    let open = false; try { open = localStorage.getItem('sml-fold-calc') === 'open'; } catch (_) { open = false; }
    const head = document.createElement('button'); head.type = 'button'; head.className = 'sml-fold-head';
    const paint = () => { calc.classList.toggle('sml-folded', phone() && !open); head.innerHTML = 'OPTIONS PRICE CALCULATOR<small>' + (open ? '▾ close' : '▸ open') + '</small>'; };
    head.addEventListener('click', () => { open = !open; try { localStorage.setItem('sml-fold-calc', open ? 'open' : 'closed'); } catch (_) { /* ignore */ } paint(); });
    calc.insertBefore(head, calc.firstChild);
    paint();
    window.addEventListener('resize', paint);
  }

  /* 5. the chat log stays short until there is something in it */
  function chat() {
    const c = document.querySelector('.academy-chat'); if (!c) return;
    const log = c.querySelector('.academy-chat-log');
    const empty = !!(log && !log.querySelector('.academy-chat-msg, article, .msg, [data-msg]') && EMPTY_RE.test(log.textContent || '') && log.children.length <= 1);
    c.classList.toggle('sml-empty', empty);
  }

  /* 6. the trio's empty members sit tighter */
  function trioState() {
    for (const id of ['academy-direction', 'academy-unusual-volume', 'academy-sml-vix']) { const el = document.getElementById(id); if (el) el.classList.toggle('sml-empty', EMPTY_RE.test(el.textContent || '')); }
  }

  let pending = 0;
  function run() { pending = 0; try { trio(); trioState(); sideColumn(); indicatorStrip(); calculator(); chat(); } catch (_) { /* never break the page */ } }
  function schedule() { if (pending) return; pending = setTimeout(run, 250); }
  run();
  const mo = new MutationObserver(schedule);
  for (const sel of ['main .side', '#academy-below', '.academy-intelligence']) { const el = document.querySelector(sel); if (el) mo.observe(el, { childList: true, subtree: true, characterData: true }); }
  window.addEventListener('resize', schedule);
  setInterval(paintFill, 12_000);
  window.smlLayoutEngine = { run, state: () => ({ trio: !!document.querySelector('.academy-market-trio'), fill: !!fill, fillRows: fill ? fill.querySelectorAll('.sf-row').length : 0, depthEmpty: !!document.querySelector('.academy-depth.sml-empty'), compact: !!document.querySelector('.academy-intelligence.sml-compact'), folded: !!document.querySelector('.opt-calc.sml-folded'), chatEmpty: !!document.querySelector('.academy-chat.sml-empty') }) };
})(0);
