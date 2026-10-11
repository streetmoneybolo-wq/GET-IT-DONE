/* SML Group Algo Chart: the chart shows the group's own ALGO list, not a fixed MEM ALGO button.
   Runs after the Chart Academy Tools adapter has built its toolbar (#sml-cat-toolbar). The adapter's MEM ALGO button and
   strategy picker are hidden, never removed, so everything wired to them (pop-outs, Hedge & Income, saved state) keeps
   working. In a group, an ALGOS menu lists the algos that group offers; picking MEM ALGO presses the hidden button.
   Outside a group there is no algo list, so no MEM ALGO. Educational: nothing here places orders. */
(function () {
  'use strict';
  if (window.__smlGroupAlgoChart) return;
  window.__smlGroupAlgoChart = 1;
  var CFG = window.SML_GAC || {};
  var MEM_KEYS = /^(mem[-_ ]?algo|mem|making[-_ ]?easy[-_ ]?money)$/i;

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* ---- which group is this chart for ---- */
  function scriptText() { var out = ''; var s = document.scripts; for (var i = 0; i < s.length; i++) if (!s[i].src) out += s[i].textContent + '\n'; return out; }
  var pageText = null;
  function pageVar(re) { if (pageText === null) pageText = scriptText(); var m = re.exec(pageText); return m ? m[1] : ''; }
  function groupId() {
    var g = Number(CFG.groupId) || 0;
    if (g) return g;
    var q = new URLSearchParams(location.search);
    ['group_id', 'group', 'gid', 'sml_group'].forEach(function (k) { if (!g && /^\d+$/.test(q.get(k) || '')) g = Number(q.get(k)); });
    if (g) return g;
    // the dashboard's own embed data: alertDestinationData={"public":true,"canAlert":false,"groupId":123,...}
    var raw = pageVar(/alertDestinationData\s*=\s*(\{[^;]*\})\s*;/);
    if (raw) { try { g = Number(JSON.parse(raw).groupId) || 0; } catch (e) { g = 0; } }
    return g;
  }
  /* Is this chart inside a group (the Live Chart embed), even when the group id itself is not on the page? */
  function inGroup(g) {
    if (g) return true;
    var q = new URLSearchParams(location.search);
    if (q.has('sml_group_tool') || (q.has('embed') && window.self !== window.top)) return true;
    var raw = pageVar(/alertDestinationData\s*=\s*(\{[^;]*\})\s*;/);
    if (raw) { try { if (JSON.parse(raw).embedMode === true) return true; } catch (e) { /* ignore */ } }
    var mem = window.SMLCAT_MEM || {};
    return mem.autoOn === true;
  }
  /* The server's own decision about MEM ALGO for this page (Chart Academy Tools withholds it inside other groups). */
  function serverAllowsMem() { var mem = window.SMLCAT_MEM; return !mem || mem.allowed !== false; }
  function nonce() { return CFG.nonce || pageVar(/SMLNONCE\s*=\s*'([a-f0-9]+)'/) || (window.wpApiSettings && window.wpApiSettings.nonce) || ''; }

  /* ---- the group's algo list (SML Group Algo Studio) ---- */
  function normalise(data) {
    var list = Array.isArray(data) ? data : (data && (data.algos || data.items || data.list || data.data)) || [];
    if (!Array.isArray(list)) list = [];
    return list.map(function (a, i) {
      if (typeof a === 'string') a = { name: a };
      var key = String(a.key || a.slug || a.id || a.type || a.name || '').trim();
      var name = String(a.name || a.title || a.label || key || 'Algo ' + (i + 1)).trim();
      return { key: key, name: name, mem: MEM_KEYS.test(key) || MEM_KEYS.test(name) || /mem algo/i.test(name), order: Number(a.order || a.position || a.sort || i), enabled: !(a.enabled === false || a.active === false || a.on === false), raw: a };
    }).filter(function (a) { return a.enabled; }).sort(function (a, b) { return a.order - b.order; });
  }
  function loadAlgos(g) {
    var url = (CFG.rest || '/wp-json/sml/v1/group/algos') + (g ? (/\?/.test(CFG.rest || '') ? '&' : '?') + 'group_id=' + encodeURIComponent(g) : '');
    var headers = { accept: 'application/json' }; var n = nonce(); if (n) headers['X-WP-Nonce'] = n;
    return fetch(url, { credentials: 'same-origin', headers: headers }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { return d == null ? null : normalise(d); }).catch(function () { return null; });
  }
  var MEM_ENTRY = { key: 'mem_algo', name: 'MEM ALGO', mem: true, order: 0, enabled: true, raw: { id: 'mem_algo', name: 'MEM ALGO' } };

  /* ---- toolbar ---- */
  var css = document.createElement('style');
  css.textContent = '#sml-cat-toolbar .sml-cat-btn.mem,#sml-cat-toolbar .sml-cat-sel{display:none!important}'
    + '.sml-gac{position:relative;display:inline-flex;align-items:center;margin-left:6px}'
    + '.sml-gac-btn{padding:4px 9px;border:1px solid #2f4a5c;border-radius:6px;background:#0f1c26;color:#bfe3f2;font:800 11px/1.2 system-ui,sans-serif;letter-spacing:.04em;cursor:pointer}.sml-gac-btn.on{background:#1d6b52;border-color:#3fd69a;color:#fff}'
    + '.sml-gac-menu{position:absolute;left:0;top:calc(100% + 4px);z-index:60;min-width:220px;background:rgba(9,15,24,.97);border:1px solid #2c3e4c;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.45);padding:6px;display:none}.sml-gac.open .sml-gac-menu{display:block}'
    + '.sml-gac-menu h6{margin:2px 6px 6px;font:800 10px ui-monospace,monospace;letter-spacing:.08em;color:#7f97a4}'
    + '.sml-gac-item{display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:0;border-radius:7px;background:transparent;color:#dbe6ec;font:700 12px system-ui,sans-serif;text-align:left;cursor:pointer}.sml-gac-item:hover{background:#13232f}.sml-gac-item.on{background:#0f3a2c;color:#9fe1c3}.sml-gac-item i{width:8px;height:8px;border-radius:50%;background:#3a4c58;flex:0 0 8px}.sml-gac-item.on i{background:#3fd69a;box-shadow:0 0 8px #3fd69a}'
    + '.sml-gac-item small{margin-left:auto;color:#7f97a4;font-weight:600}.sml-gac-sub{padding:4px 8px 8px 24px}.sml-gac-sub select{width:100%;padding:4px 6px;border:1px solid #2f4a5c;border-radius:6px;background:#0f1c26;color:#dfeef5;font:700 11px system-ui}'
    + '.sml-gac-empty{padding:8px;color:#8fa6b3;font:600 11px system-ui}';
  document.head.appendChild(css);

  function memButton() { return document.querySelector('#sml-cat-toolbar .sml-cat-btn.mem'); }
  function memSelect() { return document.querySelector('#sml-cat-toolbar .sml-cat-sel'); }

  function build(toolbar, g, algos) {
    var wrap = document.createElement('span'); wrap.className = 'sml-gac'; wrap.id = 'sml-gac';
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'sml-gac-btn'; btn.title = 'The algos this group offers on its Live Chart';
    var menu = document.createElement('div'); menu.className = 'sml-gac-menu';
    wrap.appendChild(btn); wrap.appendChild(menu); toolbar.appendChild(wrap);
    var memOn = function () { var b = memButton(); return !!(b && b.classList.contains('on')); };
    function paint() {
      var on = algos.filter(function (a) { return a.mem && memOn(); });
      var cls = 'sml-gac-btn' + (on.length ? ' on' : ''), label = on.length ? 'ALGO · ' + on[0].name.toUpperCase() : 'ALGOS' + (algos.length ? ' (' + algos.length + ')' : '');
      if (btn.className !== cls) btn.className = cls;
      if (btn.textContent !== label) btn.textContent = label;
      var h = '<h6>THIS GROUP\'S ALGOS</h6>';
      if (!algos.length) h += '<div class="sml-gac-empty">This group has not added an algo yet.</div>';
      algos.forEach(function (a, i) {
        var live = a.mem && !!memButton(), active = a.mem && memOn();
        h += '<button type="button" class="sml-gac-item' + (active ? ' on' : '') + '" data-i="' + i + '"' + (a.mem && !live ? ' disabled' : '') + '><i></i>' + esc(a.name) + '<small>' + (active ? 'ON' : a.mem ? (live ? 'tap to turn on' : 'not on this chart') : 'coming soon') + '</small></button>';
        if (active) { var sel = memSelect(); if (sel) { h += '<div class="sml-gac-sub"><select data-mode>' + [].map.call(sel.options, function (o) { return '<option value="' + esc(o.value) + '"' + (o.selected ? ' selected' : '') + '>' + esc(o.textContent) + '</option>'; }).join('') + '</select></div>'; } }
      });
      if (menu.innerHTML !== h) menu.innerHTML = h;
    }
    btn.addEventListener('click', function (e) { e.preventDefault(); wrap.classList.toggle('open'); paint(); });
    document.addEventListener('click', function (e) { if (e.isTrusted && !wrap.contains(e.target)) wrap.classList.remove('open'); }); // the menu's own programmatic press of the hidden button is not an outside tap
    menu.addEventListener('click', function (e) {
      e.stopPropagation(); // the menu re-renders on a tap; the document listener must not read a detached target as "outside"
      var it = e.target.closest('.sml-gac-item'); if (!it) return;
      var a = algos[Number(it.getAttribute('data-i'))]; if (!a) return;
      if (a.mem) { var b = memButton(); if (b) b.click(); }
      else { try { window.dispatchEvent(new CustomEvent('sml-group-algo-select', { detail: { groupId: g, algo: a.raw } })); } catch (err) { /* old browsers */ } }
      paint();
    });
    menu.addEventListener('change', function (e) {
      if (!e.target.matches('[data-mode]')) return;
      var sel = memSelect(); if (!sel) return;
      sel.value = e.target.value; sel.dispatchEvent(new Event('change', { bubbles: true })); paint();
    });
    paint();
    // the adapter repaints its own button state; mirror it
    new MutationObserver(function (muts) { for (var i = 0; i < muts.length; i++) if (!wrap.contains(muts[i].target)) { paint(); return; } }).observe(toolbar, { attributes: true, subtree: true, attributeFilter: ['class'] });
    return wrap;
  }

  /* ---- mount once the adapter's toolbar exists ---- */
  var tries = 0;
  (function mount() {
    var toolbar = document.getElementById('sml-cat-toolbar');
    if (!toolbar) { if (++tries < 400) setTimeout(mount, 150); return; }
    var g = groupId();
    var mem = memButton();
    if (!inGroup(g)) {
      /* the standalone dashboard, outside any group: MEM ALGO is not offered here; if it was left on from a group visit, switch it off for this view */
      if (mem && mem.classList.contains('on')) mem.click();
      return;
    }
    (g ? loadAlgos(g) : Promise.resolve(null)).then(function (algos) {
      /* the list could not be read (no id, route unavailable): the server's decision stands, so the group's MEM ALGO is never lost */
      if (!algos || !algos.length) algos = serverAllowsMem() && mem ? [MEM_ENTRY] : [];
      var hasMem = algos.some(function (a) { return a.mem; });
      if (!hasMem && mem && mem.classList.contains('on')) mem.click();
      build(toolbar, g, algos);
    });
  })();
})();
