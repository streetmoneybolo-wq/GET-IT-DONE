'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createSnapshotService, inspectPng } = require('./academy-snapshot');

function crc32(buf) { let x = 0xffffffff; for (const v of buf) { x ^= v; for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1; } return (x ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, c]); }
function png(w = 640, h = 360) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h, 7);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const ID = '420000000000000042', CH = '444444444444444444', GUILD = '111111111111111111';

test('only a well-formed chart-sized PNG is accepted', () => {
  assert.deepEqual(inspectPng(png(1200, 600)), { width: 1200, height: 600 });
  const good = png();
  assert.equal(inspectPng(Buffer.from('not an image at all, just text that is long enough to pass the length check ....................')), null);
  assert.equal(inspectPng(Buffer.concat([good, Buffer.from('trailing bytes')])), null, 'nothing may follow IEND');
  assert.equal(inspectPng(good.subarray(0, good.length - 12)), null, 'a missing IEND is refused');
  assert.equal(inspectPng(png(100, 100)), null, 'too small to be a chart');
  assert.equal(inspectPng(png(3300, 400)), null, 'too wide');
  assert.equal(inspectPng(png(2000, 300)), null, 'too flat (aspect ratio)');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(500, 1)]);
  assert.equal(inspectPng(jpeg), null);
  assert.equal(inspectPng(Buffer.alloc(3_000_000)), null, 'over the size cap');
  assert.equal(inspectPng(null), null);
});

function fake(opts = {}) {
  const posts = [];
  const o = { userCanSend: true, userCanAttach: true, botCanSend: true, botCanAttach: true, found: true, ...opts };
  const directory = {
    guildsFor: async () => [{ id: GUILD, name: 'S', current: true }], sendableChannels: async () => [{ id: CH, name: 'charts', category: '' }],
    postingIn: async () => (o.found ? { guildId: GUILD, name: 'charts', userCanSend: o.userCanSend, userCanAttach: o.userCanAttach, botCanSend: o.botCanSend, botCanAttach: o.botCanAttach } : null),
    post: async (c, body, files) => { posts.push({ c, body, files }); return { id: '5', channelId: c }; }
  };
  let t = 1_000_000; const svc = createSnapshotService({ directory, now: () => t, limits: opts.limits });
  return { svc, posts, tick: (ms) => { t += ms; } };
}
const user = { userId: ID, displayName: 'Ana' };

test('a snapshot posts as one message with the picture attached, no mentions, and the member named', async () => {
  const { svc, posts } = fake();
  const out = await svc.send(user, { channelId: CH, png: png(), symbol: 'nvda', tf: '5m', note: 'hello @everyone <@1> `x`' });
  assert.equal(out.ok, true); assert.equal(out.channelName, 'charts');
  const p = posts[0];
  assert.deepEqual(p.body.allowed_mentions, { parse: [] });
  assert.match(p.body.content, /^📸 \$NVDA · 5m snapshot — hello/);
  assert.ok(!/@everyone|<@|`/.test(p.body.content.split('\n')[0]), 'the note cannot ping');
  assert.match(p.body.content, /-# Shared by Ana from the Making Easy Money Academy/);
  assert.equal(p.files.length, 1); assert.equal(p.files[0].name, 'nvda-snapshot.png'); assert.equal(p.files[0].contentType, 'image/png'); assert.match(p.files[0].alt, /NVDA 5m chart snapshot/);
});

test('the member name and symbol cannot inject mentions or markdown', async () => {
  const { svc, posts } = fake();
  await svc.send({ userId: ID, displayName: '@everyone **x** <@1>' }, { channelId: CH, png: png(), symbol: '$@everyone<b>', tf: 'bad' });
  const text = posts[0].body.content;
  assert.ok(!/<@|@everyone|\*\*/.test(text), text);
  assert.ok(!/ · bad/.test(text), 'an unknown timeframe is dropped');
});

test('the member and the app must both be able to send and attach in that channel', async () => {
  for (const [opts, code] of [[{ userCanSend: false }, 'you_cannot_post_there'], [{ userCanAttach: false }, 'you_cannot_attach_there'], [{ botCanSend: false }, 'app_cannot_post_there'], [{ botCanAttach: false }, 'app_cannot_post_there'], [{ found: false }, 'channel_unavailable']]) {
    const { svc, posts } = fake(opts);
    const out = await svc.send(user, { channelId: CH, png: png(), symbol: 'SPY', tf: '1D' });
    assert.equal(out.ok, false); assert.equal(out.code, code); assert.equal(posts.length, 0, code);
  }
  assert.equal((await fake().svc.send(user, { channelId: 'x', png: png() })).code, 'invalid_channel');
});

test('anything that is not a chart-sized PNG is refused before the app posts it', async () => {
  const { svc, posts } = fake();
  const out = await svc.send(user, { channelId: CH, png: Buffer.from('GIF89a' + 'x'.repeat(200)), symbol: 'SPY' });
  assert.equal(out.code, 'invalid_image'); assert.equal(out.status, 422); assert.equal(posts.length, 0);
});

test('snapshots are rate limited per member, per day and per channel, and recover with time', async () => {
  const { svc, posts, tick } = fake({ limits: { userHour: 2, userDay: 3, channelHour: 100 } });
  const s = () => svc.send(user, { channelId: CH, png: png(), symbol: 'SPY' });
  assert.equal((await s()).ok, true); assert.equal((await s()).ok, true);
  const limited = await s(); assert.equal(limited.status, 429); assert.equal(limited.code, 'rate_limited');
  tick(3_700_000);
  assert.equal((await s()).ok, true, 'the hourly window moves on');
  const day = await s(); assert.equal(day.status, 429, 'but the daily cap holds'); assert.match(day.detail, /daily/);
  assert.equal(posts.length, 3);
  const chan = fake({ limits: { userHour: 50, userDay: 50, channelHour: 1 } });
  assert.equal((await chan.svc.send(user, { channelId: CH, png: png() })).ok, true);
  assert.match((await chan.svc.send({ userId: '420000000000000043', displayName: 'Bob' }, { channelId: CH, png: png() })).detail, /channel has reached/);
});

test('destinations and channels come from the directory', async () => {
  const { svc } = fake();
  assert.equal((await svc.destinations(ID))[0].id, GUILD);
  assert.equal((await svc.channels(ID, GUILD))[0].name, 'charts');
  assert.equal(await svc.channels(ID, 'nope'), null);
});
