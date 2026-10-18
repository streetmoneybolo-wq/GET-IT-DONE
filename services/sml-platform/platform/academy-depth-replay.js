'use strict';

/*
 * Replay recorded order books through the Academy's Level 2 reader and score what it says.
 *
 * For one symbol and one time range, every stored row is pushed into createOrderFlow twice: once cut to the first ten levels (what the live
 * reader sees today) and once with the full book. Each emitted event is scored by where the mid price sat five minutes later, in the event's
 * direction, so the two views can be compared signal by signal: hit rate, average move, and how many events each view produced.
 *
 * Usage (needs DATABASE_URL):
 *   node platform/academy-depth-replay.js SPY 2026-10-20            # one trading day, New York time
 *   node platform/academy-depth-replay.js QQQ 2026-10-20 2026-10-24 # a range of days
 * Also exported as replayDepth() for the owner's research endpoint.
 */

const { createOrderFlow } = require('./academy-order-flow');

const OUTCOME_MS = 5 * 60_000;

function toLevels(side) { return (side || []).map(([price, size, orders]) => ({ price, size, orders })); }
function toTicks(prints) { return (prints || []).map(([t, price, size, dir]) => ({ timestamp_ms: t, price, size, direction: dir === 'B' ? 'BUY' : dir === 'S' ? 'SELL' : '' })); }

/** Runs the reader over rows (oldest first) with the book cut to `depth` levels; returns the events with their 5-minute outcomes. */
function runReader(rows, depth) {
  const flow = createOrderFlow();
  const mids = [];                                  // [t, mid] in time order, for outcome lookups
  const events = [];
  for (const row of rows) {
    const bids = depth ? row.bids.slice(0, depth) : row.bids, asks = depth ? row.asks.slice(0, depth) : row.asks;
    const mid = (bids[0][0] + asks[0][0]) / 2;
    mids.push([row.t, mid]);
    const r = flow.push({ t: row.t, bids: toLevels(bids), asks: toLevels(asks), ticks: toTicks(row.prints) });
    for (const ev of r.emitted || []) events.push({ ...ev, t: row.t, mid });
  }
  // outcome: the mid price at the first row at or after t + 5 minutes, signed by the event's side
  let j = 0;
  for (const ev of events) {
    const due = ev.t + OUTCOME_MS;
    while (j < mids.length && mids[j][0] < due) j++;
    if (j < mids.length) {
      const later = mids[j][1];
      const pct = ((later - ev.mid) / ev.mid) * 100 * (ev.side === 'bear' ? -1 : 1);
      ev.outcome5mPct = Number(pct.toFixed(4));
    } else ev.outcome5mPct = null;
  } // events come out in row order, so their due times only move forward and one pass over mids is enough
  return events;
}

function summarize(events) {
  const groups = new Map();
  for (const ev of events) {
    const k = `${ev.kind}:${ev.side}`;
    const g = groups.get(k) || { kind: ev.kind, side: ev.side, events: 0, measured: 0, hits: 0, sumPct: 0 };
    g.events += 1;
    if (ev.outcome5mPct != null) { g.measured += 1; g.sumPct += ev.outcome5mPct; if (ev.outcome5mPct > 0) g.hits += 1; }
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({
    kind: g.kind, side: g.side, events: g.events, measured: g.measured,
    hitRate: g.measured ? Number((g.hits / g.measured).toFixed(3)) : null,
    avgPct: g.measured ? Number((g.sumPct / g.measured).toFixed(4)) : null
  })).sort((a, b) => (a.kind + a.side).localeCompare(b.kind + b.side));
}

/** rows: async iterable or array of stored rows for one symbol, oldest first. */
async function replayDepth(rows, { depths = [10, 0] } = {}) {
  const all = [];
  for await (const row of rows) all.push(row);
  const views = {};
  for (const d of depths) {
    const events = runReader(all, d);
    views[d === 0 ? 'full' : `top${d}`] = { depth: d === 0 ? 'full' : d, events: events.length, summary: summarize(events) };
  }
  return { rows: all.length, from: all.length ? all[0].t : null, to: all.length ? all[all.length - 1].t : null, views };
}

function dayBoundsNewYork(dateText, endDateText) {
  const toUtc = (d, hour) => {
    const [y, m, day] = d.split('-').map(Number);
    // New York offset on that date: -4 h in daylight time, -5 h otherwise
    const probe = new Date(Date.UTC(y, m - 1, day, 12));
    const ny = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).formatToParts(probe).find((p) => p.type === 'timeZoneName');
    const offset = ny && /GMT([+-]\d+)/.test(ny.value) ? Number(RegExp.$1) : -5;
    return Date.UTC(y, m - 1, day, hour - offset);
  };
  return { fromMs: toUtc(dateText, 4), toMs: toUtc(endDateText || dateText, 20) }; // 4:00 to 20:00 New York covers pre-market to after-hours
}

async function main() {
  const [symbol, from, to] = process.argv.slice(2);
  if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(from || '')) { console.error('usage: node platform/academy-depth-replay.js SYMBOL YYYY-MM-DD [YYYY-MM-DD]'); process.exit(2); }
  const { getConfig } = require('./config');
  const { createDatabase } = require('./database');
  const { createDepthStore } = require('./academy-depth-store');
  const database = createDatabase(getConfig());
  const store = createDepthStore({ pool: database.pool });
  const { fromMs, toMs } = dayBoundsNewYork(from, to);
  const result = await replayDepth(store.read(symbol.toUpperCase(), fromMs, toMs));
  console.log(JSON.stringify(result, null, 2));
  await database.pool.end();
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });

module.exports = { replayDepth, runReader, summarize, dayBoundsNewYork };
