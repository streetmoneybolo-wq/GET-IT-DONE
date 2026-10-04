/* Academy appearance: each member picks a colour theme, accent, font and text size. Kept in this browser (localStorage), applied
 * before first paint so there is no flash, and fully resettable. Dark-family themes only: the panels carry their own light-on-dark
 * text colours, so a light theme would make them unreadable. The candle colours inside the chart canvas are not themed. */
(() => {
  if (window.__smlAcademyAppearance) return;
  window.__smlAcademyAppearance = 1;
  const KEY = 'sml-academy-appearance-v1';
  const THEMES = {
    default: { label: 'Academy', bg: '#070b10', panel: '#0a1118', bar: '#0d1720', line: '#1b3540', text: '#eef4f7', accent: '#00c47d' },
    midnight: { label: 'Midnight', bg: '#060814', panel: '#0b1024', bar: '#10173a', line: '#26306a', text: '#e8ecff', accent: '#6c8cff' },
    graphite: { label: 'Graphite', bg: '#0f0f10', panel: '#171718', bar: '#1f1f21', line: '#34343a', text: '#f0f0f2', accent: '#9aa7b8' },
    plum: { label: 'Plum', bg: '#0e0812', panel: '#160d1c', bar: '#1e1228', line: '#3d2650', text: '#f5ecfb', accent: '#c46bff' },
    amber: { label: 'Amber terminal', bg: '#0a0803', panel: '#120e05', bar: '#1a1407', line: '#4a3a12', text: '#ffe9b8', accent: '#ffb020' },
    contrast: { label: 'High contrast', bg: '#000000', panel: '#000000', bar: '#0a0a0a', line: '#ffffff', text: '#ffffff', accent: '#ffe600' }
  };
  const FONTS = {
    system: ['System', 'system-ui,-apple-system,Segoe UI,sans-serif'],
    humanist: ['Humanist', 'Optima,Candara,Segoe UI,Trebuchet MS,sans-serif'],
    serif: ['Serif', 'Georgia,Cambria,Times New Roman,serif'],
    mono: ['Monospace', 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'],
    rounded: ['Rounded', 'ui-rounded,Nunito,Varela Round,Segoe UI,sans-serif'],
    dyslexia: ['Easy read', 'Verdana,Tahoma,Atkinson Hyperlegible,sans-serif']
  };
  const DEFAULTS = { theme: 'default', accent: '', bg: '', font: 'system', size: 100, density: 'comfortable' };
  const hex = (v) => /^#[0-9a-fA-F]{6}$/.test(String(v || ''));
  function load() { try { const o = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; return Object.assign({}, DEFAULTS, o); } catch (_) { return Object.assign({}, DEFAULTS); } }
  function save(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) { /* private mode */ } }
  const mix = (h, t, a) => { const p = (x) => parseInt(x, 16), c = (i) => Math.round(p(h.slice(i, i + 2)) + (p(t.slice(i, i + 2)) - p(h.slice(i, i + 2))) * a).toString(16).padStart(2, '0'); return '#' + c(1) + c(3) + c(5); };
  const ink = (h) => ((parseInt(h.slice(1, 3), 16) * 299 + parseInt(h.slice(3, 5), 16) * 587 + parseInt(h.slice(5, 7), 16) * 114) / 1000 > 140 ? '#04110c' : '#ffffff');

  const styleEl = document.createElement('style'); styleEl.id = 'academy-appearance-css';
  function apply(s) {
    const base = THEMES[s.theme] || THEMES.default, t = Object.assign({}, base);
    if (hex(s.accent)) t.accent = s.accent;
    if (hex(s.bg)) { t.bg = s.bg; t.panel = mix(s.bg, '#ffffff', 0.04); t.bar = mix(s.bg, '#ffffff', 0.08); t.line = mix(s.bg, '#ffffff', 0.18); }
    const size = Math.max(80, Math.min(140, Number(s.size) || 100)), font = (FONTS[s.font] || FONTS.system)[1];
    const compact = s.density === 'compact';
    const edited = s.theme !== 'default' || hex(s.accent) || hex(s.bg);
    let css = 'html{font-size:' + size + '%}';
    if (s.font !== 'system') css += 'body,button,input,select,textarea{font-family:' + font + '!important}';
    if (edited) {
      css += 'body,main,.academy-below{background:' + t.bg + '!important;color:' + t.text + '!important}'
        + '.bar,.dashbar,.indices,.index{background:' + t.bar + '!important;border-color:' + t.line + '!important}'
        + '.side,.chart,.academy-chat,.options-chain,.academy-intelligence,.academy-scanner,.lesson,#academy-profile-card,.academy-alerts-desk,.academy-chat-form,.academy-chat-tabs{background:' + t.panel + '!important;border-color:' + t.line + '!important}'
        + '.academy-chat-form input,.rbox input,#symbol{background:' + mix(t.panel, '#000000', 0.25) + '!important;border-color:' + t.line + '!important;color:' + t.text + '!important}'
        + '.dot,.lesson-toggle,#load,.academy-chat-form button,.rbox button,.academy-chat-tabs button.on,.hotlbl{background:' + t.accent + '!important;border-color:' + t.accent + '!important;color:' + ink(t.accent) + '!important}'
        + '.academy-chat-msg b,.academy-chat-msg .nm,.dashbrand,.academy-chat-status,.vt button.up.on{color:' + t.accent + '!important}'
        + '.th.hot{border-left-color:' + t.accent + '!important}';
    }
    if (compact) css += '.bar{padding:.3rem .6rem!important}.academy-chat-log{gap:3px!important}.th .th{margin-top:2px!important}.academy-chat-msg{line-height:1.25!important}';
    styleEl.textContent = css;
  }
  let state = load();
  document.head.appendChild(styleEl); apply(state);

  const ui = document.createElement('style');
  ui.textContent = '#aa-btn{position:fixed;right:10px;bottom:10px;z-index:2147483200;border:1px solid #2a4a58;border-radius:999px;background:#0d1a24;color:#e6eef2;padding:7px 12px;font:800 .72rem system-ui;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.5)}'
    + '#aa-panel{position:fixed;right:10px;bottom:52px;z-index:2147483201;width:min(320px,calc(100vw - 20px));max-height:calc(100dvh - 70px);overflow:auto;background:#0a1118;border:1px solid #1f8a5f;border-radius:12px;box-shadow:0 12px 36px rgba(0,0,0,.65);color:#dbe6ec;font:600 .72rem/1.4 system-ui,sans-serif;padding:12px;display:none}'
    + '#aa-panel h4{margin:0 0 8px;font:800 .8rem system-ui}#aa-panel h6{margin:10px 0 5px;font:800 .58rem ui-monospace,monospace;letter-spacing:.08em;color:#7ef0bd}'
    + '#aa-panel .sw{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}#aa-panel .sw button{border:2px solid #294554;border-radius:8px;padding:7px 4px;color:#fff;font:800 .62rem system-ui;cursor:pointer}#aa-panel .sw button.on{border-color:#fff}'
    + '#aa-panel select,#aa-panel input[type=range]{width:100%}#aa-panel select{background:#0d1720;color:#eaf5f8;border:1px solid #294554;border-radius:6px;padding:6px}'
    + '#aa-panel .row{display:flex;gap:10px;align-items:center}#aa-panel .row label{flex:1;display:flex;gap:6px;align-items:center}#aa-panel input[type=color]{width:38px;height:26px;border:0;background:none;padding:0}'
    + '#aa-panel .ft{display:flex;gap:8px;margin-top:12px}#aa-panel .ft button{flex:1;border:1px solid #2a4a58;border-radius:7px;background:#0d1a24;color:#e6eef2;padding:7px;font:800 .66rem system-ui;cursor:pointer}'
    + '#aa-panel .note{color:#7f95a1;font-weight:500;font-size:.6rem;margin-top:8px}';
  document.head.appendChild(ui);
  const btn = document.createElement('button'); btn.id = 'aa-btn'; btn.type = 'button'; btn.textContent = 'Aa Customize'; btn.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div'); panel.id = 'aa-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Customize your Academy');
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function paint() {
    const cur = THEMES[state.theme] || THEMES.default;
    panel.innerHTML = '<h4>Customize your Academy</h4><h6>COLOR SCHEME</h6><div class="sw">'
      + Object.keys(THEMES).map((k) => '<button type="button" data-theme="' + k + '" class="' + (state.theme === k ? 'on' : '') + '" style="background:' + THEMES[k].bg + ';color:' + THEMES[k].accent + '">' + esc(THEMES[k].label) + '</button>').join('') + '</div>'
      + '<div class="row" style="margin-top:8px"><label>Accent <input type="color" data-k="accent" value="' + (hex(state.accent) ? state.accent : cur.accent) + '"></label><label>Background <input type="color" data-k="bg" value="' + (hex(state.bg) ? state.bg : cur.bg) + '"></label></div>'
      + '<h6>FONT</h6><select data-k="font">' + Object.keys(FONTS).map((k) => '<option value="' + k + '"' + (state.font === k ? ' selected' : '') + '>' + esc(FONTS[k][0]) + '</option>').join('') + '</select>'
      + '<h6>TEXT SIZE · ' + (Number(state.size) || 100) + '%</h6><input type="range" min="80" max="140" step="5" data-k="size" value="' + (Number(state.size) || 100) + '">'
      + '<h6>SPACING</h6><select data-k="density"><option value="comfortable"' + (state.density === 'comfortable' ? ' selected' : '') + '>Comfortable</option><option value="compact"' + (state.density === 'compact' ? ' selected' : '') + '>Compact</option></select>'
      + '<div class="ft"><button type="button" data-reset="1">Reset to default</button><button type="button" data-close="1">Done</button></div>'
      + '<p class="note">Saved in this browser. Chart candle colours are not changed.</p>';
  }
  panel.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('button') : null; if (!b) return;
    if (b.dataset.theme) { state.theme = b.dataset.theme; state.accent = ''; state.bg = ''; save(state); apply(state); paint(); }
    else if (b.dataset.reset) { state = Object.assign({}, DEFAULTS); save(state); apply(state); paint(); }
    else if (b.dataset.close) toggle(false);
  });
  panel.addEventListener('input', (e) => {
    const k = e.target && e.target.dataset && e.target.dataset.k; if (!k) return;
    state[k] = k === 'size' ? Number(e.target.value) : e.target.value; save(state); apply(state);
    if (k === 'size') { const h = panel.querySelector('h6:nth-of-type(3)'); if (h) h.textContent = 'TEXT SIZE · ' + state.size + '%'; }
  });
  function toggle(on) { const open = on == null ? panel.style.display !== 'block' : on; if (open) paint(); panel.style.display = open ? 'block' : 'none'; btn.setAttribute('aria-expanded', String(open)); }
  btn.onclick = () => toggle();
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
  const mount = () => { document.body.appendChild(panel); document.body.appendChild(btn); };
  if (document.body) mount(); else document.addEventListener('DOMContentLoaded', mount);
})();
