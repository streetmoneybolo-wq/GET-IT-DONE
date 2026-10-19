'use strict';

/* Earnings insight: what a company's own numbers say before its next report, and a model of that report.
 *
 * Inputs the platform already has: the quarterly income statement, balance sheet and cash flow (the site's Massive
 * financials feed), the earnings history and next date (the data bridge), daily candles, the earnings playbook (the move
 * the options market prices versus past reports), the short-sale feed, SEC filings and the ticker's news.
 *
 * What it computes, all from reported figures:
 *   quarters   every reported quarter with revenue, cost of revenue, gross profit, R&D, SG&A, operating income, net income,
 *              EPS, cash from operations, capex, free cash flow, cash, debt, deferred revenue, inventories, receivables,
 *              and each one's margins, cost ratios, YoY and QoQ growth
 *   trend      where margins and costs are heading (slope over the last eight quarters), operating leverage (how much of
 *              each extra dollar of revenue became operating income), the seasonal shape of the year
 *   model      next quarter's revenue, costs, operating income and EPS from the same fiscal quarter a year ago, the
 *              blended growth rate and the margin trend; checked against what the method would have said for the last
 *              four reports (its own error band), and set beside the street's estimate when the bridge has one
 *   signals    deferred revenue running ahead of revenue (bookings), inventory and receivables building faster than
 *              sales, cash burn, the priced move versus history, short-interest crowding, fresh 8-K filings
 *   read       plain sentences; and, when an Anthropic key is configured, a short AI brief written only from these numbers
 *              (drivers, costs, margins, what to watch, beat / in-line / miss scenarios), cached per symbol and quarter.
 *
 * Nothing here knows the result. It measures what the company has been doing and sets a reference the member can judge the
 * report against. Educational only. */

const DAY = 86_400_000;
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const r3 = (v) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const pct = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && Math.abs(b) > 0 ? (a / b - 1) * 100 : null);
const share = (a, b) => (Number.isFinite(a) && Number.isFinite(b) && b > 0 ? (a / b) * 100 : null);

