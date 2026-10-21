'use strict';

/* FDA decisions for the Academy: upcoming PDUFA target action dates read straight from the companies' own 8-K press
 * releases on EDGAR (full-text search for "PDUFA", then the exhibit text), with the review flags the same releases
 * state (priority review, breakthrough, advisory committee, resubmission after a complete response letter, supplemental
 * application). For each: an approval read built from published base rates plus those flags, an impact read built from
 * what the options market prices for the date, the company's size and its short interest, and the plays with a hedge.
 *
 * The approval read is a base-rate estimate, not a prediction about the drug; nobody outside the agency knows the
 * outcome. It is shown with its inputs so a member can disagree with any of them. Educational only. */

const { impliedMove } = require('./academy-earnings-playbook');
const { DEFAULT_SEC_UA } = require('./academy-filings');

const DAY = 86_400_000;
const FTS = 'https://efts.sec.gov/LATEST/search-index';
const ARCHIVE = (cik, adsh, doc) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(adsh).replace(/-/g, '')}/${doc}`;
const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const MONTH_IDX = Object.fromEntries(MONTHS.split('|').map((m, i) => [m.toLowerCase(), i]));

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

function stripHtml(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&#160;|&nbsp;|&#xa0;/gi, ' ').replace(/&#8217;|&#x2019;|&rsquo;/gi, "'").replace(/&#8220;|&#8221;|&#x201c;|&#x201d;|&quot;|&#34;/gi, '"').replace(/&amp;/gi, '&').replace(/&#x2022;|&bull;/gi, '•').replace(/\s+/g, ' ').trim();
}
function dateFrom(month, day, year) { const m = MONTH_IDX[String(month).toLowerCase()]; if (m == null) return null; const d = Date.UTC(Number(year), m, Number(day)); return Number.isFinite(d) ? iso(d) : null; }

/* every PDUFA target action date the text states, with the sentence it came from */
function extractPdufa(text) {
  const t = stripHtml(text), out = [];
  const re = new RegExp(`(?:PDUFA|target action date|action date|Prescription Drug User Fee Act)[^.]{0,120}?(${MONTHS})\\s+(\\d{1,2}),?\\s+(\\d{4})|(${MONTHS})\\s+(\\d{1,2}),?\\s+(\\d{4})[^.]{0,40}?(?:PDUFA|target action date)`, 'gi');
  let m;
  while ((m = re.exec(t))) {
    const date = m[1] ? dateFrom(m[1], m[2], m[3]) : dateFrom(m[4], m[5], m[6]);
    if (!date) continue;
    const start = Math.max(0, m.index - 160), end = Math.min(t.length, m.index + m[0].length + 160);
    out.push({ date, sentence: t.slice(start, end).trim() });
  }
  const byDate = new Map(); for (const o of out) if (!byDate.has(o.date)) byDate.set(o.date, o);
  return [...byDate.values()];
}

/* a decision window the text states without a day: "PDUFA ... first quarter of 2027", "mid-2027", "March 2027" -> {start,end,label} */
function windowFrom(text) {
  const t = stripHtml(text);
  const re = new RegExp(`(?:PDUFA|target action date|action date|regulatory decision|FDA decision)[^.]{0,140}?(?:(first|second|third|fourth) quarter of (\\d{4})|\\bQ([1-4])\\s+(\\d{4})|(early|mid|late)[- ](\\d{4})|(first|second) half of (\\d{4})|(${MONTHS})\\s+(\\d{4}))`, 'i');
  const m = re.exec(t); if (!m) return null;
  const Q = { first: 0, second: 1, third: 2, fourth: 3 };
  let y, a, b, label;
  if (m[1]) { y = +m[2]; a = Q[m[1].toLowerCase()] * 3; b = a + 2; label = `${m[1]} quarter of ${y}`; }
  else if (m[3]) { y = +m[4]; a = (+m[3] - 1) * 3; b = a + 2; label = `Q${m[3]} ${y}`; }
  else if (m[5]) { y = +m[6]; const k = m[5].toLowerCase(); [a, b] = k === 'early' ? [0, 3] : k === 'mid' ? [4, 7] : [8, 11]; label = `${k} ${y}`; }
  else if (m[7]) { y = +m[8]; [a, b] = m[7].toLowerCase() === 'first' ? [0, 5] : [6, 11]; label = `${m[7]} half of ${y}`; }
  else { y = +m[10]; a = b = MONTH_IDX[m[9].toLowerCase()]; label = `${m[9]} ${y}`; }
  return { start: iso(Date.UTC(y, a, 1)), end: iso(Date.UTC(y, b + 1, 0)), label };
}

function flagsFrom(text) {
  const t = stripHtml(text).toLowerCase();
  const has = (re) => re.test(t);
  return {
    priorityReview: has(/priority review/), breakthrough: has(/breakthrough therapy/), fastTrack: has(/fast track/), orphan: has(/orphan drug/), accelerated: has(/accelerated approval/),
    rtor: has(/real-time oncology review|\brtor\b/), supplemental: has(/supplemental (new drug|biologics license) application|\bs(nda|bla)\b|label expansion|expanded indication/),
    bla: has(/biologics license application|\bbla\b/), nda: has(/new drug application|\bnda\b/),
    resubmission: has(/resubmi|complete response letter|\bcrl\b/), adcomNone: has(/not (currently )?(planning|plan|expect)[a-z]* to hold an advisory committee|no advisory committee/),
    adcomPlanned: !has(/not (currently )?(planning|plan|expect)[a-z]* to hold an advisory committee|no advisory committee/) && has(/advisory committee (meeting )?(is |has been |was )?(scheduled|planned|will be held|will convene|will meet)/),
    adcomPositive: has(/voted (in favor|to recommend|unanimously)|advisory committee .{0,80}(recommend|favorable|positive)/), adcomNegative: has(/voted against|did not recommend|unfavorable vote/)
  };
}

/* Base rates: roughly 70% of original NDA/BLA submissions are approved on the first review cycle, well over 80% of supplements, and
   about three in four resubmissions after a complete response letter. The flags move the read from there; the inputs are returned. */
function approvalRead(f) {
  const parts = [];
  let p = f.supplemental ? 85 : f.resubmission ? 74 : 70;
  parts.push({ k: f.supplemental ? 'supplemental application' : f.resubmission ? 'resubmission after a CRL' : 'original NDA/BLA, first cycle', v: p });
  const add = (cond, k, v) => { if (cond) { p += v; parts.push({ k, v: (v > 0 ? '+' : '') + v }); } };
  add(f.priorityReview, 'priority review', 4); add(f.breakthrough, 'breakthrough therapy', 4); add(f.rtor, 'real-time oncology review', 5); add(f.accelerated, 'accelerated approval pathway', -3);
  add(f.adcomPositive, 'advisory committee voted in favour', 12); add(f.adcomNegative, 'advisory committee voted against', -30); add(f.adcomPlanned && !f.adcomPositive && !f.adcomNegative, 'advisory committee pending', -6); add(f.adcomNone, 'FDA not planning an advisory committee', 5);
  p = Math.round(clamp(p, 30, 95));
  return { pct: p, label: p >= 85 ? 'likely' : p >= 70 ? 'leaning approval' : p >= 55 ? 'uncertain' : 'at risk', inputs: parts, note: 'Base-rate estimate from the review type and the stated flags; not a prediction about the data.' };
}

function impactRead({ implied, marketCap, shortDays, flags, price, adv }) {
  const parts = []; let s = 0;
  const m = implied && implied.impliedPct != null ? implied.impliedPct : null;
  if (m != null) { const v = clamp(m, 0, 40); s += v; parts.push({ k: 'options price a move of ' + r1(m) + '%', v: Math.round(v) }); } else parts.push({ k: 'no options read for the date', v: 0 });
  const mc = num(marketCap);
  if (mc != null) { const v = mc < 1e9 ? 25 : mc < 3e9 ? 20 : mc < 10e9 ? 12 : mc < 50e9 ? 5 : 0; s += v; parts.push({ k: 'company size ' + (mc >= 1e9 ? '$' + r1(mc / 1e9) + 'B' : '$' + Math.round(mc / 1e6) + 'M'), v }); }
  else if (price != null && adv != null) { const dollars = price * adv; const v = dollars < 1e7 ? 20 : dollars < 5e7 ? 12 : dollars < 3e8 ? 6 : 0; s += v; parts.push({ k: 'thin daily dollar volume', v }); }
  const dtc = num(shortDays);
  if (dtc != null) { const v = dtc >= 10 ? 15 : dtc >= 5 ? 10 : dtc >= 2 ? 4 : 0; s += v; parts.push({ k: 'short interest ' + r1(dtc) + ' days to cover', v }); }
  if (flags && !flags.supplemental) { s += 10; parts.push({ k: 'first approval for this drug (binary)', v: 10 }); }
  if (flags && flags.adcomPlanned && !flags.adcomPositive && !flags.adcomNegative) { s += 5; parts.push({ k: 'advisory committee still to come', v: 5 }); }
  const score = Math.round(clamp(s, 0, 100));
  return { score, label: score >= 70 ? 'very high' : score >= 45 ? 'high' : score >= 25 ? 'moderate' : 'modest', inputs: parts };
}

function playsFor({ price, implied, rows, approval, impact, flags, date, shortDays }) {
  const out = [];
  const m = implied && implied.impliedPct != null ? implied.impliedPct / 100 : null, exp = implied ? implied.expiry : null;
  const expiryOf = (r) => String(r.expiry || r.expiration || '').slice(0, 10);
  const mid = (leg) => { const b = num(leg && leg.bid), a = num(leg && leg.ask); if (b != null && a != null && a >= b && a > 0) return (a + b) / 2; const l = num(leg && leg.last); return l > 0 ? l : null; };
  const strikeNear = (level, type) => { const at = (rows || []).filter((r) => expiryOf(r) === exp && num(r.strike) > 0 && r[type]); if (!at.length) return null; const r = at.reduce((x, y) => (Math.abs(num(y.strike) - level) < Math.abs(num(x.strike) - level) ? y : x)); return { strike: num(r.strike), mid: r2(mid(r[type])), oi: num(r[type].oi ?? r[type].open_interest, 0), expiry: exp, type }; };
  const legs = (specs) => specs.map((s) => { const k = strikeNear(s.level, s.type); return k ? { action: s.action, ...k } : null; }).filter(Boolean);
  const cost = (L) => L.reduce((a, l) => a + (l.mid == null ? 0 : (l.action === 'buy' ? 1 : -1) * l.mid), 0);
  const bullish = approval.pct >= 70, typicalBinary = flags && !flags.supplemental ? 0.3 : 0.1;

  if (m && exp) {
    const L = legs([{ action: 'buy', type: 'put', level: price * (1 - m) }, { action: 'sell', type: 'call', level: price * (1 + m) }]);
    if (L.length === 2) out.push({ key: 'collar', style: 'stock', stance: 'hold', name: 'Hold the shares through the decision with a collar', why: 'For a position you already own: the put is the floor at the priced move, the sold call pays for it and sets the cap. A complete response letter can gap a small biotech far below any stop; a put does not care about the gap.', legs: L, debit: r2(cost(L)), floor: L[0].strike, cap: L[1].strike, hedge: 'This is the hedge. Per 100 shares: one put, one call.', risks: ['Upside above the call is given away on approval.', 'A rejection gap below the put strike is covered; between the strikes it is not.'] });
    const P = legs([{ action: 'buy', type: 'put', level: price * (1 - 0.5 * m) }]);
    if (P.length === 1) out.push({ key: 'protective_put', style: 'stock', stance: 'hold', name: 'Protective put, keep all the upside', why: 'Pay for a floor halfway to the priced move and keep every dollar of an approval rally. Costs real premium; a collar is the cheaper floor.', legs: P, debit: r2(cost(P)), floor: P[0].strike, hedge: 'This is the hedge.', risks: ['The premium is lost on approval.', 'Volatility collapses after the decision, so sell the put the same day if the stock holds.'] });
  }
  if (bullish && m && exp) {
    const L = legs([{ action: 'buy', type: 'call', level: price }, { action: 'sell', type: 'call', level: price * (1 + m) }]);
    if (L.length === 2) out.push({ key: 'call_spread', style: 'options', stance: 'bullish', name: 'Call debit spread to the priced move', why: `The approval read is ${approval.pct}% (${approval.label}). A spread caps the cost of a rejection to the debit and the short strike pays for the volatility crush.`, legs: L, debit: r2(cost(L)), maxLoss: r2(cost(L)), maxGain: r2(Math.abs(L[1].strike - L[0].strike) - cost(L)), hedge: 'The debit is the whole risk; the sold call is the hedge against the post-decision volatility collapse.', risks: ['"Sell the news" is common: approvals that were expected can fall on the day.', 'Capped above the short strike.'] });
  }
  if (m != null && m < typicalBinary * 0.7 && exp) {
    const L = legs([{ action: 'buy', type: 'call', level: price }, { action: 'buy', type: 'put', level: price }]);
    if (L.length === 2) out.push({ key: 'long_straddle', style: 'options', stance: 'neutral', name: 'Long straddle: the binary is cheap', why: `Options price about ${r1(m * 100)}% but ${flags && !flags.supplemental ? 'first-approval' : 'label-expansion'} decisions in names this size typically move around ${Math.round(typicalBinary * 100)}%.`, legs: L, debit: r2(cost(L)), maxLoss: r2(cost(L)), breakevens: [r2(price - cost(L)), r2(price + cost(L))], hedge: 'Defined risk: the debit. Take the winning side off into the move.', risks: ['A delay (no decision on the date) leaves both legs decaying.', 'The move can be smaller than the straddle.'] });
  }
  if (m && exp && approval.pct >= 80) {
    const L = legs([{ action: 'sell', type: 'call', level: price * (1 + m) }, { action: 'buy', type: 'call', level: price * (1 + 1.6 * m) }]);
    if (L.length === 2) out.push({ key: 'sell_the_news', style: 'options', stance: 'bearish', name: 'Sell the news: short call spread above the priced move', why: `Approval reads as ${approval.label} and is likely already in the price; the stock has to rally past the priced move for this to lose.`, legs: L, credit: r2(-cost(L)), maxLoss: r2(Math.abs(L[1].strike - L[0].strike) + cost(L)), hedge: 'The long call above is the hedge; max loss is the width minus the credit.', risks: ['A broader-than-expected label can rally it past the short strike.', 'Not for names where approval is still uncertain.'] });
  }
  out.push({ key: 'post_decision', style: 'stock', stance: 'either', name: 'No position into the date; trade the reaction', why: 'The decision itself is a coin the market has already priced. Enter the day after: on approval, buy a hold of the first-day range with the stop at its low; on a CRL, do not catch it — wait for the resubmission timeline before touching it.', plan: { entry: 'the next session, after the first 30 minutes', stop: 'low (long) / high (short) of the decision-day range', target: 'the first MEM ALGO exit on the daily chart', hold: '5-20 sessions' }, hedge: 'Flat into the date is the hedge.', risks: ['Delays: the FDA can miss the date and say nothing.', shortDays >= 5 ? 'Heavy short interest can squeeze far past fair on approval and crush on rejection.' : 'Gaps can run further than the first-day range.'] });
  return out;
}

function createFdaService({ fetchImpl = fetch, userAgent = DEFAULT_SEC_UA, candles = null, chain = null, company = null, shortData = null, hedge = null, now = Date.now, ttlMs = 6 * 3_600_000, lookbackDays = 300, maxDocs = 80, logger = () => {} } = {}) {
  const cache = new Map(), inflight = new Map();
  let lastReq = 0;
  async function sec(url, as = 'json') {
    const wait = Math.max(0, lastReq + 130 - now()); if (wait) await new Promise((r) => setTimeout(r, wait)); lastReq = now();
    const res = await fetchImpl(url, { headers: { 'user-agent': userAgent, accept: as === 'json' ? 'application/json' : 'text/html,*/*' }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`sec_${res.status}`);
    return as === 'json' ? res.json() : res.text();
  }
  const safe = async (name, fn, ms = 12_000) => { try { return await Promise.race([fn(), new Promise((r) => { const t = setTimeout(() => r(null), ms); if (t.unref) t.unref(); })]); } catch (error) { logger('warn', 'fda_input_failed', { input: name, error: String(error && error.message || error) }); return null; } };
  const memo = (key, ttl, fn) => {
    const hit = cache.get(key); if (hit && hit.until > now()) return Promise.resolve(hit.value);
    if (inflight.has(key)) return inflight.get(key);
    const p = fn().then((v) => { cache.set(key, { until: now() + ttl, value: v }); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, p); return p;
  };

  /* every 8-K exhibit over the look-back that mentions PDUFA, newest first, de-duplicated by filing */
  async function searchFilings() {
    const t = now(), start = iso(t - lookbackDays * DAY), end = iso(t);
    const hits = []; const seen = new Set();
    for (let from = 0; from < 300; from += 100) {
      const j = await sec(`${FTS}?q=%22PDUFA%22&forms=8-K&dateRange=custom&startdt=${start}&enddt=${end}&from=${from}`);
      const list = (j && j.hits && j.hits.hits) || [];
      for (const h of list) {
        const s = h._source || {}, [adsh, doc] = String(h._id || '').split(':');
        if (!adsh || !doc || seen.has(adsh)) continue; seen.add(adsh);
        const name = String((s.display_names || [])[0] || ''), tm = /\(([A-Z][A-Z0-9.\-]{0,9})\)\s*\(CIK/.exec(name);
        if (!tm) continue; // no listed ticker: not tradeable here
        hits.push({ adsh, doc, cik: (s.ciks || [])[0], ticker: tm[1], company: name.replace(/\s*\(.*$/, '').trim(), fileDate: s.file_date || '' });
      }
      if (list.length < 100) break;
    }
    return hits.sort((a, b) => String(b.fileDate).localeCompare(String(a.fileDate)));
  }

  /* scheduled: an exact PDUFA date inside the window. anytime: the newest release for the name says a decision is pending but the
   * date has passed with no news (the agency can act, or announce, any day) or only gives a window that includes today. */
  async function events(days) {
    const t = now(), today = iso(t), start = today, end = iso(t + days * DAY), overdueFrom = iso(t - 45 * DAY);
    const hits = await searchFilings();
    const byKey = new Map(), anytime = new Map(), seenTicker = new Set();
    for (const h of hits.slice(0, maxDocs)) {
      let text = null; try { text = await sec(ARCHIVE(h.cik, h.adsh, h.doc), 'text'); } catch (error) { logger('warn', 'fda_doc_failed', { adsh: h.adsh, error: String(error && error.message || error) }); continue; }
      const all = extractPdufa(text), dates = all.filter((d) => d.date >= start && d.date <= end);
      const flags = flagsFrom(text), headline = stripHtml(text).slice(0, 220);
      const source = { form: '8-K', filed: h.fileDate, url: ARCHIVE(h.cik, h.adsh, h.doc) };
      const newest = !seenTicker.has(h.ticker); seenTicker.add(h.ticker);
      for (const d of dates) {
        const key = h.ticker + '|' + d.date;
        const prev = byKey.get(key);
        if (prev && prev.source.filed >= h.fileDate) continue; // keep the newest release for the same decision
        byKey.set(key, { kind: 'scheduled', symbol: h.ticker, company: h.company, cik: h.cik, date: d.date, daysAway: Math.round((Date.parse(d.date + 'T00:00:00Z') - t) / DAY), sentence: d.sentence, headline, flags, source });
      }
      if (!newest || dates.length || anytime.has(h.ticker)) continue;
      const late = all.filter((d) => d.date < today && d.date >= overdueFrom).sort((x, y) => y.date.localeCompare(x.date))[0];
      if (late && !all.some((d) => d.date >= today)) {
        anytime.set(h.ticker, { kind: 'anytime', symbol: h.ticker, company: h.company, cik: h.cik, date: iso(t + 7 * DAY), daysAway: null, window: { start: late.date, end: today, label: `target date ${late.date} passed with no announcement` }, why: 'overdue', sentence: late.sentence, headline, flags, source });
        continue;
      }
      if (!all.length) {
        const w = windowFrom(text);
        if (w && w.end >= today && w.start <= end) anytime.set(h.ticker, { kind: 'anytime', symbol: h.ticker, company: h.company, cik: h.cik, date: w.end < end ? w.end : end, daysAway: null, window: w, why: 'window', sentence: headline, headline, flags, source });
      }
    }
    const sched = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
    return [...sched, ...[...anytime.values()].filter((a) => !sched.some((s) => s.symbol === a.symbol))];
  }

  async function enrich(ev) {
    const symbol = ev.symbol;
    const [daily, rows, co, sh] = await Promise.all([
      candles ? safe('candles', () => candles(symbol, '1D')) : null, chain ? safe('chain', () => chain(symbol)) : null,
      company ? safe('company', () => company(symbol), 6_000) : null, shortData ? safe('short', () => shortData(symbol), 6_000) : null
    ]);
    const bars = daily && Array.isArray(daily.bars) ? daily.bars : [];
    const price = bars.length ? num(bars[bars.length - 1].c) : null;
    const adv = bars.length ? bars.slice(-20).reduce((a, b) => a + num(b.v, 0), 0) / Math.min(20, bars.length) : null;
    const implied = price > 0 && Array.isArray(rows) ? impliedMove(rows, price, ev.date, 'BMO') : null;
    const marketCap = co ? num(co.marketCap ?? co.market_cap ?? (co.company && co.company.market_cap)) : null;
    const shortDays = sh ? num(sh.daysToCover ?? sh.days_to_cover ?? (sh.shortInterest && sh.shortInterest.daysToCover)) : null;
    const approval = approvalRead(ev.flags);
    const impact = impactRead({ implied, marketCap, shortDays, flags: ev.flags, price, adv });
    const plays = price > 0 ? playsFor({ price, implied, rows: Array.isArray(rows) ? rows : [], approval, impact, flags: ev.flags, date: ev.date, shortDays }) : [];
    let hedgeIdeas = null;
    if (hedge && typeof hedge.plan === 'function' && price > 0) { const plan = await safe('hedge', () => hedge.plan({ symbol, horizon: 'swing', side: 'long', noAlerts: true }), 10_000); if (plan && plan.ok && Array.isArray(plan.ideas) && plan.ideas.length) hedgeIdeas = plan.ideas.slice(0, 2); }
    return { ...ev, price: r2(price), adv: adv ? Math.round(adv) : null, marketCap, shortDays: r1(shortDays), implied, approval, impact, plays, hedgeIdeas,
      score: Math.round(clamp(impact.score * 0.6 + (100 - Math.abs(approval.pct - 70)) * 0.4, 0, 100)) };
  }

  async function upcoming({ days = 60, limit = 15 } = {}) {
    const d = clamp(Math.round(num(days, 60)), 7, 180), n = clamp(Math.round(num(limit, 15)), 1, 40);
    return memo(`up:${d}`, ttlMs, async () => {
      let list; try { list = await events(d); } catch (error) { logger('warn', 'fda_search_failed', { error: String(error && error.message || error) }); return { ok: true, available: false, reason: 'edgar_unavailable', asOf: now() }; }
      const out = []; let i = 0;
      await Promise.all(Array.from({ length: Math.min(3, list.length) }, async () => { while (i < list.length) { const ev = list[i++]; out.push(await enrich(ev)); } }));
      out.sort((a, b) => (a.kind === b.kind ? (a.kind === 'scheduled' ? a.date.localeCompare(b.date) : b.score - a.score) : a.kind === 'scheduled' ? -1 : 1));
      const sch = out.filter((e) => e.kind === 'scheduled'), any = out.filter((e) => e.kind === 'anytime');
      return { ok: true, available: true, asOf: now(), window: { start: iso(now()), end: iso(now() + d * DAY), days: d }, events: [...sch.slice(0, n), ...any.slice(0, n)], total: sch.length, anytimeTotal: any.length,
        note: 'Dates and flags come from the companies\' own 8-K releases on EDGAR; a company that never filed its date is not here. Approval reads are base-rate estimates. Educational context, not a trade signal.' };
    });
  }
  async function detail(symbol) {
    const sym = String(symbol || '').toUpperCase();
    const all = await upcoming({ days: 180, limit: 40 });
    const ev = all.available ? (all.events || []).find((e) => e.symbol === sym) : null;
    return ev ? { ok: true, asOf: now(), ...ev } : { ok: true, available: false, reason: all.available ? 'no_pdufa_found' : all.reason, symbol: sym, asOf: now() };
  }
  return { upcoming, detail };
}

module.exports = { createFdaService, extractPdufa, windowFrom, flagsFrom, approvalRead, impactRead, playsFor, stripHtml };
