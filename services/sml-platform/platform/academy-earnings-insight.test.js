'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./academy-earnings-insight');

/* twelve quarters of a company growing 12% a year with a 2-point seasonal bump in Q4 and margins widening slowly */
function synth(n = 12) {
  const inc = [], bal = [], cf = [];
  for (let i = 0; i < n; i++) {
    const fy = 2024 + Math.floor(i / 4), fq = (i % 4) + 1, period = `${fy}-${String(fq * 3).padStart(2, '0')}-28`;
    const revenue = Math.round(1e9 * Math.pow(1.12, i / 4) * (fq === 4 ? 1.15 : 1));
    const gm = 0.40 + i * 0.0025, opexPct = 0.22 - i * 0.001;
    const gross = Math.round(revenue * gm), opex = Math.round(revenue * opexPct), op = gross - opex, pretax = op + 5e6, tax = Math.round(pretax * 0.2), net = pretax - tax;
    inc.push({ period_end: period, filing_date: period, fiscal_quarter: fq, fiscal_year: fy, timeframe: 'quarterly', revenue, cost_of_revenue: revenue - gross, gross_profit: gross, research_development: Math.round(opex * 0.6), selling_general_administrative: Math.round(opex * 0.4), total_operating_expenses: opex, operating_income: op, income_before_income_taxes: pretax, income_taxes: tax, total_other_income_expense: 5e6, net_income_loss_attributable_common_shareholders: net, diluted_earnings_per_share: Math.round(net / 1e8 * 100) / 100, diluted_shares_outstanding: 1e8 });
    bal.push({ period_end: period, fiscal_quarter: fq, fiscal_year: fy, timeframe: 'quarterly', cash_and_equivalents: 2e9, short_term_investments: 1e9, debt_current: 1e8, long_term_debt_and_capital_lease_obligations: 9e8, deferred_revenue_current: Math.round(2e8 * Math.pow(1.25, i / 4)), inventories: Math.round(1e8 * Math.pow(1.5, i / 4)), receivables: Math.round(3e8 * Math.pow(1.12, i / 4)) });
    cf.push({ period_end: period, fiscal_quarter: fq, fiscal_year: fy, timeframe: 'quarterly', net_cash_from_operating_activities: Math.round(op * 1.1), purchase_of_property_plant_and_equipment: -Math.round(revenue * 0.05) });
  }
  return { income_statement: inc.slice().reverse(), balance_sheet: bal.slice().reverse(), cash_flow: cf.slice().reverse() };
}

test('quarters: statements are joined by period, sorted oldest first, with margins, cost ratios, YoY, QoQ and operating leverage', () => {
  const qs = E.quartersFrom(synth(8));
  assert.equal(qs.length, 8); assert.equal(qs[0].period, '2024-03-28'); assert.equal(qs[7].label, 'Q4 FY25');
  const q = qs[7];
  assert.ok(q.grossMarginPct > 41 && q.grossMarginPct < 42.5); assert.ok(q.opMarginPct > 19); assert.equal(q.fcf, q.ocf - q.capex); assert.equal(q.cash, 3e9); assert.equal(q.debt, 1e9);
  assert.ok(Math.abs(q.yoy.revenue - 12) < 0.3, 'YoY growth is read against the same fiscal quarter a year ago: ' + q.yoy.revenue);
  assert.ok(q.qoq.revenue > 10, 'Q4 is the seasonal high');
  assert.ok(q.incrementalMargin > 0.2 && q.incrementalMargin < 0.6, 'operating leverage is a share of the extra revenue');
  assert.equal(q.taxRatePct, 20);
  assert.deepEqual(E.quartersFrom(null), []); assert.deepEqual(E.quartersFrom({ income_statement: [{ period_end: '2024-01-01', revenue: 0 }] }), [], 'a quarter without revenue is not a quarter');
});

