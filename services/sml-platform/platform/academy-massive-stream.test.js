'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createMassiveStream } = require('./academy-massive-stream');
const { createServer } = require('./server');

class FakeWS {
  static last = null;
  constructor(url) { this.url = url; this.readyState = 1; this.sent = []; FakeWS.last = this; setImmediate(() => { this.onopen && this.onopen(); this.push([{ ev: 'status', status: 'connected', message: 'Connected Successfully' }]); }); }
  send(text) { const m = JSON.parse(text); this.sent.push(m); if (m.action === 'auth') setImmediate(() => this.push([{ ev: 'status', status: 'auth_success', message: 'authenticated' }])); }
  push(list) { this.onmessage && this.onmessage({ data: JSON.stringify(list) }); }
  close() { this.readyState = 3; this.onclose && this.onclose(); }
}
const tick = () => new Promise((r) => setTimeout(r, 15));

test('connects, authenticates, subscribes to trades and quotes for watched symbols only', async () => {
  const svc = createMassiveStream({ apiKey: 'k', WebSocketImpl: FakeWS });
  svc.start(); await tick();
  assert.equal(FakeWS.last.sent[0].action, 'auth');
  assert.equal(svc.watch('spy'), true); assert.equal(svc.watch('bad symbol!'), false);
  const sub = FakeWS.last.sent.filter((m) => m.action === 'subscribe').map((m) => m.params).join(',');
  assert.match(sub, /T\.SPY,Q\.SPY/);
  assert.doesNotMatch(sub, /bad/i);
  svc.stop();
});

test('stores quotes and a trade tape, classifying buys and sells against the quote', async () => {
  const svc = createMassiveStream({ apiKey: 'k', WebSocketImpl: FakeWS });
  svc.start(); await tick(); svc.watch('SPY');
  const ws = FakeWS.last, now = Date.now();
  ws.push([{ ev: 'Q', sym: 'SPY', bp: 770.1, ap: 770.12, bs: 40, as: 120, t: now }]);
  ws.push([{ ev: 'T', sym: 'SPY', p: 770.12, s: 100, t: now + 1 }, { ev: 'T', sym: 'SPY', p: 770.1, s: 0, ds: '0.5', t: now + 2 }, { ev: 'T', sym: 'SPY', p: 770.11, s: 5, t: now + 3 }, { ev: 'T', sym: 'OTHER', p: 1, s: 1, t: now }]);
  const p = svc.peek('SPY');
  assert.equal(p.quote.bid, 770.1); assert.equal(p.quote.bs, 4000);
  assert.deepEqual(p.tape.map((t) => t.dir), ['N', 'S', 'B']);
  assert.equal(p.tape[1].size, 0.5);
  assert.equal(p.last, 770.11);
  assert.equal(svc.peek('OTHER'), null);
  svc.stop();
});

test('listeners get each trade and quote and can be removed', async () => {
  const svc = createMassiveStream({ apiKey: 'k', WebSocketImpl: FakeWS });
  svc.start(); await tick();
  const seen = []; const off = svc.on('AAPL', (e) => seen.push(e.type));
  FakeWS.last.push([{ ev: 'Q', sym: 'AAPL', bp: 1, ap: 2, bs: 1, as: 1, t: Date.now() }, { ev: 'T', sym: 'AAPL', p: 1.5, s: 1, t: Date.now() }]);
  assert.deepEqual(seen, ['quote', 'trade']);
  off(); FakeWS.last.push([{ ev: 'T', sym: 'AAPL', p: 1.6, s: 1, t: Date.now() }]);
  assert.equal(seen.length, 2);
  svc.stop();
});

test('reconnects and re-subscribes after the socket drops', async () => {
  const timers = { setTimeout: (fn) => { setImmediate(fn); return { unref() {} }; }, clearTimeout() {}, setInterval: () => ({ unref() {} }), clearInterval() {} };
  const svc = createMassiveStream({ apiKey: 'k', WebSocketImpl: FakeWS, timers });
  svc.start(); await tick(); svc.watch('SPY');
  const first = FakeWS.last; first.close(); await tick(); await tick();
  assert.notEqual(FakeWS.last, first);
  assert.match(FakeWS.last.sent.filter((m) => m.action === 'subscribe').map((m) => m.params).join(','), /T\.SPY/);
  svc.stop();
});

