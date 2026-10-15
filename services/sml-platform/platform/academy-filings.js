'use strict';

/* SEC EDGAR for one symbol, no vendor, no key: Form 4 insider transactions (open-market buys and sells, 2-business-day lag)
 * and SC 13D / 13G filings (5%+ stakes, activist or passive). Cached six hours per symbol; EDGAR asks for a descriptive
 * User-Agent and under ten requests a second, both honoured here. Educational context, not a trade signal. */

const TICKERS_URL = 'https://www.sec.gov/files/company_tickers.json';
const SUBMISSIONS = (cik) => `https://data.sec.gov/submissions/CIK${String(cik).padStart(10, '0')}.json`;
const ARCHIVE = (cik, acc, doc) => `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${String(acc).replace(/-/g, '')}/${doc}`;
const DAY = 86_400_000;

const num = (v, d = null) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo = -100, hi = 100) => Math.max(lo, Math.min(hi, v));
const tag = (xml, name) => { const m = new RegExp(`<${name}>\\s*(?:<value>)?\\s*([^<]*?)\\s*(?:</value>)?\\s*</${name}>`, 'i').exec(xml); return m ? m[1].trim() : ''; };

/* Open-market transactions from a Form 4 XML: code P (purchase) or S (sale) in the non-derivative table only. Grants (A),
   tax withholding (F), option exercises (M) and gifts (G) are not conviction and are left out. */
function parseForm4(xml, { filingDate = '', accession = '' } = {}) {
  const owner = tag(xml, 'rptOwnerName') || 'insider';
  const title = tag(xml, 'officerTitle') || (tag(xml, 'isDirector') === '1' || /true/i.test(tag(xml, 'isDirector')) ? 'Director' : '') || (/true|1/.test(tag(xml, 'isTenPercentOwner')) ? '10% owner' : '');
  const out = [];
  const table = (/<nonDerivativeTable>([\s\S]*?)<\/nonDerivativeTable>/i.exec(xml) || [])[1] || '';
  const re = /<nonDerivativeTransaction>([\s\S]*?)<\/nonDerivativeTransaction>/gi; let m;
  while ((m = re.exec(table))) {
    const x = m[1], code = tag(x, 'transactionCode').toUpperCase();
    if (code !== 'P' && code !== 'S') continue;
    const shares = num(tag(x, 'transactionShares'), 0), price = num(tag(x, 'transactionPricePerShare'), 0), ad = tag(x, 'transactionAcquiredDisposedCode').toUpperCase();
    const side = code === 'P' || ad === 'A' ? 'buy' : 'sell';
    out.push({ owner, title, side, shares, price, value: Math.round(shares * price), date: tag(x, 'transactionDate') || filingDate, filingDate, accession });
  }
  return out;
}

function summarizeInsiders(txns, { now = Date.now() } = {}) {
  const within = (t, days) => { const d = Date.parse(String(t.date || t.filingDate) + 'T00:00:00Z'); return Number.isFinite(d) && now - d <= days * DAY; };
  const bucket = (days) => {
    const rows = txns.filter((t) => within(t, days));
    const buys = rows.filter((t) => t.side === 'buy'), sells = rows.filter((t) => t.side === 'sell');
    const sum = (a) => a.reduce((s, t) => s + (t.value || 0), 0);
    return { buys: buys.length, sells: sells.length, buyValue: sum(buys), sellValue: sum(sells), buyers: new Set(buys.map((t) => t.owner)).size, sellers: new Set(sells.map((t) => t.owner)).size };
  };
  const d30 = bucket(30), d90 = bucket(90);
  const net90 = d90.buyValue - d90.sellValue, gross90 = d90.buyValue + d90.sellValue;
  let bias = gross90 > 0 ? clamp(100 * net90 / gross90) : 0;
  if (d30.buyers >= 2) bias = clamp(bias + 25); // several insiders buying the same month is the strongest public signal here
  return { last30: d30, last90: d90, net90, cluster: d30.buyers >= 2, bias: Math.round(bias), recent: txns.slice(0, 8) };
}

function labelOf(bias, cluster) {
  if (cluster) return 'cluster insider buying';
  if (bias >= 40) return 'insiders buying'; if (bias >= 15) return 'leaning insider buying';
  if (bias <= -40) return 'insiders selling'; if (bias <= -15) return 'leaning insider selling';
  return 'quiet';
}

