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

  return { pool, health, close: () => pool.end() };
}

module.exports = { createDatabase, sslConfig };
