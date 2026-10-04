'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CA = require('./academy-click-alert');
const { buildScenarios } = require('./academy-scenarios');
const images = require('./academy-scenario-image');
const { createDiscordDirectory } = require('./academy-alert-sources');

let seed = 11;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function daily(n, price = 100, sigma = 0.018) {
  const out = []; let p = price; const t0 = Date.UTC(2025, 0, 2, 14, 30);
  for (let i = 0; i < n; i++) { const r = 0.0007 + Math.sin(i / 9) * 0.006 + (rnd() - 0.5) * 2 * sigma * 1.5; const o = p, c = p * (1 + r); out.push({ t: t0 + i * 864e5, o, h: Math.max(o, c) * (1 + rnd() * 0.007), l: Math.min(o, c) * (1 - rnd() * 0.007), c, v: 1e6 + rnd() * 5e5 }); p = c; }
  return out;
}
const D = daily(300), last = D[D.length - 1].c;
const bars = { daily: D, weekly: D.filter((_, i) => i % 5 === 4), m5: [], m15: [], fresh: true };
const analyse = (pct) => CA.classify({ symbol: 'DEMO', target: last * (1 + pct), price: last, bars });
const build = (r, series = D) => buildScenarios({ symbol: 'DEMO', side: r.side, entry: r.entry, target: r.target, stop: r.stop, horizon: r.horizon, expectedDays: r.expectedDays, levels: r.levels, series, atr: r.atr });

test('a long gets a base case that ends at the target and a risk case that breaks the stop', () => {
  const r = analyse(0.08), scn = build(r);
  assert.ok(scn && scn.base && scn.risk);
  const b = scn.base.path, k = scn.risk.path;
  assert.equal(b[0].p, r.entry); assert.equal(b[b.length - 1].p, r.target);
  assert.equal(k[0].p, r.entry);
  assert.ok(k[k.length - 1].p < r.stop, 'the risk case ends beyond the stop');
  assert.ok(scn.risk.waypoints.some((w) => w.tag === 'stop' && w.p === r.stop));
  assert.ok(b.every((pt) => pt.i >= scn.window.i0) && b[b.length - 1].i === scn.window.iEnd, 'the paths run from now to the end of the expected time');
  assert.ok(scn.base.bullets.length >= 2 && scn.risk.bullets.length >= 3);
  assert.match(scn.risk.bullets[0], /A close below .* invalidates the setup/);
});

test('a short mirrors it: the base case falls to the target and the risk case breaks upward through the stop', () => {
  const r = analyse(-0.07), scn = build(r);
  assert.equal(r.side, 'short');
  const b = scn.base.path, k = scn.risk.path;
  assert.equal(b[b.length - 1].p, r.target); assert.ok(b[b.length - 1].p < r.entry);
  assert.ok(k[k.length - 1].p > r.stop);
  assert.match(scn.risk.bullets[0], /A close above .* invalidates the setup/);
});

test('the projected part matches the expected time, with a closer view for a short move', () => {
  const quick = build(analyse(0.012)), slow = build(analyse(0.4));
  assert.ok(quick.window.future >= 8 && slow.window.future <= 40);
  assert.ok(quick.window.count < slow.window.count + 1, 'a short path is shown closer in');
  assert.equal(build(analyse(0.08), D.slice(0, 20)), null, 'too little history draws nothing');
});

test('the waypoints and bullets are drawn only from levels the data holds', () => {
  const r = analyse(0.1), scn = build(r);
  for (const w of scn.base.waypoints.filter((x) => x.tag === 'level')) assert.ok(r.levels.some((l) => Math.abs(l.price - w.p) < 0.011), 'a tested level is one of the levels in the way');
  assert.ok(scn.zones.every((z) => z.top > z.bottom));
});

test('each scenario is drawn as a valid SVG with the entry, target, stop, path and disclaimer', () => {
  const r = analyse(0.08), scn = build(r);
  for (const which of ['base', 'risk']) {
    const svg = images.svgFor(scn, which, { horizonLabel: r.horizonLabel });
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
    for (const s of ['ENTRY', 'TARGET', 'STOP', 'DEMO', 'Not a prediction', which === 'risk' ? 'WHAT TO WATCH' : 'WHY THIS PATH', '<polyline']) assert.ok(svg.includes(s), which + ' has ' + s);
    assert.ok(!/NaN|undefined|Infinity/.test(svg), 'no broken numbers: ' + (svg.match(/.{20}(NaN|undefined|Infinity).{20}/) || [''])[0]);
  }
  assert.ok(images.svgFor(scn, 'base').includes('SCENARIO 1'));
  assert.ok(images.svgFor(scn, 'risk').includes('SCENARIO 2'));
});

test('text in the picture is escaped', () => {
  const scn = build(analyse(0.08)); scn.symbol = '<b>&"X'; scn.base.bullets = ['<script>alert(1)</script>'];
  const svg = images.svgFor(scn, 'base');
  assert.ok(!svg.includes('<script>') && !svg.includes('<b>&'));
  assert.ok(svg.includes('&lt;script&gt;'));
});