/* ------------------------------------------------------------------ the quarters */
const pick = (row, keys) => { for (const k of keys) { const v = num(row && row[k]); if (v != null) return v; } return null; };
function quartersFrom(datasets) {
  const d = datasets && typeof datasets === 'object' ? datasets : {};
  const inc = Array.isArray(d.income_statement) ? d.income_statement : [], bal = Array.isArray(d.balance_sheet) ? d.balance_sheet : [], cf = Array.isArray(d.cash_flow) ? d.cash_flow : [];
  const byEnd = (rows) => { const m = new Map(); for (const r of rows) if (r && typeof r.period_end === 'string') m.set(r.period_end.slice(0, 10), r); return m; };
  const B = byEnd(bal), C = byEnd(cf);
  const out = [];
  for (const r of inc) {
    if (!r || typeof r.period_end !== 'string' || (r.timeframe && r.timeframe !== 'quarterly')) continue;
    const period = r.period_end.slice(0, 10), b = B.get(period) || {}, c = C.get(period) || {};
    const revenue = pick(r, ['revenue', 'revenues', 'total_revenue']);
    if (!(revenue > 0)) continue;
    const cogs = pick(r, ['cost_of_revenue', 'cost_of_goods_sold']), gross = pick(r, ['gross_profit']) ?? (cogs != null ? revenue - cogs : null);
    const rd = pick(r, ['research_development', 'research_and_development']), sga = pick(r, ['selling_general_administrative', 'sga']);
    const opex = pick(r, ['total_operating_expenses', 'operating_expenses']) ?? ((rd || 0) + (sga || 0) || null);
    const opIncome = pick(r, ['operating_income', 'operating_income_loss']) ?? (gross != null && opex != null ? gross - opex : null);
    const netIncome = pick(r, ['net_income_loss_attributable_common_shareholders', 'net_income_loss', 'net_income', 'consolidated_net_income_loss']);
    const pretax = pick(r, ['income_before_income_taxes']), taxes = pick(r, ['income_taxes', 'income_tax_expense']);
    const other = pick(r, ['total_other_income_expense', 'other_income_expense']);
    const eps = pick(r, ['diluted_earnings_per_share', 'basic_earnings_per_share', 'eps_diluted', 'eps']);
    const shares = pick(r, ['diluted_shares_outstanding', 'basic_shares_outstanding', 'shares_outstanding']);
    const ocf = pick(c, ['net_cash_from_operating_activities', 'cash_from_operating_activities_continuing_operations', 'operating_cash_flow']);
    const capexRaw = pick(c, ['purchase_of_property_plant_and_equipment', 'capital_expenditure', 'capex']);
    const capex = capexRaw == null ? null : Math.abs(capexRaw);
    const fcf = ocf != null && capex != null ? ocf - capex : (ocf != null ? ocf : null);
    const cash = (pick(b, ['cash_and_equivalents', 'cash']) || 0) + (pick(b, ['short_term_investments']) || 0);
    const debt = (pick(b, ['debt_current', 'short_term_debt']) || 0) + (pick(b, ['long_term_debt_and_capital_lease_obligations', 'long_term_debt']) || 0);
    out.push({
      period, fq: num(r.fiscal_quarter), fy: num(r.fiscal_year), label: (num(r.fiscal_quarter) ? 'Q' + r.fiscal_quarter : period.slice(0, 7)) + (num(r.fiscal_year) ? ' FY' + String(r.fiscal_year).slice(-2) : ''), filed: typeof r.filing_date === 'string' ? r.filing_date.slice(0, 10) : null,
      revenue, cogs, gross, rd, sga, opex, opIncome, netIncome, pretax, taxes, other, eps, shares, ebitda: pick(r, ['ebitda']),
      ocf, capex, fcf, cash: Object.keys(b).length ? cash : null, debt: Object.keys(b).length ? debt : null,
      deferredRevenue: pick(b, ['deferred_revenue_current', 'deferred_revenue']), inventories: pick(b, ['inventories', 'inventory']), receivables: pick(b, ['receivables', 'accounts_receivable']),
      grossMarginPct: share(gross, revenue), opMarginPct: share(opIncome, revenue), netMarginPct: share(netIncome, revenue), fcfMarginPct: share(fcf, revenue),
      cogsPct: share(cogs, revenue), rdPct: share(rd, revenue), sgaPct: share(sga, revenue), opexPct: share(opex, revenue),
      taxRatePct: pretax > 0 && taxes != null ? r1(clamp((taxes / pretax) * 100, 0, 60)) : null
    });
  }
  out.sort((a, b) => a.period.localeCompare(b.period));
  /* growth against the same quarter a year ago (four quarters back) and the quarter before */
  const GROW = ['revenue', 'gross', 'opIncome', 'netIncome', 'eps', 'fcf', 'opex', 'rd', 'sga', 'cogs', 'deferredRevenue', 'inventories', 'receivables'];
  out.forEach((q, i) => {
    q.yoy = {}; q.qoq = {};
    const y = out[i - 4], p = out[i - 1];
    for (const k of GROW) { q.yoy[k] = y ? r1(pct(q[k], y[k])) : null; q.qoq[k] = p ? r1(pct(q[k], p[k])) : null; }
    q.grossMarginYoyPts = y && q.grossMarginPct != null && y.grossMarginPct != null ? r1(q.grossMarginPct - y.grossMarginPct) : null;
    q.opMarginYoyPts = y && q.opMarginPct != null && y.opMarginPct != null ? r1(q.opMarginPct - y.opMarginPct) : null;
    /* operating leverage: of each extra dollar of revenue over a year ago, how much became operating income */
    q.incrementalMargin = y && q.revenue !== y.revenue && q.opIncome != null && y.opIncome != null ? r2((q.opIncome - y.opIncome) / (q.revenue - y.revenue)) : null;
  });
  return out;
}

/* ------------------------------------------------------------------ trends */
function slope(values) {
  const pts = values.map((v, i) => [i, v]).filter(([, v]) => Number.isFinite(v));
  if (pts.length < 3) return null;
  const n = pts.length, mx = pts.reduce((s, [x]) => s + x, 0) / n, my = pts.reduce((s, [, y]) => s + y, 0) / n;
  let sxx = 0, sxy = 0; for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); }
  return sxx > 0 ? sxy / sxx : null;
}
function trendOf(quarters) {
  const last8 = quarters.slice(-8), last = quarters[quarters.length - 1] || null;
  if (!last) return null;
  const yoys = quarters.map((q) => q.yoy.revenue).filter((v) => v != null);
  const seasonal = {};
  /* the seasonal shape: each fiscal quarter's revenue against its fiscal year's average, when at least two years are known */
  const years = new Map();
  for (const q of quarters) if (q.fy && q.fq) { if (!years.has(q.fy)) years.set(q.fy, []); years.get(q.fy).push(q); }
  for (const [, qs] of years) { if (qs.length < 4) continue; const avg = qs.reduce((s, q) => s + q.revenue, 0) / qs.length; for (const q of qs) { seasonal[q.fq] = seasonal[q.fq] || []; seasonal[q.fq].push(q.revenue / avg); } }
  const season = {}; for (const k of Object.keys(seasonal)) if (seasonal[k].length >= 2) season[k] = r3(seasonal[k].reduce((a, b) => a + b, 0) / seasonal[k].length);
  return {
    revenueYoyLast: last.yoy.revenue, revenueYoyPrev: quarters.length > 1 ? quarters[quarters.length - 2].yoy.revenue : null,
    revenueYoySlope: r2(slope(yoys.slice(-6))), /* pts of growth per quarter: positive = accelerating */
    grossMarginSlope: r2(slope(last8.map((q) => q.grossMarginPct))), opMarginSlope: r2(slope(last8.map((q) => q.opMarginPct))), netMarginSlope: r2(slope(last8.map((q) => q.netMarginPct))),
    cogsPctSlope: r2(slope(last8.map((q) => q.cogsPct))), rdPctSlope: r2(slope(last8.map((q) => q.rdPct))), sgaPctSlope: r2(slope(last8.map((q) => q.sgaPct))), opexPctSlope: r2(slope(last8.map((q) => q.opexPct))),
    incrementalMarginAvg: r2(avg(last8.map((q) => q.incrementalMargin).filter((v) => v != null))),
    fcfMarginAvg: r1(avg(last8.map((q) => q.fcfMarginPct).filter((v) => v != null))),
    season: Object.keys(season).length ? season : null,
    quartersKnown: quarters.length
  };
}
const avg = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);

