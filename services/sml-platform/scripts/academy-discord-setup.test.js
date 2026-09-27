'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const setup = require('./academy-discord-setup');

const { run, planChannel, sameOverwrites, findStudentRole, parseArgs, PERMISSIONS, ACADEMY_ALLOW, EXIT } = setup;

/* ----------------------------------------------------------------------------
 * Fixture: the owner's guild, scripted
 * ------------------------------------------------------------------------- */

const TOKEN = 'MTU1MTMzNjAzODcxMzEzOTM3MA.FAKE.super-secret-bot-token-value';
const G = '938894329076940820';
const OWNER = '258456581000000001';
const BOT = '1551336038713139370';
const BOT_ROLE = '1551336100000000001';
const MANAGER = '1551336100000000002';
const MONARCH = '1260433215189946420';
const ELITE = '1192450618485395466';
const PREMIUM = '939031140679970867';
const STUDENT = '1551336100000000009';
const NEW_STUDENT = '1551336100000000010';

const CAT_PREMIUM = '1551336200000000001';
const CH_PREMIUM_CHAT = '1551336200000000002';
const CH_PREMIUM_VOICE = '1551336200000000003';
const CH_SIGNALS = '1551336200000000004';
const CH_PREMIUM_NEWS = '1551336200000000005';
const CAT_ACADEMY = '1551448153276944405';
const CH_HUB = '1551459038405992488';
const CH_ACADEMY_VOICE = '1551336200000000006';
const CH_ACADEMY_ADMIN = '1551336200000000007';
const CH_GENERAL = '1551336200000000008';

const VIEW = PERMISSIONS.VIEW_CHANNEL;
const SEND = PERMISSIONS.SEND_MESSAGES;
const HISTORY = PERMISSIONS.READ_MESSAGE_HISTORY;
const CONNECT = PERMISSIONS.CONNECT;
const SPEAK = PERMISSIONS.SPEAK;
const s = (value) => value.toString();

const BOT_PERMS = PERMISSIONS.MANAGE_ROLES | PERMISSIONS.CREATE_INSTANT_INVITE | PERMISSIONS.MANAGE_CHANNELS | PERMISSIONS.VIEW_AUDIT_LOG;

function ow(id, allow, deny = 0n, type = 0) {
  return { id, type, allow: s(allow), deny: s(deny) };
}

function buildRoles({ withStudentRole, studentPosition = 1 }) {
  const roles = [
    { id: G, name: '@everyone', position: 0, permissions: s(VIEW | SEND | HISTORY | CONNECT | SPEAK), managed: false },
    { id: MANAGER, name: 'Manager', position: 12, permissions: s(PERMISSIONS.MANAGE_CHANNELS), managed: false },
    { id: MONARCH, name: 'Monarch', position: 10, permissions: '0', managed: false },
    { id: BOT_ROLE, name: 'Making Easy Money Academy', position: 9, permissions: s(BOT_PERMS), managed: true, tags: { bot_id: BOT } },
    { id: ELITE, name: 'Elite', position: 8, permissions: '0', managed: false },
    { id: PREMIUM, name: 'Premium Member', position: 7, permissions: '0', managed: false }
  ];
  if (withStudentRole) roles.push({ id: STUDENT, name: 'Academy Student', position: studentPosition, permissions: '0', managed: false });
  return roles;
}

function buildChannels({ withStudentRole }) {
  const premiumCategoryOverwrites = [ow(G, 0n, VIEW), ow(PREMIUM, VIEW | HISTORY)];
  const academyCategoryOverwrites = [ow(G, 0n, VIEW), ow(MANAGER, VIEW | SEND | HISTORY)];
  if (withStudentRole) academyCategoryOverwrites.push(ow(STUDENT, VIEW | SEND | HISTORY));
  const newsOverwrites = [ow(PREMIUM, VIEW | HISTORY, SEND)];
  if (withStudentRole) newsOverwrites.push(ow(STUDENT, VIEW | HISTORY, SEND));
  const academyVoiceOverwrites = [ow(G, 0n, VIEW), ow(MANAGER, VIEW | CONNECT | SPEAK)];
  if (withStudentRole) academyVoiceOverwrites.push(ow(STUDENT, VIEW | CONNECT));
  return [
    { id: CAT_PREMIUM, type: 4, name: 'Premium Lounge', parent_id: null, permission_overwrites: premiumCategoryOverwrites.map((o) => ({ ...o })) },
    { id: CH_PREMIUM_CHAT, type: 0, name: 'premium-chat', parent_id: CAT_PREMIUM, permission_overwrites: premiumCategoryOverwrites.map((o) => ({ ...o })) },
    { id: CH_PREMIUM_VOICE, type: 2, name: 'Premium Voice', parent_id: CAT_PREMIUM, permission_overwrites: [ow(G, 0n, VIEW), ow(PREMIUM, VIEW | CONNECT | SPEAK)] },
    { id: CH_SIGNALS, type: 0, name: 'signals', parent_id: null, permission_overwrites: [ow(G, 0n, VIEW), ow(PREMIUM, VIEW | HISTORY, SEND), ow(OWNER, VIEW | SEND, 0n, 1)] },
    { id: CH_PREMIUM_NEWS, type: 0, name: 'premium-news', parent_id: null, permission_overwrites: newsOverwrites },
    { id: CAT_ACADEMY, type: 4, name: 'Academy', parent_id: null, permission_overwrites: academyCategoryOverwrites.map((o) => ({ ...o })) },
    { id: CH_HUB, type: 0, name: 'academy-lessons-live-chart', parent_id: CAT_ACADEMY, permission_overwrites: academyCategoryOverwrites.map((o) => ({ ...o })) },
    { id: CH_ACADEMY_VOICE, type: 2, name: 'Academy Voice', parent_id: CAT_ACADEMY, permission_overwrites: academyVoiceOverwrites },
    { id: CH_ACADEMY_ADMIN, type: 0, name: 'academy-admin', parent_id: CAT_ACADEMY, permission_overwrites: [ow(G, 0n, VIEW), ow(MANAGER, VIEW | SEND | HISTORY | PERMISSIONS.MANAGE_MESSAGES)] },
    { id: CH_GENERAL, type: 0, name: 'general', parent_id: null, permission_overwrites: [] }
  ];
}

