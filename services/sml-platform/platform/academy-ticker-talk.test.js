'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('./academy-ticker-talk');

const ME = '123456789012345678', YOU = '223456789012345678', OWNER = '323456789012345678';
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);

test('links are classified: stockmarketloop channels, videos, live streams, letters and articles, YouTube, other news; Discord is refused', () => {
  assert.equal(T.classifyLink('https://stockmarketloop.com/channel/grandmasterobi/'), 'channel');
  assert.equal(T.classifyLink('https://stockmarketloop.com/watch/abc123/'), 'watch');
  assert.equal(T.classifyLink('https://stockmarketloop.com/live/desk/'), 'live');
  assert.equal(T.classifyLink('https://stockmarketloop.com/n/market-letter/'), 'letter');
  assert.equal(T.classifyLink('https://stockmarketloop.com/tcrt/'), 'article');
  assert.equal(T.classifyLink('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'youtube');
  assert.equal(T.classifyLink('https://youtu.be/dQw4w9WgXcQ'), 'youtube');
  assert.equal(T.classifyLink('https://www.reuters.com/markets/us/some-story'), 'link');
  assert.equal(T.classifyLink('https://discord.gg/abc'), 'discord');
  assert.equal(T.classifyLink('https://discord.com/invite/abc'), 'discord');
  assert.equal(T.classifyLink('ftp://x.y/z'), null);
  assert.equal(T.isDiscordLink('https://discordapp.com/channels/1/2'), true);
  assert.equal(T.isDiscordLink('https://notdiscord.com/'), false);
  assert.equal(T.youtubeId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(T.youtubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.deepEqual(T.extractLinks('see https://a.com/x, and https://b.com/y. https://a.com/x again'), ['https://a.com/x', 'https://b.com/y']);
  assert.deepEqual(T.extractCashtags('$NVDA and $amd look good, $spy flat, $$ no, $1234 no'), ['NVDA', 'AMD', 'SPY']);
  assert.equal(T.sniffImage(png), 'image/png');
  assert.equal(T.sniffImage(Buffer.from('<svg></svg>')), '');
});

test('comments, replies, cards, cashtags, mentions and pictures work end to end in memory; Discord links are refused', async () => {
  let t = 1_700_000_000_000;
  const cards = [];
  const talk = T.createTickerTalk({ now: () => (t += 1000), linkCard: async (u) => { cards.push(u); return { title: 'Title for ' + u, image: 'https://img.example/' + cards.length + '.jpg', site: 'stockmarketloop.com' }; } });
  assert.equal(talk.configured, false);
  const pic = await talk.storeImage(ME, png); assert.equal(pic.ok, true); assert.equal(pic.contentType, 'image/png');
  assert.equal((await talk.storeImage(ME, Buffer.from('nope'))).error, 'empty_file');
  assert.equal((await talk.storeImage(ME, Buffer.alloc(300, 7))).error, 'not_an_image');
  const got = await talk.image(pic.id); assert.equal(got.contentType, 'image/png'); assert.equal(got.bytes.length, png.length);

  const bad = await talk.post('spy', { id: ME, name: 'Obi' }, { body: 'join us https://discord.gg/abc' });
  assert.equal(bad.error, 'discord_links_not_allowed');
  const r1 = await talk.post('spy', { id: ME, name: 'Obi' }, { body: '# Gap and go\n$SPY over 580 means $QQQ follows. @Sarah watch https://stockmarketloop.com/watch/abc/ and https://www.youtube.com/watch?v=dQw4w9WgXcQ', imageIds: [pic.id], mentions: [{ id: YOU, name: 'Sarah' }, { id: '999', name: 'Nobody' }, { id: OWNER, name: 'NotInBody' }] });
  assert.equal(r1.ok, true, JSON.stringify(r1));
  const c = r1.comment;
  assert.equal(c.symbol, 'SPY'); assert.equal(c.authorName, 'Obi'); assert.deepEqual(c.tickers, ['SPY', 'QQQ']);
  assert.deepEqual(c.mentions, [{ id: YOU, name: 'Sarah' }], 'only real snowflakes that appear in the text are kept');
  assert.deepEqual(c.images, [pic.id]);
  assert.equal(c.links.length, 2); assert.equal(c.links[0].kind, 'watch'); assert.equal(c.links[0].title, 'Title for https://stockmarketloop.com/watch/abc/');
  assert.equal(c.links[1].kind, 'youtube'); assert.equal(c.links[1].videoId, 'dQw4w9WgXcQ');
  assert.equal((await talk.post('spy', { id: YOU, name: 'Sarah' }, { body: 'reply', parentId: '42' })).error, 'parent_not_found');
  const r2 = await talk.post('spy', { id: YOU, name: 'Sarah' }, { body: 'Watching it.', parentId: c.id });
  assert.equal(r2.ok, true); assert.equal(r2.comment.parentId, c.id);
  assert.equal((await talk.post('spy', { id: OWNER, name: 'O' }, { body: 'reply to a reply', parentId: r2.comment.id })).error, 'parent_not_found', 'one level deep');
  assert.equal((await talk.post('spy', { id: ME, name: 'Obi' }, { body: '', imageIds: [] })).error, 'empty_body');
  assert.equal((await talk.post('spy', { id: YOU, name: 'Sarah' }, { body: 'x', imageIds: [pic.id] })).error, 'image_not_found', 'a member can only attach their own pictures');
  const r3 = await talk.post('spy', { id: ME, name: 'Obi' }, { body: 'Second thought.' });
  await talk.post('qqq', { id: ME, name: 'Obi' }, { body: 'different ticker' });

  const list = await talk.list('SPY', { limit: 10 });
  assert.equal(list.ok, true); assert.equal(list.count, 3); assert.equal(list.hasMore, false);
  assert.deepEqual(list.comments.map((x) => x.id), [r3.comment.id, c.id], 'newest root first');
  assert.deepEqual(list.comments[1].replies.map((x) => x.body), ['Watching it.']);
  assert.equal(await talk.count('SPY'), 3); assert.equal(await talk.count('QQQ'), 1);
  const page = await talk.list('SPY', { limit: 1 }); assert.equal(page.hasMore, true); assert.equal(page.comments.length, 1);
  const older = await talk.list('SPY', { limit: 1, before: page.comments[0].id }); assert.equal(older.comments[0].id, c.id); assert.equal(older.hasMore, false);

  assert.equal((await talk.remove(c.id, YOU)).error, 'forbidden');
  assert.equal((await talk.remove(c.id, OWNER, { elevated: true })).ok, true, 'an Academy owner may remove any comment');
  const after = await talk.list('SPY'); assert.equal(after.count, 1, 'the removed comment and its reply are gone');
  assert.equal((await talk.remove(c.id, ME)).error, 'not_found');
  assert.equal((await talk.remove(r3.comment.id, ME)).ok, true, 'authors remove their own');
});

test('posting is rate limited per member', async () => {
  let t = 1_700_000_000_000;
  const talk = T.createTickerTalk({ now: () => (t += 10), perMinute: 2, perHour: 3 });
  for (let i = 0; i < 2; i++) assert.equal((await talk.post('SPY', { id: ME, name: 'O' }, { body: 'c' + i })).ok, true);
  assert.equal((await talk.post('SPY', { id: ME, name: 'O' }, { body: 'c3' })).error, 'slow_down');
  t += 61_000;
  assert.equal((await talk.post('SPY', { id: ME, name: 'O' }, { body: 'c4' })).ok, true);
  assert.equal((await talk.post('SPY', { id: ME, name: 'O' }, { body: 'c5' })).error, 'too_many_today');
  t += 61_000;
  assert.equal((await talk.post('SPY', { id: ME, name: 'O' }, { body: 'c6' })).error, 'too_many_today');
  assert.equal((await talk.post('SPY', { id: YOU, name: 'S' }, { body: 'other member' })).ok, true);
});

test('with a pool the store reads and writes academy_ticker_talk and academy_ticker_media', async () => {
  const sql = [];
  const pool = { query: async (text, params) => { sql.push({ text, params }); if (/^INSERT INTO academy_ticker_talk/.test(text)) return { rows: [{ id: 5, symbol: params[0], author_id: params[1], author_name: params[2], body: params[3], parent_id: params[4], images: JSON.parse(params[5]), links: JSON.parse(params[6]), mentions: JSON.parse(params[7]), tickers: JSON.parse(params[8]), created_at: new Date(0) }] }; if (/^INSERT INTO academy_ticker_media/.test(text)) return { rows: [{ id: 9 }] }; if (/SELECT author_id FROM academy_ticker_media/.test(text)) return { rows: [{ author_id: ME }] }; if (/count\(\*\)/.test(text)) return { rows: [{ n: 1 }] }; if (/parent_id IS NULL/.test(text)) return { rows: [{ id: 5, symbol: 'SPY', author_id: ME, author_name: 'Obi', body: 'hi $spy', parent_id: null, images: ['9'], links: [], mentions: [], tickers: ['SPY'], created_at: new Date(0) }] }; if (/parent_id = ANY/.test(text)) return { rows: [] }; return { rows: [] }; } };
  const talk = T.createTickerTalk({ pool });
  assert.equal(talk.configured, true);
  await talk.ensureSchema();
  assert.match(sql[0].text, /CREATE TABLE IF NOT EXISTS academy_ticker_talk/);
  const pic = await talk.storeImage(ME, png); assert.equal(pic.id, '9');
  const r = await talk.post('SPY', { id: ME, name: 'Obi' }, { body: 'hi $spy', imageIds: ['9'] });
  assert.equal(r.ok, true); assert.equal(r.comment.id, '5'); assert.deepEqual(r.comment.tickers, ['SPY']); assert.deepEqual(r.comment.images, ['9']);
  const l = await talk.list('SPY'); assert.equal(l.count, 1); assert.equal(l.comments[0].id, '5'); assert.deepEqual(l.comments[0].replies, []);
  assert.match(sql.find((q) => /parent_id IS NULL/.test(q.text)).text, /ORDER BY id DESC LIMIT \$3/);
});

test('byAuthor: one member\'s comments across every ticker, newest first, with reply counts (profile page feed)', async () => {
  let t = 1_700_000_000_000;
  const talk = T.createTickerTalk({ now: () => (t += 1000) });
  const a = await talk.post('SPY', { id: ME, name: 'Obi' }, { body: 'SPY holding 600' });
  await talk.post('NVDA', { id: YOU, name: 'You' }, { body: 'not mine' });
  const b = await talk.post('NVDA', { id: ME, name: 'Obi' }, { body: 'NVDA gap fill' });
  await talk.post('SPY', { id: YOU, name: 'You' }, { body: 'agreed', parentId: a.comment.id });
  const mine = await talk.byAuthor(ME, 7);
  assert.deepEqual(mine.map((c) => [c.symbol, c.body, c.replyCount, c.parentId]), [['NVDA', 'NVDA gap fill', 0, null], ['SPY', 'SPY holding 600', 1, null]]);
  const reply = await talk.post('NVDA', { id: ME, name: 'Obi' }, { body: 'my own reply', parentId: b.comment.id });
  const again = await talk.byAuthor(ME, 2);
  assert.equal(again.length, 2); assert.equal(again[0].id, reply.comment.id); assert.equal(again[0].parentId, b.comment.id, 'a reply carries its root');
  assert.deepEqual(await talk.byAuthor('nope'), []);
  const sql = [];
  const pooled = T.createTickerTalk({ pool: { query: async (text, params) => { sql.push({ text, params }); return { rows: [{ id: 3, symbol: 'SPY', author_id: ME, author_name: 'Obi', body: 'x', parent_id: null, images: [], links: [], mentions: [], tickers: [], created_at: new Date(t), reply_count: 2 }] }; } } });
  const rows = await pooled.byAuthor(ME, 7);
  assert.match(sql[0].text, /WHERE t\.author_id = \$1 AND t\.deleted_at IS NULL ORDER BY t\.id DESC LIMIT \$2/); assert.deepEqual(sql[0].params, [ME, 7]);
  assert.equal(rows[0].replyCount, 2);
});
