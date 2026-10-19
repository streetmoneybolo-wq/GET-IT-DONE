/* Academy Settings: the ⚙ button beside "Aa Customize". Today it holds the BUY BUTTONS choice: one Buy button that goes to
 * the member's own broker, or one button per broker they use, and whether Sell buttons show beside Buy. Saved in this
 * browser; every Buy spot on the page (chart toolbar, options chain, contract mini chart, hedge ideas) repaints at once
 * through window.smlBuyPrefs and the 'sml-buy-prefs' event. Needs window.SmlBuyPrefs (academy-buy-prefs.js). */
(() => {
  if (window.__smlAcademySettings) return;
  const P = window.SmlBuyPrefs; if (!P) return;
  window.__smlAcademySettings = 1;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let prefs = (() => { try { return P.normalize(JSON.parse(localStorage.getItem(P.STORAGE_KEY) || 'null')); } catch (_) { return P.normalize(null); } })();
  const save = () => { try { localStorage.setItem(P.STORAGE_KEY, JSON.stringify(prefs)); } catch (_) { /* private mode */ } };

  const open = (url) => { if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url); else { try { window.open(url, '_blank', 'noopener'); } catch (_) { /* ignore */ } } };
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* the Activity frame can block the clipboard API */ }
    try { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return !!ok; } catch (_) { return false; }
  }
  /* Shared by every Buy spot on the page. */
  window.smlBuyPrefs = {
    get: () => Object.assign({}, prefs, { platforms: prefs.platforms.slice() }),
    set(next) { prefs = P.normalize(Object.assign({}, prefs, next || {})); save(); applyToolbar(); window.dispatchEvent(new CustomEvent('sml-buy-prefs', { detail: window.smlBuyPrefs.get() })); },
    brokers: () => P.brokersFor(prefs),
    link: (key, opts) => P.linkFor(key, opts),
    /* open a broker for a stock or a contract; a contract's OCC symbol is copied first so the broker's search finds it */
    async go(key, opts) {
      const l = P.linkFor(key, opts || {}); if (!l) return null;
      let copied = false;
      if (opts && opts.contract && window.SmlOptionContract) copied = await copy(window.SmlOptionContract.occSymbol(opts.contract));
      open(l.url);
      return Object.assign({ copied }, l);
    },
    copy
  };

  /* the chart toolbar's "Buy SPY on …" buttons follow the choice: hidden brokers go, "one button" keeps the primary alone */
  function applyToolbar() {
    const show = new Set(P.brokersFor(prefs).map((b) => b.key));
    P.KEYS.forEach((k) => { const b = document.getElementById('academy-' + k + '-buy'); if (b) b.style.display = show.has(k) ? '' : 'none'; });
  }
  applyToolbar();
  if (typeof MutationObserver === 'function') new MutationObserver(applyToolbar).observe(document.documentElement, { childList: true, subtree: true });

  const css = document.createElement('style');
  css.textContent = '#sml-settings-btn{position:fixed;right:126px;bottom:10px;z-index:2147483200;border:1px solid #2a4a58;border-radius:999px;background:#0d1a24;color:#e6eef2;padding:7px 12px;font:800 .72rem system-ui;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.5)}'
    + '#sml-settings-panel{position:fixed;right:10px;bottom:52px;z-index:2147483201;width:min(340px,calc(100vw - 20px));max-height:calc(100dvh - 70px);overflow:auto;background:#0a1118;border:1px solid #2f6cf5;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.65);color:#dbe6ec;font:600 .72rem/1.4 system-ui,sans-serif;padding:12px;display:none}'
    + '#sml-settings-panel h4{margin:0 0 8px;font:800 .8rem system-ui}#sml-settings-panel h6{margin:10px 0 5px;font:800 .58rem ui-monospace,monospace;letter-spacing:.08em;color:#9cc8ff}'
    + '#sml-settings-panel label{display:flex;gap:7px;align-items:center;padding:5px 0;cursor:pointer}#sml-settings-panel input{accent-color:#2f6cf5}'
    + '#sml-settings-panel .brk{display:grid;grid-template-columns:1fr 1fr;gap:2px 10px}#sml-settings-panel select{width:100%;background:#0d1720;color:#eaf5f8;border:1px solid #294554;border-radius:6px;padding:6px}'
    + '#sml-settings-panel .pv{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}#sml-settings-panel .pv span{border:1px solid;border-radius:6px;padding:3px 8px;font:800 .62rem system-ui}'
    + '#sml-settings-panel .note{color:#7f95a1;font-weight:500;font-size:.6rem;margin-top:8px}#sml-settings-panel .ft{display:flex;gap:8px;margin-top:12px}#sml-settings-panel .ft button{flex:1;border:1px solid #2a4a58;border-radius:7px;background:#0d1a24;color:#e6eef2;padding:7px;font:800 .66rem system-ui;cursor:pointer}'
    + '@media(max-width:720px){#sml-settings-btn{right:auto;left:10px;bottom:48px}}';
  document.head.appendChild(css);
  const btn = document.createElement('button'); btn.id = 'sml-settings-btn'; btn.type = 'button'; btn.textContent = '⚙ Settings'; btn.setAttribute('aria-expanded', 'false'); btn.title = 'Settings: which Buy buttons the Academy shows';
  const panel = document.createElement('div'); panel.id = 'sml-settings-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Academy settings');
  function paint() {
    const chosen = P.brokersFor(prefs);
    panel.innerHTML = '<h4>Settings</h4><h6>BUY BUTTONS</h6>'
      + '<label><input type="radio" name="sml-buy-mode" value="one"' + (prefs.mode === 'one' ? ' checked' : '') + '>One Buy button, for my broker</label>'
      + '<label><input type="radio" name="sml-buy-mode" value="each"' + (prefs.mode === 'each' ? ' checked' : '') + '>A Buy button for each broker I use</label>'
      + '<h6>' + (prefs.mode === 'one' ? 'MY BROKER' : 'BROKERS I USE') + '</h6>'
      + (prefs.mode === 'one'
        ? '<select data-k="primary">' + P.BROKERS.map((b) => '<option value="' + b.key + '"' + (prefs.primary === b.key ? ' selected' : '') + '>' + esc(b.name) + '</option>').join('') + '</select>'
        : '<div class="brk">' + P.BROKERS.map((b) => '<label><input type="checkbox" data-p="' + b.key + '"' + (prefs.platforms.includes(b.key) ? ' checked' : '') + '>' + esc(b.name) + '</label>').join('') + '</div>')
      + '<h6>SELL BUTTONS</h6><label><input type="checkbox" data-k="sell"' + (prefs.sell ? ' checked' : '') + '>Show a Sell button beside Buy on contracts and hedge ideas</label>'
      + '<h6>PREVIEW</h6><div class="pv">' + chosen.map((b) => '<span style="color:' + b.color + ';background:' + b.bg + ';border-color:' + b.border + '">Buy on ' + esc(b.name) + ' ↗</span>').join('') + '</div>'
      + '<p class="note">Applies to the chart toolbar, the options chain, the contract mini chart and the hedge ideas. Buttons open your broker on the stock (or its options chain) and copy the contract symbol; every order is reviewed and placed by you in your broker. Nothing is traded from the Academy.</p>'
      + '<div class="ft"><button type="button" data-reset="1">Reset</button><button type="button" data-close="1">Done</button></div>';
  }
  panel.addEventListener('change', (e) => {
    const t = e.target; if (!t) return;
    if (t.name === 'sml-buy-mode') window.smlBuyPrefs.set({ mode: t.value });
    else if (t.dataset.p) { const set = new Set(prefs.platforms); if (t.checked) set.add(t.dataset.p); else set.delete(t.dataset.p); window.smlBuyPrefs.set({ platforms: P.KEYS.filter((k) => set.has(k)) }); }
    else if (t.dataset.k === 'primary') window.smlBuyPrefs.set({ primary: t.value });
    else if (t.dataset.k === 'sell') window.smlBuyPrefs.set({ sell: t.checked });
    paint();
  });
  panel.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
    if (b.dataset.reset) { window.smlBuyPrefs.set(Object.assign({}, P.DEFAULTS)); paint(); }
    else if (b.dataset.close) toggle(false);
  });
  function toggle(on) { const show = on == null ? panel.style.display !== 'block' : on; if (show) paint(); panel.style.display = show ? 'block' : 'none'; btn.setAttribute('aria-expanded', String(show)); }
  btn.onclick = () => toggle();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
  const mount = () => { document.body.appendChild(panel); document.body.appendChild(btn); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
  window.smlAcademySettings = { toggle };
})();
