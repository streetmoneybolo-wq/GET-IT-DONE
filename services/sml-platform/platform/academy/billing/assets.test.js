'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const assets = require('./assets');
const pages = require('./pages');

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

test('brand assets are served by name only, long-cached, with byte ranges for the clip', async () => {
  const { server, base } = await serve((req, res) => assets.sendAsset(req, res, decodeURIComponent(req.url.slice(1))));
  try {
    const crown = await fetch(`${base}/me-crown.webp`);
    assert.equal(crown.status, 200); assert.equal(crown.headers.get('content-type'), 'image/webp'); assert.match(crown.headers.get('cache-control'), /max-age/);
    const again = await fetch(`${base}/me-crown.webp`, { headers: { 'if-none-match': crown.headers.get('etag') } });
    assert.equal(again.status, 304);
    const part = await fetch(`${base}/academy-hero.mp4`, { headers: { range: 'bytes=0-99' } });
    assert.equal(part.status, 206); assert.equal(part.headers.get('content-length'), '100'); assert.match(part.headers.get('content-range'), /^bytes 0-99\/\d+$/);
    assert.equal((await fetch(`${base}/academy-hero.mp4`, { headers: { range: 'bytes=abc' } })).status, 416);
    for (const bad of ['..%2Fpages.js', 'pages.js', 'nope.png', '']) assert.equal((await fetch(`${base}/${bad}`)).status, 404, bad);
    const head = await fetch(`${base}/grandmaster-obi.webp`, { method: 'HEAD' });
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
  } finally { server.close(); }
  assert.equal(assets.hasAsset('academy-hero.mp4'), true);
  assert.equal(assets.hasAsset('../pages.js'), false);
});

test('the store pages carry the brand hero, allow only their own media, and keep the plan card markup', () => {
  const config = { termsUrl: 'https://x.test/t', privacyUrl: 'https://x.test/p', consentVersion: '1', checkoutEnabled: true };
  const csp = pages.securityHeaders('n')['content-security-policy'];
  assert.match(csp, /media-src 'self'/); assert.match(csp, /img-src 'self' data:/); assert.match(csp, /default-src 'none'/);
  const signin = pages.signInPage({ config, nonce: 'n', pkg: 'lifetime' });
  assert.match(signin, /<video autoplay muted loop playsinline/); assert.match(signin, /assets\/academy-hero\.mp4/); assert.match(signin, /assets\/me-crown\.webp/);
  assert.match(signin, /Discipline protects the dream\. Consistency builds the freedom\./); assert.match(signin, /assets\/academy-poster\.webp/);
  assert.match(signin, /🎵 Music on/); assert.match(signin, /assets\/store-music\.mp3/);
  assert.doesNotMatch(signin, /https?:\/\/(?!x\.test)/, 'every image and clip comes from our own origin');
  const desc = { key: 'lifetime', amount: 145090, currency: 'usd', academy: true, roleNames: ['Monarch'], priceId: 'price_x', label: 'MEM Lifetime', line: 'academy', roles: ['1260433215189946420'] };
  const buy = pages.buyPage({ config, nonce: 'n', userId: '1', user: { username: 'mike' }, packages: [desc], memberships: [], csrf: 'c', state: {} });
  assert.match(buy, /<section class="card"><span class="ribbon">ONE PAYMENT · LIFETIME<\/span><h2>MEM Lifetime<\/h2>/);
  assert.match(buy, /\$1,450\.90 once/); assert.match(buy, /grandmaster-obi-chibi\.gif/);
  const thanks = pages.successPage({ config, nonce: 'n', sessionId: 'cs_1', paid: true, inGuild: true });
  assert.match(thanks, /id="thanks-clip" autoplay muted playsinline/); assert.match(thanks, /assets\/thank-you\.mp4/); assert.match(thanks, /Play with sound/);
  assert.match(thanks, /assets\/me-crown\.webp/); assert.doesNotMatch(thanks, /academy-hero\.mp4/, 'the thank-you page uses the slim hero');
  const failed = pages.successPage({ config, nonce: 'n', sessionId: 'cs_2', paid: false, failed: true });
  assert.doesNotMatch(failed, /thank-you\.mp4/, 'no celebration clip on a failed payment');
});
