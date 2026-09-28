'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createLinkTracker, withLinkTracker, destinationFor, cleanUrl, LINK_COMMAND_DEFINITIONS, TOKEN_TTL_MS } = require('./link-tracker');
const { createSignalHasher } = require('./verify-gate');
const { scopeCommands } = require('./connect-commands');

/* Minimal in-memory stand-in for the tables, matching the queries by shape.
   `clock` lets tests move the database's idea of "now" with the tracker's. */
function fakePool(clock = () => Date.now()) {
  const links = [], clicks = [], verifications = [], verifyConfig = new Map();
  let linkSeq = 0, clickSeq = 0;
  const iso = () => new Date(clock()).toISOString();
  const col = (sql) => (sql.match(/(device_id_hash|ip_hash|net_hash)\s*=\s*(\$2|ANY)/) || [])[1];
  const inWindow = (at, sql) => { const m = sql.match(/interval '(\d+) days'/); return !m || (clock() - Date.parse(at)) < Number(m[1]) * 86400000; };
  const grouped = (rows, lastKey) => {
    const by = new Map();
    rows.forEach((x) => { const r = by.get(x.discord_user_id) || { discord_user_id: x.discord_user_id, username: x.username, last_at: x[lastKey] }; by.set(x.discord_user_id, r); });
    return [...by.values()];
  };
  return {
    links, clicks, verifications, verifyConfig,
    async query(sql, params = []) {
      if (sql.startsWith('INSERT INTO discord_tracked_links')) {
        const row = { id: String(++linkSeq), guild_id: params[0], channel_id: params[1], url: params[2], label: params[3], created_by: params[4], created_at: iso(), archived_at: null };
        links.push(row); return { rows: [{ id: row.id }] };
      }
      if (sql.startsWith('INSERT INTO discord_link_clicks')) {
        const row = { id: String(++clickSeq), link_id: String(params[0]), guild_id: params[1], discord_user_id: params[2], username: params[3], token_hash: params[4], clicked_at: iso(),
          opened_at: null, ip_hash: null, net_hash: null, country: null, device_id_hash: null, user_agent: null, timezone: null, languages: null, screen: null, flags: [] };
        clicks.push(row); return { rows: [{ id: row.id }] };
      }
      if (sql.startsWith('SELECT verified_role_id, enabled FROM discord_verify_config')) {
        return { rows: verifyConfig.has(params[0]) ? [verifyConfig.get(params[0])] : [] };
      }
      if (sql.startsWith('SELECT id, url, label, archived_at FROM discord_tracked_links') || sql.startsWith('SELECT id, label, url, created_at FROM discord_tracked_links')) {
        return { rows: links.filter((l) => l.id === String(params[0]) && l.guild_id === params[1]) };
      }
      if (sql.startsWith('UPDATE discord_link_clicks SET token_hash=NULL')) return { rows: [] }; // retention sweep
      if (sql.startsWith('SELECT COUNT(*)::int AS taps')) {
        const c = clicks.filter((x) => x.link_id === String(params[0]));
        const shared = new Set(c.filter((x) => x.flags.includes('shared_device') || x.flags.includes('shared_ip')).map((x) => x.discord_user_id)).size;
        return { rows: [{ taps: c.length, people: new Set(c.map((x) => x.discord_user_id)).size, opened: c.filter((x) => x.opened_at).length, shared }] };
      }
      if (sql.includes('FROM discord_link_clicks c JOIN discord_tracked_links l')) {
        const c = clicks.find((x) => x.token_hash === params[0]);
        if (!c) return { rows: [] };
        const l = links.find((x) => x.id === c.link_id);
        return { rows: [{ ...c, url: l.url, archived_at: l.archived_at }] };
      }
      if (sql.startsWith('UPDATE discord_link_clicks SET opened_at=COALESCE')) {
        const c = clicks.find((x) => x.id === String(params[0]));
        c.opened_at = c.opened_at || iso();
        c.ip_hash = c.ip_hash || params[1]; c.net_hash = c.net_hash || params[2]; c.country = c.country || params[3]; c.user_agent = c.user_agent || params[4];
        if (params.length > 5) { c.device_id_hash = params[5]; c.timezone = params[6]; c.languages = params[7]; c.screen = params[8]; c.flags = JSON.parse(params[9]); }
        return { rows: [] };
      }
      if (sql.startsWith('SELECT 1 FROM discord_link_clicks')) {
        const k = col(sql);
        return { rows: clicks.filter((x) => x.guild_id === params[0] && x[k] === params[1] && x.discord_user_id !== params[2] && x.opened_at && inWindow(x.opened_at, sql)).slice(0, 1) };
      }
      if (sql.startsWith('SELECT 1 FROM discord_verifications')) {
        const k = col(sql);
        return { rows: verifications.filter((x) => x.guild_id === params[0] && x[k] === params[1] && x.discord_user_id !== params[2] && ['passed', 'held'].includes(x.status) && inWindow(x.submitted_at, sql)).slice(0, 1) };
      }
      if (sql.startsWith('SELECT device_id_hash, ip_hash, net_hash FROM discord_link_clicks')) {
        return { rows: clicks.filter((x) => x.guild_id === params[0] && x.discord_user_id === params[1] && x.opened_at) };
      }
      if (sql.startsWith('SELECT device_id_hash, ip_hash, net_hash FROM discord_verifications')) {
        return { rows: verifications.filter((x) => x.guild_id === params[0] && x.discord_user_id === params[1] && x.submitted_at) };
      }
      if (sql.includes('= ANY($3::text[])') && sql.includes('FROM discord_link_clicks')) {
        const k = col(sql);
        return { rows: grouped(clicks.filter((x) => x.guild_id === params[0] && x.discord_user_id !== params[1] && params[2].includes(x[k])), 'opened_at') };
      }
      if (sql.includes('= ANY($3::text[])') && sql.includes('FROM discord_verifications')) {
        const k = col(sql);
        return { rows: grouped(verifications.filter((x) => x.guild_id === params[0] && x.discord_user_id !== params[1] && params[2].includes(x[k]) && ['passed', 'held'].includes(x.status)), 'submitted_at') };
      }
      if (sql.includes('GROUP BY discord_user_id')) {
        const by = new Map();
        clicks.filter((x) => x.link_id === String(params[0])).forEach((x) => {
          const r = by.get(x.discord_user_id) || { discord_user_id: x.discord_user_id, username: x.username, taps: 0, opened: 0, last_at: x.clicked_at, country: x.country, shared_device: false, shared_ip: false, shared_network: false };
          r.taps++; if (x.opened_at) r.opened++;
          r.shared_device = r.shared_device || x.flags.includes('shared_device'); r.shared_ip = r.shared_ip || x.flags.includes('shared_ip'); r.shared_network = r.shared_network || x.flags.includes('shared_network');
          by.set(x.discord_user_id, r);
        });
        return { rows: [...by.values()] };
      }
      if (sql.includes('FROM discord_tracked_links l LEFT JOIN')) {
        return { rows: links.filter((l) => l.guild_id === params[0]).map((l) => { const c = clicks.filter((x) => x.link_id === l.id); return { ...l, taps: c.length, people: new Set(c.map((x) => x.discord_user_id)).size }; }) };
      }
      if (sql.startsWith('SELECT id, link_id, discord_user_id')) {
        return { rows: clicks.filter((x) => x.guild_id === params[0] && (params.length < 2 || x.link_id === params[1])) };
      }
      throw new Error('unexpected query: ' + sql.slice(0, 80));
    }
  };
}

