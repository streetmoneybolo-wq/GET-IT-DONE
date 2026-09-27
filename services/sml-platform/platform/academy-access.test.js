'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createAcademyAccess, createAcademyContentGate, parseFreePreview, lockedLesson, LOCKED_TEXT } = require('./academy-access');
const { getConfig } = require('./config');
const { SEED_LESSONS } = require('./academy/curriculum');

const GUILD = '938894329076940820';
const MANAGER = '1100000000000000001';
const MONARCH = '1260433215189946420';
const STUDENT = '1553000000000000001';
const LIFETIME = '1553000000000000002';
const PREMIUM = '939031140679970867';
const USER = '420000000000000042';

const reply = (status, body, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: new Headers(headers), json: async () => body });
function discord(sequence) {
  const calls = [];
  const queue = sequence.slice();
  return { calls, fetchImpl: async (url, options) => { calls.push({ url, options }); const next = queue.shift(); if (!next) throw new Error('unexpected Discord call'); return next; } };
}

test('flags off: the gate admits exactly the configured roles, all as member tier, and says who was refused', async () => {
  const fake = discord([
    reply(200, { user: { id: USER }, roles: [MONARCH] }),
    reply(200, { user: { id: USER }, roles: [PREMIUM] }),
    reply(404, { code: 10004 }),
    reply(401, {})
  ]);
  const access = createAcademyAccess({ guildId: GUILD, allowedRoleIds: [MANAGER, MONARCH], fetchImpl: fake.fetchImpl });
  assert.deepEqual(await access.verify('Bearer user-token'), { ok: true, userId: USER, tier: 'member' });
  assert.deepEqual(await access.verify('Bearer user-token'), { ok: false, status: 403, code: 'academy_role_required', inGuild: true, userId: USER });
  assert.deepEqual(await access.verify('Bearer user-token'), { ok: false, status: 403, code: 'academy_role_required', inGuild: false });
  assert.deepEqual(await access.verify('Bearer user-token'), { ok: false, status: 401, code: 'authorization_required' });
  assert.equal(fake.calls[0].url, `https://discord.com/api/v10/users/@me/guilds/${GUILD}/member`);
  assert.equal(fake.calls[0].options.headers.authorization, 'Bearer user-token');
  assert.deepEqual(await access.verify(''), { ok: false, status: 401, code: 'authorization_required' });
});

test('flags off: a Discord 429 still fails as before (the caller answers 503)', async () => {
  const fake = discord([reply(429, { retry_after: 0.2 })]);
  const slept = [];
  const access = createAcademyAccess({ guildId: GUILD, allowedRoleIds: [MONARCH], fetchImpl: fake.fetchImpl, sleep: async (ms) => { slept.push(ms); } });
  await assert.rejects(access.verify('Bearer t'), /discord_member_429/);
  assert.deepEqual(slept, []);
  assert.equal(fake.calls.length, 1);
});

test('retryRateLimited honours Retry-After once (capped at 5 s) and then gives up', async () => {
  const slept = [];
  const sleep = async (ms) => { slept.push(ms); };
  const once = discord([reply(429, { retry_after: 0.25 }), reply(200, { user: { id: USER }, roles: [MONARCH] })]);
  const access = createAcademyAccess({ guildId: GUILD, allowedRoleIds: [MONARCH], fetchImpl: once.fetchImpl, retryRateLimited: true, sleep });
  assert.equal((await access.verify('Bearer t')).ok, true);
  assert.deepEqual(slept, [250]);

  const capped = discord([reply(429, {}, { 'retry-after': '60' }), reply(200, { user: { id: USER }, roles: [MONARCH] })]);
  await createAcademyAccess({ guildId: GUILD, allowedRoleIds: [MONARCH], fetchImpl: capped.fetchImpl, retryRateLimited: true, sleep }).verify('Bearer t');
  assert.equal(slept[1], 5_000, 'a long Retry-After is capped');

  const twice = discord([reply(429, { retry_after: 0.1 }), reply(429, { retry_after: 0.1 })]);
  await assert.rejects(createAcademyAccess({ guildId: GUILD, allowedRoleIds: [MONARCH], fetchImpl: twice.fetchImpl, retryRateLimited: true, sleep }).verify('Bearer t'), /discord_member_429/);
  assert.equal(twice.calls.length, 2, 'exactly one retry');
});