const clone = (value) => JSON.parse(JSON.stringify(value));

function jsonResponse(status, body, headers = {}) {
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/**
 * A scripted Discord: state mutates on writes, category PUTs propagate to
 * synced children exactly like the real server, and every call is recorded.
 */
function createFakeDiscord({ withStudentRole = false, studentPosition = 1, existingInvite = false, once429 = null, forbid = [], unauthorized = false, propagate = true } = {}) {
  const state = {
    roles: buildRoles({ withStudentRole, studentPosition }),
    channels: buildChannels({ withStudentRole }),
    invites: [{ code: 'owner-day', inviter: { id: OWNER }, max_age: 86400, max_uses: 0, temporary: false, channel: { id: CH_HUB } }],
    nextRole: 0,
    nextInvite: 0
  };
  if (existingInvite) state.invites.push({ code: 'mem-academy', inviter: { id: BOT }, max_age: 0, max_uses: 0, temporary: false, channel: { id: CH_HUB } });
  const initialChannels = clone(state.channels);
  const calls = [];
  let pending429 = once429 ? { ...once429 } : null;

  function upsert(channel, body, overwriteId) {
    const list = channel.permission_overwrites;
    const index = list.findIndex((entry) => String(entry.id) === overwriteId && Number(entry.type) === Number(body.type));
    const entry = { id: overwriteId, type: Number(body.type), allow: String(body.allow), deny: String(body.deny) };
    if (index >= 0) list[index] = entry; else list.push(entry);
  }

  async function fetchImpl(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const u = new URL(url);
    const p = u.pathname.replace(/^\/api\/v10/, '');
    const body = options.body ? JSON.parse(options.body) : null;
    const headers = options.headers || {};
    calls.push({ method, path: p, body, auth: headers.authorization, reason: headers['x-audit-log-reason'] || null });

    if (unauthorized) return jsonResponse(401, { message: '401: Unauthorized', code: 0 });
    if (pending429 && pending429.method === method && pending429.path === p) {
      pending429 = null;
      return jsonResponse(429, { message: 'You are being rate limited.', retry_after: 0.5, global: false }, { 'retry-after': '1' });
    }
    if (forbid.some((rule) => rule.method === method && rule.path === p)) {
      return jsonResponse(403, { message: 'Missing Permissions', code: 50013 });
    }

    let m;
    if (method === 'GET' && p === '/users/@me') return jsonResponse(200, { id: BOT, username: 'Making Easy Money Academy', bot: true });
    if (method === 'GET' && p === `/guilds/${G}`) return jsonResponse(200, { id: G, name: 'Making Easy Money', owner_id: OWNER });
    if (method === 'GET' && p === `/guilds/${G}/roles`) return jsonResponse(200, clone(state.roles));
    if (method === 'GET' && p === `/guilds/${G}/members/${BOT}`) return jsonResponse(200, { user: { id: BOT }, roles: [BOT_ROLE] });
    if (method === 'GET' && p === `/guilds/${G}/channels`) return jsonResponse(200, clone(state.channels));
    if (method === 'PATCH' && p.startsWith(`/guilds/${G}/roles/`) && /^[0-9]+$/.test(p.slice(`/guilds/${G}/roles/`.length))) {
      const role = state.roles.find((entry) => String(entry.id) === p.slice(`/guilds/${G}/roles/`.length));
      if (!role) return jsonResponse(404, { message: 'Unknown Role', code: 10011 });
      if (body && typeof body.name === 'string') role.name = body.name;
      return jsonResponse(200, clone(role));
    }
    if (method === 'POST' && p === `/guilds/${G}/roles`) {
      state.nextRole += 1;
      const role = { id: NEW_STUDENT, name: body.name, position: 1, permissions: String(body.permissions), color: body.color, hoist: !!body.hoist, mentionable: !!body.mentionable, managed: false };
      state.roles.push(role);
      return jsonResponse(200, clone(role));
    }
    if (method === 'PUT' && (m = p.match(/^\/channels\/(\d+)\/permissions\/(\d+)$/))) {
      const channel = state.channels.find((entry) => entry.id === m[1]);
      if (!channel) return jsonResponse(404, { message: 'Unknown Channel', code: 10003 });
      if (channel.type === 4 && propagate) {
        const before = clone(channel.permission_overwrites);
        const synced = state.channels.filter((entry) => entry.parent_id === channel.id && sameOverwrites(entry.permission_overwrites, before));
        upsert(channel, body, m[2]);
        for (const child of synced) upsert(child, body, m[2]);
      } else {
        upsert(channel, body, m[2]);
      }
      return new Response(null, { status: 204 });
    }
    if (method === 'GET' && (m = p.match(/^\/channels\/(\d+)\/invites$/))) {
      return jsonResponse(200, clone(state.invites.filter((invite) => invite.channel.id === m[1])));
    }
    if (method === 'POST' && (m = p.match(/^\/channels\/(\d+)\/invites$/))) {
      state.nextInvite += 1;
      const invite = { code: `new-invite-${state.nextInvite}`, inviter: { id: BOT }, max_age: body.max_age, max_uses: body.max_uses, temporary: !!body.temporary, channel: { id: m[1] } };
      state.invites.push(invite);
      return jsonResponse(200, clone(invite));
    }
    return jsonResponse(404, { message: 'Unknown route', code: 0 });
  }

  return { fetchImpl, calls, state, initialChannels };
}

async function runSetup(fake, argv = [], env = {}) {
  const out = [];
  const err = [];
  const sleeps = [];
  const result = await run({
    env: { SML_ACADEMY_BOT_TOKEN: TOKEN, ...env },
    argv,
    fetchImpl: fake.fetchImpl,
    sleep: async (ms) => { sleeps.push(ms); },
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text)
  });
  return { ...result, stdout: out.join(''), stderr: err.join(''), sleeps };
}

