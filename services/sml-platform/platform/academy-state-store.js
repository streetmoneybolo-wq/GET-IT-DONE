'use strict';

/* Durable JSON state in Postgres (table academy_state_kv, migration 041) with a safe fallback to a file, then memory.
 * Same { read(), write(next) } shape as the MEM LAB stores, so it drops in. A write failure is logged and never throws
 * into the caller, and reads fall back to the default so a database blip cannot erase a champion config. */
function createPgStateStore({ pool, key, fallback = null, defaultValue = () => ({}), logger = () => {} } = {}) {
  const usable = Boolean(pool && typeof pool.query === 'function');
  let cache = null;
  async function read() {
    if (usable) {
      try {
        const r = await pool.query('SELECT value FROM academy_state_kv WHERE key = $1', [key]);
        if (r && r.rows && r.rows[0]) { cache = r.rows[0].value; return JSON.parse(JSON.stringify(cache)); }
        if (fallback) { // first run after the migration: adopt whatever the old file store held
          const old = await fallback.read();
          if (old && JSON.stringify(old) !== JSON.stringify(defaultValue())) { await write(old); return old; }
        }
        return defaultValue();
      } catch (error) { logger('warn', 'academy_state_read_failed', { key, error }); }
    }
    if (cache) return JSON.parse(JSON.stringify(cache));
    return fallback ? fallback.read() : defaultValue();
  }
  async function write(next) {
    cache = JSON.parse(JSON.stringify(next));
    if (usable) {
      try { await pool.query('INSERT INTO academy_state_kv (key, value, updated_at) VALUES ($1, $2::jsonb, now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()', [key, JSON.stringify(next)]); return; }
      catch (error) { logger('warn', 'academy_state_write_failed', { key, error }); }
    }
    if (fallback) { try { await fallback.write(next); } catch (error) { logger('warn', 'academy_state_fallback_write_failed', { key, error }); } }
  }
  return { read, write, durable: usable };
}

module.exports = { createPgStateStore };
