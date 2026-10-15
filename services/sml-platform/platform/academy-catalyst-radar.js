'use strict';

/* Surprise-news radar: names showing the fingerprints that tend to show up before an announcement — options activity out
 * of proportion to the stock, implied volatility running far above what the stock actually moves, relative volume,
 * social chatter running above its own pace, sweeps and blocks on the tape, the moomoo institutional buckets leaning
 * hard, insiders buying in a cluster, a 13D on file, heavy short interest. Every input is a service the platform already
 * runs; this module only asks them about the names the wide scanner says are moving and adds the scores up.
 *
 * A high score means "the market is behaving as if something is coming", not that something is. Names whose catalyst is
 * already on the calendar (earnings, PDUFA) are tagged so they are not mistaken for a surprise. Educational only. */

const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const DAY = 86_400_000;

function realizedVol(bars, n = 20) {
  const c = (Array.isArray(bars) ? bars : []).map((b) => num(b && b.c)).filter((x) => x > 0).slice(-(n + 1));
  if (c.length < 6) return null;
  const r = []; for (let i = 1; i < c.length; i++) r.push(Math.log(c[i] / c[i - 1]));
  const m = r.reduce((a, b) => a + b, 0) / r.length, v = r.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, r.length - 1);
  return Math.sqrt(v * 252) * 100;
}
function relVolume20(bars) {
  const list = Array.isArray(bars) ? bars : []; if (list.length < 6) return null;
  const today = num(list[list.length - 1].v, 0), prior = list.slice(-21, -1).map((b) => num(b.v, 0)).filter((x) => x > 0);
  if (!prior.length || !(today > 0)) return null;
  return today / (prior.reduce((a, b) => a + b, 0) / prior.length);
}
function atmIv(rows, price) {
  const list = Array.isArray(rows) ? rows : []; if (!list.length || !(price > 0)) return null;
  const exps = [...new Set(list.map((r) => String(r.expiry || r.expiration || '').slice(0, 10)).filter(Boolean))].sort();
  const exp = exps.find((e) => Date.parse(e + 'T00:00:00Z') >= Date.now() + 5 * DAY) || exps[0]; if (!exp) return null;
  const at = list.filter((r) => String(r.expiry || r.expiration || '').slice(0, 10) === exp && num(r.strike) > 0 && (r.call || r.put));
  if (!at.length) return null;
  const atm = at.reduce((m, r) => (Math.abs(num(r.strike) - price) < Math.abs(num(m.strike) - price) ? r : m));
  const iv = num(atm.call && atm.call.iv) ?? num(atm.put && atm.put.iv); if (iv == null) return null;
  return r2(iv > 3 ? iv : iv * 100);
}

