/* Active Buy/Sell panel for the Academy Live Chart Lab: a Moomoo-style live gauge of who is in
 * control right now, built entirely from the lift-the-offer/hit-the-bid classification the massive
 * stream already computes per trade (window.smlLive.stats). Two windows are shown side by side —
 * the last minute and the last five — so a reader can tell a fresh shift in pressure from the
 * session's broader tone, and one line ties that pressure to where price is trading relative to
 * VWAP: real relativity to other data already collected on the same underlying, not a second,
 * disconnected number. Educational display only: nothing here places a trade. */
(() => {
  if (window.__smlBuySell) return;
  window.__smlBuySell = true;
  const $ = (id) => document.getElementById(id);
  const num = (v, d = 2) => (Number.isFinite(v) ? Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
  const compact = (v) => (Number.isFinite(v) ? Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(v) : '–');
  const sym = () => String(new URLSearchParams(location.search).get('symbol') || 'SPY').toUpperCase();

  const KEY = 'sml-buy-sell-v1';
  const S = { on: false };
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v) S.on = v.on === true; } catch (_) { /* storage can be blocked */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ on: S.on })); } catch (_) { /* ignore */ } };

  const toolbar = document.querySelector('.toolbar');
  if (!toolbar) return;
  const style = document.createElement('style');
  style.textContent = '.buysell-toggle{margin-left:4px;padding:5px 9px;border:1px solid #2b5362;border-radius:7px;background:#0d1a24;color:#9ed3e6;font:800 .64rem ui-monospace,monospace;letter-spacing:.06em;cursor:pointer}.buysell-toggle.on{background:#12405a;border-color:#4dc3ff;color:#fff}'
    + '.academy-buysell{margin-top:10px;border-top:1px solid #1b3540;padding-top:8px;font:600 .62rem system-ui,sans-serif;color:#c7d5dc}.academy-buysell h4{margin:0 0 6px;font:800 .58rem ui-monospace;color:#86a2b0;letter-spacing:.06em}'
    + '.academy-buysell .row{display:flex;justify-content:space-between;align-items:baseline;margin:6px 0 2px}.academy-buysell .row b{font:800 .82rem ui-monospace,monospace}.academy-buysell .row span{font:700 .58rem ui-monospace;color:#8fa6b3}'
    + '.academy-buysell .bar{display:flex;height:14px;border-radius:7px;overflow:hidden;background:#16303a;margin:3px 0 10px}.academy-buysell .bar i{display:block;height:100%}'
    + '.academy-buysell .up{color:#5df0b0}.academy-buysell .dn{color:#ff8ea1}.academy-buysell .lead{font-weight:800}'
    + '.academy-buysell small{display:block;margin-top:4px;color:#6f8794;font-weight:500;font-size:.54rem;line-height:1.35}';
  document.head.appendChild(style);

  const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'buysell-toggle'; btn.className = 'buysell-toggle'; btn.textContent = 'BUY/SELL'; btn.title = 'Active buy vs. sell pressure over the last minute and five minutes'; toolbar.appendChild(btn);

  function gauge(label, buy, sell, neu) {
    const tot = Math.max(1, buy + sell + neu), pb = buy / tot * 100, pn = neu / tot * 100, ps = 100 - pb - pn;
    const lead = buy === sell ? 'even' : buy > sell ? 'buyers' : 'sellers';
    const ratio = sell > 0 ? buy / sell : (buy > 0 ? Infinity : 1);
    return '<div class="row"><span>' + label + '</span><b class="' + (lead === 'buyers' ? 'up' : lead === 'sellers' ? 'dn' : '') + '">'
      + (lead === 'even' ? 'EVEN' : (lead === 'buyers' ? '▲ BUYERS ' : '▼ SELLERS ') + (Number.isFinite(ratio) ? (lead === 'buyers' ? ratio : 1 / ratio).toFixed(1) + '×' : 'all'))
      + '</b></div><div class="bar"><i style="width:' + pb.toFixed(1) + '%;background:#00d084" title="Buy ' + compact(buy) + ' sh"></i><i style="width:' + pn.toFixed(1) + '%;background:#6f8794" title="Neutral ' + compact(neu) + ' sh"></i><i style="width:' + ps.toFixed(1) + '%;background:#ff5470" title="Sell ' + compact(sell) + ' sh"></i></div>';
  }

  function relativity(st, last) {
    const bits = [];
    if (Number.isFinite(st.vwap) && Number.isFinite(last)) {
      const side = last > st.vwap ? 'above' : last < st.vwap ? 'below' : 'at';
      const buyLean = st.buy60 > st.sell60;
      const aligned = (side === 'above' && buyLean) || (side === 'below' && !buyLean && st.sell60 > st.buy60);
      bits.push('Price is trading ' + side + ' VWAP ($' + num(st.vwap) + ') while the last minute is ' + (buyLean ? 'buy' : (st.sell60 > st.buy60 ? 'sell' : 'even')) + '-led'
        + (aligned ? ' — pressure and location agree.' : (side !== 'at' ? ' — pressure has not caught up with location yet.' : '.')));
    }
    const accel = st.buy300 + st.sell300 > 0 ? (st.buy60 + st.sell60) / Math.max(1, (st.buy300 + st.sell300) / 5) : null;
    if (Number.isFinite(accel) && accel > 0) bits.push(accel >= 1.4 ? 'Volume is picking up: the last minute is running ' + accel.toFixed(1) + '× the five-minute average pace.' : accel <= 0.6 ? 'Volume is cooling off versus the last five minutes.' : 'Pace is steady versus the last five minutes.');
    return bits.join(' ');
  }

  function paint() {
    const panel = document.querySelector('.academy-depth'); if (!panel) return;
    let box = document.querySelector('.academy-buysell');
    if (!box) { box = document.createElement('div'); box.className = 'academy-buysell'; const stats = document.querySelector('.academy-stats'), tape = document.querySelector('.academy-tape'); (stats || tape || panel).after(box); }
    if (!S.on) { box.style.display = 'none'; return; }
    box.style.display = '';
    const L = window.smlLive, st = L && L.symbol === sym() ? L.stats : null;
    if (!st || !st.count) { box.innerHTML = '<h4>ACTIVE BUY / SELL</h4><small>Collecting trades. The live buy/sell gauge fills in as prints arrive.</small>'; return; }
    box.innerHTML = '<h4>ACTIVE BUY / SELL · LIVE</h4>'
      + gauge('LAST 1 MIN', st.buy60 || 0, st.sell60 || 0, st.neu60 || 0)
      + gauge('LAST 5 MIN', st.buy300 || 0, st.sell300 || 0, st.neu300 || 0)
      + '<small>' + relativity(st, L.last) + ' Lift = trade at the ask, hit = trade at the bid. Educational only — this describes recent pressure, not a signal to trade.</small>';
  }

  function sync() { btn.classList.toggle('on', S.on); }
  btn.addEventListener('click', () => { S.on = !S.on; save(); sync(); paint(); });
  window.addEventListener('sml-live-data', paint);
  sync(); paint();
})();
