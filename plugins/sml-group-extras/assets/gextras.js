(function () {
  'use strict';

  /* ===================================================================
     1. Rich text for group messages. Discord-style, plus colours, sizes, glow and alignment.
        **bold**  *italic*  __underline__  ~~strike~~  `code`  ||spoiler||
        # Big header   ## Header   ### Smaller header   -# small text   > quote
        [color=gold]text[/color]   [glow=#00ff66]text[/glow]   [size=32]text[/size]   [center]text[/center]   [right]text[/right]
     The message is escaped first and only these tokens are turned into markup, with colours and sizes checked, so nothing a member types can inject HTML.
     =================================================================== */
  var COLORS = { red: '#ff5c7a', green: '#00ff66', blue: '#4dc3ff', gold: '#ffd166', orange: '#ffb04a', purple: '#b388ff', pink: '#ff7ad9', white: '#ffffff', gray: '#9fb3a8', cyan: '#35e6ff' };

  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function colorOf(v) { v = String(v).toLowerCase(); if (COLORS[v]) return COLORS[v]; return /^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(v) ? v : null; }

  function inline(s) {
    var codes = [];
    s = s.replace(/`([^`\n]+)`/g, function (_, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = s.replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^\n]+?)__/g, '<u>$1</u>')
      .replace(/~~([^\n]+?)~~/g, '<s>$1</s>')
      .replace(/\|\|([^\n]+?)\|\|/g, '<span class="smlfmt-spoiler" tabindex="0">$1</span>')
      .replace(/(^|[^*\w])\*([^*\s][^*\n]*?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^\w])_([^_\s][^_\n]*?)_(?!\w)/g, '$1<em>$2</em>')
      .replace(/\[color=([#a-z0-9]{3,20})\]([\s\S]*?)\[\/color\]/gi, function (m, c, t) { var k = colorOf(c); return k ? '<span style="color:' + k + '">' + t + '</span>' : m; })
      .replace(/\[glow=([#a-z0-9]{3,20})\]([\s\S]*?)\[\/glow\]/gi, function (m, c, t) { var k = colorOf(c); return k ? '<span style="color:' + k + ';text-shadow:0 0 10px ' + k + ',0 0 2px ' + k + '">' + t + '</span>' : m; })
      .replace(/\[size=(\d{2})\]([\s\S]*?)\[\/size\]/gi, function (m, n, t) { n = Math.max(10, Math.min(48, parseInt(n, 10))); return '<span style="font-size:' + n + 'px;line-height:1.25">' + t + '</span>'; });
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
  }

  /* raw text in, safe HTML out; returns '' when the text has no formatting at all */
  function render(raw) {
    var text = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n');
    var lines = esc(text).split('\n'), out = [], any = false;
    lines.forEach(function (line) {
      var m, cls = '', body = line, tag = 'div';
      if ((m = /^(#{1,3}) (.+)$/.exec(line))) { cls = 'smlfmt-h' + m[1].length; body = m[2]; any = true; }
      else if ((m = /^-# (.+)$/.exec(line))) { cls = 'smlfmt-small'; body = m[1]; any = true; }
      else if ((m = /^&gt; (.+)$/.exec(line))) { cls = 'smlfmt-quote'; body = m[1]; any = true; }
      if ((m = /^\[center\]([\s\S]*)\[\/center\]$/i.exec(body))) { cls += ' smlfmt-center'; body = m[1]; any = true; }
      else if ((m = /^\[right\]([\s\S]*)\[\/right\]$/i.exec(body))) { cls += ' smlfmt-right'; body = m[1]; any = true; }
      var html = inline(body);
      if (html !== body) any = true;
      out.push(line === '' ? '<div class="smlfmt-gap">&nbsp;</div>' : '<' + tag + (cls ? ' class="' + cls.trim() + '"' : '') + '>' + html + '</' + tag + '>');
    });
    return any ? out.join('') : '';
  }

  var BAR_HTML = '' +
    '<button type="button" data-f="**" title="Bold (Ctrl+B)"><b>B</b></button>' +
    '<button type="button" data-f="*" title="Italic (Ctrl+I)"><i>I</i></button>' +
    '<button type="button" data-f="__" title="Underline (Ctrl+U)"><u>U</u></button>' +
    '<button type="button" data-f="~~" title="Strikethrough"><s>S</s></button>' +
    '<button type="button" data-f="`" title="Code">&lt;/&gt;</button>' +
    '<button type="button" data-f="||" title="Spoiler">▮</button>' +
    '<span class="sep"></span>' +
    '<button type="button" data-l="# " title="Big header">H1</button>' +
    '<button type="button" data-l="## " title="Header">H2</button>' +
    '<button type="button" data-l="### " title="Small header">H3</button>' +
    '<button type="button" data-l="-# " title="Small text">sm</button>' +
    '<button type="button" data-l="&gt; " title="Quote">❝</button>' +
    '<span class="sep"></span>' +
    '<span class="swatches" title="Text colour">' + Object.keys(COLORS).map(function (k) { return '<button type="button" class="sw" data-c="' + k + '" style="background:' + COLORS[k] + '" title="' + k + '"></button>'; }).join('') + '</span>' +
    '<select data-size title="Text size"><option value="">Size</option><option value="14">14</option><option value="18">18</option><option value="24">24</option><option value="32">32</option><option value="42">42</option></select>' +
    '<button type="button" data-w="center" title="Centre">⇔</button>' +
    '<button type="button" data-g title="Glow (uses the chosen colour, or green)">✦</button>';

  function wrap(ta, open, close) {
    var s = ta.selectionStart, e = ta.selectionEnd, v = ta.value, sel = v.slice(s, e) || 'text';
    ta.value = v.slice(0, s) + open + sel + close + v.slice(e);
    ta.focus(); ta.selectionStart = s + open.length; ta.selectionEnd = s + open.length + sel.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  function prefixLine(ta, p) {
    var s = ta.selectionStart, v = ta.value, ls = v.lastIndexOf('\n', s - 1) + 1, le = v.indexOf('\n', s); if (le < 0) le = v.length;
    var line = v.slice(ls, le).replace(/^(#{1,3} |-# |> )/, '');
    var had = v.slice(ls, le).indexOf(p) === 0;
    ta.value = v.slice(0, ls) + (had ? '' : p) + line + v.slice(le);
    ta.focus(); ta.selectionStart = ta.selectionEnd = ls + (had ? 0 : p.length) + line.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }

  var lastColor = '';
  function buildBar(form) {
    var ta = form.querySelector('textarea'); if (!ta || form.hasAttribute('data-smlfmt-bar')) return;
    form.setAttribute('data-smlfmt-bar', '1');
    var bar = document.createElement('div'); bar.className = 'smlfmt-bar'; bar.innerHTML = BAR_HTML;
    var prev = document.createElement('div'); prev.className = 'smlfmt-preview'; prev.hidden = true;
    form.insertBefore(prev, form.firstChild); form.insertBefore(bar, form.firstChild);
    function refresh() { var h = render(ta.value); prev.hidden = !h; prev.innerHTML = h; }
    ta.addEventListener('input', refresh);
    ta.addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      var k = e.key.toLowerCase(), m = { b: '**', i: '*', u: '__' }[k];
      if (m) { e.preventDefault(); wrap(ta, m, m); }
    });
    bar.addEventListener('mousedown', function (e) { e.preventDefault(); });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-f')) { var f = b.getAttribute('data-f'); wrap(ta, f, f); }
      else if (b.hasAttribute('data-l')) prefixLine(ta, b.getAttribute('data-l').replace('&gt;', '>'));
      else if (b.hasAttribute('data-c')) { lastColor = b.getAttribute('data-c'); wrap(ta, '[color=' + lastColor + ']', '[/color]'); }
      else if (b.hasAttribute('data-w')) wrap(ta, '[center]', '[/center]');
      else if (b.hasAttribute('data-g')) wrap(ta, '[glow=' + (lastColor || 'green') + ']', '[/glow]');
    });
    bar.addEventListener('change', function (e) { var s = e.target.closest('select[data-size]'); if (s && s.value) { wrap(ta, '[size=' + s.value + ']', '[/size]'); s.value = ''; } });
    form.addEventListener('submit', function () { setTimeout(function () { prev.hidden = true; prev.innerHTML = ''; }, 0); });
  }

  function formatMessage(p) {
    var raw = p.textContent;
    if (p.getAttribute('data-smlfmt-raw') === raw && p.nextElementSibling && p.nextElementSibling.classList.contains('smlfmt-view')) return;
    p.setAttribute('data-smlfmt-raw', raw);
    var old = p.nextElementSibling; if (old && old.classList.contains('smlfmt-view')) old.remove();
    var html = render(raw);
    if (!html) { p.classList.remove('smlfmt-hidden'); return; }
    var view = document.createElement('div'); view.className = 'smlfmt-view'; view.innerHTML = html;
    p.parentNode.insertBefore(view, p.nextSibling); p.classList.add('smlfmt-hidden');
  }

  function sweepFormatting() {
    document.querySelectorAll('form[data-smlgs-composer]').forEach(buildBar);
    document.querySelectorAll('.sml-gshell__message-text').forEach(formatMessage);
  }

  if (typeof window !== 'undefined') window.SMLGroupFormat = { render: render };
  if (typeof module !== 'undefined' && module.exports) module.exports = { render: render };
  if (typeof document === 'undefined') { return; }

  /* spoilers reveal on click */
  document.addEventListener('click', function (e) { var s = e.target.closest && e.target.closest('.smlfmt-spoiler'); if (s) s.classList.toggle('open'); });

  /* ===================================================================
     2. Channel descriptions (180 characters) and a tidier owner menu.
     =================================================================== */
  var config = window.SMLGroupExtras || {};
  var root = document.getElementById('sml-group-shell');
  if (!root || !config.api) { return; }
  var shellConfig = {};
  try { shellConfig = JSON.parse(root.getAttribute('data-config') || '{}'); } catch (e) { /* ignore */ }
  var groupId = parseInt(shellConfig.groupId, 10) || 0;
  if (!groupId) { return; }
  var MAX = config.max || 180;
  var S = { descriptions: {}, canManage: false, loaded: false, modal: null, queued: false };

  function request(path, options) {
    options = options || {}; options.credentials = 'same-origin'; options.cache = 'no-store';
    options.headers = Object.assign({ 'X-WP-Nonce': config.nonce || '' }, options.headers || {});
    return fetch(config.api + path, options).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.message || 'That could not be saved.'); return j; }); });
  }
  function activeChannelId() { var a = root.querySelector('.sml-gshell__channel[data-smlgs-channel].is-active'); return a ? (parseInt(a.getAttribute('data-smlgs-channel'), 10) || 0) : 0; }
  function activeChannelName() { var a = root.querySelector('.sml-gshell__channel[data-smlgs-channel].is-active .sml-gshell__channel-name'); return a ? String(a.textContent || '').replace(/^#\s*/, '').trim() : ''; }

  function renderDescription() {
    var cid = activeChannelId(), text = cid ? (S.descriptions[String(cid)] || '') : '';
    var head = root.querySelector('.sml-gshell__main-head'), bar = root.querySelector('.sml-gex-desc');
    if (!text || !head) { if (bar) bar.remove(); return; }
    if (!bar) { bar = document.createElement('div'); bar.className = 'sml-gex-desc'; head.parentNode.insertBefore(bar, head.nextSibling); }
    if (bar.textContent !== text) bar.textContent = text;
    bar.hidden = false;
  }
  function tooltips() {
    root.querySelectorAll('.sml-gshell__channel[data-smlgs-channel]').forEach(function (b) {
      var t = S.descriptions[String(parseInt(b.getAttribute('data-smlgs-channel'), 10))] || '';
      if (t && b.getAttribute('title') !== t) b.setAttribute('title', t); else if (!t && b.hasAttribute('title') && b.hasAttribute('data-gex-title')) { b.removeAttribute('title'); }
      if (t) b.setAttribute('data-gex-title', '1');
    });
  }

  function menu() {
    var node = root.querySelector('.sml-gshell__owner-menu') || root.querySelector('.sml-ghx-menu') || document.getElementById('sml-ghx-menu'); if (!node) return;
    /* the old "Edit group" entry is gone: group settings live in the Settings hub */
    Array.prototype.forEach.call(node.querySelectorAll('button'), function (b) { if (/^edit group$/i.test(String(b.textContent || '').trim())) b.remove(); });
    if (!S.canManage || !activeChannelId()) { var old = node.querySelector('[data-gex-desc-open]'); if (old) old.remove(); return; }
    if (!node.querySelector('[data-gex-desc-open]')) {
      var b = document.createElement('button'); b.type = 'button'; b.setAttribute('data-gex-desc-open', '1'); b.textContent = 'Channel description'; node.appendChild(b);
    }
  }

  function ensureModal() {
    if (S.modal) return S.modal;
    var m = document.createElement('section'); m.className = 'sml-gex-modal'; m.hidden = true; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
    m.innerHTML = '<form class="sml-gex-card"><h2>Channel description</h2><p class="sub" data-gex-name></p>' +
      '<textarea name="description" maxlength="' + MAX + '" rows="4" placeholder="What is this channel for? This shows under the channel and helps people find your group."></textarea>' +
      '<div class="meta"><span data-gex-count>0 / ' + MAX + '</span><span data-gex-status role="status"></span></div>' +
      '<div class="actions"><button type="button" data-gex-close>Cancel</button><button type="button" data-gex-clear>Clear</button><button type="submit" class="pri">Save</button></div></form>';
    document.body.appendChild(m);
    var ta = m.querySelector('textarea');
    function count() { m.querySelector('[data-gex-count]').textContent = (window.Array.from ? Array.from(ta.value).length : ta.value.length) + ' / ' + MAX; }
    ta.addEventListener('input', count);
    m.addEventListener('click', function (e) {
      if (e.target === m || e.target.closest('[data-gex-close]')) m.hidden = true;
      if (e.target.closest('[data-gex-clear]')) { ta.value = ''; count(); }
    });
    m.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var cid = parseInt(m.getAttribute('data-cid'), 10), st = m.querySelector('[data-gex-status]'), btn = m.querySelector('button.pri');
      st.textContent = 'Saving…'; btn.disabled = true;
      request('description', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ group_id: groupId, channel_id: cid, description: ta.value }) }).then(function (r) {
        if (r.description) S.descriptions[String(cid)] = r.description; else delete S.descriptions[String(cid)];
        st.textContent = 'Saved.'; renderDescription(); tooltips(); setTimeout(function () { m.hidden = true; st.textContent = ''; }, 400);
      }).catch(function (err) { st.textContent = err.message || 'Could not save.'; }).then(function () { btn.disabled = false; });
    });
    S.modal = m; return m;
  }
  function openModal() {
    var cid = activeChannelId(); if (!cid || !S.canManage) return;
    var m = ensureModal(), ta = m.querySelector('textarea');
    m.setAttribute('data-cid', String(cid)); m.querySelector('[data-gex-name]').textContent = '#' + activeChannelName();
    ta.value = S.descriptions[String(cid)] || ''; ta.dispatchEvent(new Event('input')); m.hidden = false; ta.focus();
  }

  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-gex-desc-open]')) { e.preventDefault(); e.stopPropagation(); var d = document.getElementById('sml-ghx-menu'); if (d) d.classList.remove('open'); openModal(); }
  }, true);

  /* The Retail Trader Spotlight button (and its Discord-alerts button) are added by their plugin to the parent of the Edit Group button, which is the banner. Move them
     to the right-hand sidebar, under the watchlist, where nothing else lives; if there is no sidebar, into the left action stack beside Pro Tools. */
  function relocateSpotlight() {
    var head = root.querySelector('.sml-gshell__main-head'); if (!head) return;
    var found = head.querySelectorAll('[data-sml-rts-open],[data-sml-rts-dm],.sml-rts-open,.sml-rts-dm'); if (!found.length) return;
    var aside = root.querySelector('.sml-gshell__aside'), stack = root.querySelector('.sml-gshell__side-actions');
    var target = null;
    if (aside) { target = aside.querySelector('.sml-gex-rts'); if (!target) { target = document.createElement('section'); target.className = 'sml-gex-rts'; aside.appendChild(target); } }
    else if (stack) target = stack;
    Array.prototype.forEach.call(found, function (b) {
      var key = b.hasAttribute('data-sml-rts-dm') || b.classList.contains('sml-rts-dm') ? '[data-sml-rts-dm]' : '[data-sml-rts-open]';
      if (!target || target.querySelector(key)) { b.remove(); return; }   // already moved once: drop the copy the plugin re-adds
      target.appendChild(b);
    });
  }

  function sweep() { S.queued = false; renderDescription(); tooltips(); menu(); relocateSpotlight(); sweepFormatting(); }
  new MutationObserver(function () { if (S.queued) return; S.queued = true; window.requestAnimationFrame(sweep); }).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  request('groups/' + groupId + '/descriptions').then(function (p) { S.descriptions = p.descriptions || {}; S.canManage = !!p.can_manage; S.loaded = true; sweep(); }).catch(function () { sweep(); });
  sweep();
})();
