'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { createVerifyGate, withVerifyGate, accountCreatedAt, networkOf, clientIp, RULES_QUIZ } = require('./verify-gate');
const RIGHT = RULES_QUIZ.map((x) => x.a);

function fakePool() {
  const cfgs = new Map(), rows = []; let seq = 0;
  return {
    cfgs, rows,
    async query(sql, p = []) {
      const s = sql.replace(/\s+/g, ' ').trim();
      if (s.startsWith('INSERT INTO discord_verify_config')) { cfgs.set(p[0], { guild_id: p[0], verified_role_id: p[1], log_channel_id: p[2], min_account_days: p[3], mode: p[4], enabled: true }); return { rows: [] }; }
      if (s.startsWith('SELECT * FROM discord_verify_config')) return { rows: cfgs.has(p[0]) ? [cfgs.get(p[0])] : [] };
      if (s.startsWith('DELETE FROM discord_verifications')) return { rows: [] };
      if (s.startsWith('INSERT INTO discord_verifications')) {
        rows.push({ id: String(++seq), guild_id: p[0], discord_user_id: p[1], username: p[2], account_created_at: p[3], token_hash: p[4], token_expires_at: p[5], status: 'pending', flags: [], created_at: new Date() });
        return { rows: [] };
      }
      if (s.startsWith("SELECT status FROM discord_verifications")) {
        const r = rows.filter((x) => x.guild_id === p[0] && x.discord_user_id === p[1] && ['held', 'denied'].includes(x.status)).reverse();
        return { rows: r.slice(0, 1) };
      }
      if (s.startsWith('SELECT * FROM discord_verifications WHERE token_hash')) return { rows: rows.filter((x) => x.token_hash === p[0]) };
      if (s.startsWith('SELECT * FROM discord_verifications WHERE id')) return { rows: rows.filter((x) => x.id === String(p[0]) && x.guild_id === p[1]) };
      if (s.startsWith('SELECT * FROM discord_verifications WHERE guild_id')) return { rows: rows.filter((x) => x.guild_id === p[0] && x.discord_user_id === p[1]).reverse().slice(0, 1) };
      if (s.startsWith('SELECT 1 FROM discord_verifications')) {
        const col = s.match(/AND (\w+)=\$2/)[1];
        return { rows: rows.filter((x) => x.guild_id === p[0] && x[col] === p[1] && x.discord_user_id !== p[2] && ['passed', 'held'].includes(x.status)).slice(0, 1) };
      }
      if (s.startsWith('UPDATE discord_verifications SET status=$2, ip_hash')) {
        const r = rows.find((x) => x.id === p[0]);
        Object.assign(r, { status: p[1], ip_hash: p[2], net_hash: p[3], country: p[4], device_id_hash: p[5], user_agent: p[6], timezone: p[7], languages: p[8], screen: p[9], flags: JSON.parse(p[10]), token_expires_at: new Date(0) });
        return { rows: [] };
      }
      if (s.startsWith('UPDATE discord_verifications SET status=$2, decided_at')) { const r = rows.find((x) => x.id === String(p[0])); r.status = p[1]; r.decided_by = p[2]; return { rows: [] }; }
      if (s.startsWith('UPDATE discord_verifications SET quiz_attempts')) { const r = rows.find((x) => x.id === p[0]); r.quiz_attempts = p[1]; return { rows: [] }; }
      if (s.startsWith('UPDATE discord_verifications SET flags')) { const r = rows.find((x) => x.id === String(p[0])); r.flags = JSON.parse(p[1]); return { rows: [] }; }
      if (s.startsWith('SELECT id, discord_user_id')) return { rows: rows.filter((x) => x.guild_id === p[0]) };
      throw new Error('unexpected query: ' + s.slice(0, 80));
    }
  };
}

const GUILD = '938894329076940820', ROLE = '555555555555555555', LOG = '666666666666666666';
const OLD_USER = '222222222222222222';   // snowflake from 2016 — an old account
const NOW = Date.parse('2026-09-27T12:00:00Z');
const NEW_USER = String(((BigInt(NOW - 2 * 86400000) - 1420070400000n) << 22n)); // two days old
const admin = { user: { id: '111111111111111111', username: 'owner' }, permissions: String((1n << 5n) | (1n << 28n)), roles: [] };
const memberOf = (id, name = 'joe') => ({ user: { id, username: name, global_name: name }, permissions: '0', roles: [] });