test('trend and the model: growth blended from the recent years-over-year, margins moved along their slope, seasonality from the base quarter', () => {
  const qs = E.quartersFrom(synth(12));
  const t = E.trendOf(qs);
  assert.ok(t.grossMarginSlope > 0, 'gross margin widening'); assert.ok(t.opexPctSlope < 0, 'opex ratio falling'); assert.ok(t.incrementalMarginAvg > 0.2);
  assert.ok(t.season && t.season[4] > 1.1 && t.season[1] < 1, 'Q4 is the seasonal high');
  const m = E.projectNext(qs);
  assert.equal(m.label, 'Q1 FY27'); assert.equal(m.baseRevenue, qs[8].revenue, 'the base is the same fiscal quarter a year ago');
  assert.ok(Math.abs(m.growthPct - 12) < 1, 'growth near the steady 12%: ' + m.growthPct);
  assert.ok(Math.abs(m.revenue / qs[8].revenue - 1.12) < 0.012);
  assert.ok(m.grossMarginPct > qs[11].grossMarginPct, 'margin carried along its slope'); assert.ok(m.eps > 0 && m.opIncome > 0 && m.cogs > 0 && m.rd > 0 && m.sga > 0);
  assert.equal(E.projectNext(qs.slice(0, 4)), null, 'fewer than five quarters: no model');
  const bt = E.backtest(qs);
  assert.equal(bt.n, 4); assert.ok(bt.revenueMapePct < 2, 'a steady company is modelled closely: ' + bt.revenueMapePct); assert.ok(bt.epsMapePct != null);
  for (const r of bt.rows) assert.ok(r.revenue.model && r.revenue.actual && r.period, 'each row is a real past report');
});

test('the street: next estimate and the beat history from the bridge records; signals read growth, costs, bookings, inventory, cash, model and street', () => {
  const NOW = Date.parse('2026-10-19T12:00:00Z');
  const st = E.streetFrom({ earnings: [{ date: '2026-10-30', time: 'amc', epsEstimate: 1.5, revenueEstimate: 1.6e9 }, { date: '2026-07-30', epsEstimate: 1.2, epsActual: 1.3 }, { date: '2026-04-30', epsEstimate: 1.1, epsActual: 1.0 }, { date: '2026-01-30', epsEstimate: 1.0, epsActual: 1.2 }, { date: '2025-10-30', epsEstimate: 0.9, epsActual: 1.0 }] }, NOW);
  assert.deepEqual(st.next, { date: '2026-10-30', timing: 'AMC', epsEstimate: 1.5, revenueEstimate: 1.6e9 }); assert.equal(st.n, 4); assert.equal(st.beats, 3); assert.ok(st.avgSurprisePct > 0);
  const qs = E.quartersFrom(synth(12)), t = E.trendOf(qs), m = E.projectNext(qs), bt = E.backtest(qs);
  const sig = E.signalsOf(qs, t, m, st, { backtest: bt, priced: { impliedPct: 6.1, avgAbsPct: 8.2, n: 6, edge: 1.34, read: 'the move is cheap versus history' }, short: { daysToCover: 6.2, ratioAvg: 48 }, filings: { count8k: 2, recent8k: '2026-10-01' } });
  const keys = sig.map((s) => s.key);
  for (const k of ['growth', 'gross', 'costs', 'opmargin', 'deferred', 'inventory', 'cash', 'model', 'street', 'beats', 'priced', 'short', 'filings']) assert.ok(keys.includes(k), 'signal ' + k);
  assert.match(sig.find((s) => s.key === 'deferred').text, /bookings are running ahead/); assert.match(sig.find((s) => s.key === 'inventory').text, /building faster than sales/);
  assert.match(sig.find((s) => s.key === 'model').text, /within about [0-9.]+% on revenue/); assert.match(sig.find((s) => s.key === 'short').text, /crowded short/);
  assert.equal(sig.find((s) => s.key === 'priced').tone, 'up');
});

test('the AI brief is parsed strictly from the JSON the model returns; prose around it is ignored and junk is refused', () => {
  const ok = E.parseBrief('Here you go:\n{"headline":"Margins widening into the print","drivers":["Revenue +12%"],"costs":["R&D 13% of revenue"],"margins":"Gross 42.7%","watch":["Deferred revenue"],"scenarios":{"beat":"Above 1.6B","in-line":"1.6B","miss":"Below"},"confidence":"medium: four clean quarters"}\nThanks');
  assert.equal(ok.headline, 'Margins widening into the print'); assert.deepEqual(ok.margins, ['Gross 42.7%']); assert.equal(ok.scenarios.inline, '1.6B'); assert.equal(ok.confidence, 'medium: four clean quarters');
  assert.equal(E.parseBrief('no json here'), null); assert.equal(E.parseBrief('{bad json'), null);
  assert.match(E.aiPrompt('ACME', { quarters: E.quartersFrom(synth(6)), trend: E.trendOf(E.quartersFrom(synth(6))), model: null, backtest: null, street: null, news: [{ title: 'ACME wins contract' }] }), /COMPANY: ACME[\s\S]*Q2 FY25[\s\S]*RECENT HEADLINES[\s\S]*ACME wins contract/);
});

