'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('./academy-buy-prefs');

test('normalize: any saved value becomes a complete, valid preference', () => {
  assert.deepEqual(P.normalize(null), { mode: 'each', platforms: ['moomoo', 'webull', 'robinhood', 'etoro'], primary: 'moomoo', sell: true });
  assert.deepEqual(P.normalize({ mode: 'one', platforms: ['webull', 'bogus', 'etoro'], primary: 'robinhood', sell: false }), { mode: 'one', platforms: ['webull', 'etoro'], primary: 'webull', sell: false }, 'unknown brokers drop; a primary outside the chosen platforms moves to the first of them');
  assert.deepEqual(P.normalize({ platforms: [] }).platforms, P.KEYS, 'unticking everything still leaves a Buy button');
  assert.equal(P.normalize({ mode: 'weird' }).mode, 'each');
});

test('brokersFor: one button for the primary in "one" mode, the chosen platforms otherwise', () => {
  assert.deepEqual(P.brokersFor({ mode: 'one', platforms: ['webull', 'etoro'], primary: 'etoro' }).map((b) => b.key), ['etoro']);
  assert.deepEqual(P.brokersFor({ mode: 'each', platforms: ['robinhood', 'moomoo'] }).map((b) => b.key), ['moomoo', 'robinhood'], 'display order is the fixed broker order');
  for (const b of P.brokersFor(null)) { assert.ok(b.name && b.color && b.bg && b.border && b.tag); }
});

test('linkFor: quote pages only, worded for buy or sell, stock or contract', () => {
  const c = { symbol: 'SPY', year: 2025, month: 12, day: 19, strike: 600, side: 'call' };
  assert.equal(P.linkFor('moomoo', { symbol: 'spy' }).url, P.LAUNCH + '?b=moomoo&symbol=SPY');
  assert.equal(P.linkFor('webull', { contract: c }).url, P.LAUNCH + '?b=webull&symbol=SPY');
  assert.equal(P.linkFor('robinhood', { symbol: 'SPY' }).url, 'https://robinhood.com/stocks/SPY');
  assert.equal(P.linkFor('robinhood', { contract: c }).url, 'https://robinhood.com/options/chains/SPY');
  assert.equal(P.linkFor('etoro', { contract: c }).url, 'https://www.etoro.com/markets/spy');
  assert.match(P.linkFor('etoro', { contract: c }).note, /lists the stock, not this contract/);
  assert.match(P.linkFor('moomoo', { contract: c, side: 'sell' }).note, /sell to close or sell to open/);
  assert.match(P.linkFor('moomoo', { contract: c, side: 'buy' }).note, /buy to open/);
  assert.match(P.linkFor('moomoo', { symbol: 'AAPL', side: 'sell' }).note, /Place the sell order there yourself\./);
  assert.equal(P.linkFor('moomoo', { contract: c }).exact, false, 'no broker publishes a link to one contract');
  assert.equal(P.linkFor('moomoo', { symbol: '../etc' }), null);
  assert.equal(P.linkFor('nope', { symbol: 'SPY' }), null);
  assert.equal(P.linkFor('moomoo', { symbol: 'brk.b' }).url, P.LAUNCH + '?b=moomoo&symbol=BRK.B');
});

test('tradeBrokersFor: a contract always gets exactly one broker (the primary), whatever the mode, so Buy and Sell never come as a row of four', () => {
  for (const mode of ['each', 'one', 'weird']) {
    const b = P.tradeBrokersFor({ mode, platforms: ['webull', 'robinhood', 'etoro'], primary: 'robinhood' });
    assert.deepEqual(b.map((x) => x.key), ['robinhood'], mode);
  }
  assert.deepEqual(P.tradeBrokersFor(null).map((x) => x.key), ['moomoo'], 'no saved prefs: moomoo alone');
  assert.deepEqual(P.tradeBrokersFor({ platforms: ['etoro'], primary: 'moomoo' }).map((x) => x.key), ['etoro'], 'a primary that is not chosen falls back to a chosen broker');
});

test('every contract trade spot uses the single-broker rule and none maps a row per broker (a guard against the clutter coming back)', () => {
  const fs = require('node:fs'), path = require('node:path');
  const read = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const desk = read('academy-options-desk.js'), bar = read('academy-options-brokers.js'), hedge = read('academy-hedge-ui.js'), settings = read('academy-settings-ui.js');
  for (const [name, src] of [['options desk', desk], ['chain bar', bar], ['hedge ideas', hedge]]) {
    assert.ok(src.includes('tradeBrokers()'), name + ' asks for the single trade broker');
    assert.ok(!/brokers\(\)\s*:\s*\[\]/.test(src) && !/P\.brokers\(\)/.test(src), name + ' does not use the per-broker list for contract buttons');
  }
  assert.ok(!/brokers\.map\(\(b\) => tradeBtn/.test(desk), 'the contract card never maps a button per broker');
  assert.ok(!/keys\.map\(\(k\) => button\(k, 'sell'\)\)\.join\(''\)[^;]*keys\.map/.test(bar), 'the chain bar has one Buy and one Sell');
  assert.ok(settings.includes('tradeBrokers:') && settings.includes('data-buy-switch') && settings.includes("set({ primary: sw.value })"), 'the picker that changes the broker');
});
