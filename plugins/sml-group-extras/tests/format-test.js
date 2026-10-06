'use strict';
const assert = require('node:assert/strict');
const { render } = require('../assets/gextras.js');
let n = 0; const t = (name, fn) => { fn(); n++; };
t('plain text has no formatting', () => assert.equal(render('hello world #SPY $AAPL'), ''));
t('bold italic underline strike', () => {
  const h = render('**b** *i* __u__ ~~s~~');
  for (const x of ['<strong>b</strong>', '<em>i</em>', '<u>u</u>', '<s>s</s>']) assert.ok(h.includes(x), x);
});
t('headers by size', () => {
  assert.match(render('# Big'), /<div class="smlfmt-h1">Big<\/div>/);
  assert.match(render('## Mid'), /smlfmt-h2/); assert.match(render('### Small'), /smlfmt-h3/);
  assert.equal(render('#hashtag'), ''); assert.equal(render('#SPY is up'), '');
});
t('small text and quote', () => { assert.match(render('-# tiny'), /smlfmt-small/); assert.match(render('> said'), /smlfmt-quote/); });
t('colour, glow, size, centre', () => {
  assert.match(render('[color=gold]x[/color]'), /style="color:#ffd166"/);
  assert.match(render('[color=#00ff66]x[/color]'), /color:#00ff66/);
  assert.match(render('[glow=cyan]x[/glow]'), /text-shadow/);
  assert.match(render('[size=32]x[/size]'), /font-size:32px/);
  assert.match(render('[size=99]x[/size]'), /font-size:48px/); assert.match(render('[size=02]x[/size]'), /font-size:10px/);
  assert.match(render('[center]hi[/center]'), /smlfmt-center/);
});
t('bad colours are left as text', () => {
  const h = render('[color=red;background:url(x)]x[/color]');
  assert.ok(!/style=/.test(h)); assert.equal(h, '');
  assert.equal(render('[color=javascript:alert(1)]x[/color]'), '');
});
t('html is escaped, never injected', () => {
  const h = render('**<img src=x onerror=alert(1)>**');
  assert.ok(!h.includes('<img')); assert.ok(h.includes('&lt;img'));
  const h2 = render('# <script>alert(1)</script>'); assert.ok(!h2.includes('<script'));
  const h3 = render('[color=gold]"><b onmouseover=1>x[/color]'); assert.ok(!/<b /.test(h3));
});
t('code protects markers inside', () => { const h = render('`**not bold**` **bold**'); assert.ok(h.includes('<code>**not bold**</code>')); assert.ok(h.includes('<strong>bold</strong>')); });
t('spoiler', () => assert.match(render('||secret||'), /smlfmt-spoiler/));
t('multi-line keeps blank lines', () => { const h = render('# Title\n\nbody **x**'); assert.ok(h.includes('smlfmt-gap')); assert.ok(h.includes('<strong>x</strong>')); });
t('math and snake_case are not italic', () => { assert.equal(render('2*3*4'), ''); assert.equal(render('snake_case_name'), ''); });
console.log(n + ' format checks passed');
