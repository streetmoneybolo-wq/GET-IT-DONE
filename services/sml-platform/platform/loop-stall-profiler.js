'use strict';

/* LOOP STALL PROFILER: names what blocked the event loop.
 *
 * The memory sampler reports loopMax (the longest pause the event loop took in the last minute). A pause of several
 * seconds means one synchronous piece of work held the whole server: every route, sign-in and timer waited behind it.
 * The number alone never says which function; this module keeps V8's sampling CPU profiler running (its sampling thread
 * keeps ticking while the main thread is blocked, so a blocking function shows up with its self time), and when a pause
 * over `thresholdMs` is reported it stops the profile, ranks functions by self time and logs the top of the list as
 * `loop_stall_profile`. It profiles during a window after boot (where the stalls were seen) and re-arms for another
 * window whenever the loop is reported slow. Overhead is a few percent while a window is open; nothing outside it.
 * SML_LOOP_PROFILE=off removes it. */

function createLoopStallProfiler({ logger = () => {}, thresholdMs = 3_000, windowMs = 6 * 60_000, samplingUs = 20_000, now = Date.now, inspector = null } = {}) {
  let session = null, until = 0, running = false, windows = 0;
  const insp = inspector || (() => { try { return require('node:inspector'); } catch (_) { return null; } })();
  const post = (method, params) => new Promise((resolve, reject) => { if (!session) return reject(new Error('no_session')); session.post(method, params || {}, (error, result) => (error ? reject(error) : resolve(result))); });

  async function begin() {
    if (running || !insp) return false;
    try {
      if (!session) { session = new insp.Session(); session.connect(); await post('Profiler.enable'); await post('Profiler.setSamplingInterval', { interval: samplingUs }); }
      await post('Profiler.start');
      running = true; windows += 1; until = now() + windowMs;
      return true;
    } catch (error) { logger('warn', 'loop_profiler_failed', { error: String(error && error.message || error) }); running = false; return false; }
  }
  async function end() {
    if (!running) return null;
    running = false;
    try { const r = await post('Profiler.stop'); return r && r.profile ? r.profile : null; } catch (error) { logger('warn', 'loop_profiler_failed', { error: String(error && error.message || error) }); return null; }
  }
  /* self time per function, from the sample stream (each sample charges its node for the time until the next) */
  function rank(profile, limit = 8) {
    const nodes = new Map(); for (const n of profile.nodes || []) nodes.set(n.id, n);
    const self = new Map(); const samples = profile.samples || [], deltas = profile.timeDeltas || [];
    let total = 0;
    for (let i = 0; i < samples.length; i++) {
      const dt = Math.max(0, Number(deltas[i]) || 0); total += dt;
      const n = nodes.get(samples[i]); if (!n) continue;
      const f = n.callFrame || {};
      if (f.functionName === '(idle)' || f.functionName === '(program)' || f.functionName === '(garbage collector)' && false) continue;
      const key = (f.functionName || '(anonymous)') + '|' + String(f.url || '').split('/').slice(-2).join('/') + '|' + (Number(f.lineNumber) + 1);
      self.set(key, (self.get(key) || 0) + dt);
    }
    const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, us]) => { const [fn, file, line] = k.split('|'); return { fn, file, line: Number(line), selfMs: Math.round(us / 1000) }; });
    return { totalMs: Math.round(total / 1000), top };
  }
  async function report(loopMaxMs) {
    const profile = await end();
    if (profile) { const r = rank(profile); logger('warn', 'loop_stall_profile', { loopMaxMs: Math.round(loopMaxMs), windowMs: r.totalMs, top: r.top }); return r; }
    return null;
  }
  /* called once a minute with the loop's worst pause and p99 for that minute */
  async function onSample({ loopMax = 0, loopP99 = 0 } = {}) {
    if (running && loopMax >= thresholdMs) { const r = await report(loopMax); if (now() < until) await begin(); return r; }
    if (running && now() >= until) { await end(); return null; }
    if (!running && loopP99 >= 500 && windows < 24) await begin();
    return null;
  }
  async function start() { return begin(); }
  async function stop() { await end(); try { if (session) { session.disconnect(); session = null; } } catch (_) { /* gone */ } }
  return { start, stop, onSample, report, rank, running: () => running, enabled: Boolean(insp) };
}

module.exports = { createLoopStallProfiler };
