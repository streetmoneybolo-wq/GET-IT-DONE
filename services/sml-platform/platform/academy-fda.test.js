'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fda = require('./academy-fda');

const NOW = Date.UTC(2026, 9, 14, 14, 0, 0);
const D = 86_400_000;
const day = (n) => new Date(NOW + n * D).toISOString().slice(0, 10);
const long = (d) => { const [y, m, dd] = d.split('-'); return ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(m) - 1] + ' ' + Number(dd) + ', ' + y; };

const NTLA = '<html><body><p>Intellia Announces FDA Acceptance of Biologics License Application with Priority Review for Lonvo-z &#x2022; FDA sets Prescription Drug User Fee Act (PDUFA) date of March 10, 2027</p><p>the FDA has accepted the Biologics License Application (BLA) and granted the BLA Priority Review with a PDUFA target action date of March 10, 2027. Additionally, FDA has advised the company that it is not currently planning to hold an advisory committee to discuss the application.</p></body></html>';
const BBIO = 'BridgeBio Announces FDA Acceptance and Priority Review of NDA for Oral Infigratinib - Accepted for Priority Review with a PDUFA target action date of February 4, 2027. Breakthrough Therapy designation was granted previously.';
const CRL = 'Following the Complete Response Letter received in May, the Company has resubmitted the NDA. The FDA has assigned a PDUFA target action date of ' + long(day(20)) + ' for the resubmission. An advisory committee meeting is scheduled to discuss the application.';

test('PDUFA dates are read from release text in either word order; duplicates collapse', () => {
  const a = fda.extractPdufa(NTLA); assert.equal(a.length, 1); assert.equal(a[0].date, '2027-03-10'); assert.ok(/Priority Review/.test(a[0].sentence));
  assert.equal(fda.extractPdufa(BBIO)[0].date, '2027-02-04');
  assert.equal(fda.extractPdufa('nothing here, just an earnings call on March 3, 2027').length, 0);
});

test('flags and the approval read: supplemental and resubmission bases, AdCom and priority review adjustments', () => {
  const f1 = fda.flagsFrom(NTLA); assert.equal(f1.priorityReview, true); assert.equal(f1.bla, true); assert.equal(f1.adcomNone, true); assert.equal(f1.resubmission, false);
  const r1 = fda.approvalRead(f1); assert.equal(r1.pct, 79); assert.equal(r1.label, 'leaning approval'); assert.ok(r1.inputs.some((i) => /not planning/.test(i.k)));
  const f2 = fda.flagsFrom(CRL); assert.equal(f2.resubmission, true); assert.equal(f2.adcomPlanned, true);
  const r2 = fda.approvalRead(f2); assert.equal(r2.pct, 68); assert.equal(r2.label, 'uncertain');
  const f3 = fda.flagsFrom('supplemental New Drug Application accepted; the advisory committee voted in favor 12-0'); assert.equal(f3.supplemental, true);
  assert.equal(fda.approvalRead(f3).pct, 95, 'capped at 95');
  assert.equal(fda.approvalRead(fda.flagsFrom('the advisory committee voted against approval')).pct, 40);
});

test('impact read: priced move, size, short interest and a first approval stack up', () => {
  const big = fda.impactRead({ implied: { impliedPct: 8 }, marketCap: 120e9, shortDays: 1, flags: { supplemental: true } });
  const small = fda.impactRead({ implied: { impliedPct: 35 }, marketCap: 800e6, shortDays: 12, flags: { supplemental: false, adcomPlanned: true } });
  assert.ok(small.score > big.score + 40); assert.equal(small.label, 'very high'); assert.equal(big.label, 'modest');
  assert.ok(fda.impactRead({ implied: null, marketCap: null, price: 5, adv: 100_000, flags: { supplemental: false } }).inputs.some((i) => /thin/.test(i.k)));
});

test('plays: collar + protective put for holders, debit spread when leaning approval, sell-the-news when likely, straddle when the binary is cheap', () => {
  const price = 50, exp = day(25);
  const rows = [-30, -20, -10, 0, 10, 20, 30].map((k) => { const strike = Math.round(price * (1 + k / 100)); const v = Math.max(0.2, 7 - Math.abs(k) * 0.2); return { strike, expiry: exp, call: { bid: v - 0.1, ask: v + 0.1, oi: 500 }, put: { bid: v - 0.1, ask: v + 0.1, oi: 500 } }; });
  const implied = { impliedPct: 20, expiry: exp };
  const lean = fda.playsFor({ price, implied, rows, approval: { pct: 79, label: 'leaning approval' }, impact: { score: 60 }, flags: { supplemental: false }, date: day(20), shortDays: 8 });
  const keys = lean.map((p) => p.key);
  assert.ok(keys.includes('collar') && keys.includes('protective_put') && keys.includes('call_spread') && keys.includes('post_decision') && !keys.includes('sell_the_news'));
  assert.ok(keys.includes('long_straddle'), '20% priced vs ~30% typical first-approval move');
  assert.ok(lean.every((p) => p.hedge && p.risks.length));
  const likely = fda.playsFor({ price, implied: { impliedPct: 30, expiry: exp }, rows, approval: { pct: 90, label: 'likely' }, impact: { score: 40 }, flags: { supplemental: true }, date: day(20) });
  assert.ok(likely.some((p) => p.key === 'sell_the_news') && !likely.some((p) => p.key === 'long_straddle'));
  assert.deepEqual(fda.playsFor({ price, implied: null, rows: [], approval: { pct: 70 }, impact: {}, flags: {}, date: day(20) }).map((p) => p.key), ['post_decision']);
});