test('the service: inputs gathered in parallel and tolerated when missing, the AI brief cached per quarter, failures reported not thrown', async () => {
  let fin = 0, ai = 0, clock = Date.parse('2026-10-19T12:00:00Z');
  const fetchImpl = async (url, init) => { ai += 1; assert.match(url, /api\.anthropic\.com/); assert.equal(init.headers['x-api-key'], 'k'); const body = JSON.parse(init.body); assert.match(body.messages[0].content, /COMPANY: ACME/); return new Response(JSON.stringify({ model: 'claude-test', content: [{ type: 'text', text: '{"headline":"H","drivers":["d"],"costs":[],"margins":[],"watch":["w"],"scenarios":{"beat":"b","inline":"i","miss":"m"},"confidence":"high"}' }] }), { status: 200 }); };
  const svc = E.createEarningsInsight({ financials: async () => { fin += 1; return { datasets: synth(10) }; }, history: async () => ({ earnings: [{ date: '2026-10-30', epsEstimate: 1.4 }] }), playbook: async () => ({ available: true, implied: { impliedPct: 5 }, history: { avgAbsPct: 7, n: 4 }, edge: 1.4, read: 'cheap', date: '2026-10-30', timing: 'AMC' }), news: async () => { throw new Error('down'); }, filings: async () => ({ filings: [{ form_type: '8-K', filing_date: '2026-10-02' }, { form_type: '4', filing_date: '2026-09-20' }] }), shortData: async () => ({ volume: [{ ratio: 40 }, { ratio: 50 }], interest: [{ date: '2026-09-30', days_to_cover: 2.5, short_interest: 1e6 }] }), ai: { apiKey: 'k', model: 'claude-test' }, fetchImpl, now: () => clock, logger: () => {} });
  const out = await svc.insight('acme');
  assert.equal(out.ok, true); assert.equal(out.symbol, 'ACME'); assert.equal(out.quarters.length, 10); assert.equal(out.model.label, 'Q3 FY26');
  assert.equal(out.street.next.epsEstimate, 1.4); assert.equal(out.priced.impliedPct, 5); assert.equal(out.short.daysToCover, 2.5); assert.equal(out.short.ratioAvg, 45); assert.equal(out.filings.count8k, 1); assert.deepEqual(out.news, [], 'a dead news feed costs nothing');
  assert.equal(out.ai.available, true); assert.equal(out.ai.headline, 'H'); assert.equal(out.ai.model, 'claude-test'); assert.equal(out.next.date, '2026-10-30');
  await svc.insight('ACME'); assert.equal(fin, 1, 'cached'); assert.equal(ai, 1);
  clock += 31 * 60_000; await svc.insight('ACME'); assert.equal(fin, 2, 'refreshed after the ttl'); assert.equal(ai, 1, 'the brief is kept per quarter, not re-asked every refresh');
  assert.equal((await svc.insight('bad symbol')).error, 'invalid_symbol');
  const none = E.createEarningsInsight({ financials: async () => null, logger: () => {} });
  const empty = await none.insight('ZZZZ'); assert.equal(empty.available, false); assert.equal(empty.reason, 'no_financials');
  const off = E.createEarningsInsight({ financials: async () => ({ datasets: synth(8) }), logger: () => {} });
  assert.equal((await off.insight('ACME')).ai.reason, 'ai_unconfigured');
  const broken = E.createEarningsInsight({ financials: async () => ({ datasets: synth(8) }), ai: { apiKey: 'k' }, fetchImpl: async () => new Response('nope', { status: 500 }), logger: () => {} });
  assert.equal((await broken.insight('ACME')).ai.reason, 'ai_unavailable');
});
