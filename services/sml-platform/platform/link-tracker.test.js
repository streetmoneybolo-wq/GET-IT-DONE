'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createLinkTracker, withLinkTracker, destinationFor, cleanUrl, LINK_COMMAND_DEFINITIONS } = require('./link-tracker');
const { scopeCommands } = require('./connect-commands');

/* Minimal in-memory stand-in for the two tables, matching the queries by shape. */
function fakePool() {
  const links = [], clicks = [];
  let linkSeq = 0, clickSeq = 0;
  return {
    links, clicks,
    async query(sql, params = []) {
      if (sql.startsWith('INSERT INTO discord_tracked_links')) {
        const row = { id: String(++linkSeq), guild_id: params[0], channel_id: params[1], url: params[2], label: params[3], created_by: params[4], created_at: new Date().toISOString(), archived_at: null };
        links.push(row); return { rows: [{ id: row.id }] };
      }
      if (sql.startsWith('INSERT INTO discord_link_clicks')) {
        const row = { id: String(++clickSeq), link_id: String(params[0]), guild_id: params[1], discord_user_id: params[2], username: params[3], clicked_at: new Date().toISOString() };
        clicks.push(row); return { rows: [{ id: row.id }] };
      }
      if (sql.startsWith('SELECT id, url, label, archived_at FROM discord_tracked_links') || sql.startsWith('SELECT id, label, url, created_at FROM discord_tracked_links')) {
        return { rows: links.filter((l) => l.id === String(params[0]) && l.guild_id === params[1]) };
      }
      if (sql.startsWith('SELECT COUNT(*)::int AS taps')) {
        const c = clicks.filter((x) => x.link_id === String(params[0]));
        return { rows: [{ taps: c.length, people: new Set(c.map((x) => x.discord_user_id)).size }] };
      }
      if (sql.includes('GROUP BY discord_user_id')) {
        const by = new Map();
        clicks.filter((x) => x.link_id === String(params[0])).forEach((x) => { const r = by.get(x.discord_user_id) || { discord_user_id: x.discord_user_id, username: x.username, taps: 0, last_at: x.clicked_at }; r.taps++; by.set(x.discord_user_id, r); });
        return { rows: [...by.values()] };
      }
      if (sql.includes('FROM discord_tracked_links l LEFT JOIN')) {
        return { rows: links.filter((l) => l.guild_id === params[0]).map((l) => { const c = clicks.filter((x) => x.link_id === l.id); return { ...l, taps: c.length, people: new Set(c.map((x) => x.discord_user_id)).size }; }) };
      }
      if (sql.startsWith('SELECT id, link_id, discord_user_id')) {
        return { rows: clicks.filter((x) => x.guild_id === params[0] && (params.length < 2 || x.link_id === params[1])) };
      }
      throw new Error('unexpected query: ' + sql.slice(0, 60));
    }
  };
}

const GUILD = '938894329076940820';
const manager = { id: '111111111111111111', username: 'owner', global_name: 'Obi' };
const member = { id: '222222222222222222', username: 'trader_joe', global_name: 'Joe' };
const cmd = (name, options, user = manager) => ({ type: 2, id: '1', guild_id: GUILD, channel_id: '333333333333333333', member: { user }, data: { name, options } });
const tap = (id, user = member) => ({ type: 3, id: '2', guild_id: GUILD, member: { user }, data: { custom_id: 'sml_link:c:' + id } });