const GUILD = '938894329076940820';
const ROLE = '939031140679970867';
const BASE = 'https://sml-platform-api.onrender.com';
const manager = { id: '111111111111111111', username: 'owner', global_name: 'Obi' };
const member = { id: '222222222222222222', username: 'trader_joe', global_name: 'Joe' };
const other = { id: '333333333333333334', username: 'amy' };
const cmd = (name, options, user = manager) => ({ type: 2, id: '1', guild_id: GUILD, channel_id: '333333333333333333', member: { user }, data: { name, options } });
const tap = (id, user = member, roles = []) => ({ type: 3, id: '2', guild_id: GUILD, member: { user, roles }, data: { custom_id: 'sml_link:c:' + id } });
const tokenOf = (out) => out.response.data.components[0].components[0].url.split('/l/')[1];

function http(method, path, { ip = '203.0.113.7', ua = 'Mozilla/5.0 (iPhone)', country, body } = {}) {
  const headers = { 'user-agent': ua, 'x-forwarded-for': ip };
  if (country) headers['cf-ipcountry'] = country;
  const request = { method, headers, socket: { remoteAddress: '10.0.0.1' }, body: body ? JSON.stringify(body) : '' };
  const response = { status: 0, headers: {}, body: '', writeHead(status, h) { this.status = status; this.headers = h; }, end(b) { this.body = String(b || ''); } };
  return { request, response, path, readBody: async (req) => ({ ok: true, rawBody: req.body }) };
}
async function open(tracker, token, opts) {
  const g = http('GET', '/l/' + token, opts);
  assert.equal(await tracker.handleHttp(g.request, g.response, g.path, g.readBody), true);
  const p = http('POST', '/l/' + token, opts);
  assert.equal(await tracker.handleHttp(p.request, p.response, p.path, p.readBody), true);
  return { get: g.response, post: p.response };
}

