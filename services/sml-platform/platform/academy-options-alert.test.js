'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const CA = require('./academy-click-alert');
const OA = require('./academy-options-alert');
const calc = require('./academy-options-calc');
const format = require('./academy-alert-format');

let seed = 5;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
function daily(n, price = 100, sigma = 0.02) {
  const out = []; let p = price; const t0 = Date.now() - n * 864e5;
  for (let i = 0; i < n; i++) { const r = 0.0005 + (rnd() - 0.5) * 2 * sigma * 1.7, o = p, c = p * (1 + r); out.push({ t: t0 + i * 864e5, o, h: Math.max(o, c) * 1.003, l: Math.min(o, c) * 0.997, c, v: 1e6 }); p = c; }
  return out;
}
function intraday(n, price, step = 3e5) { const out = []; let p = price; const t0 = Date.now() - n * step; for (let i = 0; i < n; i++) { const c = p * (1 + (rnd() - 0.5) * 0.002); out.push({ t: t0 + i * step, o: p, h: Math.max(p, c) * 1.0004, l: Math.min(p, c) * 0.9996, c, v: 1e4 }); p = c; } return out; }
const D = daily(300), spot = D[D.length - 1].c;
const EXPIRY = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);
function rows(over = {}) {
  const T = 30 / 365, out = [];
  for (let k = Math.round(spot * 0.8); k <= spot * 1.3; k += Math.max(1, Math.round(spot * 0.02))) {
    const leg = (t) => { const p = calc.price(t, spot, k, T, 0.043, 0, 0.3).price; return { bid: +(p * 0.98).toFixed(2), ask: +(p * 1.02).toFixed(2), iv: 0.3, oi: 1200, volume: 300, ...over }; };
    out.push({ expiry: EXPIRY, strike: k, call: leg('call'), put: leg('put') });
  }
  return out;
}
const analysisUp = () => CA.classify({ symbol: 'TEST', target: spot * 1.08, price: spot, bars: { daily: D, weekly: D.filter((_, i) => i % 5 === 4), m5: intraday(200, spot), m15: intraday(200, spot, 9e5), fresh: true } });
const strikeNear = (r) => r.map((x) => x.strike).reduce((a, b) => (Math.abs(b - spot * 1.02) < Math.abs(a - spot * 1.02) ? b : a));

test('a call priced from the chain carries cost, breakeven, estimates and greeks', () => {
  const r = rows(), k = strikeNear(r);
  const o = OA.buildOptionsAlert({ analysis: analysisUp(), rows: r, contract: { type: 'call', strike: k, expiry: EXPIRY } });
  assert.equal(o.ok, true);
  assert.ok(o.contract.mid > 0); assert.equal(o.contract.perContract, Math.round(o.contract.mid * 100));
  assert.ok(o.estimates.atTarget.base > o.contract.mid, 'a call is worth more at a higher stock price');
  assert.ok(o.estimates.atStop.value < o.contract.mid);
  assert.ok(o.contract.delta > 0 && o.contract.delta < 1);
  assert.equal(o.estimates.breakeven, Math.round((k + o.contract.mid) * 100) / 100);
});

test('a put against a long idea, an unknown contract and an expired one are refused with plain reasons', () => {
  const r = rows(), k = strikeNear(r), a = analysisUp();
  assert.throws(() => OA.buildOptionsAlert({ analysis: a, rows: r, contract: { type: 'put', strike: k, expiry: EXPIRY } }), (e) => e.code === 'contract_conflicts_with_target');
  assert.throws(() => OA.buildOptionsAlert({ analysis: a, rows: r, contract: { type: 'call', strike: 99999, expiry: EXPIRY } }), (e) => e.code === 'contract_not_found');
  assert.throws(() => OA.buildOptionsAlert({ analysis: a, rows: r, contract: { type: 'call', strike: k, expiry: 'tomorrow' } }), (e) => e.code === 'invalid_contract');
});