/* ------------------------------------------------------------------ the model of the next quarter */
/* Revenue = the same fiscal quarter a year ago grown by a blended YoY rate (the last two years-over-year readings and the
   trend in them). Margins and cost ratios = last quarter's, moved by half their eight-quarter slope. EPS from the projected
   operating income, the average tax rate and other income, over the latest diluted share count. */
function projectNext(quarters, at = quarters.length) {
  const hist = quarters.slice(0, at);
  if (hist.length < 5) return null;
  const last = hist[hist.length - 1], base = hist[hist.length - 4]; // the same fiscal quarter a year ago, relative to the quarter being projected
  if (!base || !(base.revenue > 0)) return null;
  const yoys = hist.map((q) => q.yoy.revenue).filter((v) => v != null);
  if (!yoys.length) return null;
  const g1 = yoys[yoys.length - 1], g2 = yoys.length > 1 ? yoys[yoys.length - 2] : g1, g4 = avg(yoys.slice(-4));
  const trend = slope(yoys.slice(-6)) || 0;
  const growthPct = clamp(0.5 * g1 + 0.3 * g2 + 0.2 * g4 + 0.5 * trend, -60, 150);
  const revenue = base.revenue * (1 + growthPct / 100);
  const last8 = hist.slice(-8);
  const ratio = (key, slopeKey) => { const v = last[key]; if (v == null) return null; const s = slope(last8.map((q) => q[key])) || 0; return clamp(v + 0.5 * s, 0, 100); };
  const grossMarginPct = ratio('grossMarginPct'), opexPct = ratio('opexPct'), cogsPct = grossMarginPct != null ? 100 - grossMarginPct : ratio('cogsPct'), rdPct = ratio('rdPct'), sgaPct = ratio('sgaPct');
  const gross = grossMarginPct != null ? revenue * grossMarginPct / 100 : null, opex = opexPct != null ? revenue * opexPct / 100 : null;
  const opIncome = gross != null && opex != null ? gross - opex : null;
  const taxRate = avg(last8.map((q) => q.taxRatePct).filter((v) => v != null)), other = avg(last8.map((q) => q.other).filter((v) => v != null)) || 0;
  const pretax = opIncome != null ? opIncome + other : null;
  const netIncome = pretax != null ? pretax * (1 - (taxRate != null ? taxRate : 21) / 100) : null;
  const shares = last.shares, eps = netIncome != null && shares > 0 ? netIncome / shares : null;
  return {
    forPeriodAfter: last.period, fq: base.fq, fy: base.fy != null ? base.fy + 1 : null, label: base.fq ? 'Q' + base.fq + (base.fy != null ? ' FY' + String(base.fy + 1).slice(-2) : '') : 'next quarter',
    growthPct: r1(growthPct), growthInputs: { lastYoy: r1(g1), prevYoy: r1(g2), avg4: r1(g4), trendPerQuarter: r2(trend) },
    revenue: Math.round(revenue), baseRevenue: base.revenue, cogs: cogsPct != null ? Math.round(revenue * cogsPct / 100) : null, gross: gross != null ? Math.round(gross) : null, opex: opex != null ? Math.round(opex) : null,
    rd: rdPct != null ? Math.round(revenue * rdPct / 100) : null, sga: sgaPct != null ? Math.round(revenue * sgaPct / 100) : null,
    opIncome: opIncome != null ? Math.round(opIncome) : null, netIncome: netIncome != null ? Math.round(netIncome) : null, eps: r2(eps),
    grossMarginPct: r1(grossMarginPct), opMarginPct: opIncome != null ? r1(opIncome / revenue * 100) : null, taxRatePct: r1(taxRate), shares
  };
}
/* how the method would have done on the last reports it could have modelled: its own error band */
function backtest(quarters, n = 4) {
  const rows = [];
  for (let at = quarters.length - 1; at >= 5 && rows.length < n; at--) {
    const p = projectNext(quarters, at), actual = quarters[at];
    if (!p || !actual) continue;
    const revErr = pct(p.revenue, actual.revenue), epsErr = p.eps != null && actual.eps != null && Math.abs(actual.eps) > 0.01 ? (p.eps - actual.eps) / Math.abs(actual.eps) * 100 : null;
    rows.push({ period: actual.period, label: actual.label, revenue: { model: p.revenue, actual: actual.revenue, errPct: r1(revErr) }, eps: { model: p.eps, actual: actual.eps, errPct: r1(epsErr) } });
  }
  const re = rows.map((r) => Math.abs(r.revenue.errPct)).filter((v) => v != null), ee = rows.map((r) => r.eps.errPct == null ? null : Math.abs(r.eps.errPct)).filter((v) => v != null);
  return { rows, n: rows.length, revenueMapePct: r1(avg(re)), epsMapePct: r1(avg(ee)), revenueBias: r1(avg(rows.map((r) => r.revenue.errPct).filter((v) => v != null))) };
}