test('/track-link posts a public message with a button and a disclosure, and stores the link', async () => {
  const pool = fakePool(); const tracker = createLinkTracker({ pool });
  const out = await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://x.com/StockMarketLoop/status/1' }, { name: 'label', value: 'Our launch post' }]));
  assert.equal(out.response.type, 4);
  assert.equal(out.response.data.flags, undefined, 'the post is visible to the channel');
  assert.equal(out.response.data.components[0].components[0].custom_id, 'sml_link:c:1');
  assert.match(out.response.data.embeds[0].footer.text, /records your Discord name, connection and device/);
  assert.equal(pool.links[0].url, 'https://x.com/StockMarketLoop/status/1');
  assert.equal(pool.links[0].created_by, manager.id);
});

test('/track-link refuses non-http links', async () => {
  const tracker = createLinkTracker({ pool: fakePool() });
  const out = await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'javascript:alert(1)' }, { name: 'label', value: 'x' }]));
  assert.equal(out.response.data.flags, 64);
  assert.match(out.response.data.content, /not valid/);
  assert.equal(cleanUrl('https://user:pw@example.com/'), null);
});

test('a tap records the member id and username, then replies privately with a one-time hand-off link', async () => {
  const pool = fakePool(); let t = 0; const tracker = createLinkTracker({ pool, now: () => (t += 20_000) });
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://example.com/page' }, { name: 'label', value: 'Page' }]));
  const out = await tracker.handleComponent(tap('1'));
  assert.equal(out.response.data.flags, 64);
  const buttons = out.response.data.components[0].components;
  assert.equal(buttons.length, 1, 'no verify prompt when verification is not set up');
  assert.equal(buttons[0].style, 5);
  assert.match(buttons[0].url, new RegExp('^' + BASE.replace(/\./g, '\\.') + '/l/[A-Za-z0-9_-]{32}$'));
  assert.equal(pool.clicks.length, 1);
  assert.equal(pool.clicks[0].discord_user_id, member.id);
  assert.equal(pool.clicks[0].username, 'Joe');
  assert.match(pool.clicks[0].token_hash, /^[0-9a-f]{64}$/, 'only a hash of the token is stored');
  assert.doesNotMatch(pool.clicks[0].token_hash, new RegExp(tokenOf(out)));
});

test('unverified members are told to verify and get the Verify button next to the link', async () => {
  const pool = fakePool(); let t = 0; const tracker = createLinkTracker({ pool, now: () => (t += 20_000) });
  pool.verifyConfig.set(GUILD, { verified_role_id: ROLE, enabled: true });
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://example.com/page' }, { name: 'label', value: 'Page' }]));
  const unverified = await tracker.handleComponent(tap('1', member, ['1000']));
  const buttons = unverified.response.data.components[0].components;
  assert.equal(buttons.length, 2);
  assert.equal(buttons[1].custom_id, 'sml_verify:start');
  assert.match(unverified.response.data.content, /not verified yet/);
  const verified = await tracker.handleComponent(tap('1', member, ['1000', ROLE]));
  assert.equal(verified.response.data.components[0].components.length, 1);
  assert.doesNotMatch(verified.response.data.content, /not verified/);
  pool.verifyConfig.set(GUILD, { verified_role_id: ROLE, enabled: false });
  t += 60_000;
  const off = await tracker.handleComponent(tap('1', member, []));
  assert.equal(off.response.data.components[0].components.length, 1, 'no prompt while verification is switched off');
});

