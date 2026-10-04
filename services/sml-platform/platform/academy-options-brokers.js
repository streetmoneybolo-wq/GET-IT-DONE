/* Buy buttons for the Academy options chain. Click a contract in the chain and this bar names it (SPY Dec 19 2025 600 Call, OCC symbol SPY251219C00600000) and offers the same
   brokers as the chart: moomoo, Webull, Robinhood and eToro. Brokers do not publish links to a single contract, so each button copies the contract symbol and opens the broker as
   close as it allows (the stock, or Robinhood's options chain for it); pasting the symbol into the broker's search lands on the contract. Quote pages only: nothing is ever
   traded from the Academy and every order is reviewed and placed by the member in their own broker. Needs window.SmlOptionContract. */
(function boot(tries) {
  if (window.__smlOptionsBrokers) return;
  const OC = window.SmlOptionContract, card = document.querySelector('#options-dock .opt-calc'), grid = document.getElementById('options-grid');
  if (!OC || !card || !grid) { if (tries < 150) setTimeout(() => boot(tries + 1), 200); return; }
  window.__smlOptionsBrokers = true;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(String(v == null ? '' : v).replace(/[^0-9.-]/g, '')); return Number.isFinite(n) && String(v).trim() !== '' && String(v).trim() !== '—' ? n : null; };

  const css = document.createElement('style');
  css.textContent = '.opt-buy{margin-top:12px;padding:10px;border:1px solid #2a4a58;border-radius:8px;background:#07121b}.opt-buy h3{margin:0 0 6px;font:800 .62rem ui-monospace,monospace;letter-spacing:.06em;color:#9cc8ff}'
    + '.opt-buy .ct{display:flex;gap:6px;align-items:center;margin-bottom:6px}.opt-buy .ct b{flex:1;color:#fff;font:800 .74rem system-ui}.opt-buy .ct code{font:700 .62rem ui-monospace,monospace;color:#ffd166;word-break:break-all}'
    + '.opt-buy .row{display:flex;flex-wrap:wrap;gap:6px}.opt-buy button{border:1px solid #2f6cf5;border-radius:6px;background:#12233f;color:#9cc0ff;font:800 .64rem system-ui;padding:6px 9px;cursor:pointer;white-space:nowrap}.opt-buy button:disabled{opacity:.45;cursor:not-allowed}'
    + '.opt-buy button[data-b=moomoo]{border-color:#ff7a1a;background:#2e1707;color:#ffb877}.opt-buy button[data-b=webull]{border-color:#1f8fff;background:#0d2238;color:#8fc8ff}.opt-buy button[data-b=robinhood]{border-color:#2fbf4f;background:#0f2a17;color:#9ff0b0}.opt-buy button[data-b=etoro]{border-color:#13c636;background:#0c2a14;color:#8ff0a6}'
    + '.opt-buy .copy{border-color:#3a6fb0;background:#0d1f33;color:#9cc8ff}.opt-buy .hint{margin:6px 0 0;color:#7f97a4;font-size:.58rem;line-height:1.4;font-weight:500}.opt-buy .hint.ok{color:#a8ffd8}';
  document.head.appendChild(css);

  const bar = document.createElement('div'); bar.className = 'opt-buy'; bar.id = 'opt-buy'; card.appendChild(bar);
  let C = null;
  const open = (url) => { if (typeof window.smlAcademyOpenExternal === 'function') void window.smlAcademyOpenExternal(url); else { try { window.open(url, '_blank', 'noopener'); } catch (_) { /* ignore */ } } };
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch (_) { /* the Activity frame can block the clipboard API */ }
    try { const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return !!ok; } catch (_) { return false; }
  }
  function say(text, ok) { const h = bar.querySelector('.hint'); if (h) { h.textContent = text; h.className = 'hint' + (ok ? ' ok' : ''); } }
  function render() {
    const links = C ? OC.links(C) : [];
    bar.innerHTML = '<h3>BUY THIS CONTRACT ON YOUR BROKER</h3>'
      + (C ? '<div class="ct"><b>' + esc(OC.describe(C)) + '</b><button type="button" class="copy" data-copy="1" title="Copy the contract symbol">Copy symbol</button></div><div class="ct"><code>' + esc(OC.occSymbol(C)) + '</code></div>' : '<div class="ct"><b style="color:#7f97a4;font-weight:600">Click a contract in the options chain.</b></div>')
      + '<div class="row">' + ['moomoo', 'webull', 'robinhood', 'etoro'].map((k) => { const l = links.find((x) => x.key === k); return '<button type="button" data-b="' + k + '"' + (l ? '' : ' disabled') + (l ? ' title="' + esc(l.note) + '"' : '') + '>' + (k === 'moomoo' ? 'moomoo' : k === 'webull' ? 'Webull' : k === 'robinhood' ? 'Robinhood' : 'eToro') + ' ↗</button>'; }).join('') + '</div>'
      + '<p class="hint">' + (C ? 'Each button copies the contract symbol and opens the broker; paste the symbol into its search to land on this contract. Nothing is traded from the Academy.' : 'Quote pages only. Any order is reviewed and placed by you in your own broker.') + '</p>';
  }
  render();

  // the chain's rows are: call columns | strike (cell 10) | put columns. A click on either side picks that contract.
  grid.addEventListener('click', (e) => {
    const td = e.target.closest && e.target.closest('td'), tr = td && td.parentElement; if (!tr || !tr.cells || tr.cells.length < 21) return;
    const strike = num(tr.cells[10].textContent); if (strike == null) return;
    const exp = $('options-expiry'), expiry = exp ? String(exp.value || (exp.selectedOptions[0] || {}).textContent || '') : '';
    const m = /[0-9]{4}-[0-9]{2}-[0-9]{2}/.exec(expiry), sym = String(($('symbol') || {}).value || new URLSearchParams(location.search).get('symbol') || 'SPY');
    C = OC.contract({ symbol: sym, expiry: m ? m[0] : '', strike, side: td.cellIndex > 10 ? 'put' : 'call' });
    render();
  });
  bar.addEventListener('click', async (e) => {
    if (!C) return;
    if (e.target.closest('[data-copy]')) { say((await copy(OC.occSymbol(C))) ? 'Copied ' + OC.occSymbol(C) + '.' : 'Select the symbol above and copy it.', true); return; }
    const b = e.target.closest('[data-b]'); if (!b) return;
    const link = OC.links(C).find((x) => x.key === b.dataset.b); if (!link) return;
    const ok = await copy(OC.occSymbol(C));
    say((ok ? 'Copied ' + OC.occSymbol(C) + '. ' : '') + link.note, ok);
    open(link.url);
  });
})(0);
