'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeChain, considerOptions } = require('./academy-alert-options');
const { createAlertsService } = require('./academy-alerts');

const NOW = Date.parse('2026-09-25T15:00:00Z');
const iso = (days) => new Date(NOW + days * 86400000).toISOString().slice(0, 10);
function side(mid, delta, over = {}) { return Object.assign({ bid: mid - 0.05, ask: mid + 0.05, last: mid, volume: 400, openInterest: 1500, impliedVolatility: 0.55, delta, theta: -mid * 0.02 }, over); }
function chain(price, days) {
  const rows = [];
  for (const d of days) for (const k of [-0.12, -0.06, -0.02, 0, 0.03, 0.08, 0.15]) {
    const strike = Math.round(price * (1 + k));
    const itm = Math.max(0, price - strike);
    const dc = Math.min(0.95, Math.max(0.05, 0.5 + (price - strike) / price * 3)), dp = dc - 1;
    rows.push({ expiration: iso(d), strike, call: side(itm + price * 0.04, dc), put: side(Math.max(0, strike - price) + price * 0.04, dp) });
  }
  return { symbol: 'TEST', chain: rows };
}
const alert = (channel = 'swings') => ({ id: '1', channel, symbol: 'TEST', entry: 20, target: 26 });
const base = (o = {}) => Object.assign({ alert: alert(), price: 22, atrPct: 0.05, plan: { action: 'HOLD', target: 26 }, algoView: { bias: 'long' }, flow: { bias: 'bullish' }, rows: normalizeChain(chain(22, [10, 24, 60])), now: NOW }, o);

test('normalizeChain reads rows with call and put sides', () => {
  const rows = normalizeChain(chain(22, [24]));
  assert.ok(rows.length >= 5);
  assert.ok(rows[0].call.bid > 0 && rows[0].put.ask > 0 && rows[0].call.oi === 1500);
});

test('a healthy long alert gets a CALL with a real contract in the swing window', () => {
  const r = considerOptions(base());
  assert.equal(r.verdict, 'CALL');
  assert.ok(r.contract.dte >= 7 && r.contract.dte <= 45);
  assert.ok(r.contract.delta >= 0.38 && r.contract.delta <= 0.72);
  assert.ok(r.contract.breakeven > r.contract.strike);
  assert.match(r.summary, /breaks even/);
  assert.match(r.note, /Educational/);
});

test('long-term alerts look at far-dated, higher-delta contracts', () => {
  const rows = normalizeChain(chain(22, [24, 150, 220]));
  const r = considerOptions(base({ alert: alert('longterm'), rows }));
  assert.equal(r.verdict, 'CALL');
  assert.ok(r.contract.dte >= 90);
  assert.ok(r.contract.delta >= 0.52);
});

test('a sell plan without a bearish read means wait, not a call', () => {
  const r = considerOptions(base({ plan: { action: 'SELL', target: 22 }, algoView: { bias: 'long' } }));
  assert.equal(r.verdict, 'WAIT');
});

test('a sell plan with a bearish MEM ALGO and price under entry considers a PUT', () => {
  const rows = normalizeChain(chain(18, [10, 24, 60]));
  const r = considerOptions(base({ price: 18, rows, plan: { action: 'SELL', target: 18 }, algoView: { bias: 'short' }, flow: { bias: 'bearish' } }));
  assert.equal(r.verdict, 'PUT');
  assert.ok(r.contract.breakeven < r.contract.strike);
});

test('a bearish trend blocks calls', () => {
  assert.equal(considerOptions(base({ algoView: { bias: 'short' } })).verdict, 'WAIT');
});

test('illiquid chains give no contract', () => {
  const rows = normalizeChain(chain(22, [24])).map((r) => ({ ...r, call: { ...r.call, oi: 3, volume: 1 } }));
  assert.equal(considerOptions(base({ rows })).verdict, 'NONE');
});

test('wide spreads are rejected', () => {
  const rows = normalizeChain(chain(22, [24])).map((r) => ({ ...r, call: { ...r.call, bid: r.call.bid * 0.5, ask: r.call.ask * 1.8 } }));
  assert.equal(considerOptions(base({ rows })).verdict, 'NONE');
});

test('no chain reports that no options are listed', () => {
  const r = considerOptions(base({ rows: [] }));
  assert.equal(r.available, false);
});

const msg = (over = {}) => Object.assign({ id: '900000000000000001', content: '@everyone TEST entry $20 pt 26', timestamp: new Date(NOW - 3600000).toISOString(), author: { id: '258456543123', username: 'grandmasterobi', global_name: 'GrandMaster Obi', avatar: 'abcdef123456' } }, over);

test('ingest keeps the poster id and avatar and the public alert points at our own proxy', () => {
  const svc = createAlertsService({ channels: [{ key: 'swings', id: '1' }], now: () => NOW });
  assert.equal(svc.ingest('swings', msg()), true);
  const a = svc.alerts.get('900000000000000001');
  assert.equal(a.authorId, '258456543123'); assert.equal(a.avatarHash, 'abcdef123456');
});

test('avatar fetches the Discord CDN for the poster only and caches it', async () => {
  const urls = [];
  const fetchImpl = async (url) => { urls.push(String(url)); return { ok: true, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }; };
  const svc = createAlertsService({ channels: [{ key: 'swings', id: '1' }], now: () => NOW, fetchImpl });
  svc.ingest('swings', msg());
  const img = await svc.avatar('900000000000000001');
  assert.equal(img.type, 'image/png'); assert.equal(img.body.length, 4);
  await svc.avatar('900000000000000001');
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/cdn\.discordapp\.com\/avatars\/258456543123\/abcdef123456\.png/);
  assert.equal(await svc.avatar('123'), null);
});

test('a poster with no custom avatar gets the default one', async () => {
  const urls = [];
  const svc = createAlertsService({ channels: [{ key: 'swings', id: '1' }], now: () => NOW, fetchImpl: async (u) => { urls.push(String(u)); return { ok: true, arrayBuffer: async () => new ArrayBuffer(2) }; } });
  svc.ingest('swings', msg({ author: { id: '258456543123', username: 'grandmasterobi', avatar: null } }));
  await svc.avatar('900000000000000001');
  assert.match(urls[0], /embed\/avatars\/\d\.png$/);
});

test('one-contract-per-row chains (type field, plain bid/ask) are understood', () => {
  const rows = normalizeChain({ options: [
    { expiration: iso(24), strike: 22, type: 'call', bid: 1.2, ask: 1.3, openInterest: 900, delta: 0.55, impliedVolatility: 0.5 },
    { expiration: iso(24), strike: 22, type: 'put', bid: 0.9, ask: 1.0, openInterest: 700, delta: -0.45, impliedVolatility: 0.5 }
  ] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].call.bid, 1.2); assert.equal(rows[0].put.ask, 1.0); assert.equal(rows[0].put.delta, -0.45);
});
