'use strict';
/* Local proof of the plugin script against a synthetic copy of the dashboard toolbar: the adapter's MEM ALGO button and strategy
   picker exist as on the site, the page carries alertDestinationData like the real embed, and the algo route is mocked. */
const path = require('node:path');
const fs = require('node:fs');
const { execSync } = require('node:child_process');
const pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright'));
const js = fs.readFileSync(path.join(__dirname, '..', 'assets', 'algo-chart.js'), 'utf8');

function page(groupId, cfg) {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="chead"></div><div id="chartpanel"><div id="hostdiv" style="position:relative;width:600px;height:300px"></div></div>
<script>var alertDestinationData={"public":true,"canAlert":false,"groupId":${groupId},"embedMode":${groupId ? 'true' : 'false'},"groups":[],"embedded":true}; var SMLNONCE='abc123';</script>
<script>
/* a stand-in for the Chart Academy Tools adapter: same ids and classes, same toggle semantics */
(function(){ var S={mem:${cfg.memOn ? 'true' : 'false'},mode:'swing'}; var head=document.getElementById('chead'); var wrap=document.createElement('span'); wrap.id='sml-cat-toolbar';
function btn(label,cls,on,click){var b=document.createElement('button');b.type='button';b.className='sml-cat-btn '+cls+(on?' on':'');b.textContent=label;b.addEventListener('click',function(){click(b)});return b}
wrap.appendChild(btn('SMC','smc',false,function(b){b.classList.toggle('on')}));
${cfg.allowed ? "wrap.appendChild(btn('MEM ALGO','mem',S.mem,function(b){S.mem=!S.mem;b.classList.toggle('on',S.mem);sel.style.display=S.mem?'':'none';window.__memToggles=(window.__memToggles||0)+1}));" : ''}
var sel=document.createElement('select');sel.className='sml-cat-sel';sel.style.display=S.mem?'':'none';['day','swing','mid','long','short'].forEach(function(k){var o=document.createElement('option');o.value=k;o.textContent=k.toUpperCase();if(k===S.mode)o.selected=true;sel.appendChild(o)});sel.addEventListener('change',function(){S.mode=sel.value;window.__memMode=S.mode});
${cfg.allowed ? 'wrap.appendChild(sel);' : ''}
wrap.appendChild(btn('CANDLES','cand',false,function(b){b.classList.toggle('on')})); head.appendChild(wrap); })();
</script>
<script>window.SML_GAC=${JSON.stringify({ groupId: 0, rest: '/wp-json/sml/v1/group/algos', nonce: 'nonce-xyz' })};</script>
<script>${js}</script></body></html>`;
}

(async () => {
  const browser = await pw.chromium.launch({ executablePath: '/opt/pw-browsers/chromium/chrome-linux/chrome' }).catch(() => pw.chromium.launch());
  const ctx = await browser.newContext();
  const calls = [];
  await ctx.route('**/wp-json/sml/v1/group/algos**', (route) => {
    const u = new URL(route.request().url()); calls.push({ url: u.pathname + u.search, nonce: route.request().headers()['x-wp-nonce'] });
    const g = u.searchParams.get('group_id');
    const body = g === '77' ? { algos: [{ id: 'mem_algo', name: 'MEM ALGO', order: 1 }, { id: 'obi-confluence', name: 'Obi Confluence', order: 2 }] } : g === '88' ? [] : { algos: [{ name: 'Some Other Algo' }] };
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  let n = 0;
  const open = async (html, query = '') => { const p = await ctx.newPage(); const u = `http://local.test/p${++n}.html`; await p.route(u + '*', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: html })); await p.goto(u + query); await p.waitForTimeout(500); return p; };
  const vis = (p, sel) => p.$eval(sel, (el) => getComputedStyle(el).display !== 'none').catch(() => null);

  /* 1. bare analyst dashboard, MEM ALGO allowed and left ON from an earlier visit: hidden and switched off, no ALGOS menu */
  let p = await open(page(0, { allowed: true, memOn: true }));
  console.log('no group: mem button visible?', await vis(p, '.sml-cat-btn.mem'), '| still on?', await p.$eval('.sml-cat-btn.mem', (b) => b.classList.contains('on')), '| algos menu present?', !!(await p.$('#sml-gac')), '| route calls', calls.length);

  /* 2. Making Easy Money embed (group 77 from alertDestinationData): ALGOS menu with MEM ALGO first, tap turns it on, strategy picker mirrors */
  p = await open(page(77, { allowed: true, memOn: false }));
  await p.waitForSelector('#sml-gac');
  console.log('group 77: fetched', JSON.stringify(calls.at(-1)), '| button:', await p.textContent('.sml-gac-btn'));
  await p.click('.sml-gac-btn');
  console.log('  menu items:', await p.$$eval('.sml-gac-item', (els) => els.map((e) => e.textContent.trim())));
  await p.click('.sml-gac-item[data-i="0"]');
  await p.waitForTimeout(100);
  console.log('  after tap: mem on?', await p.$eval('.sml-cat-btn.mem', (b) => b.classList.contains('on')), '| toggles', await p.evaluate(() => window.__memToggles), '| button:', await p.textContent('.sml-gac-btn'), '| sub-select?', !!(await p.$('.sml-gac-sub select')));
  await p.selectOption('.sml-gac-sub select', 'day');
  console.log('  mode forwarded to adapter:', await p.evaluate(() => window.__memMode), '| mem button still hidden?', !(await vis(p, '.sml-cat-btn.mem')));
  await p.click('.sml-gac-item[data-i="0"]');
  console.log('  tap again: mem on?', await p.$eval('.sml-cat-btn.mem', (b) => b.classList.contains('on')));

  /* 3. another group with no MEM ALGO in its list, MEM left on: switched off, list shows that group's algo only */
  p = await open(page(99, { allowed: true, memOn: true }));
  await p.waitForSelector('#sml-gac');
  await p.click('.sml-gac-btn');
  console.log('group 99: mem on?', await p.$eval('.sml-cat-btn.mem', (b) => b.classList.contains('on')), '| items:', await p.$$eval('.sml-gac-item', (els) => els.map((e) => e.textContent.trim())));

  /* 4. a group where the server already withheld MEM ALGO (allowed:false) and the list is empty */
  p = await open(page(88, { allowed: false, memOn: false }));
  await p.waitForSelector('#sml-gac'); await p.click('.sml-gac-btn');
  console.log('group 88: menu text:', (await p.textContent('.sml-gac-menu')).replace(/\s+/g, ' ').trim());

  /* 5. group id from the URL query when the page data has none */
  p = await open(page(0, { allowed: true, memOn: false }), '?sml_group_tool=1&embed=live-chart&group_id=77'); await p.waitForSelector('#sml-gac');
  console.log('query group id used:', JSON.stringify(calls.at(-1).url));
  /* 6. embed with no group id anywhere, server allows MEM ALGO: the ALGOS menu still offers it (server decision stands) */
  p = await open(page(0, { allowed: true, memOn: false }), '?sml_group_tool=1&embed=live-chart'); await p.waitForSelector('#sml-gac'); await p.click('.sml-gac-btn');
  console.log('embed, no id: items:', await p.$$eval('.sml-gac-item', (els) => els.map((e) => e.textContent.trim())));
  /* 7. the algo route fails (rate limit / HTML): same safety net */
  await ctx.unroute('**/wp-json/sml/v1/group/algos**'); await ctx.route('**/wp-json/sml/v1/group/algos**', (r) => r.fulfill({ status: 429, contentType: 'text/html', body: '<html>429</html>' }));
  p = await open(page(77, { allowed: true, memOn: true })); await p.waitForSelector('#sml-gac'); await p.click('.sml-gac-btn');
  console.log('route 429, group 77: items:', await p.$$eval('.sml-gac-item', (els) => els.map((e) => e.textContent.trim())), '| mem still on?', await p.$eval('.sml-cat-btn.mem', (b) => b.classList.contains('on')));
  /* 8. route fails in a group where the server withheld MEM ALGO: nothing is invented */
  p = await open(page(99, { allowed: false, memOn: false })); await p.waitForSelector('#sml-gac'); await p.click('.sml-gac-btn');
  console.log('route 429, other group: menu:', (await p.textContent('.sml-gac-menu')).replace(/\s+/g, ' ').trim());
  await browser.close();
})().catch((e) => { console.error('TEST FAILED', e); process.exit(1); });
