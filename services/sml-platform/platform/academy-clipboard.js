/* Academy clipboard: members can select text (click, hold, drag), copy it, and paste into any box, for example the song link on
 * their profile. Three things get in the way inside the Discord Activity frame, and this file removes each of them:
 *   1. a panel or chart handler that cancels copy / cut / paste / selectstart, or a hotkey that swallows Ctrl+C / Ctrl+V;
 *   2. a frame that does not hand the clipboard to a plain Ctrl+V (the paste lands nowhere): the clipboard is read through the
 *      Clipboard API instead and written into the box;
 *   3. a frame that does not copy a selection on Ctrl+C: the selection is written through the Clipboard API (or execCommand).
 * Every box in the profile editor also gets a Paste button, and the profile song link gets a Copy button, for phones and for
 * frames where keyboard shortcuts do not reach the page at all. Nothing here cancels a default action. */
(() => {
  if (window.__smlAcademyClipboard) return;
  window.__smlAcademyClipboard = 1;

  /* 1a. text is selectable everywhere except on the drag handles and buttons, which keep their own user-select:none */
  const style = document.createElement('style');
  style.textContent = 'html,body,main,section,article,p,span,div,li,td,th,pre,code,label,h1,h2,h3,h4,h5,h6{-webkit-user-select:text;user-select:text}'
    + 'input,textarea,[contenteditable="true"]{-webkit-user-select:text!important;user-select:text!important;-webkit-touch-callout:default}'
    + '#pv-view *,#pv-edit *,.sml-win *,#sml-chat *{-webkit-user-select:text;user-select:text}'
    + '#pv-view button,#pv-edit button,.sml-wh,.sml-ph,.sml-wh *,.sml-ph *,#sml-desk-bar,#sml-desk-bar *{-webkit-user-select:none;user-select:none}'
    + '.sml-clip-btn{margin-left:6px;padding:5px 9px;border:1px solid #2b4b5a;border-radius:6px;background:#0c1821;color:#cfe3ea;font:800 11px system-ui,sans-serif;cursor:pointer;white-space:nowrap;-webkit-user-select:none;user-select:none}'
    + '.sml-clip-btn:hover{border-color:#00c47d;color:#fff}.sml-clip-row{display:flex;align-items:center;gap:0}.sml-clip-row>input{flex:1;min-width:0}'
    + '#sml-clip-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483646;max-width:92vw;padding:9px 14px;border-radius:999px;background:#0c1821;border:1px solid #00c47d;color:#fff;font:700 12px system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.55);pointer-events:none;opacity:0;transition:opacity .18s}'
    + '#sml-clip-toast.on{opacity:1}';
  document.head.appendChild(style);

  let toastEl = null, toastTimer = 0;
  function toast(text) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'sml-clip-toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = text; toastEl.classList.add('on');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('on'), 2200);
  }

  const isField = (el) => !!el && ((el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|range|color|file)$/i.test(el.type || '')) || el.tagName === 'TEXTAREA' || el.isContentEditable);

  /* 1b. a handler elsewhere on the page can never cancel these (the default action is left alone) */
  for (const type of ['copy', 'cut', 'paste', 'selectstart']) {
    window.addEventListener(type, (e) => { e.stopImmediatePropagation(); }, true);
  }
  /* ...and Ctrl/Cmd + A, C, V, X (and Shift+Insert) never reach a chart or desk hotkey */
  const SHORTCUT = new Set(['a', 'c', 'v', 'x']);
  const isShortcut = (e) => ((e.ctrlKey || e.metaKey) && !e.altKey && SHORTCUT.has(String(e.key || '').toLowerCase())) || (e.shiftKey && e.key === 'Insert');

  /* 2. writing into a field the way a real paste would: caret / selection replaced, input event fired */
  function insertInto(el, text) {
    if (!el || !text) return false;
    try {
      if (el.isContentEditable) { document.execCommand('insertText', false, text); return true; }
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : el.value.length;
      let clean = String(text);
      if (el.tagName === 'INPUT') clean = clean.replace(/[\r\n]+/g, ' ').trim();
      if (el.maxLength > 0) clean = clean.slice(0, Math.max(0, el.maxLength - (el.value.length - (end - start))));
      el.focus();
      el.setRangeText(clean, start, end, 'end');
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    } catch (_) { return false; }
  }
  async function readClipboard() {
    try { if (navigator.clipboard && navigator.clipboard.readText) return await navigator.clipboard.readText(); } catch (_) { /* blocked in this frame */ }
    return null;
  }

  let pasteSeen = 0;
  document.addEventListener('paste', () => { pasteSeen = Date.now(); }, true);
  let copySeen = 0;
  document.addEventListener('copy', () => { copySeen = Date.now(); }, true);

  window.addEventListener('keydown', (e) => {
    if (!isShortcut(e)) return;
    e.stopImmediatePropagation(); /* no chart or desk hotkey sees it; the browser still acts on it */
    const key = String(e.key || '').toLowerCase();
    const t = document.activeElement;
    if ((key === 'v' || e.key === 'Insert') && isField(t)) {
      /* if the frame delivers no paste event, read the clipboard ourselves */
      const before = t.value, started = Date.now();
      setTimeout(async () => {
        if (pasteSeen >= started || t.value !== before) return;
        const text = await readClipboard();
        if (text) insertInto(t, text); else toast('Paste blocked here. Use the Paste button, or long-press and choose Paste.');
      }, 140);
    }
    if (key === 'c' || key === 'x') {
      const started = Date.now();
      const sel = String(window.getSelection ? window.getSelection() : '').toString()
        || (isField(t) && typeof t.selectionStart === 'number' ? t.value.slice(t.selectionStart, t.selectionEnd) : '');
      if (!sel) return;
      setTimeout(() => { if (copySeen < started) writeClipboard(sel, key === 'x' ? t : null); }, 140);
    }
  }, true);

  async function writeClipboard(text, cutFrom) {
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(text); ok = true; } } catch (_) { /* fall through */ }
    if (!ok) {
      try {
        const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
        document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove();
      } catch (_) { ok = false; }
    }
    if (ok && cutFrom && isField(cutFrom) && typeof cutFrom.selectionStart === 'number') { insertInto(cutFrom, ''); try { cutFrom.setRangeText('', cutFrom.selectionStart, cutFrom.selectionEnd, 'end'); cutFrom.dispatchEvent(new Event('input', { bubbles: true })); } catch (_) { /* fine */ } }
    toast(ok ? 'Copied' : 'Copy blocked here. Select the text and press Ctrl+C (or long-press, Copy).');
    return ok;
  }
  window.smlCopyText = (text) => writeClipboard(String(text == null ? '' : text));

  /* 3. Paste / Copy buttons on the profile editor and the song link (phones, and frames that eat shortcuts) */
  function pasteButton(input) {
    if (input.dataset.clipWrapped) return;
    input.dataset.clipWrapped = '1';
    const row = document.createElement('div'); row.className = 'sml-clip-row';
    input.parentNode.insertBefore(row, input); row.appendChild(input);
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sml-clip-btn'; b.textContent = 'Paste'; b.title = 'Paste from your clipboard';
    b.addEventListener('mousedown', (e) => e.preventDefault()); /* keep the caret in the box */
    b.addEventListener('click', async () => {
      const text = await readClipboard();
      if (text) { input.focus(); if (isField(input) && input.value && input.selectionStart === input.selectionEnd) { input.select(); } insertInto(input, text); toast('Pasted'); }
      else { input.focus(); toast('Your frame blocked the clipboard. Press Ctrl+V in the box, or long-press it and choose Paste.'); }
    });
    row.appendChild(b);
  }
  function sweep() {
    const edit = document.getElementById('pv-edit');
    if (edit) edit.querySelectorAll('input[type=url],input[type=text],textarea').forEach((el) => { if (el.tagName !== 'TEXTAREA') pasteButton(el); });
    document.querySelectorAll('#pv-view .pv-song:not([data-clip]),#academy-profile-card .pv-song:not([data-clip])').forEach((box) => {
      box.setAttribute('data-clip', '1');
      const a = box.querySelector('a[href]');
      const url = a ? a.href : '';
      if (!url) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'sml-clip-btn'; b.textContent = 'Copy link';
      b.addEventListener('click', (e) => { e.stopPropagation(); void writeClipboard(url); });
      box.appendChild(b);
    });
  }
  let queued = 0;
  const schedule = () => { if (queued) return; queued = setTimeout(() => { queued = 0; sweep(); }, 60); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
  sweep();
})();
