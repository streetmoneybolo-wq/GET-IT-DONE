/* Tick interval picker for the Academy chart: a candle every N trades (10, 25, 50, 100, 250, 500, 1000) instead of every N minutes.
 * The picker sits with the 1m-1Y buttons; choosing a size loads that tick chart for the symbol on screen, and the page's own refresh
 * keeps it current. Tick candles are built from the trades the Academy has seen for the symbol, so a symbol opened for the first time
 * fills in as trades print. */
(() => {
  if (window.__smlAcademyTicks) return;
  window.__smlAcademyTicks = 1;
  const SIZES = [10, 25, 50, 100, 250, 500, 1000];
  const tfNow = () => new URLSearchParams(location.search).get('tf') || '5m';
  const isTick = (tf) => /^[0-9]{1,4}T$/.test(tf);

  const style = document.createElement('style');
  style.textContent = '#academy-tick{background:#101e27;color:#9eb2bc;border:1px solid #294554;border-radius:5px;padding:5px 6px;font:800 .7rem system-ui;cursor:pointer;margin-left:2px}'
    + '#academy-tick.on{border-color:#00c47d;background:#0b3b2e;color:#7ef0bd}#academy-tick-note{display:none;margin:4px 0 0;color:#ffd166;font:600 .66rem system-ui}';
  document.head.appendChild(style);

  const sel = document.createElement('select');
  sel.id = 'academy-tick'; sel.setAttribute('aria-label', 'Tick interval (a candle every N trades)'); sel.title = 'Tick interval: a new candle every N trades';
  sel.innerHTML = '<option value="">Ticks</option>' + SIZES.map((n) => '<option value="' + n + 'T">' + n + ' tick</option>').join('');
  const note = document.createElement('p'); note.id = 'academy-tick-note';

  function sync() {
    const tf = tfNow();
    sel.value = isTick(tf) && SIZES.includes(parseInt(tf, 10)) ? tf : '';
    sel.classList.toggle('on', isTick(tf));
  }
  function showNote(text) { note.textContent = text || ''; note.style.display = text ? 'block' : 'none'; }

  sel.onchange = async () => {
    if (!sel.value) { window.smlAcademyNavigateMarket && window.smlAcademyNavigateMarket(document.getElementById('symbol').value, '5m'); return; }
    showNote('');
    const symbol = String(document.getElementById('symbol').value || 'SPY').toUpperCase();
    try {
      const res = await fetch('/academy-activity/market?symbol=' + encodeURIComponent(symbol) + '&tf=' + encodeURIComponent(sel.value), { cache: 'no-store' });
      if (res.status === 503) {
        const j = await res.json().catch(() => ({}));
        showNote(j.error === 'ticks_warming' ? 'Collecting trades for ' + symbol + '. Tick candles appear as trades print — try again in a moment.' : 'Tick candles are not available right now.');
        sync(); return;
      }
    } catch (_) { /* the navigate below reports a failed load */ }
    if (window.smlAcademyNavigateMarket) window.smlAcademyNavigateMarket(symbol, sel.value);
  };

  function mount() {
    const row = document.querySelector('.intervals');
    if (!row || document.getElementById('academy-tick')) return !!row;
    row.appendChild(sel);
    const toolbar = row.parentElement; if (toolbar) toolbar.appendChild(note);
    sync();
    return true;
  }
  let tries = 0;
  const timer = setInterval(() => { if (mount() || ++tries > 40) clearInterval(timer); }, 250);
  window.addEventListener('sml-academy-market', sync);
  document.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('[data-tf]')) setTimeout(sync, 50); });
})();
