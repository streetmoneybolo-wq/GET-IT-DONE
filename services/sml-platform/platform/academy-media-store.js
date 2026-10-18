'use strict';

/* Durable store for generated Academy lesson media (table academy_media, migration 046): Claude slide designs and
 * ElevenLabs narration parts, each keyed by a digest of the exact text it was made from. A provider is paid once per
 * text; every later request, on every instance and after every deploy, is served from here. Reads and writes never
 * throw into the caller: a database blip means a cache miss, and the in-memory caches still work. */
function createAcademyMediaStore({ pool = null, logger = () => {} } = {}) {
  const durable = Boolean(pool && typeof pool.query === 'function');

  async function get(key) {
    if (!durable) return null;
    try {
      const r = await pool.query('SELECT bytes, content_type, meta FROM academy_media WHERE key = $1', [key]);
      const row = r && r.rows && r.rows[0];
      if (!row) return null;
      return { bytes: Buffer.isBuffer(row.bytes) ? row.bytes : Buffer.from(row.bytes), contentType: row.content_type, meta: row.meta || {} };
    } catch (error) { logger('warn', 'academy_media_read_failed', { key, error }); return null; }
  }

  async function put(key, bytes, { kind, contentType, meta = {} } = {}) {
    if (!durable) return false;
    try {
      await pool.query(
        'INSERT INTO academy_media (key, kind, content_type, bytes, meta) VALUES ($1, $2, $3, $4, $5::jsonb) ON CONFLICT (key) DO UPDATE SET kind = EXCLUDED.kind, content_type = EXCLUDED.content_type, bytes = EXCLUDED.bytes, meta = EXCLUDED.meta',
        [key, String(kind || 'media'), String(contentType || 'application/octet-stream'), bytes, JSON.stringify(meta)]
      );
      return true;
    } catch (error) { logger('warn', 'academy_media_write_failed', { key, kind, error }); return false; }
  }

  /** How much is baked, per kind: { voice: { items, bytes }, design: { items, bytes } }. */
  async function stats() {
    if (!durable) return {};
    try {
      const r = await pool.query('SELECT kind, count(*)::int AS items, coalesce(sum(length(bytes)), 0)::bigint AS bytes FROM academy_media GROUP BY kind');
      return Object.fromEntries((r.rows || []).map((row) => [row.kind, { items: Number(row.items), bytes: Number(row.bytes) }]));
    } catch (error) { logger('warn', 'academy_media_stats_failed', { error }); return {}; }
  }

  return { durable, get, put, stats };
}

module.exports = { createAcademyMediaStore };