const writes = (calls) => calls.filter((call) => call.method !== 'GET');
const byResult = (summary) => Object.fromEntries(summary.overwrites.planned.map((entry) => [entry.channelId, entry]));

/* ----------------------------------------------------------------------------
 * Dry run
 * ------------------------------------------------------------------------- */

test('dry run reads the guild, reports permissions and hierarchy, and writes nothing', async () => {
  const fake = createFakeDiscord({ withStudentRole: true });
  const { code, summary, stdout } = await runSetup(fake);

  assert.equal(code, EXIT.OK);
  assert.equal(summary.dryRun, true);
  assert.equal(summary.writes, 0);
  assert.deepEqual(writes(fake.calls), []);
  assert.deepEqual(fake.calls.map((call) => call.path), [
    '/users/@me', `/guilds/${G}`, `/guilds/${G}/roles`, `/guilds/${G}/members/${BOT}`, `/guilds/${G}/channels`, `/channels/${CH_HUB}/invites`
  ]);

  assert.equal(summary.bot.userId, BOT);
  assert.deepEqual(summary.bot.topRole, { id: BOT_ROLE, name: 'Making Easy Money Academy', position: 9, managed: true });
  assert.equal(summary.bot.permissions.bitfield, s(BOT_PERMS | VIEW | SEND | HISTORY | CONNECT | SPEAK));
  assert.deepEqual(summary.bot.permissions.flags, {
    MANAGE_ROLES: true, CREATE_INSTANT_INVITE: true, BAN_MEMBERS: false, MANAGE_CHANNELS: true, VIEW_AUDIT_LOG: true, ADMINISTRATOR: false
  });

  const tiers = Object.fromEntries(summary.tiers.map((tier) => [tier.label, tier]));
  assert.equal(tiers.Monarch.position, 10);
  assert.equal(tiers.Monarch.belowBot, false);
  assert.equal(tiers.Elite.belowBot, true);
  assert.equal(tiers.Premium.belowBot, true);

  assert.ok(summary.warnings.some((w) => /lacks BAN_MEMBERS/.test(w)), 'warns about BAN_MEMBERS');
  assert.ok(summary.warnings.some((w) => /not above Monarch "Monarch" \(position 10\)/.test(w)), 'warns about Monarch above the bot');
  assert.ok(!summary.warnings.some((w) => /Elite|Premium Member/.test(w)), 'no warning for tiers below the bot');
  assert.ok(!summary.warnings.some((w) => /MANAGE_ROLES|CREATE_INSTANT_INVITE/.test(w)));

  assert.deepEqual(summary.studentRole, { id: STUDENT, name: 'Academy Student', position: 1, status: 'existing' });

  const plan = byResult(summary);
  assert.equal(plan[CAT_PREMIUM].result, 'planned');
  assert.equal(plan[CAT_PREMIUM].action, 'copy');
  assert.equal(plan[CAT_PREMIUM].allow, s(VIEW | HISTORY));
  assert.equal(plan[CAT_PREMIUM].deny, '0');
  assert.equal(plan[CH_PREMIUM_CHAT].result, 'follows_category');
  assert.equal(plan[CH_PREMIUM_VOICE].result, 'planned');
  assert.equal(plan[CH_PREMIUM_VOICE].allow, s(VIEW | CONNECT | SPEAK));
  assert.equal(plan[CH_SIGNALS].result, 'planned');
  assert.equal(plan[CH_SIGNALS].deny, s(SEND));
  assert.equal(plan[CH_PREMIUM_NEWS].result, 'skipped_identical');
  assert.equal(plan[CAT_ACADEMY].result, 'planned');
  assert.equal(plan[CAT_ACADEMY].action, 'ensure');
  assert.equal(plan[CAT_ACADEMY].allow, s(ACADEMY_ALLOW));
  assert.equal(plan[CAT_ACADEMY].current.allow, s(VIEW | SEND | HISTORY));
  assert.equal(plan[CH_HUB].result, 'follows_category');
  assert.equal(plan[CH_ACADEMY_VOICE].result, 'planned');
  assert.equal(plan[CH_ACADEMY_VOICE].allow, s(ACADEMY_ALLOW));
  assert.equal(plan[CH_ACADEMY_ADMIN].result, 'private_review');
  assert.equal(plan[CH_GENERAL], undefined);
  assert.equal(summary.overwrites.skipped, 1);
  assert.equal(summary.overwrites.followsCategory, 2);
  assert.equal(summary.overwrites.privateSkipped, 1);

  assert.equal(summary.invite.action, 'would_create');
  assert.equal(summary.invite.url, null);
  assert.match(stdout, /DRY RUN/);
  assert.match(stdout, /PLAN PUT category "Premium Lounge"/);
});

/* ----------------------------------------------------------------------------
 * Apply and idempotency
 * ------------------------------------------------------------------------- */

