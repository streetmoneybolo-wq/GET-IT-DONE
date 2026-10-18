'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfilePages, cleanSettings, parseOg, sniffAudio, LAYOUTS, TEXTURES, DESKS, LIGHTS } = require('./academy-profile-pages');

const A = '100000000000000001', B = '100000000000000002', G = '900000000000000009';

test('settings are cleaned: layouts from the list, bounded text, one song with its kind, up to 8 https social links with kinds', () => {
  assert.equal(LAYOUTS.length, 20);
  const s = cleanSettings({ displayName: 'Ana <b>', tagline: 'x'.repeat(200), layout: 'nope', theme: { accent: '#00C47D', fx: 'lasers', font: 'mono', immersive: 'immersive' }, song: { url: 'https://cdn.example.com/track.mp3', title: 'My song' }, socials: [{ url: 'https://x.com/ana' }, 'https://www.instagram.com/ana', 'http://insecure.example.com', 'https://x.com/ana', { url: 'https://stockmarketloop.com/ana/' }], flags: { showPaper: false } });
  assert.equal(s.displayName, 'Ana b'); assert.equal(s.tagline.length, 90); assert.equal(s.layout, 'classic');
  assert.deepEqual(s.theme, { accent: '#00c47d', fx: 'aurora', fxs: ['aurora'], font: 'mono', immersive: 'immersive' });
  assert.deepEqual(s.song, { url: 'https://cdn.example.com/track.mp3', title: 'My song', kind: 'audio' });
  assert.deepEqual(s.socials.map((x) => x.kind), ['x', 'instagram', 'stockmarketloop']);
  assert.equal(s.flags.showPaper, false);
  for (const link of ['https://www.youtube.com/watch?v=abc', 'https://open.spotify.com/track/abc123', 'https://soundcloud.com/a/b', 'https://music.apple.com/us/album/x/1']) assert.equal(cleanSettings({ song: { url: link } }).song, null, 'links to other sites are not accepted as a song: ' + link);
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

test('look and feel: texture, desk, light and orbs come from the lists; the 3D gallery keeps up to 12 https pictures with optional https links', () => {
  const { ORBS } = require('./academy-profile-pages');
  assert.ok(TEXTURES.size >= 97, 'at least 96 textures besides none');
  assert.ok(DESKS.size >= 44, 'at least 43 desk scenes besides none');
  assert.ok(DESKS.has('nyse-floor') && DESKS.has('paper-desk') && LIGHTS.has('desk-lamp') && ORBS.has('many'));
  const t = cleanSettings({ theme: { texture: 'legal-pad', desk: 'nyse-floor', light: 'golden-hour', orbs: 'few' } }).theme;
  assert.deepEqual([t.texture, t.desk, t.light, t.orbs], ['legal-pad', 'nyse-floor', 'golden-hour', 'few']);
  const bad = cleanSettings({ theme: { texture: 'lava', desk: 'moon', light: 'x', orbs: 'tons' } }).theme;
  assert.deepEqual([bad.texture, bad.desk, bad.light, bad.orbs], ['none', 'none', 'off', 'off']);
  const orbit = cleanSettings({ theme: { orbit: [
    { image: 'https://img.example.com/a.png', href: 'https://stockmarketloop.com/me', title: 'My <b>page</b>' },
    { image: 'https://img.example.com/a.png', href: 'https://dup.example.com/' },
    { image: 'http://insecure.example.com/b.png' }, { image: 'javascript:alert(1)' },
    { image: 'https://img.example.com/c.png', href: 'javascript:alert(1)' },
    ...Array.from({ length: 20 }, (_, i) => ({ image: 'https://img.example.com/p' + i + '.png' }))
  ] } }).theme.orbit;
  assert.equal(orbit.length, 12);
  assert.deepEqual(orbit[0], { image: 'https://img.example.com/a.png', href: 'https://stockmarketloop.com/me', title: 'My bpage/b' });
  assert.equal(orbit[1].href, '', 'a link that is not https is dropped, the picture stays');
  assert.equal(new Set(orbit.map((o) => o.image)).size, 12, 'no duplicate pictures');
});

test('effects stack: several textures, lights and background effects; a texture and a part of the song per module', () => {
  const t = cleanSettings({ theme: { textures: ['leather', 'marble', 'lava', 'leather', 'none', 'oak', 'walnut', 'slate', 'concrete', 'cork-board'], lights: ['desk-lamp', 'neon-sweep', 'off', 'x'], fxs: ['grid', 'stars', 'none', 'nope'], moduleTex: { head: 'brass-plate', feed: 'lava', bogus: 'oak' }, moduleReact: { stats: 'kick', head: 'vocal', feed: 'auto', paper: 'drums' } } }).theme;
  assert.deepEqual(t.textures, ['leather', 'marble', 'oak', 'walnut', 'slate', 'concrete'], 'six at most, no repeats, no unknown ids, "none" skipped');
  assert.equal(t.texture, 'leather');
  assert.deepEqual(t.lights, ['desk-lamp', 'neon-sweep']); assert.equal(t.light, 'desk-lamp');
  assert.deepEqual(t.fxs, ['grid', 'stars']); assert.equal(t.fx, 'grid');
  assert.deepEqual(t.moduleTex, { head: 'brass-plate' });
  assert.deepEqual(t.moduleReact, { stats: 'kick', head: 'vocal' }, 'auto is the default and is not stored');
  const old = cleanSettings({ theme: { texture: 'oak', light: 'spotlight' } }).theme;
  assert.deepEqual([old.textures, old.lights], [['oak'], ['spotlight']], 'a single older choice still works');
  assert.deepEqual(cleanSettings({ theme: { textures: [] } }).theme.textures, []);
});

test('orbit pictures: registered only after the server proves they are pictures; internal hosts refused; allowed again after a restart', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const fetchImpl = async (url) => (String(url).includes('good.example.com') ? { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => png } : { ok: true, headers: { get: () => 'text/html' }, arrayBuffer: async () => png });
  const svc = createProfilePages({ fetchImpl, now: () => 1_000_000 });
  assert.equal((await svc.registerImage('http://good.example.com/a.png', A)).error, 'invalid_url');
  for (const u of ['https://localhost/a.png', 'https://10.0.0.1/a.png', 'https://[::1]/a.png', 'https://db.internal/a.png', 'https://printer.local/a.png']) assert.equal((await svc.registerImage(u, A)).ok, false, u);
  assert.equal((await svc.registerImage('https://page.example.com/x.html', A)).error, 'not_an_image');
  assert.equal(await svc.linkImage('https://page.example.com/x.html'), null, 'a refused link is not left on the allow-list');
  const ok = await svc.registerImage('https://good.example.com/a.png', A);
  assert.deepEqual(ok, { ok: true, url: 'https://good.example.com/a.png' });
  assert.ok(await svc.linkImage('https://good.example.com/a.png'));
  /* a fresh service (a restart) allows the pictures of a saved profile once the profile is read */
  await svc.save(A, { theme: { orbit: [{ image: 'https://good.example.com/a.png', href: 'https://stockmarketloop.com/ana' }] } });
  const again = createProfilePages({ fetchImpl, now: () => 1_000_000 });
  assert.equal(await again.linkImage('https://good.example.com/a.png'), null, 'not before the profile is read');
  /* throttle: 20 checks a minute per member */
  let slow = 0; for (let i = 0; i < 25; i++) if ((await svc.registerImage('https://good.example.com/p' + i + '.png', B)).error === 'slow_down') slow += 1;
  assert.equal(slow, 5);
});

test('the profile desk script is inlined into the Academy page: no backslash, backtick or template placeholder', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'academy-profile-desk.js'), 'utf8');
  assert.equal(src.includes('\\'), false);
  assert.equal(src.includes('`'), false);
  assert.equal(src.includes('${'), false);
  assert.equal(src.includes('</script'), false);
  assert.equal((src.match(/\['[a-z-]+', '[A-Za-z ]+', '#|\['[a-z-]+', '[A-Za-z ]+', 'var/g) || []).length, 96, 'exactly 96 textures');
});