/* ------------------------------------------------------------------ the street and the beat history (the bridge's earnings records) */
const DATE_KEYS = ['date', 'reportDate', 'report_date', 'earningsDate', 'earnings_date', 'fiscalDateEnding'];
function streetFrom(payload, nowMs) {
  const recs = [];
  const walk = (node, depth) => {
    if (depth > 6 || node == null) return;
    if (Array.isArray(node)) { node.slice(0, 200).forEach((x) => walk(x, depth + 1)); return; }
    if (typeof node !== 'object') return;
    const dk = DATE_KEYS.find((k) => typeof node[k] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(node[k]));
    if (dk) recs.push({ date: node[dk].slice(0, 10), epsEst: pick(node, ['epsEstimate', 'eps_estimate', 'estimatedEPS', 'estimate']), epsActual: pick(node, ['epsActual', 'eps_actual', 'actualEPS', 'actual', 'reportedEPS']), revEst: pick(node, ['revenueEstimate', 'revenue_estimate', 'estimatedRevenue']), revActual: pick(node, ['revenueActual', 'revenue_actual', 'actualRevenue']), time: String(node.time || node.hour || node.timing || '').toLowerCase() });
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, depth + 1);
  };
  walk(payload, 0);
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const past = recs.filter((r) => r.epsActual != null && r.date < today).sort((a, b) => b.date.localeCompare(a.date));
  const next = recs.filter((r) => r.date >= today && r.epsActual == null).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
  const scored = past.filter((r) => r.epsEst != null).slice(0, 8).map((r) => ({ date: r.date, epsEst: r.epsEst, epsActual: r.epsActual, surprisePct: Math.abs(r.epsEst) > 0.01 ? r1((r.epsActual - r.epsEst) / Math.abs(r.epsEst) * 100) : null, beat: r.epsActual > r.epsEst }));
  return {
    next: next ? { date: next.date, timing: next.time.startsWith('a') ? 'AMC' : next.time.startsWith('b') ? 'BMO' : 'UNSPECIFIED', epsEstimate: next.epsEst, revenueEstimate: next.revEst } : null,
    history: scored, beats: scored.filter((r) => r.beat).length, n: scored.length, avgSurprisePct: r1(avg(scored.map((r) => r.surprisePct).filter((v) => v != null)))
  };
}

