'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shell = fs.readFileSync(path.join(__dirname, 'academy-mobile-shell.js'), 'utf8');
const smc = fs.readFileSync(path.join(__dirname, 'academy-smart-money-ui.js'), 'utf8');

test('the phone workspace has the six tabs, the sub-tabs of each, and loads in the Academy page after the phone compact pass', () => {
  for (const tab of ["'quotes'", "'chart'", "'flow'", "'options'", "'algo'", "'talk'"]) assert.ok(shell.includes('id: ' + tab), tab);
  // a phone opens on the chart of the stock the member last used (SPY the first time), never on a tool
  assert.match(shell, /const S = \{ tab: 'chart'/);
  assert.ok(!/location\.(replace|assign)\(/.test(shell), 'never reload the page: a second load inside Discord never finishes its sign-in');
  for (const bit of ["const LAST = 'sml-last-symbol'", 'function rememberSymbol', "window.smlAcademyNavigateMarket(last)", "'Take the tour'"]) assert.ok(shell.includes(bit), bit);
  // sub-tabs: the modules that belong together share a tab
  for (const bit of ["'buysell-toggle'", "'darkpool-toggle'", "'shortsale-toggle'", "'sentiment-toggle'", "'mem-algo-toggle'", "'smc-toggle'", "'sire-toggle'", "'earnings-toggle'", "'catalysts-toggle'", "'paper-toggle'", "'talk-btn'", "['chain', 'CHAIN'", "['calc', 'CALCULATOR'", "['contract', 'CONTRACT'"]) assert.ok(shell.includes(bit), bit);
  // phones only, behind a media query and a body class; desktop is never touched
  assert.match(shell, /@media\(max-width:720px\)\{/); assert.ok(shell.includes("window.matchMedia('(max-width:720px)')"));
  // panels that floated over the chart are in flow under it
  for (const bit of ['#talk-panel.sheet{position:static!important', '#mem-algo-panel', '#sire-panel', '#ms-slot-smc', '#sml-scan-pop{display:none!important}', 'display:flex!important;flex-direction:column!important;grid-template-rows:none!important']) assert.ok(shell.includes(bit), bit);
  assert.doesNotMatch(shell, /<iframe|<\/script/i);
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', bars: [] }, { appId: '1551336038713139370' });
  assert.ok(html.includes('window.__smlMobileShell'), 'the shell ships with the page');
  assert.ok(html.indexOf('window.__smlMobileShell') > html.indexOf('window.__smlAcademyMobileCompact'), 'after the phone compact pass');
});

test('the Smart-money map card takes the slot under the chart on a phone and groups its content into three tabs', () => {
  assert.ok(smc.includes("document.getElementById('ms-slot-smc')"), 'the card mounts into the phone slot');
  for (const bit of ['data-tab="read"', 'data-tab="detail"', 'data-tab="add"', 'MAP READ', 'ZONE DETAIL', 'ADD-ONS', 'data-t="add"', 'data-t="read"', 'data-t="detail"']) assert.ok(smc.includes(bit), bit);
  assert.ok(smc.includes("card.dataset.tab = 'detail'"), 'a tapped zone opens its detail tab');
  assert.ok(smc.includes('#smc-card:not([data-tab]) [data-t]:not([data-t=read])'), 'MAP READ is the tab until one is picked');
});

test('the first-time tour: a skippable spotlight walk-through for desktop and phone that starts once and can be replayed', () => {
  const tour = fs.readFileSync(path.join(__dirname, 'academy-tour.js'), 'utf8');
  for (const bit of ["const KEY = 'sml-academy-tour-v1'", 'const DESK = [', 'const PHONE_STEPS = [', 'data-a="skip"', 'Skip tour', 'window.smlTour', ".has('popout')", 'tr-hole', 'prefers-reduced-motion', "id = 'tour-btn'"]) assert.ok(tour.includes(bit), bit);
  for (const sel of ['input#symbol', '.academy-chart-stage', '#smc-toggle', '#tool-rail .tg[data-group=flow]', '#ms-top', '#ms-nav button[data-more]']) assert.ok(tour.includes(sel), sel);
  assert.doesNotMatch(tour, /<iframe|<\/script/i);
  const { academyActivityHtml } = require('./server');
  assert.ok(academyActivityHtml({ symbol: 'SPY', bars: [] }, { appId: '1551336038713139370' }).includes('window.__smlTour'), 'the tour ships with the page');
});

test('the chart: the price axis is as wide as its labels and only two empty candles sit in front of the last one', () => {
  const pro = fs.readFileSync(path.join(__dirname, 'academy-chart-pro.js'), 'utf8');
  assert.ok(pro.includes('PAD.r = clamp(Math.ceil(labelLen * 6.2) + 12, 44, 72)'));
  assert.ok(pro.includes('N + Math.max(2, Math.round(n * 0.02))'));
  assert.ok(smc.includes("ctx.fillStyle = 'rgba(6,11,18,.82)'") && smc.includes('background:#0a101a;border:1px solid #3a3160'), 'SMC labels sit on a dark pill and the card is opaque');
});

test('the phone bars never show or sit in the chart grid on a wide screen, even after the window was narrow first', () => {
  assert.ok(shell.includes("html body:not(.sml-ms) #ms-nav,html body:not(.sml-ms) #ms-sub,html body:not(.sml-ms) #ms-more,html body:not(.sml-ms) #ms-top{display:none!important}"), 'hidden whenever the phone layout is off');
  assert.ok(shell.includes("for (const id of ['ms-top', 'ms-nav', 'ms-sub', 'ms-more'])"), 'leaving the phone layout removes the bars');
  assert.ok(shell.includes("document.body.classList.contains('sml-ms') && top.previousElementSibling !== tb"), 'the tab strip is only placed in the chart section on a phone');
});

test('changing the ticker: the old stock never paints its price or prints under the new name', () => {
  const live = fs.readFileSync(path.join(__dirname, 'academy-live.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  // the page: the readouts blank and the chart dims while the new candles are on their way, and the live feed is told to wait
  for (const bit of ["window.smlNavPending=ticker;pendingUi(true)", "pendingUi(false,true)", ".sml-nav-pending canvas{opacity:.3", "const commit=(ticker,tf,payload)=>{pendingUi(false);"]) assert.ok(server.includes(bit), bit);
  // the feed: it ignores ticks while a change is pending, drops any stream event that is not for the stock on screen, and forgets the old stock at once
  for (const bit of ['const navPending = () => !!window.smlNavPending', 'function forgetStock()', 'const mine = () => symbol === sym() && !navPending() && sse.es === es', "if (!mine()) return; try { onTrade(", "window.addEventListener('sml-academy-market', (e) =>"]) assert.ok(live.includes(bit), bit);
});

test('the quote change is against the previous trading day\'s close, not the previous candle', () => {
  const live = fs.readFileSync(path.join(__dirname, 'academy-live.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const stats = fs.readFileSync(path.join(__dirname, 'academy-quote-statistics.js'), 'utf8');
  for (const bit of ['window.smlAcademyPrevClose=(ticker,price)=>', 'const prevCloseOf=bars=>', "toLocaleDateString('en-CA',{timeZone:'America/New_York'})", 'window.smlAcademyRepaintQuote=()=>', 'dc=window.smlAcademyPrevClose?window.smlAcademyPrevClose(symbol,+last.c):null', "window.smlAcademyPrevClose&&window.smlAcademyPrevClose(ticker);"]) assert.ok(server.includes(bit), bit);
  assert.ok(live.includes('window.smlAcademyPrevClose(sym(), d.last)') && !live.includes('m.bars[m.N - 2]'), 'the live readout no longer uses the previous candle');
  assert.ok(stats.includes('window.smlAcademyPrevClose(symbol)') && !stats.includes('num(bars.at(-2)?.c)'), 'Prev Close in quote statistics is the daily close');
});

test('desktop: the quote column is a tabbed tool window and the SMC card and MEM ALGO panel sit in it instead of floating', () => {
  const sw = fs.readFileSync(path.join(__dirname, 'academy-side-window.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  const mem = fs.readFileSync(path.join(__dirname, 'academy-mem-algo-ui.js'), 'utf8');
  const dock = fs.readFileSync(path.join(__dirname, 'academy-chart-dock.js'), 'utf8');
  for (const bit of ["id: 'smc'", "id: 'algo'", "id: 'dark'", "id: 'short'", "id: 'buysell'", "id: 'sent'", "'sml-sw'", 'window.smlSideWindow', 'position:static!important']) assert.ok(sw.includes(bit), bit);
  assert.ok(server.includes('ACADEMY_MOBILE_SHELL + ACADEMY_SIDE_WINDOW + '), 'the window is injected into the page');
  assert.ok(smc.includes("document.body.classList.contains('sml-sw')") && smc.includes('col.appendChild(card)'), 'SMC mounts in the column');
  assert.ok(mem.includes("document.body.classList.contains('sml-sw')") && mem.includes('col.appendChild(panel)'), 'MEM ALGO mounts in the column');
  assert.ok(dock.includes("sel === '#smc-card' || sel === '#mem-algo-panel'"), 'the chart dock leaves those two to the column');
});

test('tools take turns and a tap outside closes a floating popup (desktop and phone)', () => {
  const one = fs.readFileSync(path.join(__dirname, 'academy-one-at-a-time.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
  for (const bit of ["['smc-toggle', 'smc-card']", "['mem-algo-toggle', 'mem-algo-panel']", "['chain-toggle', 'chain-stage']", "['tool-guide-btn', 'tool-guide']", "addEventListener('pointerdown', away, true)", "e.key !== 'Escape'", 'window.smlOneAtATime', "ms-more"]) assert.ok(one.includes(bit), bit);
  assert.ok(server.includes('ACADEMY_SIDE_WINDOW + ACADEMY_ONE_AT_A_TIME + ACADEMY_TOUR'), 'injected into the page');
});