test('the profile music script is inlined into the Academy page, plays only the Academy\'s own audio, and the page frames nothing from other sites', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'academy-profile-music.js'), 'utf8');
  for (const bad of ['\\', '`', '${', '</script']) assert.equal(src.includes(bad), false, 'no ' + bad);
  assert.equal(/iframe|youtube|spotify|soundcloud|embed\.music/i.test(src.replace(/\(Embedded players[^)]*\)/, '')), false, 'no embedded players from other sites');
  const server = require('node:fs').readFileSync(require('node:path').join(__dirname, 'server.js'), 'utf8');
  assert.match(server, /img-src 'self' data:; frame-src 'self'; frame-ancestors/);
  assert.doesNotMatch(server, /youtube-nocookie/);
  assert.match(server, /ACADEMY_PROFILE_DESK \+ ACADEMY_PROFILE_MUSIC \+ ACADEMY_PROFILE_FX \+ ACADEMY_PROFILE_UI/, 'the music player loads before the profile page uses it');
});

test('uploaded songs are recognised by their first bytes, never by name or label', () => {
  const pad = (head, at = 0) => { const b = Buffer.alloc(64); Buffer.from(head, 'latin1').copy(b, at); return b; };
  assert.equal(sniffAudio(pad('ID3')), 'audio/mpeg');
  assert.equal(sniffAudio(Buffer.from([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0, 0, 0, 0, 0, 0])), 'audio/mpeg');
  assert.equal(sniffAudio(pad('ftypM4A ', 4)), 'audio/mp4');
  assert.equal(sniffAudio(pad('OggS')), 'audio/ogg');
  assert.equal(sniffAudio(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVE'), Buffer.alloc(8)])), 'audio/wav');
  assert.equal(sniffAudio(pad('fLaC')), 'audio/flac');
  for (const bad of ['<html><body>hi</body></html>', 'MZ\u0090\u0000 an exe', '%PDF-1.7 not music']) assert.equal(sniffAudio(Buffer.from(bad.padEnd(64, ' '))), '');
  assert.equal(sniffAudio(Buffer.alloc(4)), '');
  const s = cleanSettings({ song: { upload: true, title: 'Mine <b>' } }).song;
  assert.deepEqual(s, { url: '', title: 'Mine b', kind: 'audio', upload: true });
});

test('every desk scene and texture the server accepts is one the page can draw, and the other way round', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'academy-profile-desk.js'), 'utf8');
  const drawnTex = [...src.matchAll(/\n    \['([a-z-]+)', '[A-Za-z ]+', '(?:#[0-9a-f]+|var\(--acc\))'/g)].map((m) => m[1]);
  assert.deepEqual([...drawnTex].sort(), [...TEXTURES].filter((t) => t !== 'none').sort());
  const desks = [...src.matchAll(/\['([a-z-]+)', '([A-Za-z ]+)'\]/g)].map((m) => m[1]).filter((id) => DESKS.has(id));
  for (const id of DESKS) if (id !== 'none') { assert.ok(desks.includes(id), id + ' is listed for the editor'); assert.ok(src.includes("id === '" + id + "'"), id + ' has a scene'); assert.ok(src.includes("'" + id + "': ["), id + ' dresses its modules'); }
});