/* one name: the evidence, a score and the reasons */
function scoreName(x) {
  const reasons = [], tags = []; let s = 0, bull = 0, bear = 0;
  const rv = num(x.relVol);
  if (rv != null) { const v = rv >= 3 ? 20 : rv >= 2 ? 12 : rv >= 1.5 ? 6 : 0; if (v) { s += v; reasons.push({ k: 'volume ' + r2(rv) + '× its 20-day average', v }); } }
  const opt = x.options || null;
  if (opt && opt.available) {
    const n = Array.isArray(opt.unusual) ? opt.unusual.length : 0;
    if (n) { const v = n >= 2 ? 15 : 8; s += v; reasons.push({ k: n + ' unusual options print' + (n > 1 ? 's' : '') + ' (' + opt.unusual.map((u) => (u.type || '').toLowerCase() + ' ' + u.strike).join(', ') + ')', v }); }
    const pc = opt.putCall && num(opt.putCall.volume);
    if (pc != null && (pc <= 0.4 || pc >= 2)) { s += 5; reasons.push({ k: 'put/call volume ' + r2(pc) + (pc <= 0.4 ? ' (call-heavy)' : ' (put-heavy)'), v: 5 }); }
    if (num(opt.score) != null) { if (opt.score > 0.2) bull += 1; else if (opt.score < -0.2) bear += 1; }
  }
  const ivp = x.ivAtm != null && x.realizedVol > 0 ? x.ivAtm / x.realizedVol : null;
  if (ivp != null) { const v = ivp >= 1.8 ? 12 : ivp >= 1.4 ? 6 : 0; if (v) { s += v; reasons.push({ k: 'implied vol ' + r2(ivp) + '× realized (' + Math.round(x.ivAtm) + '% vs ' + Math.round(x.realizedVol) + '%)', v }); } }
  const so = x.social || null;
  if (so && so.available) {
    const vr = num(so.velocityRatio);
    if (vr != null) { const v = vr >= 3 ? 10 : vr >= 2 ? 5 : 0; if (v) { s += v; reasons.push({ k: 'social mentions ' + r2(vr) + '× their normal pace', v }); } }
    if (so.sources && num(so.sources.reddit) >= 5) { s += 3; reasons.push({ k: so.sources.reddit + ' Reddit posts this week', v: 3 }); }
    if (num(so.score) > 0.3) bull += 1; else if (num(so.score) < -0.3) bear += 1;
  }
  const inst = x.institutional || null;
  if (inst && inst.available) {
    const tape = inst.tape || {};
    const sw = tape.sweeps ? num(tape.sweeps.n, 0) : 0, bl = tape.blocks ? num(tape.blocks.n, 0) : 0;
    if (sw >= 5) { s += 8; reasons.push({ k: sw + ' sweeps on the tape today', v: 8 }); }
    if (bl >= 3) { s += 5; reasons.push({ k: bl + ' block prints today', v: 5 }); }
    const ib = num(inst.bias, 0);
    if (Math.abs(ib) >= 40) { s += 5; reasons.push({ k: inst.label + ' (bias ' + ib + ')', v: 5 }); }
    if (ib >= 25) bull += 1; else if (ib <= -25) bear += 1;
  }
  const fi = x.filings || null;
  if (fi && fi.available) {
    if (fi.insiders && fi.insiders.cluster) { s += 10; reasons.push({ k: 'cluster insider buying in the last 30 days', v: 10 }); bull += 1; }
    if (num(fi.activistRecent, 0) > 0) { s += 10; reasons.push({ k: '13D filed in the last 60 days', v: 10 }); }
  }
  const dtc = num(x.shortDays);
  if (dtc != null && dtc >= 8) { s += 6; reasons.push({ k: 'short interest ' + r2(dtc) + ' days to cover', v: 6 }); }
  const news = x.news || null;
  if (news && news.available && num(news.n, 0) > 0 && x.newsRecentH != null && x.newsRecentH <= 24 && Math.abs(num(news.score, 0)) >= 0.3) { s -= 10; tags.push('news already out'); }
  if (x.known) tags.push('scheduled: ' + x.known.type + ' ' + x.known.date);
  const score = Math.round(clamp(s, 0, 100));
  const lean = bull > bear ? 'bullish' : bear > bull ? 'bearish' : (bull || bear) ? 'mixed' : 'no lean';
  return { score, label: score >= 60 ? 'extreme' : score >= 40 ? 'high' : score >= 25 ? 'watch' : 'quiet', reasons, tags, lean };
}