function createFilingsService({ fetchImpl = fetch, userAgent = 'StockMarketLoop Academy (stockmarketloop.com)', now = Date.now, ttlMs = 6 * 3_600_000, maxForm4 = 12, logger = () => {} } = {}) {
  const cache = new Map(), inflight = new Map();
  let tickers = null, tickersAt = 0, tickersLoading = null;
  let lastReq = 0;
  async function sec(url, as = 'json') {
    const wait = Math.max(0, lastReq + 120 - now()); if (wait) await new Promise((r) => setTimeout(r, wait)); lastReq = now();
    const res = await fetchImpl(url, { headers: { 'user-agent': userAgent, accept: as === 'json' ? 'application/json' : 'application/xml,text/xml,*/*' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`sec_${res.status}`);
    return as === 'json' ? res.json() : res.text();
  }
  async function cikFor(symbol) {
    if (!tickers || now() - tickersAt > DAY) {
      if (!tickersLoading) tickersLoading = sec(TICKERS_URL).then((j) => { const map = new Map(); for (const r of Object.values(j || {})) if (r && r.ticker) map.set(String(r.ticker).toUpperCase(), { cik: r.cik_str, name: r.title }); tickers = map; tickersAt = now(); }).finally(() => { tickersLoading = null; });
      await tickersLoading;
    }
    return tickers.get(String(symbol).toUpperCase().replace(/\./g, '-')) || tickers.get(String(symbol).toUpperCase()) || null;
  }
  async function compute(symbol) {
    const t = now();
    const co = await cikFor(symbol);
    if (!co) return { ok: true, symbol, available: false, reason: 'not_in_edgar', asOf: t };
    const sub = await sec(SUBMISSIONS(co.cik));
    const r = (sub && sub.filings && sub.filings.recent) || {};
    const forms = r.form || [], dates = r.filingDate || [], accs = r.accessionNumber || [], docs = r.primaryDocument || [];
    const stakes = [], form4 = [];
    for (let i = 0; i < forms.length; i++) {
      const f = String(forms[i] || '').toUpperCase(), d = String(dates[i] || ''), age = (t - Date.parse(d + 'T00:00:00Z')) / DAY;
      if (!Number.isFinite(age) || age > 365) continue;
      if (/^SC 13[DG]/.test(f) && age <= 180) stakes.push({ form: f, date: d, accession: accs[i], daysAgo: Math.round(age) });
      else if (f === '4' && age <= 90 && form4.length < maxForm4) form4.push({ date: d, accession: accs[i], doc: docs[i] });
    }
    const txns = [];
    for (const f of form4) {
      try { const xml = await sec(ARCHIVE(co.cik, f.accession, f.doc), 'xml'); txns.push(...parseForm4(xml, { filingDate: f.date, accession: f.accession })); }
      catch (error) { logger('warn', 'filings_form4_failed', { symbol, accession: f.accession, error: String(error && error.message || error) }); }
    }
    txns.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    const insiders = summarizeInsiders(txns, { now: t });
    const activist = stakes.filter((s) => /13D/.test(s.form) && s.daysAgo <= 60);
    let bias = insiders.bias; if (activist.length) bias = clamp(bias + 15);
    return {
      ok: true, symbol, available: true, asOf: t, company: co.name, cik: co.cik,
      bias: Math.round(bias), label: labelOf(bias, insiders.cluster), insiders, stakes: stakes.slice(0, 10), activistRecent: activist.length,
      form4Read: form4.length, note: 'Form 4 lags two business days and 13D/13G ten; both are public SEC filings. Educational context, not a trade signal.'
    };
  }
  async function get(symbol) {
    const key = String(symbol || '').toUpperCase();
    const hit = cache.get(key); if (hit && hit.until > now()) return hit.value;
    if (inflight.has(key)) return inflight.get(key);
    const p = compute(key).catch((error) => { logger('warn', 'filings_failed', { symbol: key, error: String(error && error.message || error) }); return { ok: true, symbol: key, available: false, reason: 'edgar_unavailable', asOf: now() }; })
      .then((v) => { cache.set(key, { until: now() + (v.available ? ttlMs : 10 * 60_000), value: v }); if (cache.size > 500) cache.delete(cache.keys().next().value); return v; }).finally(() => inflight.delete(key));
    inflight.set(key, p); return p;
  }
  return { get };
}

module.exports = { createFilingsService, parseForm4, summarizeInsiders, labelOf };