test('every light the server accepts is drawn by the page and listed in the editor', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'academy-profile-desk.js'), 'utf8');
  assert.ok(LIGHTS.size >= 37, 'at least 36 lights besides off');
  for (const id of LIGHTS) if (id !== 'off') { assert.ok(src.includes("mode === '" + id + "'"), id + ' is drawn'); assert.ok(src.includes("['" + id + "', '"), id + ' is in the editor list'); }
});

test('a song is stored in small pieces and survives a dropped database connection', async () => {
  const meta = new Map(), chunks = [], profiles = new Map(); let failOnce = true, statements = 0, biggest = 0;
  const pool = { query: async (sql, p = []) => {
    statements += 1; for (const x of p) if (Buffer.isBuffer(x)) biggest = Math.max(biggest, x.length);
    if (/INSERT INTO academy_profile_audio_chunks/.test(sql) && failOnce) { failOnce = false; throw new Error('Connection terminated unexpectedly'); }
    if (/^CREATE TABLE|^ALTER TABLE/.test(sql)) return { rows: [] };
    if (/INSERT INTO academy_profile_audio_chunks/.test(sql)) { chunks.push({ id: p[0], version: p[1], idx: p[2], bytes: p[3] }); return { rows: [] }; }
    if (/INSERT INTO academy_profile_audio \(/.test(sql)) { meta.set(p[0], { content_type: p[1], size: p[2], version: p[3] }); return { rows: [] }; }
    if (/DELETE FROM academy_profile_audio_chunks WHERE discord_id=\$1 AND version<>\$2/.test(sql)) { for (let i = chunks.length - 1; i >= 0; i--) if (chunks[i].id === p[0] && chunks[i].version !== p[1]) chunks.splice(i, 1); return { rows: [] }; }
    if (/DELETE FROM academy_profile_audio_chunks WHERE discord_id=\$1 AND version=\$2/.test(sql)) { for (let i = chunks.length - 1; i >= 0; i--) if (chunks[i].id === p[0] && chunks[i].version === p[1]) chunks.splice(i, 1); return { rows: [] }; }
    if (/DELETE FROM academy_profile_audio_chunks/.test(sql)) { for (let i = chunks.length - 1; i >= 0; i--) if (chunks[i].id === p[0]) chunks.splice(i, 1); return { rows: [] }; }
    if (/DELETE FROM academy_profile_audio /.test(sql)) { meta.delete(p[0]); return { rows: [] }; }
    if (/SELECT 1 FROM academy_profile_audio /.test(sql)) return { rows: meta.has(p[0]) ? [{}] : [] };
    if (/SELECT content_type, version FROM academy_profile_audio /.test(sql)) return { rows: meta.has(p[0]) ? [meta.get(p[0])] : [] };
    if (/SELECT bytes FROM academy_profile_audio_chunks/.test(sql)) return { rows: chunks.filter((c) => c.id === p[0] && c.version === p[1]).sort((a, b) => a.idx - b.idx).map((c) => ({ bytes: c.bytes })) };
    if (/SELECT \* FROM academy_profiles/.test(sql)) return { rows: profiles.has(p[0]) ? [profiles.get(p[0])] : [] };
    if (/INSERT INTO academy_profiles/.test(sql)) { profiles.set(p[0], { discord_id: p[0], display_name: p[1], tagline: p[2], bio: p[3], layout: p[4], theme: p[5], song: p[6], socials: p[7], flags: p[8] }); return { rows: [] }; }
    return { rows: [] };
  } };
  const svc = createProfilePages({ pool, logger: () => {} });
  const song = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(700 * 1024, 5)]);
  const r = await svc.uploadAudio(A, song, 'Big one');
  assert.equal(r.ok, true, 'one dropped connection is retried');
  assert.ok(biggest <= 256 * 1024, 'no database statement carries more than 256 KB, got ' + biggest);
  assert.equal(chunks.length, 3, 'a 700 KB song is three pieces');
  const back = await svc.audioStream('', A);
  assert.equal(back.contentType, 'audio/mpeg'); assert.equal(Buffer.compare(back.buffer, song), 0, 'the song comes back byte for byte');
  /* a new upload replaces the old pieces */
  await svc.uploadAudio(A, Buffer.concat([Buffer.from('ID3'), Buffer.alloc(300 * 1024, 9)]), 'Second');
  assert.equal(new Set(chunks.map((c) => c.version)).size, 1, 'only the newest version stays');
  /* a database that keeps failing gives a clear refusal, and leaves no half-stored song behind */
  const dead = createProfilePages({ pool: { query: async (sql) => { if (/INSERT INTO academy_profile_audio_chunks/.test(sql)) throw new Error('Connection terminated unexpectedly'); return { rows: [] }; } }, logger: () => {} });
  const bad = await dead.uploadAudio(B, song, 'Nope');
  assert.deepEqual([bad.ok, bad.error], [false, 'storage_failed']);
});

