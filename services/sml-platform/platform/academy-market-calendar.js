'use strict';

/* Scheduled market catalysts that move SPY as a whole: FOMC decisions, the jobs report, monthly and quarterly options
 * expiration, month- and quarter-end rebalancing windows, and the owner's own additions (SML_MACRO_EVENTS, a JSON list of
 * { date, label, impact }). Dates that come from a published schedule (FOMC) are listed; the ones that follow a rule (jobs
 * report first Friday, expiration third Friday) are derived. Nothing here is guessed: a release whose exact date is not known
 * is not listed. */

/* FOMC meeting decision days (second day of each two-day meeting), from the Federal Reserve's published calendar. */
const FOMC = {
  2025: ['2025-01-29', '2025-03-19', '2025-05-07', '2025-06-18', '2025-07-30', '2025-09-17', '2025-10-29', '2025-12-10'],
  2026: ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09']
};
const ET_DATE = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
function etDate(ms) { const p = {}; for (const x of ET_DATE.formatToParts(new Date(ms))) p[x.type] = x.value; return `${p.year}-${p.month}-${p.day}`; }
const dayUtc = (iso) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;
function nthWeekday(y, m, weekday, n) { const first = new Date(Date.UTC(y, m, 1)); const off = (weekday - first.getUTCDay() + 7) % 7; return Date.UTC(y, m, 1 + off + (n - 1) * 7); }
function lastWeekday(y, m) { let d = Date.UTC(y, m + 1, 0); while ([0, 6].includes(new Date(d).getUTCDay())) d -= DAY; return d; }
function weekdayBefore(ms, n) { let d = ms, k = 0; while (k < n) { d -= DAY; if (![0, 6].includes(new Date(d).getUTCDay())) k += 1; } return d; }

function parseExtra(raw) {
  if (!raw) return [];
  let list = raw;
  if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch (_) { return []; } }
  if (!Array.isArray(list)) return [];
  return list.map((e) => ({ date: String(e && e.date || '').slice(0, 10), label: String(e && e.label || '').slice(0, 80), kind: 'owner', impact: Math.max(1, Math.min(3, Number(e && e.impact) || 2)) })).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date) && e.label);
}

/* Every scheduled catalyst from `from` for `days` days (New York dates). */
function upcoming({ now = Date.now(), days = 10, extra = null } = {}) {
  const today = etDate(now), t0 = dayUtc(today), t1 = t0 + days * DAY;
  const out = [];
  const push = (ms, label, kind, impact, note = '') => { const d = iso(ms); if (ms >= t0 && ms <= t1) out.push({ date: d, label, kind, impact, note, daysAway: Math.round((ms - t0) / DAY) }); };
  const years = new Set([new Date(t0).getUTCFullYear(), new Date(t1).getUTCFullYear()]);
  for (const y of years) {
    for (const d of FOMC[y] || []) push(dayUtc(d), 'FOMC decision 2:00 pm ET', 'fomc', 3, 'Rate decision, statement and press conference: the day SPY re-prices the path of rates.');
    for (let m = 0; m < 12; m++) {
      push(nthWeekday(y, m, 5, 1), 'Jobs report 8:30 am ET', 'jobs', 3, 'Non-farm payrolls: the first Friday of the month (moves when the first Friday is a holiday).');
      const opex = nthWeekday(y, m, 5, 3);
      push(opex, [2, 5, 8, 11].includes(m) ? 'Quarterly expiration (triple witching)' : 'Monthly options expiration', 'opex', [2, 5, 8, 11].includes(m) ? 3 : 2, 'Dealer hedges roll off: pinning into the close, freer movement the week after.');
      const eom = lastWeekday(y, m);
      push(weekdayBefore(eom, 1), [2, 5, 8, 11].includes(m) ? 'Quarter-end rebalancing window' : 'Month-end rebalancing window', 'rebalance', [2, 5, 8, 11].includes(m) ? 2 : 1, 'Pension and fund flows: large, mechanical, direction set by what outperformed in the period.');
    }
  }
  for (const e of parseExtra(extra)) push(dayUtc(e.date), e.label, e.kind, e.impact, 'Added by the owner.');
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.impact - a.impact));
  return out;
}

/* How much scheduled event risk sits in the next session(s): 0 (clear) to 1 (FOMC today). */
function eventRisk({ now = Date.now(), extra = null } = {}) {
  const list = upcoming({ now, days: 3, extra });
  let score = 0; const hits = [];
  for (const e of list) { const w = e.impact / 3 * (e.daysAway === 0 ? 1 : e.daysAway === 1 ? 0.6 : 0.3); if (w > 0) { score = Math.max(score, w); hits.push(e); } }
  return { score: Math.round(score * 100) / 100, events: hits };
}

module.exports = { upcoming, eventRisk, parseExtra, FOMC, etDate };
