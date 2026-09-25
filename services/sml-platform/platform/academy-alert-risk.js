'use strict';

/* Risk grading, company checklist and the auto-updating plan for the Academy alerts desk.
 *
 * Everything here is pure: give it what is known about an alert and it returns a grade, a checklist and a plan. Nothing is fetched and nothing is ordered.
 * Any input can be missing; a factor with no data is left out and the score is scaled over what is available, so a thin data day never invents a number.
 *
 * RISK (0-100, higher = riskier), by channel:
 *   swings     penny and small-cap swing alerts: price level, volatility, liquidity, extension, target realism, trend + MEM ALGO, company health, short pressure,
 *              chatter, market/sector, offerings
 *   longterm   position alerts: company quality, valuation, balance sheet, drawdown/volatility, trend + MEM ALGO, size, market/sector, offerings, chatter
 * Bands: LOW 0-24, MODERATE 25-44, ELEVATED 45-64, HIGH 65-84, EXTREME 85+. An author flag ("high risk") puts a floor under the score.
 *
 * PLAN: HOLD, RAISE TARGET, TAKE PARTIAL or SELL, with the reasons, from where price is versus entry/target/stop, MEM ALGO, order-book pressure, the risk grade,
 * news/chatter and (long term) the company checklist. Educational analysis, not advice. */

const algo = require('./academy-mem-algo');

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const fin = Number.isFinite;
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const roundPx = (p) => (p < 1 ? Math.round(p * 1000) / 1000 : Math.round(p * 100) / 100);

const BANDS = [
  { max: 24, key: 'LOW', label: 'Low' }, { max: 44, key: 'MODERATE', label: 'Moderate' }, { max: 64, key: 'ELEVATED', label: 'Elevated' },
  { max: 84, key: 'HIGH', label: 'High' }, { max: 100, key: 'EXTREME', label: 'Extreme' }
];
const bandOf = (score) => BANDS.find((b) => score <= b.max) || BANDS[BANDS.length - 1];

/* ---------- inputs -> numbers ---------- */
function dailyStats(bars) {
  const b = (bars || []).filter((x) => x && [x.o, x.h, x.l, x.c].every(fin));
  const n = b.length;
  if (n < 20) return null;
  const close = b.map((x) => +x.c), vol = b.map((x) => +x.v || 0);
  const atr = algo.atr(b.map((x) => ({ o: +x.o, h: +x.h, l: +x.l, c: +x.c })), 14);
  const ema = (len) => algo.ema(close, len);
  const e20 = ema(20), e50 = ema(50), e200 = ema(200), rsi = algo.rsi(close, 14);
  const last = n - 1, c = close[last];
  const avg = (arr, k) => arr.slice(Math.max(0, arr.length - k)).reduce((s, v) => s + v, 0) / Math.min(arr.length, k);
  const dollar20 = b.slice(-20).reduce((s, x) => s + (+x.c) * (+x.v || 0), 0) / Math.min(20, n);
  const yr = b.slice(-252);
  const hi52 = Math.max(...yr.map((x) => +x.h)), lo52 = Math.min(...yr.map((x) => +x.l));
  const ret = (k) => (n > k && close[n - 1 - k] > 0 ? c / close[n - 1 - k] - 1 : null);
  return {
    n, close: c, atr: atr[last], atrPct: atr[last] / c, ema20: e20[last], ema50: e50[last], ema200: Number.isFinite(e200[last]) && n >= 200 ? e200[last] : null,
    rsi: rsi[last], avgVol20: avg(vol, 20), dollar20, todayVol: vol[last], hi52, lo52, drawdown: hi52 > 0 ? 1 - c / hi52 : null,
    r5: ret(5), r20: ret(20), r60: ret(60), r180: ret(180), lastT: b[last].t
  };
}

