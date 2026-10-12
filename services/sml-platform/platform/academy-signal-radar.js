'use strict';

/* Signal radar: MEM ALGO buy signals across the whole market, for the owner's desk.
 *
 * Every tick a slice of the universe (the wide scanner's liquid, moving names) is read on the day-trade (5m) and
 * swing (1D) strategies of academy-mem-algo. A fresh BUY signal that is strong enough becomes a signal card:
 * entry at the last price, a price target 10% (day) or 15% (swing) above entry, the strategy's ATR stop, and
 * why it qualified. The card is what the owner sees in the Academy; "Click to Alert" turns it into a post.
 *
 * Strength (0-100, A >= 80, B >= 65; below B is dropped): the signal is fresh, price sits above the trend with
 * the fast EMA over the slow (bias 'long'), the EMA separation is well past the strategy's minimum, the
 * strategy's own backtest on this symbol has a positive edge, and the stock is trading on unusual volume.
 *
 * Reads go through `candles(symbol, tf)` (Massive REST first), spread over time (perTick symbols a tick) so a
 * 300-name universe never bursts the data feed. Signals persist in academy_state_kv ('signal-radar'). */

const STYLES = {
  day: { label: 'Day trade', tf: '5m', mode: 'day', pct: 10, freshBars: 3, repeatMs: 20 * 3_600_000, minBars: 150 },
  swing: { label: 'Swing trade', tf: '1D', mode: 'swing', pct: 15, freshBars: 2, repeatMs: 5 * 86_400_000, minBars: 230 }
};
const KEEP = 300; // signals kept
const fin = (v) => Number.isFinite(Number(v));
const roundPrice = (p) => (p >= 1 ? Math.round(p * 100) / 100 : Math.round(p * 10000) / 10000);
const gradeOf = (score) => (score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'D');

/* Score one strategy read of one symbol. Returns null unless there is a fresh BUY. */
function judge(result, style, row = {}) {
  if (!result || !result.latest || result.latest.dir !== 1) return null;
  const bars = result.bars, age = bars - 1 - result.latest.i;
  if (age > style.freshBars) return null;
  const why = [], signals = [];
  let score = 40;
  if (result.bias === 'long') { score += 15; why.push('price above the trend EMA with the fast EMA over the slow'); } else if (result.bias === 'pullback') { score += 5; why.push('pulling back inside an uptrend'); } else return null;
  const minSep = result.params && fin(result.params.minSep) ? Number(result.params.minSep) : 0.35, sep = fin(result.latest.sep) ? Number(result.latest.sep) : 0;
  if (sep >= minSep * 2) { score += 15; why.push('EMA separation ' + sep.toFixed(2) + ' ATR, twice the minimum'); } else if (sep >= minSep * 1.4) { score += 8; why.push('EMA separation ' + sep.toFixed(2) + ' ATR'); }
  const st = result.stats || {};
  if (st.trades >= 8 && fin(st.winRate) && st.winRate >= 0.5 && fin(st.expectancyR) && st.expectancyR > 0) { score += 15; why.push('this setup has paid on ' + Math.round(st.winRate * 100) + '% of its last ' + st.trades + ' signals here'); }
  else if (st.trades >= 8 && fin(st.expectancyR) && st.expectancyR > 0) { score += 8; why.push('positive edge over the last ' + st.trades + ' signals here'); }
  const rv = fin(row.relVolume) ? Number(row.relVolume) : null;
  if (rv != null && rv >= 2) { score += 15; why.push('volume ' + rv.toFixed(1) + 'x normal'); signals.push({ text: 'VOLUME ' + rv.toFixed(1) + 'x', tone: 'ok' }); }
  else if (rv != null && rv >= 1.3) { score += 8; why.push('volume ' + rv.toFixed(1) + 'x normal'); }
  const chg = fin(row.changePct) ? Number(row.changePct) : null;
  if (chg != null && chg > 0) signals.push({ text: (chg >= 0 ? '+' : '') + chg.toFixed(1) + '% today', tone: 'ok' });
  if (age === 0) why.unshift('BUY signal on the latest ' + style.tf + ' candle'); else why.unshift('BUY signal ' + age + ' candle' + (age === 1 ? '' : 's') + ' ago on the ' + style.tf + ' chart');
  score = Math.min(100, score);
  return { score, grade: gradeOf(score), why, signals, age };
}