test('the options alert text keeps the layout and fits Discord', () => {
  const r = rows(), k = strikeNear(r), a = analysisUp();
  const o = OA.buildOptionsAlert({ analysis: a, rows: r, contract: { type: 'call', strike: k, expiry: EXPIRY } });
  const text = format.formatOptionsContractAlert({ ...a.alert, mention: true, contract: o.contract, estimates: o.estimates, risk: o.risk });
  assert.match(text, /^@everyone\n🔥 𝐓𝐄𝐒𝐓 𝐂𝐀𝐋𝐋𝐒 \| 𝐒𝐓𝐑𝐈𝐊𝐄/);
  for (const part of ['𝐒𝐄𝐓𝐔𝐏', '𝐌𝐎𝐌𝐄𝐍𝐓𝐔𝐌', '𝐓𝐀𝐑𝐆𝐄𝐓 𝐙𝐎𝐍𝐄', '𝐁𝐑𝐄𝐀𝐊𝐄𝐕𝐄𝐍', '𝐀𝐓 𝐓𝐀𝐑𝐆𝐄𝐓', '𝐀𝐓 𝐒𝐓𝐎𝐏', '𝐆𝐑𝐄𝐄𝐊𝐒', '𝐒𝐓𝐎𝐏 𝐋𝐎𝐒𝐒']) assert.ok(text.includes(part), part);
  assert.ok(text.length < 1900, 'length ' + text.length);
});

function service(chain, posts) {
  const GUILD = '111111111111111111', CHAN = '444444444444444444', USER = '333333333333333333';
  const directory = { guildsFor: async () => [], sendableChannels: async () => [], postingIn: async () => ({ guildId: GUILD, name: 'a', userCanSend: true, botCanSend: true, mentionEveryone: true, userCanAttach: true, botCanAttach: true }), post: async (c, body, files) => { posts.push({ body, files }); return { id: '555555555555555555', channelId: c }; } };
  const svc = CA.createClickAlertService({ getBars: async (s, tf) => ({ bars: tf === '1D' ? D : tf === '1W' ? D.filter((_, i) => i % 5 === 4) : tf === '15m' ? intraday(200, spot, 9e5) : intraday(200, spot) }), chain, directory, freeUserIds: [USER] });
  return { svc, USER, CHAN };
}

test('preview and send with a contract post the options layout and record the contract', async () => {
  const posts = [], r = rows(), k = strikeNear(r);
  const { svc, USER, CHAN } = service(async () => r, posts);
  const contract = { type: 'call', strike: k, expiry: EXPIRY };
  const p = await svc.preview(USER, { symbol: 'TEST', target: spot * 1.08, contract });
  assert.equal(p.ok, true); assert.ok(p.options && p.options.contract.mid > 0);
  assert.equal(p.scenarios.images.length, 2);
  for (const im of p.scenarios.images) assert.ok(im.svg.includes(p.options.contract.name.replace(/&/g, '&amp;')) && im.svg.includes('breakeven'), 'both images carry the contract');
  assert.match(p.analysis.alertText, /𝐂𝐀𝐋𝐋𝐒/); assert.match(p.analysis.alertText, /𝐁𝐑𝐄𝐀𝐊𝐄𝐕𝐄𝐍/);
  const s = await svc.send({ userId: USER, displayName: 'Ana' }, { symbol: 'TEST', target: spot * 1.08, contract, channelId: CHAN });
  assert.equal(s.ok, true); assert.ok(s.contract.name);
  assert.match(posts[0].body.content, /𝐂𝐀𝐋𝐋𝐒/);
  const again = await svc.send({ userId: USER, displayName: 'Ana' }, { symbol: 'TEST', target: spot * 1.08, contract, channelId: CHAN });
  assert.equal(again.code, 'duplicate_alert');
});

test('contract errors map to 4xx and no chain gives 503', async () => {
  const r = rows(), k = strikeNear(r);
  const a = service(async () => r, []);
  const bad = await a.svc.preview(a.USER, { symbol: 'TEST', target: spot * 1.08, contract: { type: 'put', strike: k, expiry: EXPIRY } });
  assert.equal(bad.ok, false); assert.equal(bad.status, 422); assert.equal(bad.code, 'contract_conflicts_with_target');
  const none = service(async () => null, []);
  const off = await none.svc.preview(none.USER, { symbol: 'TEST', target: spot * 1.08, contract: { type: 'call', strike: k, expiry: EXPIRY } });
  assert.equal(off.status, 503); assert.equal(off.code, 'options_unavailable');
  const stock = await a.svc.preview(a.USER, { symbol: 'TEST', target: spot * 1.08 });
  assert.equal(stock.ok, true); assert.equal(stock.options, null);
});

