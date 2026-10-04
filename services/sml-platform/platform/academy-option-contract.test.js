'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('./academy-option-contract');

test('a contract is written as the standard OCC symbol and as plain English', () => {
  const call = C.contract({ symbol: 'spy', expiry: '2025-12-19', strike: 600, side: 'call' });
  assert.equal(C.occSymbol(call), 'SPY251219C00600000');
  assert.equal(C.describe(call), 'SPY Dec 19 2025 600 Call');
  const put = C.contract({ symbol: 'AAPL', expiry: '2026-01-16', strike: 187.5, side: 'PUT' });
  assert.equal(C.occSymbol(put), 'AAPL260116P00187500');
  assert.equal(C.describe(put), 'AAPL Jan 16 2026 187.5 Put');
  assert.equal(C.occSymbol(C.contract({ symbol: 'F', expiry: '2026-03-20', strike: 12.5, side: 'c' })), 'F260320C00012500');
  assert.equal(C.occSymbol(C.contract({ symbol: 'X', expiry: '2026-03-20', strike: 0.5, side: 'call' })), 'X260320C00000500');
});

test('a contract with any unusable part is refused', () => {
  const ok = { symbol: 'SPY', expiry: '2025-12-19', strike: 600, side: 'call' };
  assert.ok(C.contract(ok));
  for (const bad of [{ ...ok, symbol: '' }, { ...ok, expiry: '12/19/25' }, { ...ok, expiry: '2025-13-01' }, { ...ok, strike: 0 }, { ...ok, strike: 'abc' }, { ...ok, side: 'both' }, { ...ok, strike: 5_000_000 }, {}, undefined]) assert.equal(C.contract(bad), null);
  assert.deepEqual(C.links(null), []);
});

test('each broker gets a link, none claims to be the exact contract, and the symbol is made safe', () => {
  const c = C.contract({ symbol: 'spy<x>', expiry: '2025-12-19', strike: 600, side: 'call' });
  assert.equal(c.symbol, 'SPYX');
  const links = C.links(c);
  assert.deepEqual(links.map((l) => l.key), ['moomoo', 'webull', 'robinhood', 'etoro']);
  assert.equal(links.find((l) => l.key === 'robinhood').url, 'https://robinhood.com/options/chains/SPYX');
  assert.equal(links.find((l) => l.key === 'etoro').url, 'https://www.etoro.com/markets/spyx');
  assert.match(links.find((l) => l.key === 'moomoo').url, /\/academy-activity\/open\?b=moomoo&symbol=SPYX$/);
  assert.match(links.find((l) => l.key === 'webull').url, /\?b=webull&symbol=SPYX$/);
  assert.ok(links.every((l) => l.exact === false && l.note.length > 10 && /^https:\/\//.test(l.url)));
  assert.match(links.find((l) => l.key === 'etoro').note, /stock, not this contract/);
});