function createSignalRadar({ universe, candles, analyze, store = null, state = null, push = null, logger = () => {}, now = Date.now, perTick = 25, enabled = true } = {}) {
  let signals = [], loaded = false, running = false, cursor = 0, list = [], listAt = 0;
  const lastSeen = new Map(); // symbol:style -> at of the last signal
  async function load() {
    if (loaded || !store) { loaded = true; return; }
    try { const s = await store.read(); if (s && Array.isArray(s.signals)) { signals = s.signals.slice(-KEEP); for (const x of signals) lastSeen.set(x.symbol + ':' + x.style, x.at); } } catch (_) { /* fresh start */ }
    loaded = true;
  }
  const save = () => (store ? Promise.resolve(store.write({ signals: signals.slice(-KEEP) })).catch((error) => logger('warn', 'signal_radar_save_failed', { error })) : Promise.resolve());

  /* which styles to read now: intraday signals only make sense in the regular session; daily ones any time the market traded today */
  function stylesNow() {
    const st = typeof state === 'function' ? state() : null;
    if (!st) return ['day', 'swing'];
    if (st.tradingDay === false) return [];
    if (st.session === 'regular') return ['day', 'swing'];
    return ['swing'];
  }

  async function readSymbol(row, styleKeys) {
    const symbol = String(row.symbol || '').toUpperCase(), out = [];
    for (const key of styleKeys) {
      const style = STYLES[key];
      const seen = lastSeen.get(symbol + ':' + key) || 0;
      if (now() - seen < style.repeatMs) continue;
      let bars;
      try { bars = (await candles(symbol, style.tf)).bars; } catch (_) { continue; }
      if (!Array.isArray(bars) || bars.length < style.minBars) continue;
      let result;
      try { result = analyze(bars, style.mode, {}, style.tf); } catch (_) { continue; }
      const j = judge(result, style, row);
      if (!j || j.grade !== 'A' && j.grade !== 'B') continue;
      const entry = roundPrice(Number(bars[bars.length - 1].c));
      if (!(entry > 0)) continue;
      const stop = fin(result.latest.stop) && Number(result.latest.stop) < entry ? roundPrice(Number(result.latest.stop)) : roundPrice(entry * 0.95);
      const t = now();
      out.push({ id: symbol + ':' + key + ':' + t, symbol, style: key, label: style.label, tf: style.tf, at: t, barAt: Number(result.latest.t) || t, entry, target: roundPrice(entry * (1 + style.pct / 100)), pct: style.pct, stop, side: 'long',
        score: j.score, grade: j.grade, why: j.why, signals: j.signals, bias: result.bias, name: String(row.name || ''), rank: fin(row.liveRank) ? Number(row.liveRank) : null, relVolume: fin(row.relVolume) ? Number(row.relVolume) : null, changePct: fin(row.changePct) ? Number(row.changePct) : null });
      lastSeen.set(symbol + ':' + key, t);
    }
    return out;
  }

  async function tick() {
    if (!enabled || running) return { ran: false };
    running = true;
    const out = { read: 0, found: 0, styles: [] };
    try {
      await load();
      const styleKeys = stylesNow(); out.styles = styleKeys;
      if (!styleKeys.length) return { ran: true, ...out };
      if (!list.length || cursor >= list.length || now() - listAt > 30 * 60_000) {
        try { list = ((await universe()) || []).filter((r) => r && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(String(r.symbol || '').toUpperCase())); } catch (error) { logger('warn', 'signal_radar_universe_failed', { error }); list = []; }
        listAt = now(); cursor = 0;
      }
      const slice = list.slice(cursor, cursor + perTick); cursor += perTick;
      const found = [];
      for (const row of slice) { out.read++; try { found.push(...await readSymbol(row, styleKeys)); } catch (error) { logger('warn', 'signal_radar_symbol_failed', { symbol: row.symbol, error: String(error && error.message || error) }); } }
      if (found.length) {
        signals = signals.concat(found).slice(-KEEP); out.found = found.length;
        await save();
        for (const s of found) { logger('info', 'signal_radar_buy', { symbol: s.symbol, style: s.style, grade: s.grade, entry: s.entry, target: s.target }); if (typeof push === 'function') { try { push(s); } catch (error) { logger('warn', 'signal_radar_push_failed', { error }); } } }
      }
    } finally { running = false; }
    return { ran: true, ...out };
  }
  /* newest first; `since` in ms */
  const recent = (since = 0, limit = 40) => signals.filter((s) => s.at > since).sort((a, b) => b.at - a.at).slice(0, Math.max(1, Math.min(200, Number(limit) || 40)));
  const status = () => ({ enabled, signals: signals.length, universe: list.length, cursor, styles: stylesNow() });
  return { tick, recent, status, load, judge, STYLES };
}

module.exports = { createSignalRadar, judge, STYLES };
