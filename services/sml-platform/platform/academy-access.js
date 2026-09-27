'use strict';

const DISCORD_API = 'https://discord.com/api/v10';
const SNOWFLAKE = /^\d{15,24}$/;
/* Session tiers. 'member' = the full Academy with live alerts (Monarch, which
   Lifetime buyers receive, manager, the billing engine's optional lifetime
   role, and any SML_ACADEMY_MEMBER_ROLE_IDS). 'academy' = a
   paid Academy plan ('Academy Student'). 'free' = a guild member with no paid
   role, issued only when SML_ACADEMY_FREE_SESSIONS=1. */
const TIERS = Object.freeze(['member', 'academy', 'free']);
const ENTITLED_TIERS = Object.freeze(['member', 'academy']);
const RETRY_AFTER_CAP_MS = 5_000;

function retryAfterMs(response, body) {
  const header = Number.parseFloat(response && response.headers && typeof response.headers.get === 'function' ? response.headers.get('retry-after') : '');
  const seconds = Number.isFinite(header) ? header : Number(body && body.retry_after);
  return Math.max(0, Math.min(RETRY_AFTER_CAP_MS, Number.isFinite(seconds) ? Math.ceil(seconds * 1000) : 1_000));
}

/* The Activity gate. `allowedRoleIds` are every role that earns a session.
   When `memberRoleIds` is given, a granted member whose roles include one of
   them is tier 'member' and everyone else admitted is 'academy'; without it
   every admitted role is 'member' (the original behaviour).
   Options that change behaviour default off: `retryRateLimited` retries one
   Discord 429 after its Retry-After (capped at 5 s) instead of throwing, and
   `identityAccess` resolves the Discord id of a caller who is not in the guild
   so a refusal can still name who asked. */
