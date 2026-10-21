'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');

test('screener contract cards are buttons that carry what the chain needs, and say they open the chain', () => {
  const ui = read('academy-screener-ui.js');
  assert.match(ui, /const ccard = \(c, side, best, sym\)/);
  for (const attr of ['role="button"', 'tabindex="0"', 'data-sym=', 'data-side=', 'data-expiry=', 'data-strike=']) assert.ok(ui.includes(attr), attr);
  assert.match(ui, /ccard\(g\.contract, side, true, b\.symbol\)/);
  assert.match(ui, /g\.alternatives\.map\(\(c\) => ccard\(c, side, false, b\.symbol\)\)/);
  assert.match(ui, /sml-open-contract/);
  assert.match(ui, /OPEN IN CHAIN/);
  assert.match(ui, /e\.key !== 'Enter' && e\.key !== ' '/, 'keyboard: Enter and Space open it too');
});

test('the options dock answers sml-open-contract: ticker, expiration, widened range, row select, plain messages when it cannot', () => {
  const dock = read('academy-options-dock.js');
  assert.match(dock, /addEventListener\('sml-open-contract'/);
  for (const piece of ['smlAcademyNavigateMarket', "$('options-expiry')", "$('options-range')", 'cell.click()', 'sml-picked', 'is not in the chain right now', 'did not load in time']) assert.ok(dock.includes(piece), piece);
  assert.match(dock, /ms\.tab\('options'\)/, 'on a phone the Options tab is brought up so the chain is visible');
});

test('the tour tells the truth about the click-through', () => {
  const { PLAYBOOKS } = require('./academy/tour-playbooks');
  const text = JSON.stringify(PLAYBOOKS);
  assert.doesNotMatch(text, /card is for reading|display only/i);
  assert.match(PLAYBOOKS.indicators.steps.find((s) => s.k === 'suggest').b, /open it in the options chain/i);
  assert.match(PLAYBOOKS.cheap.steps.find((s) => s.k === 'screen').b, /opens that exact contract/i);
});
