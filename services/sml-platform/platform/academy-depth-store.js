'use strict';

const SYMBOL = /^[A-Z0-9.:-]{1,10}$/;

/* Postgres side of the full-depth recorder: append book rows, read them back in time order for replay, and prune.
   Never blocks the live site: the recorder swallows errors from here. */
function createDepthStore({ pool } = {}) {
  const configured = !!(pool && typeof pool.query === 'function');

  async function append(row) {
    if (!configured) return null;
    if (!SYMBOL.test(String(row.symbol))) throw new TypeError('invalid_symbol');
    const r = await pool.query(
      `INSERT INTO academy_depth_snapshots (symbol, ts, depth, bid1, ask1, bid_size_10, ask_size_10, bid_size_all, ask_size_all, bids, asks, prints)
       VALUES ($1, to_timestamp($2::double precision / 1000.0), $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb) RETURNING id`,
      [row.symbol, Number(row.t), row.depth, row.bid1, row.ask1, row.bidSize10, row.askSize10, row.bidSizeAll, row.askSizeAll,
        JSON.stringify(row.bids), JSON.stringify(row.asks), JSON.stringify(row.prints || [])]
    );
    return r.rows[0] && r.rows[0].id;
  }

  /** Rows for one symbol between two times (ms), oldest first, in pages so a full day never sits in memory at once. */
  async function* read(symbol, fromMs, toMs, pageSize = 2000) {
    if (!configured) return;
    if (!SYMBOL.test(String(symbol))) throw new TypeError('invalid_symbol');
    let afterId = 0;
    for (;;) {
      const r = await pool.query(
        `SELECT id, (extract(epoch FROM ts) * 1000)::bigint AS t, depth, bid1::float8 AS bid1, ask1::float8 AS ask1, bids, asks, prints
           FROM academy_depth_snapshots
          WHERE symbol = $1 AND ts >= to_timestamp($2::double precision / 1000.0) AND ts < to_timestamp($3::double precision / 1000.0) AND id > $4
          ORDER BY id LIMIT $5`,
        [symbol, Number(fromMs), Number(toMs), afterId, pageSize]
      );
      for (const row of r.rows) { afterId = Number(row.id); yield { ...row, t: Number(row.t) }; }
      if (r.rows.length < pageSize) return;
    }
  }

  /** What has been recorded: rows and time span per symbol, plus the table's size on disk. */
  async function status() {
    if (!configured) return { configured: false, symbols: [] };
    const r = await pool.query(
      `SELECT symbol, count(*)::int AS rows, min(ts) AS first_ts, max(ts) AS last_ts, max(depth)::int AS max_depth,
              count(DISTINCT (ts AT TIME ZONE 'America/New_York')::date)::int AS days
         FROM academy_depth_snapshots GROUP BY symbol ORDER BY symbol`
    );
    const size = await pool.query("SELECT pg_total_relation_size('academy_depth_snapshots')::bigint AS bytes");
    return { configured: true, symbols: r.rows, bytes: Number(size.rows[0] && size.rows[0].bytes) || 0 };
  }

  async function prune(days = 30) {
    if (!configured) return 0;
    const r = await pool.query("DELETE FROM academy_depth_snapshots WHERE ts < now() - ($1 || ' days')::interval", [String(Math.max(1, Math.min(365, Number(days) || 30)))]);
    return r.rowCount || 0;
  }

  return { configured, append, read, status, prune };
}

module.exports = { createDepthStore };