function createCatalystRadar({ universe, candles, sentiment = null, institutional = null, filings = null, shortData = null, chain = null, known = null, now = Date.now, ttlMs = 10 * 60_000, candidates = 30, deepChain = 12, concurrency = 4, perSymbolMs = 9_000, logger = () => {} } = {}) {
  let cache = null, inflight = null;
  const safe = async (name, fn, ms = perSymbolMs) => { try { return await Promise.race([fn(), new Promise((r) => { const t = setTimeout(() => r(null), ms); if (t.unref) t.unref(); })]); } catch (error) { logger('warn', 'catalyst_radar_input_failed', { input: name, error: String(error && error.message || error) }); return null; } };

  async function evidence(row, knownMap) {
    const symbol = row.symbol;
    const [daily, sent, inst, fil, sh] = await Promise.all([
      safe('candles', () => candles(symbol, '1D')), sentiment ? safe('sentiment', () => sentiment(symbol)) : null,
      institutional ? safe('institutional', () => institutional(symbol), 5_000) : null, filings ? safe('filings', () => filings(symbol)) : null, shortData ? safe('short', () => shortData(symbol), 6_000) : null
    ]);
    const bars = daily && Array.isArray(daily.bars) ? daily.bars : [];
    const price = bars.length ? num(bars[bars.length - 1].c) : num(row.price);
    const comps = sent && sent.ok ? (sent.components || {}) : {};
    const newsRecentH = comps.news && Array.isArray(comps.news.drivers) && comps.news.drivers.length && comps.news.drivers[0].date ? (now() - Date.parse(comps.news.drivers[0].date)) / 3_600_000 : null;
    const interest = sh && Array.isArray(sh.interest) ? sh.interest[0] : null;
    return { symbol, price: r2(price), changePct: r2(num(row.changePct)), relVol: relVolume20(bars) ?? num(row.relVolume), realizedVol: realizedVol(bars), ivAtm: null,
      options: comps.options || null, social: comps.social || null, news: comps.news || null, newsRecentH: Number.isFinite(newsRecentH) ? r2(newsRecentH) : null,
      institutional: inst && inst.ok ? inst : null, filings: fil && fil.ok ? fil : null, shortDays: interest ? num(interest.days_to_cover ?? interest.daysToCover) : null,
      known: knownMap.get(symbol) || null, bars };
  }

  async function compute(limit) {
    let rows = []; try { rows = (await universe()) || []; } catch (error) { logger('warn', 'catalyst_radar_universe_failed', { error: String(error && error.message || error) }); }
    rows = rows.filter((r) => r && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(String(r.symbol || '').toUpperCase())).map((r) => ({ ...r, symbol: String(r.symbol).toUpperCase() }));
    const knownMap = new Map();
    if (known) { const k = await safe('known', () => known(), 8_000); for (const e of (Array.isArray(k) ? k : [])) if (e && e.symbol && !knownMap.has(e.symbol)) knownMap.set(String(e.symbol).toUpperCase(), { type: e.type, date: e.date }); }
    // the names the wide scanner already says are moving, plus anything with a known catalyst this week that is also in the universe
    const pre = rows.map((r) => ({ r, pre: (num(r.relVolume, 1) - 1) * 2 + Math.abs(num(r.changePct, 0)) / 2 + (knownMap.has(r.symbol) ? 2 : 0) })).sort((a, b) => b.pre - a.pre).slice(0, candidates).map((x) => x.r);
    const ev = []; let i = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, pre.length) }, async () => { while (i < pre.length) { const row = pre[i++]; ev.push(await evidence(row, knownMap)); } }));
    // second pass: ATM implied vol for the strongest names only (the chain is the expensive input)
    const first = ev.map((x) => ({ x, s: scoreName(x).score })).sort((a, b) => b.s - a.s);
    if (chain) { let j = 0; const top = first.slice(0, deepChain).map((t) => t.x); await Promise.all(Array.from({ length: Math.min(3, top.length) }, async () => { while (j < top.length) { const x = top[j++]; const rows2 = await safe('chain', () => chain(x.symbol), 12_000); x.ivAtm = atmIv(rows2, x.price); } })); }
    const out = ev.map((x) => { const sc = scoreName(x); const { bars, ...rest } = x; void bars; return { ...rest, ...sc, options: x.options ? { unusual: (x.options.unusual || []).slice(0, 3), putCall: x.options.putCall || null, score: r2(num(x.options.score)) } : null, social: x.social ? { velocityRatio: x.social.velocityRatio, sources: x.social.sources || null, score: r2(num(x.social.score)) } : null, news: x.news ? { n: x.news.n, score: r2(num(x.news.score)), drivers: (x.news.drivers || []).slice(0, 2) } : null, institutional: x.institutional ? { bias: x.institutional.bias, label: x.institutional.label, sweeps: x.institutional.tape && x.institutional.tape.sweeps ? x.institutional.tape.sweeps.n : null, blocks: x.institutional.tape && x.institutional.tape.blocks ? x.institutional.tape.blocks.n : null } : null, filings: x.filings ? { label: x.filings.label, cluster: Boolean(x.filings.insiders && x.filings.insiders.cluster), activistRecent: x.filings.activistRecent } : null, realizedVol: r2(x.realizedVol), ivAtm: r2(x.ivAtm), relVol: r2(x.relVol) }; })
      .sort((a, b) => b.score - a.score);
    return { ok: true, available: out.length > 0, asOf: now(), universe: rows.length, scanned: ev.length, rows: out.slice(0, limit),
      note: 'A high score means the market is behaving as if something is coming, not that something is. Names with a scheduled catalyst are tagged. Educational context, not a trade signal.' };
  }
  async function scan({ limit = 20 } = {}) {
    const n = clamp(Math.round(num(limit, 20)), 1, 40);
    if (cache && cache.until > now()) return { ...cache.value, rows: cache.value.rows.slice(0, n) };
    if (inflight) return inflight.then((v) => ({ ...v, rows: v.rows.slice(0, n) }));
    inflight = compute(40).then((v) => { cache = { until: now() + ttlMs, value: v }; return v; }).finally(() => { inflight = null; });
    return inflight.then((v) => ({ ...v, rows: v.rows.slice(0, n) }));
  }
  return { scan };
}

module.exports = { createCatalystRadar, scoreName, realizedVol, relVolume20, atmIv };