test('/track-link posts a public message with a button and a disclosure, and stores the link', async () => {
  const pool = fakePool(); const tracker = createLinkTracker({ pool });
  const out = await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://x.com/StockMarketLoop/status/1' }, { name: 'label', value: 'Our launch post' }]));
  assert.equal(out.response.type, 4);
  assert.equal(out.response.data.flags, undefined, 'the post is visible to the channel');
  assert.equal(out.response.data.components[0].components[0].custom_id, 'sml_link:c:1');
  assert.match(out.response.data.embeds[0].footer.text, /records your Discord name/);
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

test('a tap records the member id and username, then replies privately with the real link', async () => {
  const pool = fakePool(); let t = 0; const tracker = createLinkTracker({ pool, now: () => (t += 20_000) });
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://example.com/page' }, { name: 'label', value: 'Page' }]));
  const out = await tracker.handleComponent(tap('1'));
  assert.equal(out.response.data.flags, 64);
  const button = out.response.data.components[0].components[0];
  assert.equal(button.style, 5);
  assert.equal(button.url, 'https://example.com/page', 'external links are not modified');
  assert.equal(pool.clicks.length, 1);
  assert.equal(pool.clicks[0].discord_user_id, member.id);
  assert.equal(pool.clicks[0].username, 'Joe');
});

test('site links carry a click reference so the site tracker can join the visit', () => {
  assert.equal(destinationFor('https://stockmarketloop.com/go/abc?x=1', '42'), 'https://stockmarketloop.com/go/abc?x=1&sml_click=d42');
  assert.equal(destinationFor('https://www.stockmarketloop.com/', '7'), 'https://www.stockmarketloop.com/?sml_click=d7');
  assert.equal(destinationFor('https://evil-stockmarketloop.com.example/', '7'), 'https://evil-stockmarketloop.com.example/');
});

test('button mashing is throttled but the member still gets the link', async () => {
  const pool = fakePool(); const tracker = createLinkTracker({ pool, now: () => 1000 });
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://example.com/' }, { name: 'label', value: 'L' }]));
  for (let i = 0; i < 5; i++) {
    const out = await tracker.handleComponent(tap('1'));
    assert.equal(out.response.data.components[0].components[0].url, 'https://example.com/');
  }
  assert.equal(pool.clicks.length, 2);
});

test('a link from another server cannot be tapped here', async () => {
  const pool = fakePool(); const tracker = createLinkTracker({ pool });
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://example.com/' }, { name: 'label', value: 'L' }]));
  const other = { ...tap('1'), guild_id: '999999999999999999' };
  const out = await tracker.handleComponent(other);
  assert.match(out.response.data.content, /no longer available/);
  assert.equal(pool.clicks.length, 0);
});

test('/link-clicks lists links, then who tapped one with id, name and count', async () => {
  const pool = fakePool(); let t = 0; const tracker = createLinkTracker({ pool, now: () => (t += 20_000) });
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://example.com/' }, { name: 'label', value: 'Launch' }]));
  await tracker.handleComponent(tap('1'));
  await tracker.handleComponent(tap('1', { id: '333333333333333334', username: 'amy' }));
  const list = await tracker.handleCommand(cmd('link-clicks', []));
  assert.match(list.response.data.content, /#1 Launch · 2 people, 2 taps/);
  const detail = await tracker.handleCommand(cmd('link-clicks', [{ name: 'link', value: '1' }]));
  assert.equal(detail.response.data.flags, 64);
  assert.deepEqual(detail.response.data.allowed_mentions, { parse: [] }, 'listing members never pings them');
  assert.match(detail.response.data.content, /<@222222222222222222> · Joe · `222222222222222222` · 1 tap/);
  assert.match(detail.response.data.content, /amy/);
});

test('report() returns links and taps for one server, and rejects bad ids', async () => {
  const pool = fakePool(); let t = 0; const tracker = createLinkTracker({ pool, now: () => (t += 20_000) });
  await tracker.handleCommand(cmd('track-link', [{ name: 'url', value: 'https://example.com/' }, { name: 'label', value: 'L' }]));
  await tracker.handleComponent(tap('1'));
  const r = await tracker.report({ guildId: GUILD });
  assert.equal(r.links.length, 1);
  assert.equal(r.clicks[0].discord_user_id, member.id);
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
  const own = await combined.handleCommand(cmd('link-clicks', []));
  assert.match(own.response.data.content, /No tracked links yet/);
  assert.deepEqual(calls, ['cmd:role-status', 'cmp:sml_connect:uc:yes']);
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
  assert.deepEqual(sent, ['link-clicks']);
});
