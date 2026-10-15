'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfilePages, cleanSettings, parseOg, LAYOUTS } = require('./academy-profile-pages');

const A = '100000000000000001', B = '100000000000000002', G = '900000000000000009';

test('settings are cleaned: layouts from the list, bounded text, one song with its kind, up to 8 https social links with kinds', () => {
  assert.equal(LAYOUTS.length, 20);
  const s = cleanSettings({ displayName: 'Ana <b>', tagline: 'x'.repeat(200), layout: 'nope', theme: { accent: '#00C47D', fx: 'lasers', font: 'mono', immersive: 'immersive' }, song: { url: 'https://cdn.example.com/track.mp3', title: 'My song' }, socials: [{ url: 'https://x.com/ana' }, 'https://www.instagram.com/ana', 'http://insecure.example.com', 'https://x.com/ana', { url: 'https://stockmarketloop.com/ana/' }], flags: { showPaper: false } });
  assert.equal(s.displayName, 'Ana b'); assert.equal(s.tagline.length, 90); assert.equal(s.layout, 'classic');
  assert.deepEqual(s.theme, { accent: '#00c47d', fx: 'aurora', font: 'mono', immersive: 'immersive' });
  assert.deepEqual(s.song, { url: 'https://cdn.example.com/track.mp3', title: 'My song', kind: 'audio' });
  assert.deepEqual(s.socials.map((x) => x.kind), ['x', 'instagram', 'stockmarketloop']);
  assert.equal(s.flags.showPaper, false);
  assert.equal(cleanSettings({ song: { url: 'https://www.youtube.com/watch?v=abc' } }).song.kind, 'youtube');
  assert.equal(cleanSettings({ song: { url: 'javascript:alert(1)' } }).song, null);
  assert.equal(cleanSettings({ socials: Array.from({ length: 12 }, (_, i) => 'https://site' + i + '.example.com/') }).socials.length, 8);
});

test('open graph title and image come from the page, relative image urls resolve, nothing else is read', () => {
  const og = parseOg('<html><head><title>Fallback</title><meta property="og:title" content="Ana on X &amp; more"><meta content="/img/card.png" property="og:image"><meta property="og:site_name" content="X"></head></html>', 'https://x.com/ana');
  assert.deepEqual(og, { title: 'Ana on X & more', image: 'https://x.com/img/card.png', site: 'X' });
  assert.equal(parseOg('<title>Just a title</title>', 'https://a.example.com/p').title, 'Just a title');
});

function harness() {
  const chatPosts = [{ id: '3', channel: 'day', discordId: A, authorName: 'Ana', body: 'third', createdAt: '2026-10-15T14:00:00Z', score: 2, parentId: null }, { id: '2', channel: 'global', discordId: A, body: 'second', createdAt: '2026-10-15T13:00:00Z', score: 0, parentId: '1' }, { id: '1', channel: 'swing', discordId: A, body: 'first', createdAt: '2026-10-15T12:00:00Z', score: 5, parentId: null }];
  const accounts = new Map([['paper:u:' + A, { cash: 1500, positions: { X: { kind: 'stock', qty: 10, mark: 20 } }, deposits: [{ amount: 1000 }], trades: [{}, {}] }], ['paper:u:' + B, { cash: 900, positions: {}, deposits: [{ amount: 1000 }], trades: [{}] }], ['paper:u:300000000000000003', { cash: 1000, positions: {}, deposits: [{ amount: 1000 }], trades: [] }]]);
  const svc = createProfilePages({
    chat: { byAuthor: async (id, limit) => chatPosts.filter((p) => p.discordId === id).slice(0, limit) },
    paper: { snapshot: async (id) => { const a = accounts.get('paper:' + id); return { createdAt: 1, summary: { equity: 1700, pnl: 700, returnPct: 70, trades: 2, winRate: 0.5 } }; } },
    paperStore: { all: async () => [...accounts.entries()] },
    tierLive: async (id) => (id === A ? 'member' : 'academy'),
    directory: { guild: async (g) => (g === G ? { id: g, name: 'MEM Trading Floor' } : null) },
    fetchImpl: async (url) => ({ ok: true, headers: { get: (k) => (k === 'content-type' ? 'text/html' : null) }, text: async () => '<meta property="og:title" content="Ana (@ana)"><meta property="og:image" content="https://pbs.example.com/ana.jpg">' }),
    now: () => 1_000_000
  });
  return { svc };
}

test('save keeps a link card per social link; the page carries tier, main server, paper rank, follows and the post feed', async () => {
  const { svc } = harness();
  const saved = await svc.save(A, { displayName: 'Ana', layout: 'neon', socials: ['https://x.com/ana'], song: { url: 'https://cdn.example.com/a.mp3', title: 'Track' } });
  assert.equal(saved.ok, true); assert.equal(saved.settings.socials[0].card.title, 'Ana (@ana)'); assert.equal(saved.settings.socials[0].card.image, 'https://pbs.example.com/ana.jpg');
  await svc.beat(A, G); await svc.beat(A, G); // the second beat inside a minute does not count
  assert.equal((await svc.mainServer(A)).minutes, 1);
  await svc.follow(B, A);
  const p = await svc.page(A, B);
  assert.equal(p.settings.layout, 'neon'); assert.equal(p.tier, 'member'); assert.equal(p.tierLabel, 'MEM member');
  assert.deepEqual(p.server, { guildId: G, name: 'MEM Trading Floor', minutes: 1, sharePct: 100, servers: 1 });
  assert.equal(p.paper.rank, 1); assert.equal(p.paper.of, 2, 'accounts with no trades are not ranked');
  assert.equal(p.followers, 1); assert.equal(p.viewerFollows, true); assert.equal(p.own, false);
  assert.deepEqual(p.posts.map((x) => x.body), ['third', 'second', 'first']); assert.equal(p.posts[1].reply, true);
  const c = await svc.card(A, B);
  assert.equal(c.posts.length, 3); assert.equal(c.paper.rank, 1); assert.equal(c.followers, 1); assert.equal(c.server.name, 'MEM Trading Floor');
  const un = await svc.follow(B, A, false); assert.equal(un.followers, 0);
  assert.equal((await svc.follow(A, A)).ok, false, 'no self-follow');
  const lb = await svc.leaderboard(10); assert.deepEqual(lb.map((r) => [r.userId, r.rank, r.returnPct]), [[A, 1, 70], [B, 2, -10]]);
});

test('link images are served only for images the server found itself; audio only for the saved song', async () => {
  const { svc } = harness();
  assert.equal(await svc.linkImage('https://pbs.example.com/other.jpg'), null);
  await svc.save(A, { socials: ['https://x.com/ana'], song: { url: 'https://cdn.example.com/a.mp3' } });
  assert.equal(await svc.audioStream('https://cdn.example.com/b.mp3', A), null);
  assert.equal(await svc.audioStream('https://cdn.example.com/a.mp3', B), null, 'another member cannot proxy it');
});