/** Where the trade stands since the alert: high/low reached and the last price. Intraday candles if there are any, else daily. */
function sinceAlert(alert, intraday, daily, lastPrice) {
  const at = Number(alert.at) || 0;
  const pick = (bars) => (bars || []).filter((x) => x && +x.t >= at - 5 * 60_000 && [x.h, x.l].every(fin));
  let bars = pick(intraday);
  if (!bars.length) { // daily candles carry the start of the day; take the alert day onwards
    const dayStart = at - (at % 86_400_000) - 86_400_000;
    bars = (daily || []).filter((x) => x && +x.t >= dayStart && [x.h, x.l].every(fin));
  }
  let high = alert.entry, low = alert.entry;
  for (const x of bars) { if (+x.h > high) high = +x.h; if (+x.l < low) low = +x.l; }
  if (fin(lastPrice)) { if (lastPrice > high) high = lastPrice; if (lastPrice < low) low = lastPrice; }
  return { high, low, pct: fin(lastPrice) && alert.entry > 0 ? lastPrice / alert.entry - 1 : null, highPct: alert.entry > 0 ? high / alert.entry - 1 : null, lowPct: alert.entry > 0 ? low / alert.entry - 1 : null, bars: bars.length };
}

/* ---------- company checklist (yes / no) ---------- */
const byDateDesc = (rows) => (rows || []).slice().sort((a, b) => String(b.period_end || b.date || '').localeCompare(String(a.period_end || a.date || '')));
const sumLast = (rows, key, k = 4) => { const r = byDateDesc(rows).slice(0, k); return r.length === k && r.every((x) => fin(num(x[key]))) ? r.reduce((s, x) => s + num(x[key]), 0) : null; };
const sumPrev = (rows, key, k = 4) => { const r = byDateDesc(rows).slice(k, 2 * k); return r.length === k && r.every((x) => fin(num(x[key]))) ? r.reduce((s, x) => s + num(x[key]), 0) : null; };

