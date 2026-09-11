'use strict';

const GAP_MS = 20_000;

// Called inside the existing claim transaction. Shared across worker replicas
// and restarts; no schema migration or long-lived connection lock is needed.
async function canClaimNewsJob(client) {
  const lock = await client.query('SELECT pg_try_advisory_xact_lock(1936551022, 1) AS acquired');
  if (lock.rows[0]?.acquired !== true) return false;
  await client.query(`UPDATE news_article_jobs
    SET status='retry', worker_id=NULL, locked_at=NULL, next_attempt_at=now(),
        last_error_code='stale_worker_lock', updated_at=now()
    WHERE status='processing' AND locked_at < now() - interval '15 minutes'`);
  const state = await client.query(`SELECT EXISTS (
    SELECT 1 FROM news_article_jobs
    WHERE status='processing'
       OR (status IN ('published','rejected','failed','retry')
           AND updated_at > now() - interval '20 seconds')
  ) AS blocked`);
  return state.rows[0]?.blocked === false;
}

// Completion-based pacing, not setInterval: long AI jobs never overlap and
// timer delays never trigger a catch-up burst. No batch drain anywhere here.
function createNewsFlow({ runOnce, onResult = () => {}, onError = () => {},
  schedule = setTimeout, cancel = clearTimeout }) {
  let stopped = true;
  let timer = null;
  let pending = null;
  async function cycle() {
    timer = null;
    if (stopped || pending) return;
    pending = Promise.resolve().then(runOnce);
    try { onResult(await pending); }
    catch (error) { try { onError(error); } catch (_) { /* keep pacing if logging fails */ } }
    finally {
      pending = null;
      if (!stopped) timer = schedule(cycle, GAP_MS);
    }
  }
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      timer = schedule(cycle, GAP_MS);
    },
    async stop() {
      stopped = true;
      if (timer !== null) cancel(timer);
      timer = null;
      if (pending) { try { await pending; } catch (_) { /* reported by cycle */ } }
    }
  };
}
module.exports = { GAP_MS, canClaimNewsJob, createNewsFlow };