function discordFake() {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => { calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null }); return { status: opts.method === 'PUT' ? 204 : 200, json: async () => ({}) }; };
  return { calls, fetchImpl };
}
function setupCmd(opts = {}) {
  return { type: 2, guild_id: GUILD, member: admin, data: { name: 'verify-setup', options: [{ name: 'role', value: ROLE }, { name: 'log_channel', value: LOG }, ...(opts.mode ? [{ name: 'mode', value: opts.mode }] : [])] } };
}
const verifyTap = (member) => ({ type: 3, guild_id: GUILD, member, data: { custom_id: 'sml_verify:start' } });
function tokenFrom(out) { return out.response.data.components[0].components[0].url.split('/verify/')[1]; }

function fakeRequest(method, { headers = {}, body = '' } = {}) {
  const req = new EventEmitter(); req.method = method; req.headers = headers; req.socket = { remoteAddress: '10.0.0.1' };
  return req;
}
function fakeResponse() { const r = { status: 0, headers: null, body: '' }; r.writeHead = (s, h) => { r.status = s; r.headers = h; }; r.end = (b) => { r.body = String(b || ''); }; return r; }
async function visit(gate, token, { method = 'POST', ip = '203.0.113.9', ua = 'Mozilla/5.0 (iPhone)', country = 'US', signals = { answers: RIGHT, deviceId: 'dev-a', timezone: 'America/New_York', languages: 'en-US', screen: '390x844@3', webdriver: false } } = {}) {
  const res = fakeResponse();
  const req = fakeRequest(method, { headers: { 'x-forwarded-for': ip + ', 10.0.0.2', 'user-agent': ua, 'cf-ipcountry': country } });
  await gate.handleHttp(req, res, '/verify/' + token, async () => ({ ok: true, rawBody: JSON.stringify(signals) }));
  return res;
}

test('helpers: account age from a Discord id, network prefix, client IP', () => {
  assert.equal(accountCreatedAt(NEW_USER).toISOString().slice(0, 10), '2026-09-25');
  assert.equal(networkOf('203.0.113.9'), '203.0.113.0/24');
  assert.equal(clientIp({ headers: { 'cf-connecting-ip': '198.51.100.4', 'x-forwarded-for': '1.1.1.1' } }), '198.51.100.4');
});

test('setup posts a public Verify panel and saves the server settings', async () => {
  const pool = fakePool(); const gate = createVerifyGate({ pool, now: () => NOW });
  const out = await gate.handleCommand(setupCmd());
  assert.equal(out.response.data.flags, undefined);
  assert.equal(out.response.data.components[0].components[0].custom_id, 'sml_verify:start');
  assert.deepEqual(pool.cfgs.get(GUILD), { guild_id: GUILD, verified_role_id: ROLE, log_channel_id: LOG, min_account_days: 7, mode: 'auto', enabled: true });
});

test('a clean visit passes: the role is granted, the mod log gets a summary, no raw IP is stored', async () => {
  const pool = fakePool(); const d = discordFake();
  const gate = createVerifyGate({ pool, botToken: 't', secret: 's', fetchImpl: d.fetchImpl, now: () => NOW });
  await gate.handleCommand(setupCmd());
  const out = await gate.handleComponent(verifyTap(memberOf(OLD_USER)));
  assert.equal(out.response.data.flags, 64);
  const token = tokenFrom(out);
  const page = await visit(gate, token, { method: 'GET' });
  assert.match(page.body, /Verify me/);
  assert.match(page.body, /scrambled fingerprint/);
  const res = await visit(gate, token);
  assert.deepEqual(JSON.parse(res.body), { ok: true, status: 'passed' });
  const row = pool.rows[0];
  assert.equal(row.status, 'passed');
  assert.equal(row.country, 'US');
  assert.ok(row.ip_hash && !JSON.stringify(row).includes('203.0.113.9'), 'the raw IP is never stored');
  assert.ok(d.calls.some((c) => c.method === 'PUT' && c.url.endsWith(`/guilds/${GUILD}/members/${OLD_USER}/roles/${ROLE}`)));
  const log = d.calls.find((c) => c.url.endsWith(`/channels/${LOG}/messages`));
  assert.match(log.body.embeds[0].title, /passed/);
  assert.deepEqual(log.body.components, []);
  const again = await visit(gate, token);
  assert.equal(again.status, 410, 'the link works once');
});