/* ------------------------------------------------------------------ signals and sentences */
function signalsOf(quarters, trend, model, street, extras = {}) {
  const last = quarters[quarters.length - 1]; if (!last) return [];
  const out = [];
  const push = (key, tone, text) => out.push({ key, tone, text });
  if (last.yoy.revenue != null) {
    const prev = trend.revenueYoyPrev;
    push('growth', last.yoy.revenue > 0 ? 'up' : 'down', `Revenue ${last.yoy.revenue >= 0 ? 'grew' : 'fell'} ${Math.abs(last.yoy.revenue)}% year over year last quarter` + (prev != null ? (last.yoy.revenue > prev + 1 ? ', accelerating from ' : last.yoy.revenue < prev - 1 ? ', slowing from ' : ', about the same as ') + prev + '% the quarter before.' : '.'));
  }
  if (last.grossMarginPct != null) push('gross', last.grossMarginYoyPts > 0.3 ? 'up' : last.grossMarginYoyPts < -0.3 ? 'down' : 'flat', `Gross margin ${r1(last.grossMarginPct)}%` + (last.grossMarginYoyPts != null ? ` (${last.grossMarginYoyPts >= 0 ? '+' : ''}${last.grossMarginYoyPts} pts vs a year ago)` : '') + (trend.grossMarginSlope != null ? `; eight-quarter trend ${trend.grossMarginSlope >= 0 ? '+' : ''}${trend.grossMarginSlope} pts a quarter.` : '.'));
  const costs = [];
  if (last.cogsPct != null) costs.push(`cost of revenue ${r1(last.cogsPct)}%` + (trend.cogsPctSlope != null ? ` (${trend.cogsPctSlope > 0.15 ? 'rising' : trend.cogsPctSlope < -0.15 ? 'falling' : 'steady'})` : ''));
  if (last.rdPct != null) costs.push(`R&D ${r1(last.rdPct)}%` + (trend.rdPctSlope != null ? ` (${trend.rdPctSlope > 0.15 ? 'rising' : trend.rdPctSlope < -0.15 ? 'falling' : 'steady'})` : ''));
  if (last.sgaPct != null) costs.push(`SG&A ${r1(last.sgaPct)}%` + (trend.sgaPctSlope != null ? ` (${trend.sgaPctSlope > 0.15 ? 'rising' : trend.sgaPctSlope < -0.15 ? 'falling' : 'steady'})` : ''));
  if (costs.length) push('costs', trend.opexPctSlope > 0.2 ? 'down' : trend.opexPctSlope < -0.2 ? 'up' : 'flat', 'Costs as a share of revenue: ' + costs.join(', ') + '.');
  if (last.opMarginPct != null) push('opmargin', last.opMarginYoyPts > 0.3 ? 'up' : last.opMarginYoyPts < -0.3 ? 'down' : 'flat', `Operating margin ${r1(last.opMarginPct)}%` + (last.opMarginYoyPts != null ? ` (${last.opMarginYoyPts >= 0 ? '+' : ''}${last.opMarginYoyPts} pts YoY)` : '') + (trend.incrementalMarginAvg != null ? `. Operating leverage: of each extra dollar of revenue over the past two years, about $${trend.incrementalMarginAvg.toFixed(2)} became operating income.` : '.'));
  if (last.deferredRevenue != null && last.yoy.deferredRevenue != null && last.yoy.revenue != null) {
    const gap = last.yoy.deferredRevenue - last.yoy.revenue;
    if (Math.abs(gap) >= 5) push('deferred', gap > 0 ? 'up' : 'down', `Deferred revenue ${last.yoy.deferredRevenue >= 0 ? 'up' : 'down'} ${Math.abs(last.yoy.deferredRevenue)}% YoY against revenue ${last.yoy.revenue >= 0 ? 'up' : 'down'} ${Math.abs(last.yoy.revenue)}%: ${gap > 0 ? 'bookings are running ahead of recognised sales (a tailwind for coming quarters)' : 'bookings are lagging recognised sales (a headwind for coming quarters)'}.`);
  }
  if (last.inventories != null && last.yoy.inventories != null && last.yoy.revenue != null && last.yoy.inventories - last.yoy.revenue >= 10) push('inventory', 'down', `Inventories up ${last.yoy.inventories}% YoY while revenue is ${last.yoy.revenue >= 0 ? 'up' : 'down'} ${Math.abs(last.yoy.revenue)}%: stock is building faster than sales (margin risk if it has to be discounted).`);
  if (last.receivables != null && last.yoy.receivables != null && last.yoy.revenue != null && last.yoy.receivables - last.yoy.revenue >= 10) push('receivables', 'down', `Receivables up ${last.yoy.receivables}% YoY, well ahead of revenue: customers are paying slower or sales were pulled into the quarter.`);
  if (last.fcf != null) push('cash', last.fcf > 0 ? 'up' : 'down', `Free cash flow ${last.fcf >= 0 ? '' : '-'}$${fmtBig(Math.abs(last.fcf))} last quarter` + (last.fcfMarginPct != null ? ` (${r1(last.fcfMarginPct)}% of revenue)` : '') + (last.cash != null && last.debt != null ? `; cash $${fmtBig(last.cash)} against debt $${fmtBig(last.debt)}.` : '.'));
  if (model) {
    const bt = extras.backtest, band = bt && bt.revenueMapePct != null ? ` (the method has been within about ${bt.revenueMapePct}% on revenue over the last ${bt.n} reports)` : '';
    push('model', 'neutral', `Model for ${model.label}: revenue $${fmtBig(model.revenue)} (${model.growthPct >= 0 ? '+' : ''}${model.growthPct}% YoY)${band}` + (model.eps != null ? `, EPS about $${model.eps.toFixed(2)}` : '') + '.');
    if (street && street.next) {
      const gapRev = street.next.revenueEstimate > 0 ? r1(pct(model.revenue, street.next.revenueEstimate)) : null, gapEps = street.next.epsEstimate != null && model.eps != null && Math.abs(street.next.epsEstimate) > 0.01 ? r1((model.eps - street.next.epsEstimate) / Math.abs(street.next.epsEstimate) * 100) : null;
      if (gapRev != null || gapEps != null) push('street', (gapEps != null ? gapEps : gapRev) > 2 ? 'up' : (gapEps != null ? gapEps : gapRev) < -2 ? 'down' : 'flat', 'Against the street: ' + [gapRev != null ? `revenue model ${gapRev >= 0 ? 'above' : 'below'} the estimate by ${Math.abs(gapRev)}%` : '', gapEps != null ? `EPS model ${gapEps >= 0 ? 'above' : 'below'} the $${street.next.epsEstimate.toFixed(2)} estimate by ${Math.abs(gapEps)}%` : ''].filter(Boolean).join('; ') + '.');
    }
  }
  if (street && street.n >= 3) push('beats', street.beats / street.n >= 0.75 ? 'up' : street.beats / street.n <= 0.4 ? 'down' : 'flat', `Beat the EPS estimate ${street.beats} of the last ${street.n} reports` + (street.avgSurprisePct != null ? `, average surprise ${street.avgSurprisePct >= 0 ? '+' : ''}${street.avgSurprisePct}%` : '') + '.');
  if (extras.priced && extras.priced.impliedPct != null) push('priced', extras.priced.edge != null ? (extras.priced.edge >= 1.25 ? 'up' : extras.priced.edge <= 0.8 ? 'down' : 'flat') : 'neutral', `The options market prices a ${extras.priced.impliedPct}% move` + (extras.priced.avgAbsPct != null ? ` against an average ${extras.priced.avgAbsPct}% on the last ${extras.priced.n} reports` : '') + (extras.priced.read ? ` (${extras.priced.read})` : '') + '.');
  if (extras.short && extras.short.daysToCover != null) push('short', extras.short.daysToCover >= 5 ? 'up' : 'neutral', `Short interest ${extras.short.daysToCover} days to cover` + (extras.short.ratioAvg != null ? `, ${extras.short.ratioAvg}% of daily volume sold short lately` : '') + (extras.short.daysToCover >= 5 ? ': a crowded short, so a beat can squeeze.' : '.'));
  if (extras.filings && extras.filings.recent8k) push('filings', 'neutral', `${extras.filings.count8k} 8-K filing${extras.filings.count8k === 1 ? '' : 's'} in the last 60 days, latest ${extras.filings.recent8k}: read it for guidance changes or pre-announcements.`);
  return out;
}
function fmtBig(v) { const a = Math.abs(v); return a >= 1e12 ? (a / 1e12).toFixed(2) + 'T' : a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(0) + 'K' : String(Math.round(a)); }