test('apply creates the role, mirrors overwrites, creates the invite; a second apply makes zero writes', async () => {
  const fake = createFakeDiscord({ withStudentRole: false });
  const first = await runSetup(fake, ['--apply']);

  assert.equal(first.code, EXIT.OK);
  assert.equal(first.summary.dryRun, false);
  assert.deepEqual(first.summary.studentRole, { id: NEW_STUDENT, name: 'Academy Student', position: 1, status: 'created' });

  const roleCreate = fake.calls.find((call) => call.method === 'POST' && call.path === `/guilds/${G}/roles`);
  assert.deepEqual(roleCreate.body, { name: 'Academy Student', permissions: '0', color: 0, hoist: false, mentionable: false });
  assert.ok(roleCreate.reason, 'role create carries an audit-log reason');

  const puts = fake.calls.filter((call) => call.method === 'PUT');
  assert.deepEqual(puts.map((call) => call.path).sort(), [
    `/channels/${CAT_PREMIUM}/permissions/${NEW_STUDENT}`,
    `/channels/${CAT_ACADEMY}/permissions/${NEW_STUDENT}`,
    `/channels/${CH_PREMIUM_VOICE}/permissions/${NEW_STUDENT}`,
    `/channels/${CH_SIGNALS}/permissions/${NEW_STUDENT}`,
    `/channels/${CH_PREMIUM_NEWS}/permissions/${NEW_STUDENT}`
  ].sort());
  /* categories are written before their children, then the channel list is re-read */
  const order = fake.calls.filter((call) => call.method === 'PUT' || (call.method === 'GET' && call.path === `/guilds/${G}/channels`)).map((call) => call.path);
  assert.deepEqual(order.slice(0, 4), [
    `/guilds/${G}/channels`,
    `/channels/${CAT_PREMIUM}/permissions/${NEW_STUDENT}`,
    `/channels/${CAT_ACADEMY}/permissions/${NEW_STUDENT}`,
    `/guilds/${G}/channels`
  ]);
  const put = (id) => puts.find((call) => call.path.startsWith(`/channels/${id}/`)).body;
  assert.deepEqual(put(CAT_PREMIUM), { type: 0, allow: s(VIEW | HISTORY), deny: '0' });
  assert.deepEqual(put(CAT_ACADEMY), { type: 0, allow: s(ACADEMY_ALLOW), deny: '0' });
  assert.deepEqual(put(CH_PREMIUM_VOICE), { type: 0, allow: s(VIEW | CONNECT | SPEAK), deny: '0' });
  assert.deepEqual(put(CH_SIGNALS), { type: 0, allow: s(VIEW | HISTORY), deny: s(SEND) });
  assert.deepEqual(put(CH_PREMIUM_NEWS), { type: 0, allow: s(VIEW | HISTORY), deny: s(SEND) });

  const invitePost = fake.calls.find((call) => call.method === 'POST' && call.path === `/channels/${CH_HUB}/invites`);
  assert.deepEqual(invitePost.body, { max_age: 0, max_uses: 0, temporary: false, unique: false });
  assert.ok(fake.calls.findIndex((call) => call.method === 'GET' && call.path === `/channels/${CH_HUB}/invites`) < fake.calls.indexOf(invitePost), 'lists invites before creating');
  assert.equal(first.summary.invite.action, 'created');
  assert.equal(first.summary.invite.url, 'https://discord.gg/new-invite-1');

  assert.equal(first.summary.writes, 7);
  assert.equal(writes(fake.calls).length, 7);
  assert.equal(first.summary.overwrites.copied, 4);
  assert.equal(first.summary.overwrites.ensured, 1);
  assert.equal(first.summary.overwrites.failed, 0);
  /* synced children were propagated by the category write, so they compare identical */
  const plan = byResult(first.summary);
  assert.equal(plan[CH_PREMIUM_CHAT].result, 'follows_category');
  assert.equal(plan[CH_HUB].result, 'follows_category');
  assert.equal(first.summary.overwrites.followsCategory, 2);
  assert.equal(first.summary.overwrites.skipped, 0);
  assert.equal(plan[CH_ACADEMY_VOICE].result, 'private_review');
  assert.equal(plan[CH_ACADEMY_ADMIN].result, 'private_review');
  assert.ok(!fake.calls.some((call) => call.method === 'DELETE' || call.method === 'PATCH'), 'never deletes or patches');
  assert.ok(puts.every((call) => call.path.endsWith(`/${NEW_STUDENT}`)), 'only the student overwrite is ever written');

  /* every non-student overwrite is byte-for-byte what it was */
  for (const before of fake.initialChannels) {
    const after = fake.state.channels.find((channel) => channel.id === before.id);
    assert.deepEqual(after.permission_overwrites.filter((entry) => entry.id !== NEW_STUDENT), before.permission_overwrites, `${before.name} untouched`);
  }
  const everyone = fake.state.channels.find((channel) => channel.id === CAT_ACADEMY).permission_overwrites.find((entry) => entry.id === G);
  assert.deepEqual(everyone, ow(G, 0n, VIEW));
  assert.ok(first.sleeps.length >= 6, 'writes are spaced by the delay');
  assert.ok(first.sleeps.every((ms) => ms === 350));

  const callsBefore = fake.calls.length;
  const second = await runSetup(fake, ['--apply']);
  assert.equal(second.code, EXIT.OK);
  assert.equal(second.summary.writes, 0);
  assert.deepEqual(writes(fake.calls.slice(callsBefore)), []);
  assert.equal(second.summary.studentRole.status, 'existing');
  assert.equal(second.summary.studentRole.id, NEW_STUDENT);
  assert.equal(second.summary.overwrites.copied + second.summary.overwrites.ensured, 0);
  assert.equal(second.summary.overwrites.skipped, 5);
  assert.equal(second.summary.overwrites.followsCategory, 2);
  assert.equal(second.summary.overwrites.privateSkipped, 2);
  assert.equal(second.summary.invite.action, 'reused');
  assert.equal(second.summary.invite.url, 'https://discord.gg/new-invite-1');
  assert.deepEqual(second.sleeps, []);
});

test('apply with an existing role skips the identical overwrite, upgrades the Academy voice ACL, and reuses the bot invite', async () => {
  const fake = createFakeDiscord({ withStudentRole: true, existingInvite: true });
  const { code, summary } = await runSetup(fake, ['--apply']);

  assert.equal(code, EXIT.OK);
  assert.ok(!fake.calls.some((call) => call.method === 'POST'), 'no role create, no invite create');
  const puts = fake.calls.filter((call) => call.method === 'PUT').map((call) => call.path);
  assert.deepEqual(puts.sort(), [
    `/channels/${CAT_PREMIUM}/permissions/${STUDENT}`,
    `/channels/${CAT_ACADEMY}/permissions/${STUDENT}`,
    `/channels/${CH_PREMIUM_VOICE}/permissions/${STUDENT}`,
    `/channels/${CH_SIGNALS}/permissions/${STUDENT}`,
    `/channels/${CH_ACADEMY_VOICE}/permissions/${STUDENT}`
  ].sort());
  const plan = byResult(summary);
  assert.equal(plan[CH_PREMIUM_NEWS].result, 'skipped_identical');
  assert.equal(plan[CH_ACADEMY_VOICE].result, 'written');
  assert.equal(plan[CH_ACADEMY_VOICE].action, 'ensure');
  assert.equal(plan[CH_ACADEMY_ADMIN].result, 'private_review');
  assert.equal(summary.invite.action, 'reused');
  assert.equal(summary.invite.url, 'https://discord.gg/mem-academy');
  assert.equal(summary.writes, 5);

  const again = await runSetup(fake, ['--apply']);
  assert.equal(again.summary.writes, 0);
});