test('a second account from the same browser and IP is held with Approve/Deny for mods', async () => {
  const pool = fakePool(); const d = discordFake();
  const gate = createVerifyGate({ pool, botToken: 't', secret: 's', fetchImpl: d.fetchImpl, now: () => NOW });
  await gate.handleCommand(setupCmd());
  await visit(gate, tokenFrom(await gate.handleComponent(verifyTap(memberOf(OLD_USER)))));
  const alt = '333333333333333333';
  const res = await visit(gate, tokenFrom(await gate.handleComponent(verifyTap(memberOf(alt, 'alt')))));
  assert.equal(JSON.parse(res.body).status, 'held');
  const row = pool.rows[1];
  assert.deepEqual(row.flags, ['shared_device', 'shared_ip']);
  assert.equal(d.calls.filter((c) => c.method === 'PUT').length, 1, 'the alt did not get the role');
  const log = d.calls.filter((c) => c.url.endsWith(`/channels/${LOG}/messages`)).pop();
  assert.deepEqual(log.body.components[0].components.map((b) => b.custom_id), ['sml_verify:approve:2', 'sml_verify:deny:2']);
  assert.match(log.body.embeds[0].fields.find((f) => f.name === 'Checks').value, /Same browser/);
  const retry = await gate.handleComponent(verifyTap(memberOf(alt, 'alt')));
  assert.match(retry.response.data.content, /waiting for a moderator/);
});

test('new accounts, Tor and automated browsers are held', async () => {
  const pool = fakePool(); const d = discordFake();
  const gate = createVerifyGate({ pool, botToken: 't', secret: 's', fetchImpl: d.fetchImpl, now: () => NOW });
  await gate.handleCommand(setupCmd());
  await visit(gate, tokenFrom(await gate.handleComponent(verifyTap(memberOf(NEW_USER)))), { ip: '198.51.100.1', country: 'T1', ua: 'Mozilla/5.0 HeadlessChrome/120', signals: { answers: RIGHT, deviceId: 'dev-new', webdriver: true } });
  assert.deepEqual(pool.rows[0].flags, ['account_new', 'tor', 'automation']);
  assert.equal(pool.rows[0].status, 'held');
});

test('mods approve (role granted, message updated) or deny; members without Manage Roles cannot', async () => {
  const pool = fakePool(); const d = discordFake();
  const gate = createVerifyGate({ pool, botToken: 't', secret: 's', fetchImpl: d.fetchImpl, now: () => NOW });
  await gate.handleCommand(setupCmd({ mode: 'review' }));
  await visit(gate, tokenFrom(await gate.handleComponent(verifyTap(memberOf(OLD_USER)))));
  assert.equal(pool.rows[0].status, 'held', 'review mode holds everyone');
  const denied = await gate.handleComponent({ type: 3, guild_id: GUILD, member: memberOf('444444444444444444'), data: { custom_id: 'sml_verify:approve:1' } });
  assert.match(denied.response.data.content, /Manage Roles/);
  const ok = await gate.handleComponent({ type: 3, guild_id: GUILD, member: admin, data: { custom_id: 'sml_verify:approve:1' } });
  assert.equal(ok.response.type, 7);
  assert.deepEqual(ok.response.data.components, []);
  assert.match(ok.response.data.embeds[0].footer.text, /approved by owner/);
  assert.equal(pool.rows[0].status, 'passed');
  assert.ok(d.calls.some((c) => c.method === 'PUT'));
  const twice = await gate.handleComponent({ type: 3, guild_id: GUILD, member: admin, data: { custom_id: 'sml_verify:deny:1' } });
  assert.match(twice.response.data.content, /Already passed/);
});

