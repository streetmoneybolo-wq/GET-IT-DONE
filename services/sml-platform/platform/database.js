'use strict';

const { Pool } = require('pg');
const { createStripeEventStore } = require('./stripe-event-store');

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
         subject_type, subject_id, payload, payload_hash, source_event_key
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        event.eventId,
        event.eventType,
        event.occurredAt,
        event.actorUserId,
        event.subjectType,
        event.subjectId,
        JSON.stringify(event.data),
        event.payloadHash,
        event.sourceEventKey
      ]
    );
    return result.rowCount === 1 ? 'accepted' : 'duplicate';
  }

  async function enqueueNewsArticle(job) {
    const result = await pool.query(
      `INSERT INTO news_article_jobs (source_url, source_url_hash, source_event_key)
       VALUES ($1, $2, $3)
       ON CONFLICT (source_url_hash) DO NOTHING
       RETURNING id, status`,
      [job.sourceUrl, job.sourceUrlHash, job.sourceEventKey]
    );
    if (result.rowCount === 1) return { ...result.rows[0], status: 'accepted' };
    const existing = await pool.query(
      'SELECT id, status FROM news_article_jobs WHERE source_url_hash = $1',
      [job.sourceUrlHash]
    );
    return { ...existing.rows[0], status: 'duplicate' };
  }

  async function claimNewsJob(workerId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      /* A crashed worker's lock becomes retryable after 15 minutes. */
      await client.query(
        `UPDATE news_article_jobs
            SET status='retry', worker_id=NULL, locked_at=NULL, next_attempt_at=now(),
                last_error_code='stale_worker_lock', updated_at=now()
          WHERE status='processing' AND locked_at < now() - interval '15 minutes'`
      );
      const selected = await client.query(
        `SELECT * FROM news_article_jobs
          WHERE status IN ('queued','retry') AND next_attempt_at <= now()
          ORDER BY created_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT 1`
      );
      if (!selected.rowCount) {
        await client.query('COMMIT');
        return null;
      }
      const result = await client.query(
        `UPDATE news_article_jobs
            SET status='processing', attempts=attempts+1, worker_id=$2, locked_at=now(), updated_at=now()
          WHERE id=$1
          RETURNING *`,
        [selected.rows[0].id, workerId]
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function saveNewsSource(id, source) {
    await pool.query(
      `UPDATE news_article_jobs
          SET source_url=$2, source_title=$3, source_excerpt=$4, source_image_url=$5, updated_at=now()
        WHERE id=$1 AND status='processing'`,
      [id, source.sourceUrl, source.title, source.description, source.imageUrl]
    );
  }

  async function saveGeneratedArticle(id, article) {
    await pool.query(
      `UPDATE news_article_jobs SET generated_payload=$2::jsonb, updated_at=now()
        WHERE id=$1 AND status='processing'`,
      [id, JSON.stringify(article)]
    );
  }

  async function saveNewsMedia(id, mediaId) {
    await pool.query(
      `UPDATE news_article_jobs SET wordpress_media_id=$2, updated_at=now()
        WHERE id=$1 AND status='processing'`,
      [id, mediaId]
    );
  }

  async function recentGeneratedArticles(excludeId, limit) {
    const result = await pool.query(
      `SELECT id, generated_payload->>'body_html' AS body_html
         FROM news_article_jobs
        WHERE id <> $1 AND status='published' AND generated_payload ? 'body_html'
        ORDER BY published_at DESC
        LIMIT $2`,
      [excludeId, Math.max(1, Math.min(Number(limit) || 100, 500))]
    );
    return result.rows;
  }

  async function completeNewsJob(id, wordpressPostId, wordpressPostUrl, duplicate) {
    await pool.query(
      `UPDATE news_article_jobs
          SET status='published', wordpress_post_id=$2, wordpress_post_url=$3,
              published_at=COALESCE(published_at, now()), worker_id=NULL, locked_at=NULL,
              last_error_code=$4, last_error_detail=NULL, updated_at=now()
        WHERE id=$1 AND status='processing'`,
      [id, wordpressPostId, wordpressPostUrl, duplicate ? 'wordpress_duplicate_reconciled' : null]
    );
  }

  async function failNewsJob(id, error, permanent) {
    await pool.query(
      `UPDATE news_article_jobs
          SET status=CASE WHEN $4 OR attempts >= 5 THEN
                CASE WHEN $4 THEN 'rejected' ELSE 'failed' END
              ELSE 'retry' END,
              next_attempt_at=CASE WHEN $4 OR attempts >= 5 THEN next_attempt_at
                ELSE now() + make_interval(secs => LEAST(3600, 30 * power(2, attempts)::integer)) END,
              worker_id=NULL, locked_at=NULL, last_error_code=$2, last_error_detail=$3, updated_at=now()
        WHERE id=$1 AND status='processing'`,
      [id, error.code, error.detail, permanent]
    );
  }

  const acceptStripeEvent = createStripeEventStore(pool);

  return {
    pool,
    health,
    acceptWordPressEvent,
    acceptStripeEvent,
    enqueueNewsArticle,
    claimNewsJob,
    saveNewsSource,
    saveGeneratedArticle,
    saveNewsMedia,
    recentGeneratedArticles,
    completeNewsJob,
    failNewsJob,
    close: () => pool.end()
  };
}

module.exports = { createDatabase, sslConfig };
