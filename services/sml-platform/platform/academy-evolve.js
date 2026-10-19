'use strict';

/* ACADEMY EVOLVE: the Academy learns from its own use and keeps proposing (and, within guard rails, applying) ways
 * to get better. Three parts.
 *
 *  1. The ledger. Every /academy-activity route is timed (count, errors, timeouts, p50/p95), the page beacons which
 *     tools members open and on what kind of screen, page errors, and how long a visit lasts; the server adds its
 *     memory and event-loop lag, the data providers' health and the signal outcome hit rates. Everything is bounded
 *     (fixed-size maps and sample rings) and rolls over once a day into a dated digest kept for thirty days.
 *
 *  2. The knobs. A few runtime settings with hard floors and ceilings that the system may turn on its own from the
 *     evidence: how fast the page polls the quote, how wide and how parallel the squeeze sweep runs, how long the
 *     sentiment read is cached. A knob never leaves its rail, every turn is written down with its reason, and the
 *     owner can pin any knob by hand.
 *
 *  3. The brief. Once a day (and whenever the owner asks) the digest goes to Claude, which answers with a plain
 *     account of what members did, where the Academy was slow, wrong or unreliable, and three to seven concrete
 *     proposals, each with the evidence, the change, the expected effect, the risk and a size. Proposals are kept
 *     in a queue the owner can approve, dismiss or mark shipped from the EVOLVE panel; a scheduled builder session
 *     reads the queue from the database and implements the top approved one as a pull request. Small, low-risk
 *     proposals the brief marks `auto` are approved on arrival, so the loop keeps moving without the owner.
 *
 *  Nothing here places trades or changes what a tool computes; it changes how the Academy serves and what gets built
 *  next. Educational software improving itself, with the owner holding the merge button. */

const DAY_MS = 86_400_000;
const KEEP_DAYS = 30;
const MAX_ROUTES = 160, MAX_TOOLS = 120, MAX_ERRORS = 60, SAMPLE_RING = 48;
const PROPOSAL_STATES = new Set(['proposed', 'approved', 'dismissed', 'building', 'shipped']);

/* the knobs the system may turn, with their rails; `value` is the live setting, `pinned` means the owner set it */
const KNOBS = {
  livePollMs: { min: 2_000, max: 8_000, step: 500, value: 2_500, unit: 'ms', about: 'how often the page polls the live quote and book' },
  squeezeConcurrency: { min: 1, max: 4, step: 1, value: 2, unit: 'workers', about: 'how many names the squeeze sweep reads in full at once' },
  squeezeMaxSymbols: { min: 60, max: 160, step: 20, value: 100, unit: 'names', about: 'how many pre-screened names the squeeze sweep reads in full' },
  sentimentTtlMs: { min: 60_000, max: 600_000, step: 60_000, value: 60_000, unit: 'ms', about: 'how long a sentiment read is kept before it is rebuilt' }
};

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const percentile = (ring, p) => { if (!ring.length) return 0; const s = ring.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);
const routeKey = (path) => String(path || '').replace(/^\/academy-activity\/?/, '').split('?')[0].replace(/\/\d{6,}/g, '/:id').replace(/\/[A-Z]{1,6}$/, '/:sym').slice(0, 60) || 'page';

function emptyLedger(at) {
  return { since: at, routes: {}, tools: {}, devices: { phone: 0, desktop: 0, discord: 0, web: 0 }, visits: { count: 0, msTotal: 0, msMax: 0 }, errors: [], memory: { samples: 0, rssMax: 0, rssSum: 0, loopP99Max: 0, loopP99Sum: 0 }, timeouts: 0 };
}