function checklist({ fin: f, company, daily, quote }) {
  const items = [];
  const add = (key, label, ok, detail) => items.push({ key, label, ok: ok === null || ok === undefined ? null : Boolean(ok), detail });
  const inc = f && f.income_statement, bal = byDateDesc(f && f.balance_sheet), cf = f && f.cash_flow, ratio = f && f.ratios && f.ratios[0];
  const netTtm = sumLast(inc, 'net_income_loss_attributable_common_shareholders') ?? sumLast(inc, 'consolidated_net_income_loss');
  add('profit', 'Profitable', netTtm == null ? null : netTtm > 0, netTtm == null ? 'no earnings data' : (netTtm > 0 ? 'made money over the last four quarters' : 'lost money over the last four quarters'));
  const revNow = sumLast(inc, 'revenue'), revPrev = sumPrev(inc, 'revenue');
  add('growth', 'Sales growing', revNow == null || revPrev == null ? null : (revPrev > 0 ? revNow > revPrev : revNow > 0), revNow == null ? 'no sales data' : (revPrev == null ? 'not enough history' : (revNow > revPrev ? 'sales are up year over year' : 'sales are flat or down year over year')));
  const ocf = sumLast(cf, 'net_cash_from_operating_activities');
  add('cash', 'Cash flow positive', ocf == null ? null : ocf > 0, ocf == null ? 'no cash flow data' : (ocf > 0 ? 'the business brings in cash' : 'the business burns cash'));
  const de = ratio ? num(ratio.debt_to_equity) : null, equity = bal[0] ? num(bal[0].total_equity) : null;
  add('debt', 'Debt manageable', de == null && equity == null ? null : !(equity != null && equity <= 0) && (de == null || de <= 1.5), de == null ? (equity != null && equity <= 0 ? 'equity is negative' : 'no debt data') : `debt is ${de.toFixed(1)}x equity${de > 1.5 ? ' (heavy)' : ''}`);
  const cash = bal[0] ? num(bal[0].cash_and_equivalents) : null, short = bal[0] ? num(bal[0].debt_current) : null;
  add('liquidity', 'Cash covers near-term debt', cash == null || short == null ? null : cash >= short, cash == null ? 'no balance sheet' : (cash >= short ? 'cash on hand exceeds debt due within a year' : 'debt due within a year is more than cash on hand'));
  const shNow = byDateDesc(inc)[0] ? num(byDateDesc(inc)[0].diluted_shares_outstanding) : null, shOld = byDateDesc(inc)[4] ? num(byDateDesc(inc)[4].diluted_shares_outstanding) : null;
  add('dilution', 'Not watering down shares', shNow == null || shOld == null || shOld <= 0 ? null : shNow <= shOld * 1.05, shNow == null || shOld == null ? 'not enough share history' : `share count ${shNow <= shOld * 1.05 ? 'is steady' : 'grew ' + Math.round((shNow / shOld - 1) * 100) + '% in a year'}`);
  const cap = company && num(company.market_cap) != null ? num(company.market_cap) : (ratio ? num(ratio.market_cap) : null);
  add('size', 'Established size', cap == null ? null : cap >= 2e9, cap == null ? 'no market cap' : `market cap about ${cap >= 1e9 ? (cap / 1e9).toFixed(1) + 'B' : Math.round(cap / 1e6) + 'M'} dollars`);
  const st = dailyStats(daily);
  const above = st && st.ema200 != null ? st.close > st.ema200 : (st ? st.close > st.ema50 : null);
  add('trend', 'Above long-term trend', above, st ? (st.ema200 != null ? (above ? 'price is above its 200-day average' : 'price is below its 200-day average') : (above ? 'price is above its 50-day average' : 'price is below its 50-day average')) : 'no price history');
  const price = quote && fin(num(quote.last)) ? num(quote.last) : (st ? st.close : null);
  const eps = ratio ? num(ratio.earnings_per_share) : null;
  const pe = price != null && eps != null && eps > 0 ? price / eps : null;
  add('value', 'Sane valuation', eps == null || price == null ? null : (eps > 0 && pe <= 35), eps == null ? 'no earnings per share' : (eps > 0 ? `${pe.toFixed(0)}x earnings${pe > 35 ? ' (pricey)' : ''}` : 'no profit to value it on'));
  const yes = items.filter((i) => i.ok === true).length, no = items.filter((i) => i.ok === false).length, unknown = items.length - yes - no;
  return { items, yes, no, unknown, total: items.length };
}

/* ---------- risk ---------- */
const SWING_WEIGHTS = { price: 10, volatility: 14, liquidity: 14, extension: 10, target: 10, trend: 12, company: 8, squeeze: 4, chatter: 8, market: 5, offerings: 5 };
const LONG_WEIGHTS = { company: 22, valuation: 10, balance: 10, drawdown: 8, trend: 14, size: 6, market: 6, extension: 6, chatter: 6, offerings: 4, liquidity: 4, squeeze: 2, target: 2 };
const CHATTER_ALARM = /\b(offering|dilution|dilutive|bankrupt\w*|delist\w*|halt\w*|going concern|reverse split|pump|scam|fraud|sec investigation|lawsuit|short report)\b/i;
const OFFERING_FORMS = /^(?:424B\d?|S-1|S-1\/A|S-3|S-3\/A|F-1|F-3|F-1\/A|F-3\/A|S-8|424H)$/i;

