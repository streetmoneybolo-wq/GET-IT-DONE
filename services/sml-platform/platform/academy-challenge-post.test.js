'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const post = require('./academy-challenge-post');

const T = Date.UTC(2026, 9, 15, 15, 30, 0);
const ev = (o) => ({ symbol: 'NVDA', side: 'buy', trade: { qty: 3.4, price: 182.1 }, before: 0, after: 3.4, avgAfter: 182.1, totalBought: 3.4, totalBoughtCost: 619.14, stop: 176.4, target: 194.8, grade: 'A', score: 82, reason: 'Higher-timeframe trend, Volume, Gamma pressure', equity: 1250.3, cash: 631.16, ...o });

test('kind: entry, add, trim, exit from the position before and after', () => {
  assert.equal(post.kindOf(ev({})), 'entry');
  assert.equal(post.kindOf(ev({ before: 3.4, after: 4.6 })), 'add');
  assert.equal(post.kindOf(ev({ side: 'sell', before: 3.4, after: 1.7 })), 'trim');
  assert.equal(post.kindOf(ev({ side: 'sell', before: 3.4, after: 0 })), 'exit');
});

test('the words: what happened, where the position stands, the plan or the result, always simulated', () => {
  const entry = post.composeTrade(ev({}));
  assert.ok(entry.includes('🟢 **BOUGHT NVDA**') && entry.includes('**3.4 shares** × **$182.10** = **$619.14**') && entry.includes('Now holding: **3.4 shares** (average $182.10)') && entry.includes('🛑 Stop **$176.40** · 🎯 Target **$194.80** · grade **A 82**') && entry.includes('💼 Account now **$1,250.30**') && /SIMULATED/.test(entry));
  const add = post.composeTrade(ev({ before: 3.4, after: 4.6, avgAfter: 183, trade: { qty: 1.2, price: 185.5 }, totalBought: 4.6, totalBoughtCost: 841.74 }));
  assert.ok(add.includes('**ADDED TO NVDA**') && add.includes('This buy: **1.2 shares** × **$185.50** = **$222.60**') && add.includes('Total bought so far: **4.6 shares** for $841.74') && add.includes('Now holding: **4.6 shares** (average $183.00)'));
  const trim = post.composeTrade(ev({ side: 'sell', before: 4.6, after: 2.3, avgBefore: 183, avgAfter: 183, trade: { qty: 2.3, price: 190 }, realized: 16.1, reason: 'target', stop: null, target: null }));
  assert.ok(trim.includes('🟡 **SOLD PART OF NVDA**') && trim.includes('Sold **2.3 shares** of 4.6 shares × **$190.00** = **$437.00**') && trim.includes('✅ Profit on this piece: **$16.10** (+3.83%)') && trim.includes('Still holding: **2.3 shares**') && trim.includes('🧭 Why sold: target') && !trim.includes('🛑'));
  const exit = post.composeTrade(ev({ side: 'sell', before: 2.3, after: 0, avgBefore: 183, trade: { qty: 2.3, price: 176.4 }, realized: -15.18, totalBought: 4.6, reason: 'stop', equity: 1230.1 }));
  assert.ok(exit.includes('🔴 **SOLD ALL NVDA**') && exit.includes('❌ LOSS: **-$15.18** (-3.61%) on 4.6 shares bought') && exit.includes('Now holding: **0** — out.') && exit.includes('Why sold: stop'));
  assert.ok(post.composeTrade(ev({ trade: { qty: 1, price: 50 }, after: 1 })).includes('**1 share** × **$50.00**'));
});

test('the idea text carries the four numbers and where to click', () => {
  const s = post.composeIdea({ id: 7, symbol: 'AMD', mode: 'swing', grade: 'A', score: 79, qty: 2, entry: 150.25, riskDollars: 30, stop: 135.25, target: 171, reason: 'Volume, Momentum', expiresAt: T });
  assert.ok(s.includes('💡 **1K→100K IDEA #7: BUY AMD**') && s.includes('**2 shares** × about **$150.25** = **$300.50**') && s.includes('🛑 Stop **$135.25** (risking $30.00) · 🎯 Target **$171.00**') && s.includes('**TAKE IT**') && s.includes('11:30 AM ET'));
});

test('the order card: badge, ticker, shares × price, total, standing, plan; monogram without a logo, image with one; escaped', () => {
  const svg = post.orderCardSvg(ev({ symbol: 'NV<DA' }), { now: T, company: 'NVIDIA Corp' });
  assert.ok(svg.includes('>BOUGHT<') && svg.includes('NV&lt;DA') && svg.includes('3.4 SHARES') && svg.includes('$182.10') && svg.includes('$619.14') && svg.includes('NOW HOLDING') && svg.includes('STOP') && svg.includes('TARGET') && svg.includes('SIMULATED') && svg.includes('NVIDIA Corp') && !svg.includes('<image'));
  const withLogo = post.orderCardSvg(ev({}), { now: T, logo: 'data:image/png;base64,AAAA' });
  assert.ok(withLogo.includes('<image') && withLogo.includes('data:image/png;base64,AAAA'));
  const exit = post.orderCardSvg(ev({ side: 'sell', before: 3.4, after: 0, avgBefore: 182.1, trade: { qty: 3.4, price: 176.4 }, realized: -19.38, reason: 'stop' }), { now: T });
  assert.ok(exit.includes('>SOLD ALL<') && exit.includes('TOTAL PROCEEDS') && exit.includes('LOSS') && exit.includes('POSITION CLOSED') && exit.includes('WHY: STOP'));
  const r = post.renderOrderCard(ev({}), { now: T }); assert.equal(r.name, 'nvda-entry-2026-10-15.png'); assert.ok(r.svg && (r.png === null || Buffer.isBuffer(r.png)));
});

test('logo lookup: reference branding -> data URI, cached; null without a key or on failure', async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); if (url.includes('/v3/reference/tickers/NVDA')) return { ok: true, json: async () => ({ results: { name: 'NVIDIA Corp', branding: { icon_url: 'https://api.massive.com/v1/reference/company-branding/x/images/icon.png' } } }) }; if (url.includes('icon.png')) return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => new Uint8Array([137, 80, 78, 71]).buffer }; return { ok: false, status: 404 }; };
  const l = post.createLogoLookup({ apiKey: 'k', fetchImpl, now: () => T });
  const a = await l.lookup('nvda'); assert.equal(a.name, 'NVIDIA Corp'); assert.ok(a.logo.startsWith('data:image/png;base64,')); assert.ok(calls[1].includes('apiKey=k'));
  await l.lookup('NVDA'); assert.equal(calls.length, 2, 'cached');
  assert.equal(await l.lookup('ZZZZ'), null);
  assert.equal(await post.createLogoLookup({ apiKey: '', fetchImpl }).lookup('NVDA'), null);
});