test('the reactive screen effects: inlined safely, every effect is saveable, and the asked-for names exist', () => {
  const fs = require('node:fs'), path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, 'academy-profile-fx.js'), 'utf8');
  for (const bad of ['\\', '`', '${', '</script']) assert.equal(src.includes(bad), false, 'no ' + bad);
  const { FX } = require('./academy-profile-pages');
  const rows = [...src.matchAll(/^\s*\['([a-z0-9-]+)', '([^']+)', '[A-Za-z]+', '([a-z]+)',/gm)];
  assert.ok(rows.length >= 115, 'at least 115 effects, found ' + rows.length);
  for (const r of rows) assert.ok(FX.has(r[1]), r[1] + ' can be saved');
  const motions = new Set([...src.matchAll(/^    ([a-z]+)\(inst, ctx, F\) \{/gm)].map((m) => m[1]));
  for (const r of rows) assert.ok(motions.has(r[3]), r[1] + ' has a working motion (' + r[3] + ')');
  const labels = new Set(rows.map((r) => r[2].toLowerCase()));
  const asked = ['Rain', 'Waves', 'Quantum', 'Fog', 'Snow', 'Dust', 'Embers', 'Lightning', 'Glitch', 'Energy', 'Money rain', 'Bull run', 'Bear drop', 'Confetti', 'Fireflies', 'Bubbles', 'Meteors', 'Hearts', 'Starfield', 'Notes', 'Candle storm', 'Coin shower', 'Rockets', 'Euro rain', 'Bitcoin rain', 'Pound & yen', 'Percent shower', 'Green candles', 'Red candles', 'Ticker tape', 'Arrow storm', 'To the moon', 'Diamond hands', 'Money bags', 'Bull stampede', 'Bear market', 'Fire', 'Chart rally', 'Hundred club', 'Coin flip', 'Orbiting coins', 'Cherry blossom', 'Autumn leaves', 'Petals', 'Clover luck', 'Blizzard', 'Soft snow', 'Heavy rain', 'Thunder bugs', 'Sunbeams', 'Ocean waves', 'Rainbow drops', 'Leaves drift', 'Warp speed', 'Hyperspace', 'Spiral galaxy', 'Vortex', 'Orbit rings', 'Planets', 'UFO sighting', 'Aliens', 'Comet tails', 'Satellites', 'Matrix code', 'Binary rain', 'Dollar matrix', 'Cyber grid', 'Robots', 'Fireworks', 'Gold confetti', 'Neon confetti', 'Party poppers', 'Balloons', 'Lanterns', 'Sparklers', 'Fountain', 'Champagne', 'Cake day', 'Stars falling', 'Purple hearts', 'Heartbeat', 'Thumbs up', 'Clap track', 'Bokeh', 'Plasma orbs', 'Smoke', 'Aurora ribbons', 'Sea anemone', 'Dust motes', 'Sonar', 'Neon rings', 'Grid pulse', 'Hex swarm', 'DNA strand', 'Sine field', 'Pixel rain', 'Glitch squares', 'Ghosts', 'Skull drift', 'Dice roll', 'Card shower', 'Chess rain', 'Music storm', 'Vinyl spin', 'Eyes on you', 'Nova Dust', 'Lunar Glow', 'Amber Tide', 'Jade Spark', 'Velvet Drift', 'Frost Wave'];
  const missing = asked.filter((n) => !labels.has(n.toLowerCase()));
  assert.deepEqual(missing, [], 'every asked-for effect exists');
  const t = cleanSettings({ theme: { fxs: ['rain', 'bitcoin-rain', 'nope', 'fireworks', 'ghosts', 'vortex', 'snow'] } }).theme;
  assert.deepEqual(t.fxs, ['rain', 'bitcoin-rain', 'fireworks', 'ghosts', 'vortex'], 'up to five, unknown ones dropped');
});