function gradeRisk(input) {
  const { alert, quote, daily, fin: f, company, short, sentiment, filings, market, sector, algoView, spreadPct } = input;
  const news = Array.isArray(input.news) ? input.news.filter((n) => Date.parse(n.date) >= (input.now || Date.now()) - 7 * 86400000) : null;
  const channel = alert.channel === 'longterm' ? 'longterm' : 'swings';
  const W = channel === 'longterm' ? LONG_WEIGHTS : SWING_WEIGHTS;
  const st = dailyStats(daily);
  const price = quote && fin(num(quote.last)) ? num(quote.last) : (st ? st.close : alert.entry);
  const list = [];
  const add = (key, label, r, detail, available = true) => { if (!(key in W)) return; list.push({ key, label, weight: W[key], risk: available ? clamp01(r) : 0, detail, available }); };

  const priceRisk = price < 0.5 ? 1 : price < 1 ? 0.85 : price < 2 ? 0.65 : price < 5 ? 0.4 : price < 10 ? 0.25 : price < 25 ? 0.12 : 0.05;
  add('price', 'Price level', priceRisk, price < 1 ? 'sub-dollar stocks can gap and stall' : price < 5 ? 'low-priced stocks swing hard' : 'not a low-priced stock');

  if (st) {
    const a = st.atrPct;
    const volR = a >= 0.15 ? 1 : a >= 0.10 ? 0.85 : a >= 0.07 ? 0.65 : a >= 0.05 ? 0.45 : a >= 0.03 ? 0.25 : a >= 0.02 ? 0.12 : 0.05;
    add('volatility', 'Volatility', volR, `moves about ${(a * 100).toFixed(1)}% on a typical day`);
    const d = st.dd == null ? st.drawdown : st.dd;
    add('drawdown', 'Drawdown & swings', clamp01((d != null ? (d > 0.5 ? 0.9 : d > 0.3 ? 0.65 : d > 0.15 ? 0.4 : 0.2) : 0.3) * 0.6 + volR * 0.4), d != null ? `${Math.round(d * 100)}% below its 52-week high, ${(a * 100).toFixed(1)}% daily swing` : 'no long history');
    let liq = st.dollar20 < 1e5 ? 1 : st.dollar20 < 3e5 ? 0.85 : st.dollar20 < 1e6 ? 0.65 : st.dollar20 < 3e6 ? 0.45 : st.dollar20 < 1e7 ? 0.25 : st.dollar20 < 5e7 ? 0.12 : 0.05;
    if (fin(spreadPct) && spreadPct > 0.02) liq = Math.min(1, liq + 0.15);
    if (st.avgVol20 > 0 && st.todayVol < st.avgVol20 * 0.5) liq = Math.min(1, liq + 0.05);
    const $ = st.dollar20 >= 1e6 ? (st.dollar20 / 1e6).toFixed(1) + 'M' : Math.round(st.dollar20 / 1e3) + 'K';
    add('liquidity', 'Liquidity', liq, `about $${$} traded a day${fin(spreadPct) ? `, spread ${(spreadPct * 100).toFixed(1)}%` : ''}`);
    const ext = Math.max((st.r5 ?? 0) / 0.6, (price / st.ema20 - 1) / 0.5, (price / alert.entry - 1) / 0.35);
    add('extension', 'Extension / chasing', ext, `up ${Math.round((st.r5 ?? 0) * 100)}% in five days, ${Math.round((price / st.ema20 - 1) * 100)}% over its 20-day average`);
    // trend
    let trend = st.ema200 != null ? (price > st.ema20 && st.ema20 > st.ema50 ? 0.15 : price > st.ema50 ? 0.35 : price < st.ema20 && st.ema20 < st.ema50 && price < st.ema200 ? 0.9 : 0.65) : (price > st.ema20 && st.ema20 > st.ema50 ? 0.2 : price > st.ema50 ? 0.4 : price < st.ema20 && st.ema20 < st.ema50 ? 0.85 : 0.6);
    let trendNote = price > st.ema50 ? 'above its 50-day average' : 'below its 50-day average';
    if (algoView) {
      if (algoView.bias === 'long') trend -= 0.1; else if (algoView.bias === 'short') trend += 0.15;
      if (algoView.latestSignal && algoView.latestSignal.dir < 0 && algoView.latestSignal.recent) trend += 0.15;
      if (algoView.latestSignal && algoView.latestSignal.dir > 0 && algoView.latestSignal.recent) trend -= 0.05;
      trendNote += `; MEM ALGO ${algoView.label || algoView.bias}`;
    }
    add('trend', 'Trend & MEM ALGO', trend, trendNote);
    const tgtPct = alert.target / alert.entry - 1, stopDist = impliedStopDistance(alert, st);
    const multiple = tgtPct / Math.max(0.005, a);
    let tr = multiple >= 6 ? 1 : multiple >= 4 ? 0.8 : multiple >= 3 ? 0.6 : multiple >= 2 ? 0.4 : multiple >= 1 ? 0.2 : 0.1;
    const rr = tgtPct / Math.max(0.005, stopDist);
    if (rr < 1) tr = Math.min(1, tr + 0.2);
    add('target', 'Target realism', tr, `target is ${(tgtPct * 100).toFixed(0)}% away, about ${multiple.toFixed(1)} typical days of movement; reward to risk ${rr.toFixed(1)} to 1`);
  } else {
    add('volatility', 'Volatility', 0, 'not enough price history', false);
  }

  // company health
  const chk = f ? checklist({ fin: f, company, daily, quote }) : null;
  if (chk && chk.yes + chk.no >= 3) {
    const share = chk.no / (chk.yes + chk.no);
    let r = 0.15 + share * 0.8;
    const cash = f.balance_sheet && byDateDesc(f.balance_sheet)[0] ? num(byDateDesc(f.balance_sheet)[0].cash_and_equivalents) : null;
    const burn = f.cash_flow ? -(byDateDesc(f.cash_flow)[0] ? num(byDateDesc(f.cash_flow)[0].net_cash_from_operating_activities) : 0) : null;
    if (channel === 'swings' && cash != null && burn != null && burn > 0) { const q = cash / burn; r = Math.max(r, q < 1 ? 0.95 : q < 2 ? 0.8 : q < 4 ? 0.55 : r); }
    add('company', 'Company health', r, `${chk.yes} of ${chk.yes + chk.no} basic checks pass`);
  } else add('company', 'Company health', 0, 'no financial statements found', false);

  // valuation (long term)
  const ratio = f && f.ratios && f.ratios[0];
  if (ratio && num(ratio.earnings_per_share) != null && price > 0) {
    const eps = num(ratio.earnings_per_share), pe = eps > 0 ? price / eps : null;
    add('valuation', 'Valuation', pe == null ? 0.85 : pe > 60 ? 0.8 : pe > 30 ? 0.55 : pe > 15 ? 0.3 : 0.2, pe == null ? 'no profit to value it on' : `${pe.toFixed(0)}x earnings`);
  } else add('valuation', 'Valuation', 0, 'no earnings per share', false);
  const de = ratio ? num(ratio.debt_to_equity) : null;
  if (de != null) add('balance', 'Debt load', de < 0 ? 0.9 : de > 3 ? 0.9 : de > 1.5 ? 0.65 : de > 0.8 ? 0.4 : 0.15, `debt is ${de.toFixed(1)}x equity`); else add('balance', 'Debt load', 0, 'no debt data', false);

  // size
  const cap = company && num(company.market_cap) != null ? num(company.market_cap) : (ratio ? num(ratio.market_cap) : null);
  if (cap != null) add('size', 'Company size', cap < 5e7 ? 1 : cap < 3e8 ? 0.8 : cap < 2e9 ? 0.5 : cap < 1e10 ? 0.25 : 0.1, cap >= 1e9 ? `${(cap / 1e9).toFixed(1)}B market cap` : `${Math.round(cap / 1e6)}M market cap (small)`); else add('size', 'Company size', 0, 'no market cap', false);

  // short pressure
  if (short && short.summary) {
    const avg = num(short.summary.avg_ratio), dtc = short.interest && short.interest[0] ? num(short.interest[0].days_to_cover) : null;
    let r = avg == null ? 0.3 : avg > 60 ? 0.75 : avg > 45 ? 0.5 : 0.25;
    if (dtc != null && dtc > 5) r = Math.max(r, 0.7);
    add('squeeze', 'Short pressure', r, `${avg != null ? Math.round(avg) + '% of volume is short selling' : 'short volume unknown'}${dtc != null ? `, ${dtc.toFixed(1)} days to cover` : ''}`);
  } else add('squeeze', 'Short pressure', 0, 'no short data', false);

  // chatter / news: what traders are saying, and what the news wire says (red-flag words in either raise the grade)
  const posts = sentiment && Array.isArray(sentiment.posts) && sentiment.posts.length >= 3 ? sentiment.posts : null;
  if (posts || (news && news.length)) {
    let r = 0.3; const bits = [];
    if (posts) {
      const bull = posts.filter((p) => /bull/i.test(p.sentiment || '')).length, bear = posts.filter((p) => /bear/i.test(p.sentiment || '')).length, labelled = bull + bear;
      if (labelled >= 3) r = bear / labelled > 0.6 ? 0.8 : bull / labelled > 0.75 && posts.length >= 15 ? 0.6 : 0.3;
      const alarms = posts.filter((p) => CHATTER_ALARM.test(p.comment || '')).length;
      r = Math.min(1, r + Math.min(0.4, alarms * 0.1));
      bits.push(`${bull} bullish, ${bear} bearish posts${alarms ? `, ${alarms} mention offerings, halts or other red flags` : ''}`);
    }
    if (news && news.length) {
      const alarming = news.filter((n) => CHATTER_ALARM.test(`${n.title || ''} ${n.excerpt || ''}`)).length;
      r = Math.min(1, r + Math.min(0.4, alarming * 0.2));
      bits.push(`${news.length} news item${news.length > 1 ? 's' : ''} this week${alarming ? `, ${alarming} with red-flag wording` : ''}`);
    }
    add('chatter', 'News & chatter', r, bits.join('; '));
  } else add('chatter', 'News & chatter', 0, 'no recent chatter or news found', false);

  // market and sector
  if (market || sector) {
    let r = 0.2; const bits = [];
    if (market && market.spyChgPct != null) { if (market.spyChgPct < -1) { r += 0.3; bits.push('the market is down hard today'); } else if (market.spyChgPct < -0.4) { r += 0.15; bits.push('the market is soft'); } else bits.push('the market is steady'); }
    if (market && market.spyBelow50 === true) { r += 0.15; bits.push('SPY is under its 50-day average'); }
    if (sector && sector.chgPct != null) { if (sector.chgPct < -1.5) { r += 0.25; bits.push(`the ${sector.name || 'sector'} is falling`); } else if (sector.chgPct < -0.5) { r += 0.1; bits.push(`the ${sector.name || 'sector'} is weak`); } else if (sector.chgPct > 1) { r -= 0.1; bits.push(`the ${sector.name || 'sector'} is strong`); } }
    add('market', 'Market & sector', r, bits.join(', ') || 'no read');
  } else add('market', 'Market & sector', 0, 'no market read', false);

  // offerings / filings
  if (Array.isArray(filings)) {
    const cutoff = (input.now || Date.now()) - 90 * 86400000;
    const recent = filings.filter((x) => Date.parse(x.filing_date) >= cutoff);
    const offering = recent.filter((x) => OFFERING_FORMS.test(String(x.form_type || '')));
    const r = offering.length ? 0.85 : recent.some((x) => /^8-K/i.test(x.form_type)) ? 0.3 : 0.1;
    add('offerings', 'Offerings & filings', r, offering.length ? `${offering.length} share-offering filing${offering.length > 1 ? 's' : ''} in the last 90 days: expect dilution` : `${recent.length} recent filings, none for new shares`);
  } else add('offerings', 'Offerings & filings', 0, 'no filings data', false);

  const avail = list.filter((x) => x.available);
  const totalW = avail.reduce((s, x) => s + x.weight, 0);
  let score = totalW > 0 ? Math.round((avail.reduce((s, x) => s + x.weight * x.risk, 0) / totalW) * 100) : 50;
  const flags = [];
  if (alert.riskFlag) { flags.push('The alert itself says high risk'); score = Math.max(score, 70); }
  if (alert.kind === 'option') { flags.push('Options can lose all their value quickly'); score = Math.max(score, 60); }
  if (totalW < 30) flags.push('Very little data on this ticker: the grade is a rough guess');
  const band = bandOf(score);
  const top = avail.slice().sort((a, b) => b.weight * b.risk - a.weight * a.risk).slice(0, 3).filter((x) => x.risk >= 0.5).map((x) => x.label);
  return { score, band: band.key, label: band.label, factors: list, top, flags, coverage: Math.round((totalW / Object.values(W).reduce((s, v) => s + v, 0)) * 100), channel };
}