/* ------------------------------------------------------------------ the AI brief */
const AI_SYSTEM = 'You are the earnings analyst of the Making Easy Money Academy, writing for retail traders before a company reports. '
  + 'Use ONLY the figures given to you; never invent numbers, guidance, products or events. Be concrete: name the line items and the percentages. '
  + 'You do not know the result and you do not predict a beat or a miss; you explain what the numbers set up and what would prove each case. '
  + 'Answer with one JSON object only, no prose around it, with these keys: headline (one sentence), drivers (3 to 5 short sentences on what is moving sales), '
  + 'costs (2 to 4 sentences on cost of revenue, R&D, SG&A and operating leverage), margins (2 to 3 sentences), watch (3 to 5 things to check in the report), '
  + 'scenarios (an object with beat, inline, miss: one sentence each on what each would mean for the numbers), confidence (low, medium or high, with a short reason).';
function aiPrompt(symbol, pack) {
  return `COMPANY: ${symbol}\n\nQUARTERS (oldest to newest; money in USD):\n` + pack.quarters.map((q) => `${q.label} (${q.period}): revenue ${fmtBig(q.revenue)}${q.yoy.revenue != null ? ' (' + (q.yoy.revenue >= 0 ? '+' : '') + q.yoy.revenue + '% YoY)' : ''}; gross margin ${r1(q.grossMarginPct)}%; R&D ${r1(q.rdPct)}% of revenue; SG&A ${r1(q.sgaPct)}%; operating margin ${r1(q.opMarginPct)}%; net income ${q.netIncome == null ? 'n/a' : fmtBig(q.netIncome)}; EPS ${q.eps == null ? 'n/a' : q.eps}; free cash flow ${q.fcf == null ? 'n/a' : fmtBig(q.fcf)}; deferred revenue ${q.deferredRevenue == null ? 'n/a' : fmtBig(q.deferredRevenue)}; inventories ${q.inventories == null ? 'n/a' : fmtBig(q.inventories)}`).join('\n')
    + `\n\nTREND: revenue growth slope ${pack.trend.revenueYoySlope} pts/quarter; gross margin slope ${pack.trend.grossMarginSlope}; operating margin slope ${pack.trend.opMarginSlope}; incremental operating margin ${pack.trend.incrementalMarginAvg}`
    + (pack.model ? `\n\nMODEL FOR ${pack.model.label}: revenue ${fmtBig(pack.model.revenue)} (${pack.model.growthPct}% YoY), gross margin ${pack.model.grossMarginPct}%, operating income ${pack.model.opIncome == null ? 'n/a' : fmtBig(pack.model.opIncome)}, EPS ${pack.model.eps}` : '')
    + (pack.backtest && pack.backtest.n ? `\nMODEL ERROR ON THE LAST ${pack.backtest.n} REPORTS: revenue ${pack.backtest.revenueMapePct}% average, EPS ${pack.backtest.epsMapePct == null ? 'n/a' : pack.backtest.epsMapePct + '%'}` : '')
    + (pack.street && pack.street.next ? `\nSTREET: report ${pack.street.next.date} ${pack.street.next.timing}; EPS estimate ${pack.street.next.epsEstimate}; revenue estimate ${pack.street.next.revenueEstimate == null ? 'n/a' : fmtBig(pack.street.next.revenueEstimate)}; beat ${pack.street.beats} of the last ${pack.street.n}` : '\nSTREET: no estimate on file')
    + (pack.priced && pack.priced.impliedPct != null ? `\nOPTIONS: priced move ${pack.priced.impliedPct}%, average past move ${pack.priced.avgAbsPct}%` : '')
    + (pack.short && pack.short.daysToCover != null ? `\nSHORT INTEREST: ${pack.short.daysToCover} days to cover` : '')
    + (pack.news && pack.news.length ? '\n\nRECENT HEADLINES (context only):\n' + pack.news.map((n) => '- ' + n.title).join('\n') : '');
}
function parseBrief(text) {
  const s = String(text || '').trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let j; try { j = JSON.parse(s.slice(start, end + 1)); } catch (_) { return null; }
  if (!j || typeof j !== 'object') return null;
  const list = (v, max) => (Array.isArray(v) ? v : typeof v === 'string' ? [v] : []).map((x) => String(x).trim()).filter(Boolean).slice(0, max);
  const sc = j.scenarios && typeof j.scenarios === 'object' ? j.scenarios : {};
  return { headline: String(j.headline || '').trim().slice(0, 300), drivers: list(j.drivers, 5), costs: list(j.costs, 4), margins: list(j.margins, 3), watch: list(j.watch, 5), scenarios: { beat: String(sc.beat || '').slice(0, 300), inline: String(sc.inline || sc['in-line'] || sc.in_line || '').slice(0, 300), miss: String(sc.miss || '').slice(0, 300) }, confidence: String(j.confidence || '').slice(0, 160) };
}