test('member vs academy tiers follow memberRoleIds; an admitted role outside it is the academy tier', async () => {
  const fake = discord([
    reply(200, { user: { id: USER }, roles: [STUDENT] }),
    reply(200, { user: { id: USER }, roles: [STUDENT, LIFETIME] }),
    reply(200, { user: { id: USER }, roles: [MONARCH] }),
    reply(200, { user: { id: USER }, roles: [PREMIUM] })
  ]);
  const members = [MANAGER, MONARCH, LIFETIME];
  const access = createAcademyAccess({ guildId: GUILD, allowedRoleIds: [...members, STUDENT], memberRoleIds: members, fetchImpl: fake.fetchImpl });
  assert.deepEqual(await access.verify('Bearer t'), { ok: true, userId: USER, tier: 'academy' });
  assert.deepEqual(await access.verify('Bearer t'), { ok: true, userId: USER, tier: 'member' }, 'lifetime outranks the student role');
  assert.deepEqual(await access.verify('Bearer t'), { ok: true, userId: USER, tier: 'member' });
  assert.equal((await access.verify('Bearer t')).code, 'academy_role_required', 'Premium is not admitted unless configured');
});

test('identityAccess names a caller who is not in the guild; a failed lookup keeps the plain refusal', async () => {
  const notInGuild = discord([reply(404, { code: 10004 })]);
  const identity = { verify: async (authorization) => { assert.equal(authorization, 'Bearer t'); return { ok: true, userId: USER }; } };
  const access = createAcademyAccess({ guildId: GUILD, allowedRoleIds: [MONARCH], fetchImpl: notInGuild.fetchImpl, identityAccess: identity });
  assert.deepEqual(await access.verify('Bearer t'), { ok: false, status: 403, code: 'academy_role_required', inGuild: false, userId: USER });
  const broken = discord([reply(403, {})]);
  const failing = createAcademyAccess({ guildId: GUILD, allowedRoleIds: [MONARCH], fetchImpl: broken.fetchImpl, identityAccess: { verify: async () => { throw new Error('discord down'); } } });
  assert.deepEqual(await failing.verify('Bearer t'), { ok: false, status: 403, code: 'academy_role_required', inGuild: false });
});