function impliedStopDistance(alert, st) {
  const a = st ? st.atrPct : 0.06;
  if (alert.channel === 'longterm') return Math.min(0.22, Math.max(0.08, 2.5 * a));
  return Math.min(0.15, Math.max(0.04, 1.5 * a));
}

/* ---------- plan ---------- */
function planFor(input) {
  const { alert, quote, daily, since, risk, algoView, flow, sentiment, now } = input;
  const st = dailyStats(daily);
  const channel = alert.channel === 'longterm' ? 'longterm' : 'swings';
  const price = quote && fin(num(quote.last)) ? num(quote.last) : (st ? st.close : null);
  const entry = alert.entry, tgt0 = alert.target;
  const atr = st ? st.atr : entry * 0.06;
  const stopDist = impliedStopDistance(alert, st);
  let stop = roundPx(entry * (1 - stopDist));
  if (channel === 'longterm' && st && st.ema200 != null && st.ema200 < entry) stop = roundPx(Math.max(stop, Math.min(st.ema200, entry * 0.92) * 0.98));
  const reasons = [];
  const out = (action, extra) => Object.assign({ action, target: tgt0, stop, reasons, progress: price != null ? (price - entry) / (tgt0 - entry) : null, since, asOf: now || Date.now() }, extra || {});
  if (price == null) return out('HOLD', { reasons: ['Waiting for a live price'] });
  const bullish = algoView && (algoView.bias === 'long' || (algoView.bias === 'pullback' && !(algoView.latestSignal && algoView.latestSignal.dir < 0 && algoView.latestSignal.recent)));
  const bearish = algoView && (algoView.bias === 'short' || (algoView.latestSignal && algoView.latestSignal.dir < 0 && algoView.latestSignal.recent) || (algoView.exitLevel === 'exit'));
  const flowBull = flow && flow.bias === 'bullish', flowBear = flow && flow.bias === 'bearish';
  const hot = risk && (risk.band === 'HIGH' || risk.band === 'EXTREME');
  const newsRed = Array.isArray(input.news) && input.news.filter((n) => Date.parse(n.date) >= (now || Date.now()) - 7 * 86400000 && CHATTER_ALARM.test(`${n.title || ''} ${n.excerpt || ''}`)).length >= 1;
  const chatterRed = newsRed || (sentiment && Array.isArray(sentiment.posts) && sentiment.posts.filter((p) => CHATTER_ALARM.test(p.comment || '')).length >= 2);
  const ageDays = (((now || Date.now()) - (alert.at || 0)) / 86400000);
  const high = since ? since.high : Math.max(entry, price), reached = high >= tgt0 || price >= tgt0;
  const peakGain = Math.max(0.0001, high - entry), pullback = (high - price) / peakGain;
  const chk = input.checklist;
  const strong = bullish && !flowBear && pullback < 0.25 && !chatterRed;

  if (price <= stop) {
    reasons.push(`Price is at or under the ${channel === 'longterm' ? 'thesis' : 'invalidation'} line (${stop})`);
    if (bearish) reasons.push('MEM ALGO agrees the trend has turned');
    return out('SELL');
  }
  if (reached) {
    const bump = channel === 'longterm' ? Math.max(atr * 2, (tgt0 - entry) * 0.5) : Math.max(atr, (tgt0 - entry) * 0.6);
    const newTarget = roundPx(Math.max(tgt0 + bump, high + atr * 0.5));
    const trail = roundPx(Math.max(entry, high - (channel === 'longterm' ? 2.5 : 1.2) * atr));
    reasons.push(`Target ${tgt0} was reached (high ${roundPx(high)})`);
    const checklistOk = channel !== 'longterm' || !chk || chk.total === 0 || chk.yes >= Math.ceil((chk.yes + chk.no) * 0.6);
    if (strong && !hot && checklistOk) {
      reasons.push('MEM ALGO is still bullish and price is holding near its highs');
      if (flowBull) reasons.push('Buyers are leaning on the order book');
      reasons.push(`Trail the stop to ${trail}`);
      return out('RAISE_TARGET', { target: newTarget, stop: trail });
    }
    if (strong) {
      reasons.push(hot ? 'Risk is high, so bank part of it' : 'The company checklist is weak, so bank part of it');
      reasons.push(`Keep the rest with a stop at ${trail} and a higher target of ${newTarget}`);
      return out('PARTIAL', { target: newTarget, stop: trail });
    }
    if (pullback >= 0.25) reasons.push(`Price has given back ${Math.round(pullback * 100)}% of its gain`);
    if (bearish) reasons.push('MEM ALGO has turned against it');
    if (flowBear) reasons.push('Sellers are heavier on the order book');
    if (chatterRed) reasons.push('Chatter is mentioning offerings or other red flags');
    if (!reasons.some((r) => /gave|turned|Sellers|Chatter/.test(r))) reasons.push('Momentum is not strong enough to raise the target');
    return out('SELL');
  }
  if (bearish && (flowBear || price < entry)) {
    reasons.push('MEM ALGO has turned against the trade');
    if (flowBear) reasons.push('Sellers are heavier on the order book');
    if (price < entry) reasons.push('Price is under the entry');
    return out('SELL');
  }
  const progress = (price - entry) / (tgt0 - entry);
  if (channel === 'swings' && ageDays > 7 && progress < 0.3) {
    reasons.push(`It has been ${Math.round(ageDays)} days and price is only ${Math.round(Math.max(0, progress) * 100)}% of the way to target`);
    reasons.push('A swing that stalls this long ties up money: exit or tighten');
    return out('SELL');
  }
  if (progress >= 0.5 && (hot || bearish || flowBear || chatterRed)) {
    reasons.push(`Price is ${Math.round(progress * 100)}% of the way to target`);
    if (hot) reasons.push('Risk is high, so taking some off is reasonable');
    if (bearish) reasons.push('MEM ALGO is weakening');
    if (flowBear) reasons.push('Sellers are heavier on the order book');
    if (chatterRed) reasons.push('Chatter is mentioning red flags');
    return out('PARTIAL', { stop: roundPx(Math.max(stop, entry)) });
  }
  reasons.push(progress > 0 ? `Price is ${Math.round(progress * 100)}% of the way to target` : `Price is ${Math.round(Math.abs(progress) * 100)}% back from the entry`);
  if (bullish) reasons.push('MEM ALGO is bullish');
  if (flowBull) reasons.push('Buyers are leaning on the order book');
  if (progress >= 0.85 && strong) reasons.push('Close to target: a break above it with volume raises the target');
  if (chk && channel === 'longterm') reasons.push(`Company checklist: ${chk.yes} yes, ${chk.no} no`);
  return out('HOLD');
}

const ACTION_LABEL = { HOLD: 'Hold', RAISE_TARGET: 'Raise target', PARTIAL: 'Take partial profits', SELL: 'Sell' };

module.exports = { gradeRisk, checklist, planFor, sinceAlert, dailyStats, bandOf, BANDS, ACTION_LABEL, impliedStopDistance, roundPx, CHATTER_ALARM };