test('a synced child is re-synced explicitly when Discord does not propagate the category write, never judged private', async () => {
  const fake = createFakeDiscord({ withStudentRole: false, propagate: false });
  const first = await runSetup(fake, ['--apply']);

  assert.equal(first.code, EXIT.OK);
  const puts = fake.calls.filter((call) => call.method === 'PUT');
  assert.deepEqual(puts.map((call) => call.path).sort(), [
    `/channels/${CAT_PREMIUM}/permissions/${NEW_STUDENT}`,
    `/channels/${CH_PREMIUM_CHAT}/permissions/${NEW_STUDENT}`,
    `/channels/${CAT_ACADEMY}/permissions/${NEW_STUDENT}`,
    `/channels/${CH_HUB}/permissions/${NEW_STUDENT}`,
    `/channels/${CH_PREMIUM_VOICE}/permissions/${NEW_STUDENT}`,
    `/channels/${CH_SIGNALS}/permissions/${NEW_STUDENT}`,
    `/channels/${CH_PREMIUM_NEWS}/permissions/${NEW_STUDENT}`
  ].sort());
  const put = (id) => puts.find((call) => call.path.startsWith(`/channels/${id}/`)).body;
  assert.deepEqual(put(CH_HUB), { type: 0, allow: s(ACADEMY_ALLOW), deny: '0' }, 'the hub gets the category values');
  assert.deepEqual(put(CH_PREMIUM_CHAT), { type: 0, allow: s(VIEW | HISTORY), deny: '0' });
  const plan = byResult(first.summary);
  assert.equal(plan[CH_HUB].result, 'written');
  assert.equal(plan[CH_HUB].action, 'ensure');
  assert.equal(plan[CH_HUB].source, 'category');
  assert.equal(plan[CH_PREMIUM_CHAT].result, 'written');
  assert.equal(plan[CH_ACADEMY_ADMIN].result, 'private_review', 'a truly private child is still untouched');
  assert.equal(first.summary.overwrites.followsCategory, 0);
  assert.equal(first.summary.writes, 9);
  assert.ok(puts.every((call) => call.path.endsWith(`/${NEW_STUDENT}`)));

  /* the children now equal their category again, so the second run sees them synced */
  const callsBefore = fake.calls.length;
  const second = await runSetup(fake, ['--apply']);
  assert.equal(second.summary.writes, 0);
  assert.deepEqual(writes(fake.calls.slice(callsBefore)), []);
  assert.equal(byResult(second.summary)[CH_HUB].result, 'follows_category');
  assert.equal(second.summary.overwrites.followsCategory, 2);
});

test('SML_ACADEMY_BILLING_ACADEMY_ROLE_ID pins the student role even when it was renamed', async () => {
  const fake = createFakeDiscord({ withStudentRole: true, existingInvite: true });
  fake.state.roles.find((role) => role.id === STUDENT).name = 'MEM Student';
  const { code, summary } = await runSetup(fake, ['--apply'], { SML_ACADEMY_BILLING_ACADEMY_ROLE_ID: STUDENT });

  assert.equal(code, EXIT.OK);
  assert.ok(!fake.calls.some((call) => call.method === 'POST'), 'no second role is created');
  assert.equal(summary.studentRole.id, STUDENT);
  assert.equal(summary.studentRole.status, 'renamed');
  assert.equal(summary.studentRole.name, 'Academy Student');
  const renames = fake.calls.filter((call) => call.method === 'PATCH');
  assert.deepEqual(renames.map((call) => [call.path, call.body]), [[`/guilds/${G}/roles/${STUDENT}`, { name: 'Academy Student' }]], 'exactly one PATCH, name only, on the pinned role');
  assert.equal(fake.state.roles.find((role) => role.id === STUDENT).name, 'Academy Student');
  assert.ok(fake.calls.filter((call) => call.method === 'PUT').every((call) => call.path.endsWith(`/${STUDENT}`)));
  assert.ok(!summary.warnings.some((w) => /is named "MEM Student"/.test(w)), 'no rename warning once renamed');

  /* a dry run only announces the rename */
  const dry = createFakeDiscord({ withStudentRole: true, existingInvite: true });
  dry.state.roles.find((role) => role.id === STUDENT).name = 'new role';
  const planned = await runSetup(dry, [], { SML_ACADEMY_BILLING_ACADEMY_ROLE_ID: STUDENT });
  assert.equal(planned.code, EXIT.OK);
  assert.ok(!dry.calls.some((call) => call.method === 'PATCH'), 'dry run never patches');
  assert.equal(planned.summary.studentRole.status, 'existing');
  assert.ok(planned.summary.warnings.some((w) => /is named "new role", not "Academy Student"; --apply will rename it/.test(w)));

  /* a second apply after the rename makes no PATCH */
  const again = await runSetup(fake, ['--apply'], { SML_ACADEMY_BILLING_ACADEMY_ROLE_ID: STUDENT });
  assert.equal(again.code, EXIT.OK);
  assert.equal(fake.calls.filter((call) => call.method === 'PATCH').length, 1, 'rename is idempotent');
  assert.deepEqual(summary.engineRoleEnv, { variable: 'SML_ACADEMY_BILLING_ACADEMY_ROLE_ID', configured: STUDENT, expected: STUDENT, inSync: true });

  /* a configured id that is not in the guild falls back to the name with a warning */
  const missing = createFakeDiscord({ withStudentRole: true });
  const fallback = await runSetup(missing, [], { SML_ACADEMY_BILLING_ACADEMY_ROLE_ID: '1551336100000000099' });
  assert.equal(fallback.summary.studentRole.id, STUDENT);
  assert.ok(fallback.summary.warnings.some((w) => /1551336100000000099 is not a usable role/.test(w)));
  assert.equal(fallback.summary.engineRoleEnv.inSync, false);
  assert.match(fallback.stdout, new RegExp(`SML_ACADEMY_BILLING_ACADEMY_ROLE_ID=${STUDENT}`));

  /* @everyone can never be pinned as the student role */
  const everyone = createFakeDiscord({ withStudentRole: true });
  const guarded = await runSetup(everyone, [], { SML_ACADEMY_BILLING_ACADEMY_ROLE_ID: G });
  assert.equal(guarded.summary.studentRole.id, STUDENT);
  assert.ok(guarded.summary.warnings.some((w) => new RegExp(`${G} is not a usable role`).test(w)));
  assert.throws(() => setup.readConfig({ SML_ACADEMY_BOT_TOKEN: 'tok', SML_ACADEMY_BILLING_ACADEMY_ROLE_ID: 'nope' }), /SML_ACADEMY_BILLING_ACADEMY_ROLE_ID/);
});