test('free preview parsing: the default is module 0 plus lessons 1-10 of module 29, and bad input only shrinks it', () => {
  const gate = createAcademyContentGate({ freePreview: 'M0,M29:1-10' });
  const free = SEED_LESSONS.filter((lesson) => gate.isFreeLesson(lesson.moduleId, lesson.lessonId));
  assert.equal(free.length, 30);
  assert.equal(free.filter((lesson) => lesson.moduleId === 0).length, SEED_LESSONS.filter((lesson) => lesson.moduleId === 0).length);
  assert.deepEqual(free.filter((lesson) => lesson.moduleId === 29).map((lesson) => lesson.lessonId), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(gate.isFreeLesson('29', '11'), false);
  assert.equal(gate.isFreeLesson('0', '1'), true, 'query strings are accepted');
  for (const bad of [null, '', '1.5', 'x', undefined]) assert.equal(gate.isFreeLesson(bad, 1), false);
  assert.deepEqual(parseFreePreview('none'), []);
  assert.deepEqual(parseFreePreview('M5:3, junk, M7:9-2, m2'), [{ moduleId: 5, from: 3, to: 3 }, { moduleId: 2, from: 1, to: Infinity }]);
  const none = createAcademyContentGate({ freePreview: 'none' });
  assert.equal(SEED_LESSONS.some((lesson) => none.isFreeLesson(lesson.moduleId, lesson.lessonId)), false);
});

test('a locked lesson keeps only its title and summary: no steps, example, narration or answers', () => {
  const seed = SEED_LESSONS.find((lesson) => lesson.moduleId === 5 && lesson.lessonId === 1);
  const locked = lockedLesson(seed);
  assert.equal(locked.locked, true);
  assert.equal(locked.title, seed.title);
  assert.equal(locked.description, seed.description);
  assert.equal(locked.question, null);
  assert.equal(locked.example, null);
  assert.equal(locked.exampleIndex, -1);
  assert.deepEqual(locked.parts, [seed.title, LOCKED_TEXT]);
  assert.deepEqual(locked.steps, [LOCKED_TEXT]);
  assert.equal(locked.simulation.rounds.length, 1);
  const text = JSON.stringify(locked);
  for (const step of seed.steps) assert.equal(text.includes(step), false, 'no teaching step leaks');
  assert.equal(text.includes(seed.question.explanation), false, 'no quiz explanation leaks');
  for (const round of seed.simulation.rounds) assert.equal(text.includes(round.explanation), false, 'no lab explanation leaks');
  const gate = createAcademyContentGate({ freePreview: 'M0' });
  const preview = gate.previewLessons(SEED_LESSONS);
  assert.equal(preview.length, SEED_LESSONS.length);
  assert.equal(preview[0], SEED_LESSONS[0], 'a free lesson is passed through unchanged');
  assert.ok(preview.filter((lesson) => lesson.locked).every((lesson) => lesson.moduleId !== 0));
});

test('free symbols and entitled tiers', () => {
  const gate = createAcademyContentGate({ freeSymbols: ['spy', ' QQQ '] });
  assert.deepEqual(gate.freeSymbols, ['SPY', 'QQQ']);
  assert.equal(gate.isFreeSymbol('spy'), true);
  assert.equal(gate.isFreeSymbol('AAPL'), false);
  assert.equal(gate.isFreeSymbol(null), false);
  assert.equal(gate.entitled('member'), true);
  assert.equal(gate.entitled('academy'), true);
  assert.equal(gate.entitled('free'), false);
  assert.equal(gate.entitled('anonymous'), false);
  assert.equal(gate.enabled, false, 'the gate is off unless enabled');
});

test('config: every Academy gate flag is off by default and SML_ACADEMY_MONARCH_ACCESS=0 is honoured', () => {
  const off = getConfig({ DATABASE_URL: 'postgres://x' });
  assert.deepEqual(off.academyAccessRoleIds, []);
  assert.deepEqual(off.academyMemberRoleIds, []);
  assert.equal(off.academyLifetimeRoleId, '');
  assert.equal(off.academyMonarchAccess, true);
  assert.equal(off.academyMonarchRoleId, '1260433215189946420');
  for (const key of ['academyFreeSessions', 'academyContentGateEnabled', 'academyAlertsTiering', 'academyHubRoleGate', 'academyBillingInDiscordLinks']) assert.equal(off[key], false, key);
  assert.equal(off.academyFreePreview, 'M0,M29:1-10');
  assert.deepEqual(off.academyFreeSymbols, ['SPY', 'QQQ']);
  assert.equal(off.academyBillingPublicUrl, '');

  const on = getConfig({
    DATABASE_URL: 'postgres://x',
    SML_ACADEMY_ACCESS_ROLE_IDS: ` ${STUDENT}, not-a-role ,${LIFETIME},${STUDENT}`,
    SML_ACADEMY_MEMBER_ROLE_IDS: `${PREMIUM},1192450618485395466`,
    SML_ACADEMY_BILLING_LIFETIME_ROLE_ID: LIFETIME,
    SML_ACADEMY_MONARCH_ACCESS: '0',
    SML_ACADEMY_FREE_SESSIONS: '1', SML_ACADEMY_CONTENT_GATE_ENABLED: '1', SML_ACADEMY_ALERTS_TIERING: '1',
    SML_ACADEMY_HUB_ROLE_GATE: '1', SML_ACADEMY_BILLING_IN_DISCORD_LINKS: '1',
    SML_ACADEMY_FREE_PREVIEW: 'M0', SML_ACADEMY_FREE_SYMBOLS: 'spy, iwm, $bad',
    SML_ACADEMY_BILLING_PUBLIC_URL: 'https://making-easy-money-academy.onrender.com/some/path'
  });
  assert.deepEqual(on.academyAccessRoleIds, [STUDENT, LIFETIME]);
  assert.deepEqual(on.academyMemberRoleIds, [PREMIUM, '1192450618485395466']);
  assert.equal(on.academyLifetimeRoleId, LIFETIME);
  assert.equal(on.academyMonarchAccess, false);
  assert.equal(on.academyMonarchRoleId, '1260433215189946420', 'the role id itself is unchanged');
  for (const key of ['academyFreeSessions', 'academyContentGateEnabled', 'academyAlertsTiering', 'academyHubRoleGate', 'academyBillingInDiscordLinks']) assert.equal(on[key], true, key);
  assert.equal(on.academyFreePreview, 'M0');
  assert.deepEqual(on.academyFreeSymbols, ['SPY', 'IWM']);
  assert.equal(on.academyBillingPublicUrl, 'https://making-easy-money-academy.onrender.com');

  for (const value of ['1', '', ' 1 ', 'yes']) assert.equal(getConfig({ DATABASE_URL: 'x', SML_ACADEMY_MONARCH_ACCESS: value }).academyMonarchAccess, true, `'${value}' keeps Monarch`);
  assert.equal(getConfig({ DATABASE_URL: 'x', SML_ACADEMY_MONARCH_ACCESS: ' 0 ' }).academyMonarchAccess, false);
  assert.equal(getConfig({ DATABASE_URL: 'x', SML_ACADEMY_FREE_SESSIONS: 'true' }).academyFreeSessions, false, 'only exactly 1 turns a flag on');
  assert.equal(getConfig({ DATABASE_URL: 'x', SML_ACADEMY_BILLING_PUBLIC_URL: 'http://insecure.example' }).academyBillingPublicUrl, '');
  assert.deepEqual(getConfig({ DATABASE_URL: 'x', SML_ACADEMY_FREE_SYMBOLS: '###' }).academyFreeSymbols, ['SPY', 'QQQ']);
});