test('the hand-off page records hashed connection + device signals and sends the browser on', async () => {
  let t = Date.parse('2026-09-28T12:00:00Z');
  const pool = fakePool(() => t); const tracker = createLinkTracker({ pool, now: () => t, secret: 'shh' });
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://stockmarketloop.com/go/abc' }, { name: 'label', value: 'Page' }]));
  t += 20_000;
  const token = tokenOf(await tracker.handleComponent(tap('1')));
  const ip = '203.0.113.7';
  const { get, post } = await open(tracker, token, { ip, country: 'US', body: { deviceId: 'dev-A', timezone: 'America/New_York', languages: 'en-US', screen: '390x844@3' } });
  assert.equal(get.status, 200);
  assert.equal(get.headers['referrer-policy'], 'no-referrer');
  assert.match(get.body, /https:\/\/stockmarketloop\.com\/go\/abc\?sml_click=d1/, 'the page sends the browser to the destination with the click reference');
  assert.match(get.body, /records, for the server team/);
  assert.equal(post.status, 200);
  assert.deepEqual(JSON.parse(post.body), { ok: true, url: 'https://stockmarketloop.com/go/abc?sml_click=d1', flags: 0 });
  const row = pool.clicks[0];
  const hasher = createSignalHasher('shh');
  assert.ok(row.opened_at);
  assert.equal(row.ip_hash, hasher.ipHash(ip), 'same keyed hash as the verification page');
  assert.equal(row.net_hash, hasher.netHash(ip));
  assert.equal(row.device_id_hash, hasher.deviceHash('dev-A'));
  assert.equal(row.country, 'US');
  assert.equal(row.timezone, 'America/New_York');
  assert.deepEqual(row.flags, []);
  assert.ok(!JSON.stringify(row).includes(ip), 'the raw IP address is never stored');
  assert.ok(!JSON.stringify(row).includes('dev-A'), 'the raw device marker is never stored');
  const again = http('GET', '/l/' + token, { ip });
  await tracker.handleHttp(again.request, again.response, again.path, again.readBody);
  assert.equal(again.response.status, 200, 'the link keeps working for the day');
  assert.equal(await tracker.handleHttp(http('GET', '/other').request, http('GET', '/other').response, '/other', async () => ({})), false);
});

test('a device or IP address already seen on another account is flagged, and /link-matches names the accounts', async () => {
  let t = Date.parse('2026-09-28T12:00:00Z');
  const pool = fakePool(() => t); const tracker = createLinkTracker({ pool, now: () => t, secret: 'shh' });
  const hasher = createSignalHasher('shh');
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://example.com/' }, { name: 'label', value: 'Launch' }]));
  t += 20_000;
  await open(tracker, tokenOf(await tracker.handleComponent(tap('1', member))), { ip: '203.0.113.7', body: { deviceId: 'dev-A' } });
  /* a third account verified earlier from the same /24 network */
  pool.verifications.push({ guild_id: GUILD, discord_user_id: '444444444444444444', username: 'carl', status: 'passed', submitted_at: new Date(t - 86400000).toISOString(),
    device_id_hash: hasher.deviceHash('dev-C'), ip_hash: hasher.ipHash('203.0.113.99'), net_hash: hasher.netHash('203.0.113.99') });
  t += 20_000;
  const second = await open(tracker, tokenOf(await tracker.handleComponent(tap('1', other))), { ip: '203.0.113.7', body: { deviceId: 'dev-A', webdriver: true } });
  assert.equal(JSON.parse(second.post.body).flags, 3);
  assert.deepEqual(pool.clicks[1].flags, ['shared_device', 'shared_ip', 'automation']);

  const detail = await tracker.handleCommand(cmd('link-clicks', [{ name: 'link', value: '1' }]));
  assert.match(detail.response.data.content, /2 taps by 2 people, 2 opened/);
  assert.match(detail.response.data.content, /⚠ 1 account shares a device or IP address/);
  assert.match(detail.response.data.content, /<@333333333333333334> · amy · `333333333333333334` · 1 tap · opened · <t:\d+:R> · ⚠ same device, same IP/);

  const matches = await tracker.handleCommand(cmd('link-matches', [{ name: 'member', value: other.id }]));
  assert.equal(matches.response.data.flags, 64);
  assert.deepEqual(matches.response.data.allowed_mentions, { parse: [] });
  assert.match(matches.response.data.content, /Checked 1 device marker, 1 address and 1 network/);
  assert.match(matches.response.data.content, /<@222222222222222222> · Joe · `222222222222222222` · same device, same IP/);
  assert.match(matches.response.data.content, /<@444444444444444444> · carl · `444444444444444444` · same network/);
  const idx = (s) => matches.response.data.content.indexOf(s);
  assert.ok(idx('<@222222222222222222>') < idx('<@444444444444444444>'), 'device matches rank above network matches');

  const nobody = await tracker.handleCommand(cmd('link-matches', [{ name: 'member', value: '555555555555555555' }]));
  assert.match(nobody.response.data.content, /No connection or device records/);
});

