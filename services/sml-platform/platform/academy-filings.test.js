'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const filings = require('./academy-filings');

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);
const d = (daysAgo) => new Date(NOW - daysAgo * 86_400_000).toISOString().slice(0, 10);
const form4 = ({ owner = 'DOE JANE', code = 'P', shares = 10000, price = 50, date = d(3), ad = code === 'P' ? 'A' : 'D' }) => `<?xml version="1.0"?><ownershipDocument><reportingOwner><reportingOwnerId><rptOwnerName>${owner}</rptOwnerName></reportingOwnerId><reportingOwnerRelationship><isDirector>1</isDirector><officerTitle>CEO</officerTitle></reportingOwnerRelationship></reportingOwner>
<nonDerivativeTable><nonDerivativeTransaction><transactionDate><value>${date}</value></transactionDate><transactionCoding><transactionCode>${code}</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>${shares}</value></transactionShares><transactionPricePerShare><value>${price}</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>${ad}</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction>
<nonDerivativeTransaction><transactionDate><value>${date}</value></transactionDate><transactionCoding><transactionCode>A</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>99999</value></transactionShares><transactionPricePerShare><value>0</value></transactionPricePerShare><transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode></transactionAmounts></nonDerivativeTransaction></nonDerivativeTable>
<derivativeTable><derivativeTransaction><transactionCoding><transactionCode>P</transactionCode></transactionCoding><transactionAmounts><transactionShares><value>5</value></transactionShares></transactionAmounts></derivativeTransaction></derivativeTable></ownershipDocument>`;

test('Form 4 parsing keeps open-market P/S only, skipping grants and the derivative table', () => {
  const t = filings.parseForm4(form4({}), { filingDate: d(1), accession: 'x' });
  assert.equal(t.length, 1); assert.equal(t[0].side, 'buy'); assert.equal(t[0].value, 500_000); assert.equal(t[0].owner, 'DOE JANE'); assert.equal(t[0].title, 'CEO');
  const s = filings.parseForm4(form4({ code: 'S', ad: 'D' }));
  assert.equal(s[0].side, 'sell');
});

test('cluster buying (two insiders in 30 days) is the strongest read; heavy selling reads negative', () => {
  const buys = [...filings.parseForm4(form4({ owner: 'A' })), ...filings.parseForm4(form4({ owner: 'B', date: d(10) }))];
  const c = filings.summarizeInsiders(buys, { now: NOW });
  assert.equal(c.cluster, true); assert.equal(c.last30.buyers, 2); assert.ok(c.bias >= 100 || c.bias > 90);
  assert.equal(filings.labelOf(c.bias, c.cluster), 'cluster insider buying');
  const sells = filings.parseForm4(form4({ code: 'S', ad: 'D', shares: 200000, price: 50 }));
  const sc = filings.summarizeInsiders(sells, { now: NOW });
  assert.ok(sc.bias <= -90); assert.equal(filings.labelOf(sc.bias, false), 'insiders selling');
  assert.equal(filings.summarizeInsiders([], { now: NOW }).bias, 0);
  assert.equal(filings.summarizeInsiders(filings.parseForm4(form4({ date: d(200) })), { now: NOW }).last90.buys, 0, 'old transactions fall out of the window');
});

test('service: ticker map -> submissions -> Form 4 documents, with 13D stakes and caching', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const json = (o) => ({ ok: true, json: async () => o, text: async () => JSON.stringify(o) });
    const text = (s) => ({ ok: true, text: async () => s, json: async () => ({}) });
    if (url.includes('company_tickers')) return json({ 0: { cik_str: 320193, ticker: 'ABC', title: 'Abc Inc' } });
    if (url.includes('/submissions/CIK0000320193')) return json({ filings: { recent: { form: ['4', 'SC 13D', '10-Q', '4'], filingDate: [d(2), d(20), d(30), d(400)], accessionNumber: ['0001-26-1', '0001-26-2', '0001-26-3', '0001-26-4'], primaryDocument: ['f4a.xml', 'sc13d.htm', 'q.htm', 'old.xml'] } } });
    if (url.endsWith('/f4a.xml')) return text(form4({ owner: 'DOE JANE' }));
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  const svc = filings.createFilingsService({ fetchImpl, now: () => NOW, userAgent: 'test agent' });
  const r = await svc.get('abc');
  assert.equal(r.available, true); assert.equal(r.company, 'Abc Inc'); assert.equal(r.form4Read, 1, 'the year-old Form 4 is not fetched');
  assert.equal(r.insiders.last30.buys, 1); assert.equal(r.stakes.length, 1); assert.equal(r.activistRecent, 1);
  assert.ok(r.bias > 0); assert.ok(calls.every((u) => u.startsWith('https://')));
  const again = await svc.get('ABC'); assert.equal(again, r); assert.equal(calls.length, 3, 'cached: no new EDGAR calls');
  const miss = await svc.get('ZZZZ'); assert.equal(miss.available, false); assert.equal(miss.reason, 'not_in_edgar');
});

test('service: an EDGAR outage is reported as unavailable, never thrown', async () => {
  const svc = filings.createFilingsService({ fetchImpl: async () => { throw new Error('boom'); }, now: () => NOW });
  const r = await svc.get('ABC'); assert.equal(r.ok, true); assert.equal(r.available, false); assert.equal(r.reason, 'edgar_unavailable');
});
