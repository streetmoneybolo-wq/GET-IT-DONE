'use strict';
const { etParts } = require('./market-clock');

/* Finds the next scheduled earnings date in whatever shape the data bridge returns (the field names are not pinned, which the
 * earnings panel already admits), by walking the payload for objects that carry a date-like field. Returns null when nothing
 * recognisable and upcoming is found: unknown is reported as unknown, never as "no earnings soon". */
const DATE_KEYS = ['date', 'reportDate', 'report_date', 'earningsDate', 'earnings_date', 'nextEarningsDate', 'next_earnings_date', 'announcementDate', 'fiscalDateEnding'];
const EPS_KEYS = ['epsEstimate', 'eps_estimate', 'estimatedEPS', 'estimate', 'epsEstimated', 'revenueEstimate'];
const ACTUAL_KEYS = ['epsActual', 'eps_actual', 'actualEPS', 'actual', 'reportedEPS'];

function walk(node, out, depth = 0) {
  if (depth > 6 || node == null) return;
  if (Array.isArray(node)) { for (const x of node.slice(0, 200)) walk(x, out, depth + 1); return; }
  if (typeof node !== 'object') return;
  const dk = DATE_KEYS.find((k) => typeof node[k] === 'string' && /^\d{4}-\d{2}-\d{2}/.test(node[k]));
  if (dk) {
    const hasEst = EPS_KEYS.some((k) => node[k] != null && node[k] !== '');
    const hasActual = ACTUAL_KEYS.some((k) => node[k] != null && node[k] !== '');
    out.push({ date: String(node[dk]).slice(0, 10), hasEst, hasActual, key: dk });
  }
  for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, out, depth + 1);
}

function extractNextEarnings(payload, now = Date.now()) {
  const found = []; walk(payload, found);
  if (!found.length) return null;
  const et = etParts(now); // "today" is the New York date: at 9 pm Eastern the UTC date is already tomorrow
  const today = `${et.y}-${String(et.m).padStart(2, '0')}-${String(et.d).padStart(2, '0')}`;
  const todayMs = Date.parse(today + 'T00:00:00Z');
  const upcoming = found.filter((r) => r.date >= today && !r.hasActual && r.key !== 'fiscalDateEnding')
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!upcoming.length) return null;
  const r = upcoming[0];
  return { date: r.date, daysAway: Math.round((Date.parse(r.date + 'T00:00:00Z') - todayMs) / 86_400_000), confirmedEstimate: r.hasEst };
}

/* risk contribution: the closer the report, the bigger the gap risk */
function earningsRisk(next) {
  if (!next) return null;
  const d = next.daysAway;
  if (d <= 1) return { r: 0.95, detail: d <= 0 ? 'reports earnings today' : 'reports earnings tomorrow' };
  if (d <= 3) return { r: 0.85, detail: `reports earnings in ${d} days` };
  if (d <= 7) return { r: 0.65, detail: `reports earnings in ${d} days` };
  if (d <= 14) return { r: 0.4, detail: `reports earnings in ${d} days` };
  if (d <= 30) return { r: 0.2, detail: `next earnings in ${d} days` };
  return { r: 0.1, detail: `next earnings in ${d} days` };
}

module.exports = { extractNextEarnings, earningsRisk };