function createEvolve({ store = null, ai = null, now = Date.now, logger = () => {}, fetchImpl = fetch, sources = {}, briefHourUtc = 7, knobs = null } = {}) {
  const state = { ledger: emptyLedger(now()), days: [], briefs: [], proposals: [], knobs: JSON.parse(JSON.stringify(KNOBS)), turns: [], lastBriefAt: 0, loaded: false };
  if (knobs && typeof knobs === 'object') for (const [k, v] of Object.entries(knobs)) if (state.knobs[k] && Number.isFinite(Number(v))) state.knobs[k].value = clamp(Number(v), state.knobs[k].min, state.knobs[k].max);
  const rings = new Map();  // route -> latency samples (not persisted)
  let saving = null;

  async function load() {
    if (state.loaded || !store || typeof store.read !== 'function') { state.loaded = true; return; }
    try {
      const saved = await store.read();
      if (saved && typeof saved === 'object') {
        if (Array.isArray(saved.days)) state.days = saved.days.slice(-KEEP_DAYS);
        if (Array.isArray(saved.briefs)) state.briefs = saved.briefs.slice(-KEEP_DAYS);
        if (Array.isArray(saved.proposals)) state.proposals = saved.proposals.slice(-200);
        if (Array.isArray(saved.turns)) state.turns = saved.turns.slice(-100);
        if (saved.knobs && typeof saved.knobs === 'object') for (const [k, v] of Object.entries(saved.knobs)) if (state.knobs[k] && v && Number.isFinite(Number(v.value))) { state.knobs[k].value = clamp(Number(v.value), state.knobs[k].min, state.knobs[k].max); state.knobs[k].pinned = Boolean(v.pinned); }
        if (saved.ledger && typeof saved.ledger === 'object' && saved.ledger.since && now() - Number(saved.ledger.since) < 2 * DAY_MS) state.ledger = { ...emptyLedger(saved.ledger.since), ...saved.ledger };
        state.lastBriefAt = num(saved.lastBriefAt);
      }
    } catch (error) { logger('warn', 'academy_evolve_load_failed', { error: String((error && error.message) || error) }); }
    state.loaded = true;
  }
  function save() {
    if (!store || typeof store.write !== 'function') return Promise.resolve();
    if (saving) return saving;
    saving = Promise.resolve().then(() => store.write({ ledger: state.ledger, days: state.days, briefs: state.briefs, proposals: state.proposals, turns: state.turns, knobs: Object.fromEntries(Object.entries(state.knobs).map(([k, v]) => [k, { value: v.value, pinned: Boolean(v.pinned) }])), lastBriefAt: state.lastBriefAt, savedAt: now() }))
      .catch((error) => logger('warn', 'academy_evolve_save_failed', { error: String((error && error.message) || error) }))
      .finally(() => { saving = null; });
    return saving;
  }

  /* ---- the ledger ---- */
  function observeRoute(path, status, ms, { timeout = false } = {}) {
    const key = routeKey(path);
    const L = state.ledger;
    let r = L.routes[key];
    if (!r) { if (Object.keys(L.routes).length >= MAX_ROUTES) return; r = L.routes[key] = { n: 0, err: 0, timeouts: 0, msSum: 0, msMax: 0, p50: 0, p95: 0 }; }
    r.n += 1; r.msSum += ms; r.msMax = Math.max(r.msMax, ms);
    if (status >= 500) r.err += 1;
    if (timeout) { r.timeouts += 1; L.timeouts += 1; }
    let ring = rings.get(key); if (!ring) { ring = []; rings.set(key, ring); }
    ring.push(ms); if (ring.length > SAMPLE_RING) ring.shift();
    r.p50 = percentile(ring, 50); r.p95 = percentile(ring, 95);
  }
  function observeEvent(event) {
    if (!event || typeof event !== 'object') return false;
    const L = state.ledger;
    const kind = String(event.kind || '');
    if (kind === 'tool') {
      const id = String(event.id || '').slice(0, 40); if (!/^[a-z0-9][a-z0-9-]*$/i.test(id)) return false;
      let t = L.tools[id]; if (!t) { if (Object.keys(L.tools).length >= MAX_TOOLS) return false; t = L.tools[id] = { opens: 0, phone: 0 }; }
      if (event.on !== false) { t.opens += 1; if (event.phone) t.phone += 1; }
      return true;
    }
    if (kind === 'visit') {
      L.devices[event.phone ? 'phone' : 'desktop'] += 1; L.devices[event.discord ? 'discord' : 'web'] += 1;
      L.visits.count += 1; return true;
    }
    if (kind === 'leave') {
      const ms = clamp(num(event.ms), 0, 12 * 3_600_000);
      L.visits.msTotal += ms; L.visits.msMax = Math.max(L.visits.msMax, ms); return true;
    }
    if (kind === 'error') {
      const message = String(event.message || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 160); if (!message) return false;
      const hit = L.errors.find((e) => e.message === message);
      if (hit) hit.n += 1; else if (L.errors.length < MAX_ERRORS) L.errors.push({ message, n: 1, phone: Boolean(event.phone) });
      return true;
    }
    return false;
  }
  function observeMemory(sample) {
    if (!sample) return;
    const M = state.ledger.memory;
    M.samples += 1; M.rssSum += num(sample.rss); M.rssMax = Math.max(M.rssMax, num(sample.rss));
    M.loopP99Sum += num(sample.loopP99); M.loopP99Max = Math.max(M.loopP99Max, num(sample.loopP99));
  }

  /* a digest a person or a model can read in one screen */
  async function digest(ledger = state.ledger) {
    const routes = Object.entries(ledger.routes).map(([route, r]) => ({ route, n: r.n, errPct: pct(r.err, r.n), timeouts: r.timeouts, p50: r.p50, p95: r.p95, msMax: r.msMax }));
    const slow = routes.filter((r) => r.n >= 5).sort((a, b) => b.p95 - a.p95).slice(0, 8);
    const failing = routes.filter((r) => r.n >= 5 && (r.errPct > 0 || r.timeouts > 0)).sort((a, b) => (b.errPct + b.timeouts) - (a.errPct + a.timeouts)).slice(0, 8);
    const busiest = routes.slice().sort((a, b) => b.n - a.n).slice(0, 8);
    const tools = Object.entries(ledger.tools).map(([id, t]) => ({ id, opens: t.opens, phonePct: pct(t.phone, t.opens) })).sort((a, b) => b.opens - a.opens);
    const extra = {};
    for (const [name, fn] of Object.entries(sources)) { if (typeof fn !== 'function') continue; try { const v = await Promise.race([fn(), new Promise((r) => setTimeout(() => r(null), 4_000))]); if (v != null) extra[name] = v; } catch (_) { /* a source that fails is left out of the digest */ } }
    const M = ledger.memory;
    return {
      day: dayKey(ledger.since), since: ledger.since, until: now(),
      visits: { ...ledger.visits, avgMinutes: ledger.visits.count ? Math.round(ledger.visits.msTotal / ledger.visits.count / 6000) / 10 : 0 },
      devices: ledger.devices, requests: routes.reduce((a, r) => a + r.n, 0), timeouts: ledger.timeouts,
      slow, failing, busiest, tools: tools.slice(0, 25), unusedTools: [], errors: ledger.errors.slice().sort((a, b) => b.n - a.n).slice(0, 12),
      memory: { rssAvg: M.samples ? Math.round(M.rssSum / M.samples) : 0, rssMax: M.rssMax, loopP99Avg: M.samples ? Math.round(M.loopP99Sum / M.samples) : 0, loopP99Max: M.loopP99Max },
      knobs: Object.fromEntries(Object.entries(state.knobs).map(([k, v]) => [k, { value: v.value, min: v.min, max: v.max, pinned: Boolean(v.pinned) }])),
      ...extra
    };
  }

  /* ---- the knobs: evidence in, a bounded turn out, every turn written down ---- */
  function turn(key, nextValue, reason) {
    const k = state.knobs[key]; if (!k || k.pinned) return false;
    const v = clamp(Math.round(nextValue / k.step) * k.step, k.min, k.max);
    if (v === k.value) return false;
    const from = k.value; k.value = v;
    state.turns.push({ at: now(), knob: key, from, to: v, reason: String(reason).slice(0, 160) }); if (state.turns.length > 100) state.turns.shift();
    logger('info', 'academy_evolve_turn', { knob: key, from, to: v, reason });
    return true;
  }
  function tune(d) {
    const turns = [];
    const live = d.routes ? null : (d.slow || []).concat(d.failing || []).find((r) => r.route === 'live') || null;
    const liveRow = Object.entries(state.ledger.routes).find(([k]) => k === 'live');
    const lr = liveRow ? liveRow[1] : null;
    /* the page polls the quote slower while the live route is slow or timing out, and faster again once it is quick */
    if (lr && lr.n >= 20) {
      if (lr.p95 > 2_000 || pct(lr.timeouts, lr.n) > 2) { if (turn('livePollMs', state.knobs.livePollMs.value + 1_000, `live p95 ${lr.p95} ms, timeouts ${pct(lr.timeouts, lr.n)}%`)) turns.push('livePollMs'); }
      else if (lr.p95 < 400 && lr.timeouts === 0) { if (turn('livePollMs', state.knobs.livePollMs.value - 500, `live p95 ${lr.p95} ms, no timeouts`)) turns.push('livePollMs'); }
    }
    /* the squeeze sweep narrows while memory or the event loop is under pressure, and widens when there is room */
    const m = d.memory || {};
    if (m.rssMax >= 440 || m.loopP99Max >= 500) {
      if (turn('squeezeConcurrency', state.knobs.squeezeConcurrency.value - 1, `rss max ${m.rssMax} MB, loop p99 max ${m.loopP99Max} ms`)) turns.push('squeezeConcurrency');
      if (turn('squeezeMaxSymbols', state.knobs.squeezeMaxSymbols.value - 20, `rss max ${m.rssMax} MB, loop p99 max ${m.loopP99Max} ms`)) turns.push('squeezeMaxSymbols');
    } else if (m.rssMax > 0 && m.rssMax < 380 && m.loopP99Max < 200) {
      if (turn('squeezeMaxSymbols', state.knobs.squeezeMaxSymbols.value + 10, `rss max ${m.rssMax} MB, loop p99 max ${m.loopP99Max} ms`)) turns.push('squeezeMaxSymbols');
      if (turn('squeezeConcurrency', state.knobs.squeezeConcurrency.value + 1, `rss max ${m.rssMax} MB, loop p99 max ${m.loopP99Max} ms`)) turns.push('squeezeConcurrency');
    }
    /* a sentiment read that fails or crawls is kept longer so members see a reading instead of a spinner */
    const sr = state.ledger.routes.sentiment;
    if (sr && sr.n >= 10) {
      if (sr.p95 > 6_000 || pct(sr.err + sr.timeouts, sr.n) > 5) { if (turn('sentimentTtlMs', state.knobs.sentimentTtlMs.value * 2, `sentiment p95 ${sr.p95} ms, failures ${pct(sr.err + sr.timeouts, sr.n)}%`)) turns.push('sentimentTtlMs'); }
      else if (sr.p95 < 1_500 && sr.err === 0) { if (turn('sentimentTtlMs', state.knobs.sentimentTtlMs.value / 2, `sentiment p95 ${sr.p95} ms, no failures`)) turns.push('sentimentTtlMs'); }
    }
    void live;
    return turns;
  }
  function setKnob(key, value, { pinned = null } = {}) {
    const k = state.knobs[key]; if (!k) return null;
    if (value != null && Number.isFinite(Number(value))) { const v = clamp(Number(value), k.min, k.max); if (v !== k.value) { state.turns.push({ at: now(), knob: key, from: k.value, to: v, reason: 'owner' }); k.value = v; } }
    if (pinned != null) k.pinned = Boolean(pinned);
    void save();
    return { value: k.value, pinned: Boolean(k.pinned) };
  }
  const knob = (key) => (state.knobs[key] ? state.knobs[key].value : undefined);
  const config = () => ({ livePollMs: knob('livePollMs'), squeezeConcurrency: knob('squeezeConcurrency'), squeezeMaxSymbols: knob('squeezeMaxSymbols'), sentimentTtlMs: knob('sentimentTtlMs') });

  /* ---- the brief ---- */
  const SYSTEM = 'You are the engineering lead for the Making Easy Money Academy, a Discord Activity for learning to trade (a live chart with tools for order flow, options, smart money, earnings, short sales, paper trading, chat and alerts), built in Node.js and vanilla browser JavaScript. You receive one day of telemetry as JSON. Answer with JSON only, no prose outside it, of this shape: '
    + '{"summary": "<120-220 words: what members did, what was slow, wrong or unreliable, what improved>", "proposals": [{"title": "<short>", "evidence": "<the numbers that justify it>", "change": "<what to change, concretely, naming the area or file family when you can>", "effect": "<expected effect on members>", "risk": "low|medium|high", "size": "S|M|L", "auto": true|false, "area": "speed|reliability|accuracy|navigation|learning|content"}], "knobs": [{"knob": "<name>", "value": <number>, "why": "<one line>"}]}. '
    + 'Rules: three to seven proposals, each grounded in the telemetry (quote numbers), ordered by member impact per unit of work; mark auto true only for size S, risk low changes that do not touch money, access or data correctness; never propose trading advice or anything that places trades; knobs only from the list given, inside their rails; plain words, no hype, no em dashes.';

  async function askModel(d) {
    if (!ai || !ai.apiKey) return null;
    const body = { model: ai.model || 'claude-sonnet-5-5', max_tokens: 1800, system: SYSTEM, messages: [{ role: 'user', content: 'Telemetry for ' + d.day + ':\n' + JSON.stringify(d).slice(0, 60_000) }] };
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': ai.apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(45_000) });
    if (!res.ok) throw new Error('anthropic_' + res.status);
    const j = await res.json();
    const text = Array.isArray(j && j.content) ? j.content.filter((c) => c && c.type === 'text').map((c) => c.text).join('') : '';
    const s = String(text).replace(/```(?:json)?/gi, '').trim();
    const start = s.indexOf('{'), end = s.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('anthropic_bad_json');
    const parsed = JSON.parse(s.slice(start, end + 1));
    return { summary: String(parsed.summary || '').slice(0, 2000), proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [], knobs: Array.isArray(parsed.knobs) ? parsed.knobs : [], model: body.model };
  }
  function fallbackBrief(d) {
    const lines = [];
    lines.push(`${d.visits.count} visits (${d.devices.phone} on phones, ${d.devices.discord} inside Discord), ${d.requests} requests, ${d.timeouts} route timeouts.`);
    if (d.tools.length) lines.push('Most opened tools: ' + d.tools.slice(0, 5).map((t) => `${t.id} (${t.opens})`).join(', ') + '.');
    if (d.slow.length) lines.push('Slowest routes by p95: ' + d.slow.slice(0, 4).map((r) => `${r.route} ${r.p95} ms`).join(', ') + '.');
    if (d.failing.length) lines.push('Routes with failures: ' + d.failing.slice(0, 4).map((r) => `${r.route} ${r.errPct}% errors, ${r.timeouts} timeouts`).join(', ') + '.');
    if (d.errors.length) lines.push('Top page error: ' + d.errors[0].message + ' (' + d.errors[0].n + ').');
    lines.push(`Memory peaked at ${d.memory.rssMax} MB; event-loop p99 peaked at ${d.memory.loopP99Max} ms.`);
    const proposals = [];
    for (const r of d.failing.slice(0, 2)) proposals.push({ title: `Stop ${r.route} failing`, evidence: `${r.errPct}% errors, ${r.timeouts} timeouts over ${r.n} calls`, change: `Root-cause the ${r.route} route's failures and add a bounded fallback`, effect: 'members stop seeing a dead panel', risk: 'low', size: 'M', auto: false, area: 'reliability' });
    for (const r of d.slow.slice(0, 2)) if (r.p95 > 2000) proposals.push({ title: `Speed up ${r.route}`, evidence: `p95 ${r.p95} ms, max ${r.msMax} ms over ${r.n} calls`, change: `Cache or precompute the ${r.route} answer and cut its upstream waits`, effect: 'the panel opens without a wait', risk: 'low', size: 'M', auto: false, area: 'speed' });
    if (d.errors.length) proposals.push({ title: 'Fix the most common page error', evidence: `${d.errors[0].message} seen ${d.errors[0].n} times`, change: 'Find where this throws and guard it', effect: 'fewer silent failures on members’ screens', risk: 'low', size: 'S', auto: true, area: 'reliability' });
    return { summary: lines.join(' '), proposals, knobs: [], model: 'rules' };
  }
  function adoptProposals(brief, day) {
    const added = [];
    for (const p of (brief.proposals || []).slice(0, 7)) {
      if (!p || !p.title) continue;
      const title = String(p.title).slice(0, 120);
      if (state.proposals.some((q) => q.title.toLowerCase() === title.toLowerCase() && q.status !== 'dismissed' && q.status !== 'shipped')) continue;
      const id = 'p' + now().toString(36) + Math.random().toString(36).slice(2, 6);
      const auto = p.auto === true && String(p.size).toUpperCase() === 'S' && String(p.risk).toLowerCase() === 'low';
      const row = { id, day, title, evidence: String(p.evidence || '').slice(0, 400), change: String(p.change || '').slice(0, 600), effect: String(p.effect || '').slice(0, 300), risk: ['low', 'medium', 'high'].includes(String(p.risk).toLowerCase()) ? String(p.risk).toLowerCase() : 'medium', size: ['S', 'M', 'L'].includes(String(p.size).toUpperCase()) ? String(p.size).toUpperCase() : 'M', area: String(p.area || 'other').slice(0, 20), auto, status: auto ? 'approved' : 'proposed', createdAt: now(), updatedAt: now() };
      state.proposals.push(row); added.push(row);
    }
    if (state.proposals.length > 200) state.proposals = state.proposals.slice(-200);
    return added;
  }

  async function runBrief({ reason = 'scheduled' } = {}) {
    await load();
    const d = await digest();
    const turns = tune(d);
    let brief = null, error = '';
    try { brief = await askModel(d); } catch (e) { error = String((e && e.message) || e); logger('warn', 'academy_evolve_model_failed', { error }); }
    if (!brief) brief = fallbackBrief(d);
    /* the model's knob suggestions are turned only inside the rails, like any other turn */
    for (const k of brief.knobs || []) if (k && state.knobs[k.knob] && Number.isFinite(Number(k.value))) { if (turn(k.knob, Number(k.value), 'brief: ' + String(k.why || '').slice(0, 120))) turns.push(k.knob); }
    const added = adoptProposals(brief, d.day);
    const row = { day: d.day, at: now(), reason, model: brief.model, summary: brief.summary, proposalIds: added.map((p) => p.id), turns, digest: { visits: d.visits, devices: d.devices, requests: d.requests, timeouts: d.timeouts, slow: d.slow.slice(0, 5), failing: d.failing.slice(0, 5), tools: d.tools.slice(0, 10), errors: d.errors.slice(0, 5), memory: d.memory }, ...(error ? { modelError: error } : {}) };
    state.briefs.push(row); if (state.briefs.length > KEEP_DAYS) state.briefs.shift();
    state.days.push({ day: d.day, digest: row.digest }); if (state.days.length > KEEP_DAYS) state.days.shift();
    state.lastBriefAt = now();
    state.ledger = emptyLedger(now()); rings.clear();
    await save();
    logger('info', 'academy_evolve_brief', { day: d.day, reason, model: brief.model, proposals: added.length, turns: turns.length });
    return row;
  }
  /* once a day, in the quiet hour, and never twice within twenty hours */
  function due() { const t = now(); return t - state.lastBriefAt > 20 * 3_600_000 && new Date(t).getUTCHours() === briefHourUtc; }

  function setProposal(id, status) {
    if (!PROPOSAL_STATES.has(status)) return null;
    const p = state.proposals.find((x) => x.id === id); if (!p) return null;
    p.status = status; p.updatedAt = now(); void save(); return p;
  }
  /* what the builder session (and the owner panel) reads: approved proposals first, newest brief, the knobs */
  async function snapshot() {
    await load();
    const open = state.proposals.filter((p) => p.status !== 'dismissed' && p.status !== 'shipped');
    const order = { building: 0, approved: 1, proposed: 2 };
    return {
      ok: true, asOf: now(), lastBriefAt: state.lastBriefAt, brief: state.briefs[state.briefs.length - 1] || null, briefs: state.briefs.slice(-7).reverse(),
      proposals: open.sort((a, b) => (order[a.status] - order[b.status]) || (b.createdAt - a.createdAt)).slice(0, 40), done: state.proposals.filter((p) => p.status === 'shipped').slice(-10).reverse(),
      knobs: Object.fromEntries(Object.entries(state.knobs).map(([k, v]) => [k, { ...v }])), turns: state.turns.slice(-12).reverse(), today: await digest(), aiOn: Boolean(ai && ai.apiKey)
    };
  }

  /* the public read-only queue the builder session works from: proposals and brief summaries, nothing from the telemetry itself */
  async function queue() {
    await load();
    const fields = (p) => ({ id: p.id, day: p.day, title: p.title, evidence: p.evidence, change: p.change, effect: p.effect, risk: p.risk, size: p.size, area: p.area, status: p.status, createdAt: p.createdAt, updatedAt: p.updatedAt });
    return { ok: true, asOf: now(), proposals: state.proposals.filter((p) => p.status === 'approved' || p.status === 'proposed' || p.status === 'building').sort((a, b) => b.createdAt - a.createdAt).map(fields), shipped: state.proposals.filter((p) => p.status === 'shipped').slice(-20).map(fields), briefs: state.briefs.slice(-7).reverse().map((b) => ({ day: b.day, at: b.at, model: b.model, summary: b.summary })) };
  }
  return { load, save, observeRoute, observeEvent, observeMemory, digest, tune, runBrief, due, setProposal, setKnob, knob, config, snapshot, queue, state, KNOBS };
}

module.exports = { createEvolve, routeKey, KNOBS };