test('options ALERT mode: a contract with no chart target gets its target from the contract and runs the same analysis, scenarios and layout', async () => {
  const posts = [], r = rows(), k = strikeNear(r);
  const { svc, USER, CHAN } = service(async () => r, posts);
  const contract = { type: 'call', strike: k, expiry: EXPIRY };
  const p = await svc.preview(USER, { symbol: 'TEST', contract, autoTarget: true });
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.equal(p.analysis.autoTarget, true);
  assert.equal(p.analysis.side, 'long');
  assert.ok(p.analysis.target > spot, 'a call targets above the live price');
  assert.ok(p.analysis.target > p.options.estimates.breakeven - 0.01, 'and past the breakeven');
  assert.match(p.analysis.targetBasis, /^(next resistance at \$|breakeven \$|live price \$)/);
  assert.ok(p.analysis.rationale[0].startsWith('Target set from the ' + EXPIRY));
  assert.equal(p.scenarios.images.length, 2);
  assert.match(p.analysis.alertText, /\u{1D402}\u{1D400}\u{1D40B}\u{1D40B}\u{1D412}/u);
  assert.ok(p.analysis.alertText.includes('Target from the contract: '));
  // a missing target with a contract means the same thing
  const q = await svc.preview(USER, { symbol: 'TEST', contract });
  assert.equal(q.ok, true); assert.equal(q.analysis.target, p.analysis.target);
  // a put is mirrored
  const put = await svc.preview(USER, { symbol: 'TEST', contract: { type: 'put', strike: k, expiry: EXPIRY }, autoTarget: true });
  assert.equal(put.ok, true, JSON.stringify(put)); assert.equal(put.analysis.side, 'short'); assert.ok(put.analysis.target < spot);
  // the post and the record are the same as a clicked target
  const s = await svc.send({ userId: USER, displayName: 'Ana' }, { symbol: 'TEST', contract, autoTarget: true, channelId: CHAN });
  assert.equal(s.ok, true, JSON.stringify(s)); assert.equal(s.analysis.autoTarget, true); assert.equal(s.analysis.target, p.analysis.target);
  assert.ok(posts[0].body.content.includes('Target from the contract: '));
  assert.equal(posts[0].files.length, 2, 'both scenario charts ride along');
  const again = await svc.send({ userId: USER, displayName: 'Ana' }, { symbol: 'TEST', contract, autoTarget: true, channelId: CHAN });
  assert.equal(again.code, 'duplicate_alert');
  // a clicked target still wins when autoTarget is not asked for
  const clicked = await svc.preview(USER, { symbol: 'TEST', target: spot * 1.08, contract });
  assert.equal(clicked.ok, true); assert.ok(!clicked.analysis.autoTarget); assert.equal(clicked.analysis.target, spot * 1.08);
});

test('options ALERT mode refuses an unknown contract, a missing chain and an unsubscribed member', async () => {
  const r = rows();
  const a = service(async () => r, []);
  const missing = await a.svc.preview(a.USER, { symbol: 'TEST', contract: { type: 'call', strike: 99999, expiry: EXPIRY }, autoTarget: true });
  assert.equal(missing.status, 404); assert.equal(missing.code, 'contract_not_found');
  const none = service(async () => null, []);
  const off = await none.svc.preview(none.USER, { symbol: 'TEST', contract: { type: 'call', strike: strikeNear(r), expiry: EXPIRY }, autoTarget: true });
  assert.equal(off.status, 503); assert.equal(off.code, 'options_unavailable');
  const bad = await a.svc.preview(a.USER, { symbol: 'TEST', contract: { type: 'call', strike: 'x', expiry: EXPIRY }, autoTarget: true });
  assert.equal(bad.code, 'invalid_contract');
  const unsub = CA.createClickAlertService({ getBars: async () => ({ bars: D }), chain: async () => r, directory: { memberRolesLive: async () => [] }, academyGuildId: '111111111111111111', roleIds: ['222222222222222222'] });
  const u = await unsub.preview('333333333333333333', { symbol: 'TEST', contract: { type: 'call', strike: strikeNear(r), expiry: EXPIRY }, autoTarget: true });
  assert.equal(u.status, 402); assert.equal(u.code, 'click_alert_subscription_required');
});
