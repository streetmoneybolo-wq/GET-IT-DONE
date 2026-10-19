'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { createPageAssets, blocksOf } = require('./academy-page-assets');

const big = (seed) => `/* ${seed} ${'pad '.repeat(160)} */ (function(){ var x = "${seed}".repeat(80); window['k_${seed}'] = x.length; })();`;
const page = (market) => '<!doctype html><html><head><title>t</title></head><body>'
  + `<script>window.MARKET=${JSON.stringify(market)};${'/*pad*/'.repeat(100)}</script>`
  + `<script>${big('one')}</script>\n<script>${big('two')}</script>`
  + `<script type="module">window.mod=1;${'/*m*/'.repeat(200)}</script>`
  + `<style>${'.a{color:red}'.repeat(60)}</style><style>${'.b{color:blue}'.repeat(60)}</style>`
  + `<script>${big('three')}</script>`
  + '</body></html>';

function fakeResponse() {
  const r = { status: 0, headers: {}, body: null, writeHead(s, h) { r.status = s; r.headers = h; }, end(b) { r.body = b; } };
  return r;
}

test('static blocks become immutable external bundles in document order; the market block, attributed scripts and the shell stay inline', () => {
  const logs = [];
  const assets = createPageAssets({ logger: (l, e, x) => logs.push([l, e, x]) });
  const canonical = () => [page({ symbol: 'SPY', bars: [1, 2, 3] }), page({ symbol: 'QQQ', bars: [4, 5] })];
  const served = assets.transform(page({ symbol: 'NVDA', bars: [9] }), { key: 'k', canonical });
  assert.match(served, /window\.MARKET=\{"symbol":"NVDA"/, 'the request\'s own data stays inline');
  assert.match(served, /<script type="module">window\.mod=1/, 'module scripts are untouched');
  const tags = [...served.matchAll(/<script src="\/academy-activity\/a\/([a-f0-9]{20})\.js" onerror=/g)].map((m) => m[1]);
  assert.equal(tags.length, 2, 'two script bundles: one/two adjacent, three alone after the styles');
  assert.match(served, /<link rel="stylesheet" href="\/academy-activity\/a\/[a-f0-9]{20}\.css"/, 'adjacent styles become one stylesheet');
  assert.ok(served.indexOf('<link rel="preload" as="script"') < served.indexOf('</head>'), 'preload hints sit in the head');
  assert.match(served, /window\.__smlAssetFail=function/, 'a missing bundle reloads once');
  assert.equal(served.includes(big('one')), false); assert.equal(served.includes(big('three')), false);
  assert.ok(served.length < page({}).length / 2, 'the shell is a fraction of the inline page');
  assert.equal(assets.stats.bundlesBuilt, 3);
  assert.ok(logs.some((l) => l[1] === 'academy_page_assets_learned' && l[2].staticBlocks === 6));

  /* the same page again builds nothing new and serves the same ids */
  const again = assets.transform(page({ symbol: 'AMD', bars: [] }), { key: 'k', canonical: () => { throw new Error('not called twice'); } });
  assert.deepEqual([...again.matchAll(/\/a\/([a-f0-9]{20})\.js/g)].map((m) => m[1]).slice(0, 2), tags);
  assert.equal(assets.stats.bundlesBuilt, 3);

  /* serving: brotli, gzip, identity, ETag 304, immutable; bundle one+two executes both pieces in order */
  const req = (path, headers = {}) => ({ url: path, method: 'GET', headers });
  let res = fakeResponse(); assert.equal(assets.serve(req('/academy-activity/a/' + tags[0] + '.js', { 'accept-encoding': 'gzip, deflate, br' }), res), true);
  assert.equal(res.status, 200); assert.equal(res.headers['content-encoding'], 'br'); assert.match(res.headers['cache-control'], /immutable/);
  const js = zlib.brotliDecompressSync(res.body).toString('utf8');
  assert.ok(js.indexOf(big('one')) < js.indexOf(big('two')));
  res = fakeResponse(); assets.serve(req('/academy-activity/a/' + tags[0] + '.js', { 'accept-encoding': 'gzip' }), res);
  assert.equal(res.headers['content-encoding'], 'gzip'); assert.equal(zlib.gunzipSync(res.body).toString('utf8'), js);
  res = fakeResponse(); assets.serve(req('/academy-activity/a/' + tags[0] + '.js?v=1'), res);
  assert.equal(res.headers['content-encoding'], undefined); assert.equal(res.body.toString('utf8'), js);
  res = fakeResponse(); assets.serve(req('/academy-activity/a/' + tags[0] + '.js', { 'if-none-match': '"' + tags[0] + '"' }), res);
  assert.equal(res.status, 304);
  res = fakeResponse(); assets.serve(req('/academy-activity/a/' + tags[0] + '.css'), res);
  assert.equal(res.status, 404, 'a script id is not a stylesheet');
  res = fakeResponse(); assert.equal(assets.serve(req('/academy-activity/a/00000000000000000000.js'), res), true); assert.equal(res.status, 404);
  assert.equal(assets.serve(req('/academy-activity/other'), fakeResponse()), false, 'other paths are not ours');
});

test('a group that does not compile as one file is served one file per block, and pages without a canonical stay inline', () => {
  const logs = [];
  const assets = createPageAssets({ logger: (l, e, x) => logs.push([l, e, x]) });
  const dup = (m) => `<html><head></head><body><script>const K = ${'1'.repeat(600)}; window.a=K;</script><script>const K = 2${'/**/'.repeat(200)}; window.b=K;</script><script>window.m=${m}</script></body></html>`;
  const served = assets.transform(dup(1), { key: 'd', canonical: () => [dup(2), dup(3)] });
  const ids = [...served.matchAll(/\/a\/([a-f0-9]{20})\.js/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, 2, 'one file per block');
  assert.ok(logs.some((l) => l[1] === 'academy_page_assets_split'));
  assert.equal(assets.transform('<html><script>x</script></html>'), '<html><script>x</script></html>');
  assert.equal(blocksOf('<script>a</script><style>b</style><script src="x"></script>').length, 3);
});
