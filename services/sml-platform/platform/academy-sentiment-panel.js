/* Sentiment panel: one composite read plus the pieces behind it (news, social, options positioning, market gauges), each with its
 * own state so a missing feed shows as "not available" instead of a neutral score. History sparkline shows how the read has moved.
 * Server: /academy-activity/sentiment (Discord session + paid tier). Educational context, not a trade signal. */
(() => {
  if (window.__smlSentimentPanel) return;
  window.__smlSentimentPanel = true;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (v) => String(v || 'SPY').toUpperCase().replace(/[^A-Z0-9.-]/g, '').slice(0, 10) || 'SPY';
  const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
  const sym = () => clean(new URLSearchParams(location.search).get('symbol'));
  const KEY = 'sml-sentiment-v1';
  const S = { on: false, session: '', symbol: '', data: null, loading: false, error: '' };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) S.on = v.on === true; } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on })); } catch (_) { /* ignore */ } };
  const toolbar = document.querySelector('.toolbar');
  if (!toolbar) return;
  const style = document.createElement('style');
  style.textContent = '.sentiment-toggle{margin-left:4px;padding:5px 9px;border:1px solid #2b4a62;border-radius:7px;background:#07131d;color:#9fd2ee;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}.sentiment-toggle.on{background:#0f2a3d;color:#e3f6ff;border-color:#4fb4ee}'
    + '.academy-sentiment{margin-top:10px;border-top:1px solid #1b3540;padding-top:8px;font:600 .62rem system-ui,sans-serif;color:#c7d5dc}.academy-sentiment h4{margin:0 0 6px;font:800 .58rem ui-monospace;color:#8fd8ff;letter-spacing:.08em}'
    + '.academy-sentiment .big{display:flex;align-items:baseline;gap:8px;margin:2px 0 6px}.academy-sentiment .big b{font:800 1.15rem ui-monospace,monospace}.academy-sentiment .big span{font:700 .66rem system-ui}'
    + '.academy-sentiment .bar{position:relative;height:8px;border-radius:5px;background:linear-gradient(90deg,#ff5d6c,#3a4650 50%,#37e08f);margin:4px 0 8px}.academy-sentiment .bar i{position:absolute;top:-3px;width:3px;height:14px;background:#fff;border-radius:2px;transform:translateX(-1px)}'
    + '.academy-sentiment .comp{display:grid;grid-template-columns:62px 1fr auto;gap:2px 8px;align-items:center;margin:4px 0;font:600 .6rem ui-monospace,monospace}.academy-sentiment .comp small{grid-column:2/4;color:#7f96a3;font:500 .56rem system-ui;margin:0}'
    + '.academy-sentiment .mini{height:5px;border-radius:3px;background:#17232c;position:relative}.academy-sentiment .mini b{position:absolute;top:0;height:5px;border-radius:3px}'
    + '.academy-sentiment .pos{color:#5df0b0}.academy-sentiment .neg{color:#ff8a95}.academy-sentiment .na{color:#6f8794}.academy-sentiment .note{margin:4px 0;padding:5px 7px;border-left:2px solid #ffc247;background:#1a1608;color:#ffe2a3;font:600 .58rem system-ui}'
    + '.academy-sentiment svg{display:block;margin:6px 0}.academy-sentiment a{color:#8fd8ff}.academy-sentiment .drv{margin:2px 0;font:500 .56rem system-ui;color:#a9bcc7}'
    + '.academy-sentiment > small{display:block;margin-top:6px;color:#6f8794;font-weight:500;font-size:.54rem;line-height:1.35}';
  document.head.appendChild(style);
  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'sentiment-toggle'; btn.className = 'sentiment-toggle'; btn.textContent = 'SENTIMENT';
  btn.title = 'News, social, options and market sentiment for this ticker, with sources and coverage'; toolbar.appendChild(btn);

  window.addEventListener('sml-academy-session', (event) => { S.session = String((event.detail && event.detail.sessionToken) || ''); S.symbol = ''; S.data = null; S.error = ''; if (S.on) { void load(); paint(); } });

  async function load() {
    if (S.loading || !S.session) return;
    const symbol = sym();
    if (S.symbol === symbol && (S.data || S.error)) return;
    S.loading = true; S.error = ''; S.symbol = symbol;
    try {
      const res = await fetch('/academy-activity/sentiment?symbol=' + encodeURIComponent(symbol), { headers: { authorization: 'Bearer ' + S.session }, cache: 'no-store' });
      const payload = await res.json();
      if (res.status === 429) throw new Error('Too many requests. Try again in a moment.');
      if (!res.ok || !payload.ok) throw new Error(payload.error === 'academy_access_required' ? 'Sentiment is part of the paid Academy tools.' : 'Sentiment is temporarily unavailable.');
      S.data = payload;
    } catch (e) { S.error = String((e && e.message) || 'Sentiment is temporarily unavailable.'); S.data = null; }
    S.loading = false; paint();
  }

  const NAMES = { news: 'NEWS', social: 'SOCIAL', options: 'OPTIONS', market: 'MARKET' };
  const WHY = { no_recent_news: 'no news in the last 7 days', too_few_posts: 'too few posts', untagged_posts: 'posts carry no bull/bear tag', no_chain: 'no options chain', no_volume: 'no options volume yet', provider_error: 'feed unavailable', no_market_data: 'no index data', not_configured: 'not configured', options_math_missing: 'not available' };
  const pct = (x) => (x >= 0 ? '+' : '') + Math.round(x * 100);
  function spark(h) {
    if (!Array.isArray(h) || h.length < 3) return '';
    const w = 220, ht = 34, xs = (i) => (i / (h.length - 1)) * w, ys = (v) => ht / 2 - (v * ht) / 2.4;
    const d = h.map((p, i) => (i ? 'L' : 'M') + xs(i).toFixed(1) + ' ' + ys(p.s).toFixed(1)).join(' ');
    return '<svg viewBox="0 0 ' + w + ' ' + ht + '" width="100%" height="' + ht + '" preserveAspectRatio="none" aria-label="Sentiment history"><line x1="0" x2="' + w + '" y1="' + (ht / 2) + '" y2="' + (ht / 2) + '" stroke="#294454" stroke-dasharray="3 3"/><path d="' + d + '" fill="none" stroke="#8fd8ff" stroke-width="1.6"/></svg>';
  }
  function comp(key, c) {
    if (!c) return '';
    if (!c.available) return '<div class="comp"><span>' + NAMES[key] + '</span><span class="na">not available</span><span></span><small>' + esc(WHY[c.reason] || c.reason || '') + '</small></div>';
    const s = c.score, w = Math.min(50, Math.abs(s) * 50);
    const bar = '<div class="mini"><b style="' + (s >= 0 ? 'left:50%;background:#37e08f;' : 'right:50%;background:#ff5d6c;') + 'width:' + w + '%"></b></div>';
    let detail = '';
    if (key === 'news') detail = c.n + ' headlines (' + c.bull + ' up, ' + c.bear + ' down)' + (c.drivers && c.drivers[0] ? ' \u00b7 top: ' + (safeUrl(c.drivers[0].url) ? '<a href="' + esc(safeUrl(c.drivers[0].url)) + '" target="_blank" rel="noopener noreferrer">' + esc(c.drivers[0].title) + '</a>' : esc(c.drivers[0].title)) : '');
    if (key === 'social') detail = c.bull + ' bullish / ' + c.bear + ' bearish of ' + c.n + ' posts' + (c.postsPerHour != null ? ' \u00b7 ' + c.postsPerHour + '/hr' : '') + (c.velocityRatio != null ? ' \u00b7 ' + c.velocityRatio + 'x normal' : '');
    if (key === 'options') detail = (c.putCall && c.putCall.volume != null ? 'put/call vol ' + c.putCall.volume : '') + (c.putCall && c.putCall.openInterest != null ? ' \u00b7 OI ' + c.putCall.openInterest : '') + (c.maxPain != null ? ' \u00b7 max pain ' + c.maxPain : '') + (c.gex && c.gex.flipStrike != null ? ' \u00b7 gamma flip ' + c.gex.flipStrike : '') + (c.unusual && c.unusual.length ? ' \u00b7 ' + c.unusual.length + ' unusual' : '');
    if (key === 'market') detail = c.detail || '';
    return '<div class="comp"><span>' + NAMES[key] + '</span>' + bar + '<span class="' + (s >= 0.12 ? 'pos' : s <= -0.12 ? 'neg' : '') + '">' + pct(s) + '</span><small>' + detail + '</small></div>';
  }

  function paint() {
    const panel = document.querySelector('.academy-depth'); if (!panel) return;
    let box = document.querySelector('.academy-sentiment');
    if (!box) { box = document.createElement('div'); box.className = 'academy-sentiment'; const anchor = document.querySelector('.academy-shortsale') || document.querySelector('.academy-darkpool') || document.querySelector('.academy-buysell') || document.querySelector('.academy-stats') || panel.lastElementChild; if (anchor && anchor.parentNode === panel) anchor.after(box); else panel.appendChild(box); }
    if (!S.on) { box.style.display = 'none'; return; }
    box.style.display = '';
    if (S.symbol !== sym()) { S.data = null; S.error = ''; }
    if (!S.session) { box.innerHTML = '<h4>SENTIMENT</h4><small>Unlock Academy Tools first so Discord can verify private Academy access.</small>'; return; }
    if (S.loading) { box.innerHTML = '<h4>SENTIMENT</h4><small>Reading the news, chatter and options\u2026</small>'; return; }
    if (S.error) { box.innerHTML = '<h4>SENTIMENT</h4><small>' + esc(S.error) + '</small>'; return; }
    if (!S.data) { void load(); box.innerHTML = '<h4>SENTIMENT</h4><small>Loading\u2026</small>'; return; }
    const d = S.data;
    if (!d.available) {
      box.innerHTML = '<h4>SENTIMENT \u00b7 ' + esc(d.symbol) + '</h4><small>Not enough sources are answering to give an honest reading (' + esc(d.coverage) + '% coverage). ' + (d.notes || []).map(esc).join(' ') + '</small>'
        + Object.keys(NAMES).map((k) => comp(k, d.components && d.components[k])).join('');
      return;
    }
    const col = d.score >= 0.12 ? 'pos' : d.score <= -0.12 ? 'neg' : '';
    let h = '<h4>SENTIMENT \u00b7 ' + esc(d.symbol) + '</h4><div class="big"><b class="' + col + '">' + (d.scorePct >= 0 ? '+' : '') + d.scorePct + '</b><span class="' + col + '">' + esc(String(d.label).toUpperCase()) + '</span><span class="na">' + esc(d.coverage) + '% of sources</span></div>'
      + '<div class="bar"><i style="left:' + Math.max(1, Math.min(99, 50 + d.score * 50)).toFixed(1) + '%"></i></div>';
    h += Object.keys(NAMES).map((k) => comp(k, d.components[k])).join('');
    (d.notes || []).forEach((n) => { h += '<div class="note">' + esc(n) + '</div>'; });
    h += spark(d.history);
    h += '<small>Scores run from -100 (bearish) to +100 (bullish). News is scored from headline wording, social from StockTwits bull/bear tags, options from put/call and unusual volume, market from SPY/QQQ and VIX. Sources that are down are left out, not counted as neutral. Sentiment describes crowds, it does not predict price, and it is educational context, not a trade signal.</small>';
    box.innerHTML = h;
  }

  function sync() { btn.classList.toggle('on', S.on); }
  btn.addEventListener('click', () => { S.on = !S.on; save(); sync(); if (S.on) { S.data = null; S.error = ''; S.symbol = ''; if (S.session) void load(); } paint(); });
  window.addEventListener('sml-live-data', () => { if (S.on && S.symbol !== sym()) void load(); });
  sync(); paint();
})();
