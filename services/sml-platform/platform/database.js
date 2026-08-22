'use strict';

const { Pool } = require('pg');

function sslConfig(connectionString, mode) {
  if (mode === 'off') return false;

  let host = '';
  try { host = new URL(connectionString).hostname; } catch (_) { /* handled by pg */ }
  if (!mode && (host === 'localhost' || host === '127.0.0.1')) return false;
  return { rejectUnauthorized: mode === 'verify' };
}

function createDatabase({ databaseUrl, databaseSsl }) {
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: sslConfig(databaseUrl, databaseSsl),
    max: 8,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: 'sml-platform'
  });

  async function health() {
    const result = await pool.query('SELECT 1 AS ok');
    return result.rows[0] && result.rows[0].ok === 1;
  }

  async function acceptWordPressEvent(event) {
    const result = await pool.query(
      `INSERT INTO wordpress_gateway_events (
         event_id, event_type, occurred_at, actor_user_id,
         subject_type, subject_id, payload, payload_hash
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id`,
      [
        event.eventId,
        event.eventType,
        event.occurredAt,
        event.actorUserId,
        event.subjectType,
        event.subjectId,
        JSON.stringify(event.data),
        event.payloadHash
      ]
    );
    return result.rowCount === 1 ? 'accepted' : 'duplicate';
  }

  return { pool, health, acceptWordPressEvent, close: () => pool.end() };
}

module.exports = { createDatabase, sslConfig };