test('if Discord refuses the role, the visit is held and the reason is shown', async () => {
  const pool = fakePool(); const calls = [];
  const fetchImpl = async (url, opts = {}) => { calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null }); return { status: opts.method === 'PUT' ? 403 : 200, json: async () => ({}) }; };
  const gate = createVerifyGate({ pool, botToken: 't', secret: 's', fetchImpl, now: () => NOW });
  await gate.handleCommand(setupCmd());
  const res = await visit(gate, tokenFrom(await gate.handleComponent(verifyTap(memberOf(OLD_USER)))));
  assert.equal(JSON.parse(res.body).status, 'held');
  assert.deepEqual(pool.rows[0].flags, ['role_grant_failed']);
});

test('expired or unknown links show the expired page', async () => {
  const pool = fakePool(); let t = NOW;
  const gate = createVerifyGate({ pool, now: () => t });
  await gate.handleCommand(setupCmd());
  const token = tokenFrom(await gate.handleComponent(verifyTap(memberOf(OLD_USER))));
  t += 21 * 60 * 1000;
  assert.match((await visit(gate, token, { method: 'GET' })).body, /expired/);
  assert.match((await visit(gate, 'x'.repeat(32), { method: 'GET' })).body, /expired/);
});

test('withVerifyGate routes its commands and buttons and passes the rest through', async () => {
  const gate = createVerifyGate({ pool: fakePool(), now: () => NOW });
  const seen = [];
  const base = { handleCommand: async (i) => { seen.push(i.data.name); return { response: {} }; }, handleComponent: async (i) => { seen.push(i.data.custom_id); return { response: {} }; } };
  const combined = withVerifyGate(base, gate);
  await combined.handleCommand({ data: { name: 'track-link' } });
  await combined.handleComponent({ data: { custom_id: 'sml_link:c:1' } });
  const own = await combined.handleComponent(verifyTap(memberOf(OLD_USER)));
  assert.match(own.response.data.content, /not set up/);
  assert.deepEqual(seen, ['track-link', 'sml_link:c:1']);
});

test('the page asks five yes/no rules questions and still shows the full notice', async () => {
  const gate = createVerifyGate({ pool: fakePool(), now: () => NOW });
  const html = gate.pageHtml({ state: 'form', token: 't' });
  assert.equal((html.match(/type="radio"/g) || []).length, 10);
  assert.match(html, /your IP address, to spot repeat or anonymised accounts/);
  assert.match(html, /scrambled fingerprint/);
});

test('wrong answers get two more tries without using up the link; the third miss is held for a moderator', async () => {
  const pool = fakePool(); const d = discordFake();
  const gate = createVerifyGate({ pool, botToken: 't', secret: 's', fetchImpl: d.fetchImpl, now: () => NOW });
  await gate.handleCommand(setupCmd());
  const token = tokenFrom(await gate.handleComponent(verifyTap(memberOf(OLD_USER))));
  const wrong = { answers: ['no', 'yes', 'no', 'yes', 'no'], deviceId: 'dev-q' };
  const first = JSON.parse((await visit(gate, token, { signals: wrong })).body);
  assert.equal(first.ok, false);
  assert.match(first.message, /2 tries left/);
  assert.equal(pool.rows[0].status, 'pending');
  const second = JSON.parse((await visit(gate, token, { signals: wrong })).body);
  assert.match(second.message, /1 try left/);
  const third = JSON.parse((await visit(gate, token, { signals: wrong })).body);
  assert.equal(third.status, 'held');
  assert.deepEqual(pool.rows[0].flags, ['quiz_failed']);
  assert.equal(d.calls.filter((c) => c.method === 'PUT').length, 0, 'no role after failing the rules questions');
});

test('a missing answer counts as wrong; right answers after a miss still pass', async () => {
  const pool = fakePool(); const d = discordFake();
  const gate = createVerifyGate({ pool, botToken: 't', secret: 's', fetchImpl: d.fetchImpl, now: () => NOW });
  await gate.handleCommand(setupCmd());
  const token = tokenFrom(await gate.handleComponent(verifyTap(memberOf(OLD_USER))));
  const miss = JSON.parse((await visit(gate, token, { signals: { answers: RIGHT.slice(0, 4), deviceId: 'dev-m' } })).body);
  assert.equal(miss.ok, false);
  const ok = JSON.parse((await visit(gate, token, { signals: { answers: RIGHT, deviceId: 'dev-m' } })).body);
  assert.equal(ok.status, 'passed');
});