test('dry run predicts channel-level rejections from the documented rules', async () => {
  /* the fixture bot has no ADMINISTRATOR and no overwrite anywhere: hidden channels are unreachable */
  const fake = createFakeDiscord({ withStudentRole: true });
  const { summary } = await runSetup(fake);
  const plan = byResult(summary);
  assert.equal(plan[CAT_PREMIUM].predicted, 'cannot_view');
  assert.equal(plan[CH_PREMIUM_VOICE].predicted, 'cannot_view');
  assert.equal(plan[CH_SIGNALS].predicted, 'cannot_view');
  assert.equal(plan[CAT_ACADEMY].predicted, 'cannot_view');
  assert.equal(plan[CH_PREMIUM_NEWS].predicted, undefined, 'an identical overwrite is not predicted');
  const warning = summary.warnings.find((w) => /Bot cannot view 5 channel\(s\)/.test(w));
  assert.ok(warning, 'one aggregated warning');
  assert.match(warning, /"Premium Lounge".*"Academy"/);
  assert.match(warning, /Missing Access/);

  /* an allow overwrite for the bot role makes the channel reachable, but the
     Activity/command bits the bot does not hold are still flagged */
  const reachable = createFakeDiscord({ withStudentRole: true });
  reachable.state.channels.find((channel) => channel.id === CAT_ACADEMY).permission_overwrites.push(ow(BOT_ROLE, VIEW));
  const second = await runSetup(reachable);
  const academy = byResult(second.summary)[CAT_ACADEMY];
  assert.equal(academy.predicted, 'missing_bits');
  assert.deepEqual(academy.predictedMissing, ['USE_APPLICATION_COMMANDS', 'USE_EMBEDDED_ACTIVITIES']);
  assert.ok(second.summary.warnings.some((w) => /"Academy" lacks USE_APPLICATION_COMMANDS, USE_EMBEDDED_ACTIVITIES/.test(w)));

  /* a MANAGE_ROLES overwrite for the bot lifts the held-bits rule; ADMINISTRATOR lifts everything */
  const managed = createFakeDiscord({ withStudentRole: true });
  managed.state.channels.find((channel) => channel.id === CAT_ACADEMY).permission_overwrites.push(ow(BOT_ROLE, VIEW | PERMISSIONS.MANAGE_ROLES));
  assert.equal(byResult((await runSetup(managed)).summary)[CAT_ACADEMY].predicted, undefined);
  const admin = createFakeDiscord({ withStudentRole: true });
  admin.state.roles.find((role) => role.id === BOT_ROLE).permissions = s(PERMISSIONS.ADMINISTRATOR);
  const adminRun = await runSetup(admin);
  assert.ok(adminRun.summary.overwrites.planned.every((entry) => entry.predicted === undefined));
  assert.ok(!adminRun.summary.warnings.some((w) => /cannot view|lacks USE_/.test(w)));

  /* a member overwrite denying MANAGE_ROLES is honoured last */
  const denied = createFakeDiscord({ withStudentRole: true });
  denied.state.channels.find((channel) => channel.id === CH_PREMIUM_VOICE).permission_overwrites.push(ow(BOT_ROLE, VIEW), ow(BOT, 0n, PERMISSIONS.MANAGE_ROLES, 1));
  assert.equal(byResult((await runSetup(denied)).summary)[CH_PREMIUM_VOICE].predicted, 'missing_manage_roles');

  /* pure helper: the documented order of application */
  const effective = setup.channelPermissions(
    { permission_overwrites: [ow(G, 0n, VIEW), ow(BOT_ROLE, VIEW | SPEAK, CONNECT), ow(BOT, CONNECT, SPEAK, 1)] },
    { guildId: G, botId: BOT, memberRoleIds: [BOT_ROLE], base: VIEW | CONNECT | SPEAK | PERMISSIONS.MANAGE_ROLES }
  );
  assert.equal(effective.permissions, VIEW | CONNECT | PERMISSIONS.MANAGE_ROLES);
  assert.equal(effective.manageRolesOverwrite, false);
  assert.deepEqual(setup.permissionNames(VIEW | SPEAK | (1n << 50n)), ['VIEW_CHANNEL', 'SPEAK', 'bit 50']);
});

/* ----------------------------------------------------------------------------
 * Rate limits and failures
 * ------------------------------------------------------------------------- */

test('a 429 is retried after retry_after and still counts as one write', async () => {
  const fake = createFakeDiscord({ withStudentRole: true, once429: { method: 'PUT', path: `/channels/${CAT_PREMIUM}/permissions/${STUDENT}` } });
  const { code, summary, sleeps } = await runSetup(fake, ['--apply']);

  assert.equal(code, EXIT.OK);
  const attempts = fake.calls.filter((call) => call.method === 'PUT' && call.path === `/channels/${CAT_PREMIUM}/permissions/${STUDENT}`);
  assert.equal(attempts.length, 2);
  assert.ok(sleeps.includes(500), 'slept for retry_after 0.5s');
  assert.equal(summary.overwrites.failed, 0);
  assert.equal(byResult(summary)[CAT_PREMIUM].result, 'written');
  assert.equal(summary.writes, 6);
});