test('without a key the stream is disabled and harmless', () => {
  const svc = createMassiveStream({ apiKey: '', WebSocketImpl: FakeWS });
  svc.start(); assert.equal(svc.status().enabled, false); assert.equal(svc.peek('SPY'), null);
});

test('the SSE route sends a snapshot then live trades, and /live merges Massive over the stale tape', async () => {
  const svc = createMassiveStream({ apiKey: 'k', WebSocketImpl: FakeWS });
  svc.start(); await tick(); svc.watch('SPY');
  const ws = FakeWS.last, now = Date.now();
  ws.push([{ ev: 'Q', sym: 'SPY', bp: 770.1, ap: 770.12, bs: 40, as: 120, t: now }, { ev: 'T', sym: 'SPY', p: 770.11, s: 10, t: now }]);
  const orderFlow = { live: (symbol) => ({ symbol, ready: true, asOf: now - 60000, seq: 1, book: { bids: [{ price: 770.0, size: 500 }], asks: [{ price: 770.2, size: 400 }] }, tape: [{ t: now - 150000, price: 769, size: 1, dir: 'N' }], last: 769, servedAt: now }), start() {}, stop() {}, peek: () => null, touch() {}, get() {}, engines: new Map() };
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, now: Date.now, academyOrderFlow: orderFlow, academyMassive: svc });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const live = await (await fetch(`http://127.0.0.1:${port}/academy-activity/live?symbol=SPY`)).json();
  assert.equal(live.source, 'massive'); assert.equal(live.last, 770.11); assert.equal(live.tape[0].price, 770.11); assert.equal(live.rt.bid, 770.1); assert.equal(live.book.bids[0].price, 770.0);
  const events = [];
  await new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}/academy-activity/stream?symbol=SPY`, (res) => {
      assert.match(res.headers['content-type'], /text\/event-stream/);
      let buf = '';
      res.on('data', (d) => { buf += d; const parts = buf.split('\n\n'); buf = parts.pop(); for (const p of parts) { const m = /event: (\w+)\ndata: (.*)/.exec(p); if (m) events.push([m[1], JSON.parse(m[2])]); } if (events.some((e) => e[0] === 'trade')) { req.destroy(); resolve(); } });
      setTimeout(() => ws.push([{ ev: 'T', sym: 'SPY', p: 770.13, s: 7, t: Date.now() }]), 50);
    });
    req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
    setTimeout(() => reject(new Error('no trade event')), 3000);
  });
  assert.equal(events[0][0], 'snapshot'); assert.equal(events[0][1].source, 'massive');
  assert.equal(events.find((e) => e[0] === 'trade')[1].price, 770.13);
  const bad = await fetch(`http://127.0.0.1:${port}/academy-activity/stream?symbol=%3Cscript%3E`);
  assert.equal(bad.status, 400);
  server.close(); svc.stop();
});

test('public market routes are license-gated, CORS-scoped and serve cached candles when enabled', async () => {
  const disabled = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, publicMarketDataEnabled: false });
  await new Promise((resolve) => disabled.listen(0, '127.0.0.1', resolve));
  const disabledUrl = `http://127.0.0.1:${disabled.address().port}/market-data/candles?symbol=SPY&tf=5m`;
  const off = await fetch(disabledUrl, { headers: { origin: 'https://stockmarketloop.com' } });
  assert.equal(off.status, 503);
  assert.equal((await off.json()).error, 'public_market_data_disabled');
  disabled.close();

  const history = { enabled: true, get: async (symbol, tf) => ({ ok: true, status: 200, data: { symbol, tf, bars: [{ t: 1, o: 1, h: 1, l: 1, c: 1, v: 1 }] } }) };
  const enabled = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, publicMarketDataEnabled: true, marketHistory: history });
  await new Promise((resolve) => enabled.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${enabled.address().port}`;
  const good = await fetch(`${base}/market-data/candles?symbol=SPY&tf=5m`, { headers: { origin: 'https://creator.stockmarketloop.com' } });
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('access-control-allow-origin'), 'https://creator.stockmarketloop.com');
  assert.equal((await good.json()).bars.length, 1);
  const blocked = await fetch(`${base}/market-data/candles?symbol=SPY&tf=5m`, { headers: { origin: 'https://attacker.test' } });
  assert.equal(blocked.status, 403);
  enabled.close();
});