test('hand-off links expire after a day and unknown tokens are refused', async () => {
  let t = Date.parse('2026-09-28T12:00:00Z');
  const pool = fakePool(() => t); const tracker = createLinkTracker({ pool, now: () => t });
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://example.com/' }, { name: 'label', value: 'L' }]));
  const token = tokenOf(await tracker.handleComponent(tap('1')));
  t += TOKEN_TTL_MS + 1000;
  const g = http('GET', '/l/' + token);
  await tracker.handleHttp(g.request, g.response, g.path, g.readBody);
  assert.equal(g.response.status, 410);
  assert.match(g.response.body, /expired/);
  const p = http('POST', '/l/' + token, { body: { deviceId: 'x' } });
  await tracker.handleHttp(p.request, p.response, p.path, p.readBody);
  assert.equal(p.response.status, 410);
  assert.equal(pool.clicks[0].opened_at, null, 'nothing is recorded for an expired link');
  const bad = http('GET', '/l/' + 'A'.repeat(32));
  await tracker.handleHttp(bad.request, bad.response, bad.path, bad.readBody);
  assert.equal(bad.response.status, 410);
});

test('site links carry a click reference so the site tracker can join the visit', () => {
  assert.equal(destinationFor('https://stockmarketloop.com/go/abc?x=1', '42'), 'https://stockmarketloop.com/go/abc?x=1&sml_click=d42');
  assert.equal(destinationFor('https://www.stockmarketloop.com/', '7'), 'https://www.stockmarketloop.com/?sml_click=d7');
  assert.equal(destinationFor('https://evil-stockmarketloop.com.example/', '7'), 'https://evil-stockmarketloop.com.example/');
});

test('button mashing is throttled but the member still gets the link', async () => {
  const pool = fakePool(); const tracker = createLinkTracker({ pool, now: () => 1000 });
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://example.com/' }, { name: 'label', value: 'L' }]));
  const urls = [];
  for (let i = 0; i < 5; i++) urls.push((await tracker.handleComponent(tap('1'))).response.data.components[0].components[0].url);
  assert.equal(pool.clicks.length, 2);
  assert.ok(urls.slice(0, 2).every((u) => u.startsWith(BASE + '/l/')));
  assert.deepEqual(urls.slice(2), ['https://example.com/', 'https://example.com/', 'https://example.com/'], 'throttled taps get the plain link');
});

test('a link from another server cannot be tapped here', async () => {
  const pool = fakePool(); const tracker = createLinkTracker({ pool });
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://example.com/' }, { name: 'label', value: 'L' }]));
  const elsewhere = { ...tap('1'), guild_id: '999999999999999999' };
  const out = await tracker.handleComponent(elsewhere);
  assert.match(out.response.data.content, /no longer available/);
  assert.equal(pool.clicks.length, 0);
});

