'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const shell = fs.readFileSync(path.join(__dirname, 'academy-mobile-shell.js'), 'utf8');
const smc = fs.readFileSync(path.join(__dirname, 'academy-smart-money-ui.js'), 'utf8');

test('the phone workspace has the six tabs, the sub-tabs of each, and loads in the Academy page after the phone compact pass', () => {
  for (const tab of ["'quotes'", "'chart'", "'flow'", "'options'", "'algo'", "'talk'"]) assert.ok(shell.includes('id: ' + tab), tab);
  // the default is the quotes with the chat, never a tool
  assert.match(shell, /const S = \{ tab: 'quotes'/);
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