test('a forbidden write is recorded as failed with a warning and the run continues with exit 0', async () => {
  const fake = createFakeDiscord({ withStudentRole: true, forbid: [{ method: 'PUT', path: `/channels/${CH_SIGNALS}/permissions/${STUDENT}` }] });
  const { code, summary } = await runSetup(fake, ['--apply']);

  assert.equal(code, EXIT.OK);
  assert.equal(summary.overwrites.failed, 1);
  assert.equal(byResult(summary)[CH_SIGNALS].result, 'failed');
  assert.ok(summary.warnings.some((w) => /signals.*403/.test(w)));
  assert.equal(summary.invite.action, 'created', 'later steps still ran');
  assert.equal(summary.writes, 5);
});

test('a rejected token exits non-zero before any write', async () => {
  const fake = createFakeDiscord({ unauthorized: true });
  const { code, summary, stdout } = await runSetup(fake, ['--apply']);

  assert.equal(code, EXIT.AUTH);
  assert.notEqual(code, 0);
  assert.equal(summary.ok, false);
  assert.equal(summary.error.kind, 'unauthorized');
  assert.deepEqual(writes(fake.calls), []);
  assert.match(stdout, /FATAL/);
});

test('missing MANAGE_ROLES and CREATE_INSTANT_INVITE block writes with warnings instead of failing', async () => {
  const fake = createFakeDiscord({ withStudentRole: false });
  fake.state.roles.find((role) => role.id === BOT_ROLE).permissions = s(PERMISSIONS.VIEW_AUDIT_LOG);
  const { code, summary } = await runSetup(fake, ['--apply']);

  assert.equal(code, EXIT.OK);
  assert.deepEqual(writes(fake.calls), []);
  assert.equal(summary.studentRole.status, 'blocked_missing_manage_roles');
  assert.equal(summary.invite.action, 'blocked_missing_permission');
  assert.ok(summary.warnings.some((w) => /lacks MANAGE_ROLES/.test(w)));
  assert.ok(summary.warnings.some((w) => /lacks CREATE_INSTANT_INVITE/.test(w)));
  assert.ok(summary.warnings.some((w) => /lacks BAN_MEMBERS/.test(w)));
});