test('/link-clicks lists links, then who tapped one with id, name and count', async () => {
  const pool = fakePool(); let t = 0; const tracker = createLinkTracker({ pool, now: () => (t += 20_000) });
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://example.com/' }, { name: 'label', value: 'Launch' }]));
  await tracker.handleComponent(tap('1'));
  await tracker.handleComponent(tap('1', other));
  const list = await tracker.handleCommand(cmd('link-clicks', []));
  assert.match(list.response.data.content, /#1 Launch · 2 people, 2 taps/);
  const detail = await tracker.handleCommand(cmd('link-clicks', [{ name: 'link', value: '1' }]));
  assert.equal(detail.response.data.flags, 64);
  assert.deepEqual(detail.response.data.allowed_mentions, { parse: [] }, 'listing members never pings them');
  assert.match(detail.response.data.content, /2 taps by 2 people, 0 opened/);
  assert.match(detail.response.data.content, /<@222222222222222222> · Joe · `222222222222222222` · 1 tap · not opened/);
  assert.match(detail.response.data.content, /amy/);
});

test('report() returns links and taps for one server, and rejects bad ids', async () => {
  const pool = fakePool(); let t = 0; const tracker = createLinkTracker({ pool, now: () => (t += 20_000) });
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://example.com/' }, { name: 'label', value: 'L' }]));
  await tracker.handleComponent(tap('1'));
  const r = await tracker.report({ guildId: GUILD });
  assert.equal(r.links.length, 1);
  assert.equal(r.clicks[0].discord_user_id, member.id);
  assert.deepEqual(r.clicks[0].flags, []);
  await assert.rejects(() => tracker.report({ guildId: 'x' }), TypeError);
  await assert.rejects(() => tracker.report({ guildId: GUILD, linkId: '1;drop' }), TypeError);
});

test('withLinkTracker routes its commands and buttons, and passes everything else through', async () => {
  const tracker = createLinkTracker({ pool: fakePool() });
  const calls = [];
  const base = { handleCommand: async (i) => { calls.push('cmd:' + i.data.name); return { response: { type: 4, data: { content: 'base' } } }; },
    handleComponent: async (i) => { calls.push('cmp:' + i.data.custom_id); return { response: { type: 4, data: { content: 'base' } } }; } };
  const combined = withLinkTracker(base, tracker);
  await combined.handleCommand(cmd('role-status', []));
  await combined.handleComponent({ ...tap('1'), data: { custom_id: 'sml_connect:uc:yes' } });
  await combined.handleComponent({ ...tap('1'), data: { custom_id: 'sml_verify:start' } });
  const own = await combined.handleCommand(cmd('link-clicks', []));
  assert.match(own.response.data.content, /No tracked links yet/);
  assert.deepEqual(calls, ['cmd:role-status', 'cmp:sml_connect:uc:yes', 'cmp:sml_verify:start'], 'the Verify button is left to the verify gate');
});

test('scopeCommands now passes button clicks through instead of answering "Unknown command"', async () => {
  const inner = { handleCommand: async () => ({ response: { type: 4, data: { content: 'cmd' } } }), handleComponent: async () => ({ response: { type: 4, data: { content: 'component' } } }) };
  const scoped = scopeCommands(inner, ['role-status']);
  const out = await scoped.handleComponent({ type: 3, data: { custom_id: 'sml_connect:uc:no' } });
  assert.equal(out.response.data.content, 'component');
});

test('registerCommands only sends commands that are missing or changed', async () => {
  const sent = [];
  const existing = [JSON.parse(JSON.stringify(LINK_COMMAND_DEFINITIONS[0]))];
  const fetchImpl = async (url, opts = {}) => {
    if (!opts.method) return { ok: true, status: 200, json: async () => existing };
    sent.push(JSON.parse(opts.body).name); return { ok: true, status: 201 };
  };
  const r = await createLinkTracker({ pool: fakePool() }).registerCommands({ appId: '1537698927401377894', botToken: 't', fetchImpl });
  assert.equal(r.ok, true);
  assert.deepEqual(sent, ['link-clicks', 'link-matches']);
});