/* ------------------------------------------------------------------ the service */
function createEarningsInsight({ financials, history = null, candles = null, playbook = null, news = null, filings = null, shortData = null, ai = null, now = Date.now, logger = () => {}, ttlMs = 30 * 60_000, aiTtlMs = 6 * 3_600_000, fetchImpl = globalThis.fetch } = {}) {
  const cache = new Map(), briefs = new Map(), inflight = new Map();
  const aiOn = !!(ai && String(ai.apiKey || '').trim());
  const safe = async (name, fn, ms = 15_000) => { try { return await Promise.race([fn(), new Promise((r) => { const t = setTimeout(() => r(null), ms); if (t.unref) t.unref(); })]); } catch (error) { logger('warn', 'earnings_insight_input_failed', { name, error: String(error && error.message || error) }); return null; } };

  async function brief(symbol, pack) {
    if (!aiOn || !pack.quarters.length) return { available: false, reason: aiOn ? 'no_quarters' : 'ai_unconfigured' };
    const key = symbol + ':' + pack.quarters[pack.quarters.length - 1].period + ':' + (pack.street && pack.street.next ? pack.street.next.date : '');
    const hit = briefs.get(key); if (hit && now() - hit.at < aiTtlMs) return hit.v;
    let v;
    try {
      const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: ai.model || 'claude-sonnet-5-5', max_tokens: 900, system: AI_SYSTEM, messages: [{ role: 'user', content: aiPrompt(symbol, pack) }] }), signal: AbortSignal.timeout(60_000)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error('anthropic_' + res.status);
      const text = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      const parsed = parseBrief(text);
      v = parsed ? { available: true, model: data.model || ai.model, at: now(), ...parsed } : { available: false, reason: 'unreadable_answer' };
    } catch (error) { logger('warn', 'earnings_insight_ai_failed', { symbol, error: String(error && error.message || error) }); v = { available: false, reason: 'ai_unavailable' }; }
    if (v.available) { briefs.set(key, { at: now(), v }); if (briefs.size > 300) briefs.delete(briefs.keys().next().value); }
    return v;
  }

  async function build(symbol) {
    const t = now();
    const [fin, hist, pb, nw, fl, sh] = await Promise.all([
      safe('financials', () => financials(symbol), 20_000), history ? safe('history', () => history(symbol)) : null, playbook ? safe('playbook', () => playbook(symbol), 25_000) : null,
      news ? safe('news', () => news(symbol), 8_000) : null, filings ? safe('filings', () => filings(symbol), 8_000) : null, shortData ? safe('short', () => shortData(symbol), 8_000) : null
    ]);
    const quarters = quartersFrom(fin && fin.datasets ? fin.datasets : fin);
    if (!quarters.length) return { ok: true, available: false, reason: 'no_financials', symbol, asOf: t };
    const trend = trendOf(quarters), model = projectNext(quarters), bt = backtest(quarters), street = streetFrom(hist, t);
    const priced = pb && pb.available ? { impliedPct: pb.implied ? pb.implied.impliedPct : null, avgAbsPct: pb.history ? pb.history.avgAbsPct : null, n: pb.history ? pb.history.n : 0, edge: pb.edge, read: pb.read, date: pb.date, timing: pb.timing } : null;
    const interest = sh && Array.isArray(sh.interest) && sh.interest.length ? sh.interest.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] : null;
    const vol = sh && Array.isArray(sh.volume) ? sh.volume.slice(-10).map((r) => num(r.ratio)).filter((v) => v != null) : [];
    const short = interest || vol.length ? { daysToCover: interest ? r2(num(interest.days_to_cover)) : null, shortInterest: interest ? num(interest.short_interest) : null, ratioAvg: vol.length ? r1(avg(vol)) : null } : null;
    const filingRows = fl && Array.isArray(fl.filings) ? fl.filings : Array.isArray(fl) ? fl : [];
    const since = new Date(t - 60 * DAY).toISOString().slice(0, 10);
    const k8 = filingRows.filter((f) => /^8-K/i.test(String(f.form_type || f.type || '')) && String(f.filing_date || f.date || '') >= since);
    const filingInfo = filingRows.length ? { count8k: k8.length, recent8k: k8.length ? String(k8[0].filing_date || k8[0].date).slice(0, 10) : null, latest: filingRows.slice(0, 5).map((f) => ({ form: String(f.form_type || f.type || ''), date: String(f.filing_date || f.date || '').slice(0, 10), url: String(f.filing_url || f.url || '') })) } : null;
    const newsRows = (Array.isArray(nw) ? nw : nw && Array.isArray(nw.articles) ? nw.articles : []).slice(0, 5).map((a) => ({ title: String(a.title || '').slice(0, 200), url: String(a.url || ''), date: String(a.date || '').slice(0, 25) }));
    const pack = { quarters, trend, model, backtest: bt, street, priced, short, news: newsRows };
    const signals = signalsOf(quarters, trend, model, street, { backtest: bt, priced, short, filings: filingInfo });
    const out = { ok: true, available: true, symbol, asOf: t, quarters, trend, model, backtest: bt, street, priced, short, filings: filingInfo, news: newsRows, signals,
      next: street.next || (priced && priced.date ? { date: priced.date, timing: priced.timing, epsEstimate: null, revenueEstimate: null } : null),
      note: 'Every figure is from reported statements. The model is a base rate (the same quarter a year ago grown at the blended trend, margins moved along their slope), checked against its own past error. It is a reference to judge the report by, not a forecast of the result. Educational only.' };
    out.ai = await brief(symbol, pack);
    return out;
  }

  function insight(symbolRaw) {
    const symbol = String(symbolRaw || '').toUpperCase();
    if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) return Promise.resolve({ ok: false, status: 400, error: 'invalid_symbol' });
    const hit = cache.get(symbol); if (hit && now() - hit.at < ttlMs) return Promise.resolve(hit.v);
    if (inflight.has(symbol)) return inflight.get(symbol);
    const p = build(symbol).then((v) => { cache.set(symbol, { at: now(), v }); if (cache.size > 200) cache.delete(cache.keys().next().value); return v; }).catch((error) => { logger('error', 'earnings_insight_failed', { symbol, error: String(error && error.message || error) }); return { ok: false, status: 503, error: 'insight_unavailable' }; }).finally(() => inflight.delete(symbol));
    inflight.set(symbol, p); return p;
  }
  return { insight, aiOn };
}

module.exports = { createEarningsInsight, quartersFrom, trendOf, projectNext, backtest, streetFrom, signalsOf, parseBrief, aiPrompt, slope, fmtBig };