test('the PNGs are real images when the picture engine is available', { skip: !images.available() }, () => {
  const pair = images.renderPair(build(analyse(0.08)), { horizonLabel: 'Swing trade' });
  assert.equal(pair.length, 2);
  for (const im of pair) {
    assert.ok(im.png && im.png.length > 5000, 'png bytes');
    assert.equal(im.png.slice(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(im.png.readUInt32BE(16), 1200); assert.equal(im.png.readUInt32BE(20), 675);
    assert.match(im.name, /^demo-scenario-[12]-/); assert.ok(im.alt.includes('DEMO'));
  }
  assert.notEqual(pair[0].png.toString('hex'), pair[1].png.toString('hex'));
});

test('renderPair with no scenario returns nothing, and PNGs can be skipped', () => {
  assert.deepEqual(images.renderPair(null), []);
  const pair = images.renderPair(build(analyse(0.08)), {}, { withPng: false });
  assert.equal(pair[0].png, null); assert.ok(pair[0].svg.length > 1000);
});

/* ---------- posting with pictures ---------- */
const ID = '420000000000000042', CH = '444444444444444444', GUILD = '111111111111111111';
test('the directory posts the message and the pictures as one multipart message with alt text', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    if (/\/users\/@me\/guilds/.test(url)) return { ok: true, status: 200, json: async () => [{ id: GUILD, name: 'S' }] };
    if (/\/channels\/\d+$/.test(url) && (!init || !init.method)) return { ok: true, status: 200, json: async () => ({ id: CH, guild_id: GUILD, name: 'alerts', type: 0 }) };
    seen = { url, init }; return { ok: true, status: 200, json: async () => ({ id: '999999999999999999', channel_id: CH }) };
  };
  const dir = createDiscordDirectory({ tokens: [{ label: 'a', token: 'tok' }], fetchImpl });
  const out = await dir.post(CH, { content: 'hello', allowed_mentions: { parse: [] } }, [{ name: 'a.png', bytes: Buffer.from('89504e47', 'hex'), alt: 'First' }, { name: 'b.png', bytes: Buffer.from('89504e47', 'hex'), alt: 'Second' }]);
  assert.equal(out.id, '999999999999999999');
  assert.equal(seen.init.method, 'POST'); assert.ok(seen.init.body instanceof FormData);
  assert.ok(!('content-type' in seen.init.headers), 'the multipart boundary is set by fetch');
  const payload = JSON.parse(seen.init.body.get('payload_json'));
  assert.equal(payload.content, 'hello'); assert.deepEqual(payload.allowed_mentions, { parse: [] });
  assert.deepEqual(payload.attachments, [{ id: 0, filename: 'a.png', description: 'First' }, { id: 1, filename: 'b.png', description: 'Second' }]);
  assert.equal(seen.init.body.get('files[0]').name, 'a.png'); assert.equal(seen.init.body.get('files[1]').name, 'b.png');
  await dir.post(CH, { content: 'plain' });
  assert.equal(seen.init.headers['content-type'], 'application/json'); assert.equal(JSON.parse(seen.init.body).content, 'plain');
});

function fakeService({ userCanAttach = true, botCanAttach = true, png = true } = {}) {
  const posts = [];
  const D2 = D; const m5 = []; 
  const directory = {
    memberRolesLive: async () => ['222222222222222222'], guildsFor: async () => [], sendableChannels: async () => [],
    postingIn: async () => ({ guildId: GUILD, name: 'x', userCanSend: true, botCanSend: true, userCanAttach, botCanAttach, mentionEveryone: false }),
    post: async (c, body, files) => { posts.push({ c, body, files }); return { id: '5', channelId: c }; }
  };
  const svc = CA.createClickAlertService({ getBars: async (sym, tf) => ({ bars: tf === '1D' ? D2 : tf === '1W' ? bars.weekly : m5 }), directory, academyGuildId: GUILD, roleIds: ['222222222222222222'] });
  return { svc, posts };
}
const SEND = { symbol: 'DEMO', target: last * 1.08, channelId: CH };

test('send attaches the two charts when asked and allowed', { skip: !images.available() }, async () => {
  const { svc, posts } = fakeService();
  const out = await svc.send({ userId: ID, displayName: 'Ana' }, SEND);
  assert.equal(out.ok, true); assert.equal(out.imagesAttached, 2); assert.equal(out.imagesSkipped, '');
  assert.equal(posts[0].files.length, 2);
  assert.ok(posts[0].files.every((f) => f.contentType === 'image/png' && f.bytes.slice(0, 4).toString('hex') === '89504e47' && f.alt));
  assert.match(posts[0].body.content, /^@?.*🔥/s, 'the alert text is unchanged');
});

test('the charts are left off, and the alert still posts, without file permission or when declined', async () => {
  for (const [opts, extra, reason] of [[{ userCanAttach: false }, {}, 'no_permission'], [{ botCanAttach: false }, {}, 'no_permission'], [{}, { images: false }, 'declined']]) {
    const { svc, posts } = fakeService(opts);
    const out = await svc.send({ userId: ID, displayName: 'Ana' }, { ...SEND, target: last * (1.08 + Math.random() * 0.01), ...extra });
    assert.equal(out.ok, true, reason); assert.equal(out.imagesAttached, 0); assert.equal(out.imagesSkipped, reason);
    assert.deepEqual(posts[0].files, []);
  }
});

test('the preview carries both scenario pictures for the panel', async () => {
  const { svc } = fakeService();
  const out = await svc.preview(ID, { symbol: 'DEMO', target: last * 1.08 });
  assert.equal(out.ok, true);
  assert.equal(out.scenarios.available, true); assert.equal(out.scenarios.images.length, 2);
  assert.deepEqual(out.scenarios.images.map((i) => i.which), ['base', 'risk']);
  assert.ok(out.scenarios.images.every((i) => i.svg.startsWith('<svg') && i.alt));
  assert.ok(!('__bars' in out.analysis), 'the raw candles are not sent to the browser');
});