function createAcademyAccess({ guildId = '', allowedRoleIds = [], memberRoleIds = null, fetchImpl = fetch,
  identityAccess = null, retryRateLimited = false, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const roles = new Set(allowedRoleIds.map(String).filter(Boolean));
  const members = Array.isArray(memberRoleIds) ? new Set(memberRoleIds.map(String).filter(Boolean)) : null;
  const lookup = (bearer) => fetchImpl(`${DISCORD_API}/users/@me/guilds/${encodeURIComponent(guildId)}/member`, {
    headers: { authorization: `Bearer ${bearer}`, accept: 'application/json' },
    signal: AbortSignal.timeout(5_000)
  });
  async function verify(authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(String(authorization || ''));
    if (!guildId || !roles.size || !match) return { ok: false, status: 401, code: 'authorization_required' };
    let response = await lookup(match[1]);
    if (response.status === 429 && retryRateLimited) {
      let body = null;
      try { body = await response.json(); } catch (_) { body = null; }
      await sleep(retryAfterMs(response, body));
      response = await lookup(match[1]);
    }
    if (response.status === 401) return { ok: false, status: 401, code: 'authorization_required' };
    if (response.status === 403 || response.status === 404) {
      const miss = { ok: false, status: 403, code: 'academy_role_required', inGuild: false };
      if (identityAccess && typeof identityAccess.verify === 'function') {
        try {
          const who = await identityAccess.verify(authorization);
          if (who && who.ok && SNOWFLAKE.test(String(who.userId))) miss.userId = String(who.userId);
        } catch (_) { /* the refusal stands without an id */ }
      }
      return miss;
    }
    if (!response.ok) throw new Error(`discord_member_${response.status}`);
    const member = await response.json();
    const held = Array.isArray(member.roles) ? member.roles.map(String) : [];
    const userId = String(member.user?.id || '');
    if (!held.some((role) => roles.has(role))) {
      return { ok: false, status: 403, code: 'academy_role_required', inGuild: true, ...(SNOWFLAKE.test(userId) ? { userId } : {}) };
    }
    const tier = !members || held.some((role) => members.has(role)) ? 'member' : 'academy';
    return { ok: true, userId, tier };
  }
  return { verify };
}

/** Identity-only access: proves who the Discord user is, gates nothing else.
 *  The Connect app's LOOP-KICK Activity uses this — the real gate is the
 *  linked + verified stockmarketloop.com account, checked by the site. */
function createIdentityAccess({ fetchImpl = fetch } = {}) {
  async function verify(authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(String(authorization || ''));
    if (!match) return { ok: false, status: 401, code: 'authorization_required' };
    const response = await fetchImpl(`${DISCORD_API}/users/@me`, {
      headers: { authorization: `Bearer ${match[1]}`, accept: 'application/json' },
      signal: AbortSignal.timeout(5_000)
    });
    if (response.status === 401) return { ok: false, status: 401, code: 'authorization_required' };
    if (!response.ok) throw new Error(`discord_identity_${response.status}`);
    const user = await response.json();
    const userId = String(user?.id || '');
    return /^\d{15,24}$/.test(userId) ? { ok: true, userId } : { ok: false, status: 401, code: 'authorization_required' };
  }
  return { verify };
}

/* ---------- content gate (SML_ACADEMY_CONTENT_GATE_ENABLED) ---------- */

/* 'M0,M29:1-10' -> every lesson of module 0 and lessons 1-10 of module 29.
   'M5:3' is one lesson. 'none' (or nothing valid) is no free lessons: a bad
   value can only make the preview smaller. */
function parseFreePreview(raw) {
  const rules = [];
  for (const token of String(raw == null ? '' : raw).split(',')) {
    const match = /^M(\d{1,3})(?::(\d{1,3})(?:-(\d{1,3}))?)?$/i.exec(token.trim());
    if (!match) continue;
    const moduleId = Number(match[1]);
    if (match[2] === undefined) { rules.push({ moduleId, from: 1, to: Infinity }); continue; }
    const from = Number(match[2]);
    const to = match[3] === undefined ? from : Number(match[3]);
    if (to >= from) rules.push({ moduleId, from, to });
  }
  return Object.freeze(rules);
}

const LOCKED_TEXT = 'This lesson is part of the paid Making Easy Money Academy. Get Academy access to hear the full narration, work through the example and take the knowledge check.';
const LOCKED_ROUND = Object.freeze({
  prompt: 'This practice lab unlocks with Academy access.',
  display: LOCKED_TEXT,
  options: Object.freeze({ A: 'Unlock the full lesson' }),
  correct: 'A',
  explanation: 'Get Academy access to practise every decision in this lab.'
});

/* What a free or anonymous caller receives for a locked lesson: its title and
   summary (the first slide), a single unlock slide, and no steps, example,
   narration parts or quiz answers. Field order matches the full lesson with
   `locked` appended, so the client deck renders it without special cases. */
function lockedLesson(lesson) {
  const simulation = lesson.simulation && typeof lesson.simulation === 'object' ? lesson.simulation : {};
  return {
    moduleId: lesson.moduleId, lessonId: lesson.lessonId, title: lesson.title,
    description: lesson.description, duration: lesson.duration, level: lesson.level,
    steps: [LOCKED_TEXT],
    question: null,
    simulation: { type: String(simulation.type || 'scenario'), title: String(simulation.title || lesson.title || ''), rounds: [LOCKED_ROUND] },
    parts: [lesson.title, LOCKED_TEXT],
    example: null, exampleIndex: -1,
    narrationVersion: lesson.narrationVersion,
    locked: true
  };
}

function createAcademyContentGate({ enabled = false, freePreview = '', freeSymbols = ['SPY', 'QQQ'], alertsTiering = false } = {}) {
  const rules = parseFreePreview(freePreview);
  const symbols = Object.freeze([...new Set((Array.isArray(freeSymbols) ? freeSymbols : []).map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean))]);
  const symbolSet = new Set(symbols);
  /* Query strings arrive as text: only plain digits count (null, '' and 1.5 are not lessons). */
  const lessonNumber = (value) => (typeof value === 'number' ? value : (/^\d{1,3}$/.test(String(value == null ? '' : value)) ? Number(value) : NaN));
  const isFreeLesson = (moduleId, lessonId) => {
    const m = lessonNumber(moduleId), l = lessonNumber(lessonId);
    if (!Number.isInteger(m) || !Number.isInteger(l)) return false;
    return rules.some((rule) => rule.moduleId === m && l >= rule.from && l <= rule.to);
  };
  const isFreeSymbol = (symbol) => symbolSet.has(String(symbol == null ? '' : symbol).trim().toUpperCase());
  /* Only 'member' and 'academy' are entitled. A missing tier is anonymous. */
  const entitled = (tier) => ENTITLED_TIERS.includes(tier);
  const previewLessons = (lessons) => (Array.isArray(lessons) ? lessons : []).map((lesson) => (isFreeLesson(lesson.moduleId, lesson.lessonId) ? lesson : lockedLesson(lesson)));
  return Object.freeze({ enabled: Boolean(enabled), alertsTiering: Boolean(alertsTiering), freeSymbols: symbols, rules, isFreeLesson, isFreeSymbol, entitled, previewLessons });
}

module.exports = { createAcademyAccess, createIdentityAccess, createAcademyContentGate, parseFreePreview, lockedLesson,
  TIERS, ENTITLED_TIERS, LOCKED_TEXT };
