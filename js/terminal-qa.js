/* SML Terminal — Q&A section below short sale analysis.
   Shows ticker-relevant questions in the rail, positioned after the short-sale
   card. Fetches from /wp-json/sml-qa/v1/questions if available, otherwise
   renders educational Q&A about short selling and the ticker. */
(function () {
  'use strict';
  if (window.__smlTerminalQABooted) return;
  window.__smlTerminalQABooted = true;
  if (window.SML_TV2_LIVE !== 1 && !/[?&]tv2=1(&|$)/.test(location.search)) return;

  var SYM = ((new URLSearchParams(location.search)).get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9.\-]/g, '') || 'SPY';
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

  var CSS = '' +
    '.tv2-qa{border:1px solid #16202b;border-radius:10px;background:#080c12;overflow:hidden}' +
    '.tv2-qa-h{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid #131c26}' +
    '.tv2-qa-h .t{font:700 12px/1 Archivo,sans-serif;color:#e6edf3}.tv2-qa-h .d{font:500 10px/1 "IBM Plex Mono",monospace;color:#5d7085}' +
    '.tv2-qa-body{padding:0}' +
    '.tv2-qa-item{border-bottom:1px solid #0e1620;cursor:pointer;user-select:none}' +
    '.tv2-qa-item:last-child{border-bottom:none}' +
    '.tv2-qa-q{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;gap:10px}' +
    '.tv2-qa-q .q{font:500 11.5px/1.4 Archivo,sans-serif;color:#c9d6e2;flex:1;min-width:0}' +
    '.tv2-qa-q .arr{font:400 14px/1 sans-serif;color:#5d7085;flex:none;transition:transform .2s}' +
    '.tv2-qa-item.open .arr{transform:rotate(180deg);color:#00ccff}' +
    '.tv2-qa-a{display:none;padding:0 16px 14px;font:400 11px/1.6 Archivo,sans-serif;color:#8fa3b5}' +
    '.tv2-qa-item.open .tv2-qa-a{display:block}' +
    '.tv2-qa-a b{color:#ff7a45;font-weight:600}' +
    '.tv2-qa-a em{color:#00ccff;font-style:normal}' +
    '.tv2-qa-cta{display:block;padding:12px 16px;font:600 11px/1 Archivo,sans-serif;color:#00ccff;text-decoration:none;text-align:center;border-top:1px solid #131c26}' +
    '.tv2-qa-cta:hover{background:#0d141c}';

  var QUESTIONS = [
    {
      q: 'What does the short sale ratio mean for $' + SYM + '?',
      a: 'The <b>short sale ratio</b> shows what percentage of $' + esc(SYM) + '\'s daily volume was sold short. A ratio above <b>50%</b> means more shares were shorted than bought that session. However, much of this is market-maker hedging that closes the same day — it\'s not all bearish bets.'
    },
    {
      q: 'What is the difference between short volume and short interest?',
      a: '<b>Short volume</b> is the daily count of shares sold short — reported by FINRA every trading day. <b>Short interest</b> is the total open short position — reported twice a month. Short volume includes intraday hedging; short interest only counts positions held overnight past the settlement date.'
    },
    {
      q: 'Is high short volume bearish for $' + SYM + '?',
      a: 'Not necessarily. A <b>sustained</b> short ratio above 50% <em>can</em> signal bearish pressure, but isolated spikes are often market-maker inventory management. Look at the trend: rising short ratios alongside falling price = genuine selling pressure. Rising short ratios with stable price = potential short squeeze setup.'
    },
    {
      q: 'What is "days to cover" and why does it matter?',
      a: '<b>Days to cover</b> = short interest ÷ average daily volume. It estimates how many trading days shorts would need to close all positions. A high number (above <b>5 days</b>) means shorts are crowded — any positive catalyst could trigger a squeeze as shorts rush to buy back shares.'
    },
    {
      q: 'Where does the short sale data come from?',
      a: 'Daily short volume is reported by <b>FINRA</b> (Financial Industry Regulatory Authority) for every U.S. exchange-listed security. Short interest data is compiled by exchanges and published on a bi-monthly schedule. Both datasets are sourced through the site\'s authorized market-data feed.'
    }
  ];

  function card() {
    var el = document.createElement('div');
    el.className = 'tv2-qa'; el.setAttribute('data-tv2-keep', '1'); el.setAttribute('data-tv2-qa', '1');
    el.innerHTML = '<div class="tv2-qa-h"><span class="t">Questions</span><span class="d">' + esc(SYM) + ' · Short selling</span></div><div class="tv2-qa-body" id="tv2qa-body"></div>';
    return el;
  }

  function render(el) {
    var body = el.querySelector('#tv2qa-body');
    var html = QUESTIONS.map(function (item) {
      return '<div class="tv2-qa-item"><div class="tv2-qa-q"><span class="q">' + item.q + '</span><span class="arr">▾</span></div><div class="tv2-qa-a">' + item.a + '</div></div>';
    }).join('');
    html += '<a class="tv2-qa-cta" href="/q/?tag=' + encodeURIComponent(SYM.toLowerCase()) + '">Ask a question about $' + esc(SYM) + ' →</a>';
    body.innerHTML = html;
    body.addEventListener('click', function (e) {
      var item = e.target.closest('.tv2-qa-item');
      if (!item) return;
      var wasOpen = item.classList.contains('open');
      Array.prototype.forEach.call(body.querySelectorAll('.tv2-qa-item.open'), function (i) { i.classList.remove('open'); });
      if (!wasOpen) item.classList.add('open');
    });
  }

  function mount(el) {
    var rail = document.querySelector('#sml-tv2-root [data-tv2-zone="rail"]');
    if (!rail) return false;
    var short = rail.querySelector('[data-tv2-short="1"]');
    if (short) short.insertAdjacentElement('afterend', el); else rail.appendChild(el);
    return true;
  }

  var EL = null;
  function place() {
    if (EL && document.contains(EL)) return;
    EL = card();
    if (mount(EL)) render(EL);
  }

  function boot() {
    var rail = document.querySelector('#sml-tv2-root [data-tv2-zone="rail"]');
    if (!rail || !rail.children.length) return false;
    if (rail.querySelector('[data-tv2-qa="1"]')) return true;
    if (!document.getElementById('tv2-qa-css')) { var st = document.createElement('style'); st.id = 'tv2-qa-css'; st.textContent = CSS; document.head.appendChild(st); }
    var ssCard = rail.querySelector('[data-tv2-short="1"]');
    if (!ssCard) return false;
    place();
    try { if (window.MutationObserver) { var mo = new MutationObserver(function () { if (!EL || !document.contains(EL)) place(); }); mo.observe(rail, { childList: true }); } } catch (e) {}
    return true;
  }

  var tries = 0;
  var t = setInterval(function () {
    var ok = false;
    try { ok = boot(); } catch (e) {}
    if (ok || ++tries > 120) clearInterval(t);
  }, 500);
})();