test('a student role sitting above the bot is warned about', async () => {
  const fake = createFakeDiscord({ withStudentRole: true, studentPosition: 11 });
  const { summary } = await runSetup(fake);
  assert.ok(summary.warnings.some((w) => /"Academy Student" \(position 11\) is not below the bot's top role \(position 9\)/.test(w)));
});

/* ----------------------------------------------------------------------------
 * Secrets and output modes
 * ------------------------------------------------------------------------- */

test('the bot token is used on every request but never appears in stdout or stderr', async () => {
  for (const argv of [[], ['--apply'], ['--apply', '--json']]) {
    const fake = createFakeDiscord({ withStudentRole: false, forbid: [{ method: 'PUT', path: `/channels/${CH_SIGNALS}/permissions/${NEW_STUDENT}` }] });
    const { stdout, stderr, summary } = await runSetup(fake, argv);
    assert.ok(fake.calls.length > 0);
    assert.ok(fake.calls.every((call) => call.auth === `Bot ${TOKEN}`), 'every call is bot-authenticated');
    assert.ok(!stdout.includes(TOKEN), `token leaked to stdout for ${argv.join(' ') || 'dry run'}`);
    assert.ok(!stderr.includes(TOKEN), `token leaked to stderr for ${argv.join(' ') || 'dry run'}`);
    assert.ok(!JSON.stringify(summary).includes(TOKEN), 'token leaked into the summary');
  }
  const unauthorized = createFakeDiscord({ unauthorized: true });
  const failed = await runSetup(unauthorized, ['--json']);
  assert.ok(!failed.stdout.includes(TOKEN) && !failed.stderr.includes(TOKEN));
});

test('--json prints one machine-readable summary on stdout and keeps logs on stderr', async () => {
  const fake = createFakeDiscord({ withStudentRole: true, existingInvite: true });
  const { code, stdout, stderr } = await runSetup(fake, ['--json']);
  assert.equal(code, EXIT.OK);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.dryRun, true);
  assert.equal(parsed.studentRole.id, STUDENT);
  assert.equal(parsed.invite.url, 'https://discord.gg/mem-academy');
  assert.equal(parsed.bot.topRole.position, 9);
  assert.ok(Array.isArray(parsed.warnings));
  assert.match(stderr, /DRY RUN/);
});

test('the redactor also hides a URL-encoded token', () => {
  const redact = setup.createRedactor('abc/def+ghi==');
  assert.equal(redact(`x ${encodeURIComponent('abc/def+ghi==')} y abc/def+ghi== z`), 'x [redacted] y [redacted] z');
});

/* ----------------------------------------------------------------------------
 * CLI entry and configuration
 * ------------------------------------------------------------------------- */

test('CLI without a token exits 1 with a usage message and makes no request', () => {
  const script = path.join(__dirname, 'academy-discord-setup.js');
  const result = spawnSync(process.execPath, [script, '--apply'], { env: { ...process.env, SML_ACADEMY_BOT_TOKEN: '' }, encoding: 'utf8', timeout: 20000 });
  assert.equal(result.status, EXIT.CONFIG);
  assert.match(result.stderr, /SML_ACADEMY_BOT_TOKEN is required/);
  assert.match(result.stderr, /Usage:/);
});

test('argument parsing and config validation', () => {
  assert.deepEqual(parseArgs(['--apply', '--json']), { apply: true, json: true, help: false });
  assert.deepEqual(parseArgs([]), { apply: false, json: false, help: false });
  assert.throws(() => parseArgs(['--force']), /Unknown argument/);
  const cfg = setup.readConfig({ SML_ACADEMY_BOT_TOKEN: ' tok ' });
  assert.equal(cfg.token, 'tok');
  assert.equal(cfg.guildId, '938894329076940820');
  assert.equal(cfg.studentRoleName, 'Academy Student');
  assert.equal(cfg.templateRoleId, PREMIUM);
  assert.equal(cfg.categoryId, CAT_ACADEMY);
  assert.equal(cfg.inviteChannelId, CH_HUB);
  assert.equal(cfg.writeDelayMs, 350);
  assert.throws(() => setup.readConfig({ SML_ACADEMY_BOT_TOKEN: 'tok', SML_ACADEMY_GUILD_ID: 'nope' }), /SML_ACADEMY_GUILD_ID/);
  assert.throws(() => setup.readConfig({ SML_ACADEMY_BOT_TOKEN: 'tok', SML_ACADEMY_WRITE_DELAY_MS: '-1' }), /WRITE_DELAY/);
  const custom = setup.readConfig({ SML_ACADEMY_BOT_TOKEN: 'tok', SML_ACADEMY_STUDENT_ROLE_NAME: 'Scholar', SML_ACADEMY_WRITE_DELAY_MS: '0' });
  assert.equal(custom.studentRoleName, 'Scholar');
  assert.equal(custom.writeDelayMs, 0);
});

/* ----------------------------------------------------------------------------
 * Pure helpers
 * ------------------------------------------------------------------------- */

test('sameOverwrites is order-insensitive and value-sensitive', () => {
  assert.equal(sameOverwrites([ow(G, 0n, VIEW), ow(PREMIUM, VIEW)], [ow(PREMIUM, VIEW), ow(G, 0n, VIEW)]), true);
  assert.equal(sameOverwrites([ow(G, 0n, VIEW)], [ow(G, 0n, VIEW | SEND)]), false);
  assert.equal(sameOverwrites([ow(G, 0n, VIEW)], [ow(G, 0n, VIEW), ow(PREMIUM, VIEW)]), false);
  assert.equal(sameOverwrites([ow(OWNER, VIEW, 0n, 1)], [ow(OWNER, VIEW, 0n, 0)]), false);
  assert.equal(sameOverwrites([], undefined), true);
});

test('planChannel copies the template, ensures Academy bits, and protects private Academy children', () => {
  const roles = buildRoles({ withStudentRole: true });
  const base = { templateRoleId: PREMIUM, studentRoleId: STUDENT, guildId: G, roles };

  assert.equal(planChannel({ id: '1', permission_overwrites: [] }, { ...base, academy: false }), null);

  const copy = planChannel({ id: '1', permission_overwrites: [ow(PREMIUM, VIEW, SEND)] }, { ...base, academy: false });
  assert.equal(copy.action, 'copy');
  assert.equal(copy.allow, VIEW);
  assert.equal(copy.deny, SEND);

  const identical = planChannel({ id: '1', permission_overwrites: [ow(PREMIUM, VIEW, SEND), ow(STUDENT, VIEW, SEND)] }, { ...base, academy: false });
  assert.equal(identical.action, 'identical');

  /* template deny of an Academy bit is overridden inside the Academy */
  const merged = planChannel({ id: CAT_ACADEMY, permission_overwrites: [ow(PREMIUM, VIEW, SEND | PERMISSIONS.MANAGE_CHANNELS)] }, { ...base, academy: 'category' });
  assert.equal(merged.action, 'copy');
  assert.equal(merged.allow, VIEW | ACADEMY_ALLOW);
  assert.equal(merged.deny, PERMISSIONS.MANAGE_CHANNELS);

  const root = planChannel({ id: CAT_ACADEMY, permission_overwrites: [ow(G, 0n, VIEW)] }, { ...base, academy: 'category' });
  assert.equal(root.action, 'ensure');
  assert.equal(root.allow, ACADEMY_ALLOW);

  const privateChild = planChannel({ id: '2', parent_id: CAT_ACADEMY, permission_overwrites: [ow(G, 0n, VIEW), ow(MANAGER, VIEW)] }, { ...base, academy: 'child' });
  assert.equal(privateChild.action, 'private_skipped');

  const openChild = planChannel({ id: '3', parent_id: CAT_ACADEMY, permission_overwrites: [ow(MANAGER, VIEW)] }, { ...base, academy: 'child' });
  assert.equal(openChild.action, 'ensure');
  assert.equal(openChild.allow, ACADEMY_ALLOW);

  const upgraded = planChannel({ id: '4', parent_id: CAT_ACADEMY, permission_overwrites: [ow(G, 0n, VIEW), ow(STUDENT, VIEW, SPEAK)] }, { ...base, academy: 'child' });
  assert.equal(upgraded.action, 'ensure');
  assert.equal(upgraded.allow, ACADEMY_ALLOW);
  assert.equal(upgraded.deny, 0n);
});

test('findStudentRole matches by name case-insensitively and ignores managed roles', () => {
  const roles = [
    { id: '1', name: 'academy student', position: 3, managed: true },
    { id: '2', name: ' Academy Student ', position: 2, managed: false },
    { id: '3', name: 'Academy Student', position: 5, managed: false }
  ];
  const found = findStudentRole(roles, 'Academy Student');
  assert.equal(found.role.id, '2');
  assert.equal(found.duplicates, 2);
  assert.equal(findStudentRole(roles, 'Scholar').role, null);
});

test('isPermanentBotInvite only accepts the bot\'s own permanent invites', () => {
  assert.equal(setup.isPermanentBotInvite({ inviter: { id: BOT }, max_age: 0, max_uses: 0, temporary: false }, BOT), true);
  assert.equal(setup.isPermanentBotInvite({ inviter: { id: OWNER }, max_age: 0, max_uses: 0 }, BOT), false);
  assert.equal(setup.isPermanentBotInvite({ inviter: { id: BOT }, max_age: 3600, max_uses: 0 }, BOT), false);
  assert.equal(setup.isPermanentBotInvite({ inviter: { id: BOT }, max_age: 0, max_uses: 5 }, BOT), false);
  assert.equal(setup.isPermanentBotInvite({ inviter: { id: BOT }, max_age: 0, max_uses: 0, temporary: true }, BOT), false);
  assert.equal(setup.isPermanentBotInvite(null, BOT), false);
});