test('service: EDGAR search -> exhibits -> dated events in the window, newest release wins, enriched and cached', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url); assert.ok(/support@/.test(opts.headers['user-agent']), 'address-form User-Agent');
    const json = (o) => ({ ok: true, json: async () => o, text: async () => '' }), text = (s) => ({ ok: true, text: async () => s, json: async () => ({}) });
    if (url.startsWith('https://efts.sec.gov/')) return json({ hits: { hits: [
      { _id: '0001-26-1:a.htm', _source: { ciks: ['1'], display_names: ['Alpha Bio  (ALFA)  (CIK 0000000001)'], file_date: day(-5) } },
      { _id: '0001-26-0:a0.htm', _source: { ciks: ['1'], display_names: ['Alpha Bio  (ALFA)  (CIK 0000000001)'], file_date: day(-90) } },
      { _id: '0002-26-1:b.htm', _source: { ciks: ['2'], display_names: ['Beta Pharma  (BETA)  (CIK 0000000002)'], file_date: day(-3) } },
      { _id: '0003-26-1:c.htm', _source: { ciks: ['3'], display_names: ['Private Co  (CIK 0000000003)'], file_date: day(-1) } },
      { _id: '0004-26-1:d.htm', _source: { ciks: ['4'], display_names: ['Far Away  (FARR)  (CIK 0000000004)'], file_date: day(-1) } }
    ] } });
    if (url.endsWith('/a.htm')) return text('Alpha Bio: the FDA accepted the NDA with Priority Review and a PDUFA target action date of ' + long(day(30)) + '.');
    if (url.endsWith('/a0.htm')) return text('Alpha Bio: earlier release, PDUFA target action date of ' + long(day(30)) + '.');
    if (url.endsWith('/b.htm')) return text('Beta Pharma: supplemental Biologics License Application accepted; PDUFA date of ' + long(day(45)) + '. The advisory committee voted in favor.');
    if (url.endsWith('/d.htm')) return text('Far Away: PDUFA target action date of ' + long(day(200)) + '.');
    return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
  };
  const svc = fda.createFdaService({ fetchImpl, now: () => NOW, candles: async () => ({ bars: Array.from({ length: 30 }, (_, i) => ({ t: NOW - (30 - i) * D, o: 20, h: 21, l: 19, c: 20, v: 500_000 })) }), chain: async () => [], company: async () => ({ marketCap: 1.5e9 }), shortData: async () => ({ daysToCover: 7 }), hedge: { plan: async () => ({ ok: true, ideas: [{ name: 'Collar' }] }) } });
  const r = await svc.upcoming({ days: 60 });
  assert.equal(r.available, true); assert.deepEqual(r.events.map((e) => e.symbol + ':' + e.date), ['ALFA:' + day(30), 'BETA:' + day(45)], 'FARR outside the window, private co has no ticker');
  const alfa = r.events[0]; assert.equal(alfa.source.filed, day(-5), 'newest release for the same decision wins'); assert.equal(alfa.approval.pct, 74); assert.equal(alfa.flags.priorityReview, true);
  assert.ok(alfa.impact.score >= 25 && alfa.plays.length >= 1 && alfa.hedgeIdeas.length === 1 && alfa.price === 20 && alfa.shortDays === 7);
  assert.equal(r.events[1].approval.pct, 95);
  const n = calls.length; const again = await svc.upcoming({ days: 60 }); assert.equal(again, r); assert.equal(calls.length, n, 'cached');
  const det = await svc.detail('beta'); assert.equal(det.symbol, 'BETA'); assert.equal(det.approval.label, 'likely');
  assert.equal((await svc.detail('ZZZ')).available, false);
});

test('service: an EDGAR outage is reported, never thrown', async () => {
  const svc = fda.createFdaService({ fetchImpl: async () => { throw new Error('down'); }, now: () => NOW });
  const r = await svc.upcoming({}); assert.equal(r.ok, true); assert.equal(r.available, false); assert.equal(r.reason, 'edgar_unavailable');
});
