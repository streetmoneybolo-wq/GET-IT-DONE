'use strict';
process.env.ACADEMY_ALERTS_START = ''; // most tests use the normal recent window; the GLND/INTC starting point has its own test below
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseAlertMessage } = require('./academy-alerts-parse');
const R = require('./academy-alert-risk');
const { createAlertsService, defaultChannels, sectorFor } = require('./academy-alerts');

const DAY = 86400000;
/* deterministic daily candles: a drift with noise, ending at `end` */
function series(n, { start = 10, drift = 0.002, noise = 0.03, vol = 2_000_000, seed = 5, end = null } = {}) {
  let x = seed; const rnd = () => { x = (x * 1664525 + 1013904223) % 4294967296; return x / 4294967296; };
  const bars = []; let p = start; const t0 = Date.UTC(2026, 0, 5);
  for (let i = 0; i < n; i++) {
    const o = p, c = Math.max(0.05, o * (1 + drift + (rnd() - 0.5) * noise)); const h = Math.max(o, c) * (1 + rnd() * noise / 2), l = Math.min(o, c) * (1 - rnd() * noise / 2);
    bars.push({ t: t0 + i * DAY, o, h, l, c, v: vol * (0.6 + rnd()) }); p = c;
  }
  if (end != null) { const k = end / bars[n - 1].c; for (const b of bars) { b.o *= k; b.h *= k; b.l *= k; b.c *= k; } }
  return bars;
}
const fin = (over = {}) => {
  const q = (i, r) => Object.assign({ period_end: `2025-${String(12 - i * 3 > 0 ? 12 - i * 3 : 12 - i * 3 + 12).padStart(2, '0')}-28`, revenue: 100 + r, net_income_loss_attributable_common_shareholders: 10, diluted_shares_outstanding: 1000, net_cash_from_operating_activities: 12, total_equity: 500, cash_and_equivalents: 300, debt_current: 50 }, {});
  const rows = Array.from({ length: 8 }, (_, i) => Object.assign(q(i, 50 - i * 5), { period_end: new Date(Date.UTC(2026, 5 - i * 3, 28)).toISOString().slice(0, 10) }));
  return Object.assign({ income_statement: rows, balance_sheet: rows, cash_flow: rows, ratios: [{ debt_to_equity: 0.5, earnings_per_share: 2, market_cap: 5e10 }] }, over);
};

test('the parser reads the trader\'s real alert styles, including cents, decimal commas and typos', () => {
  const p = (s) => parseAlertMessage(s, '2026-09-22T12:00:00Z');
  assert.deepEqual(pick(p('@everyone GDC entry $2 pt 2.33 plus')), { symbol: 'GDC', entryPrice: 2, targetPrice: 2.33, targetIsMinimum: true, riskFlag: false });
  assert.deepEqual(pick(p('@everyone NEXR entry 33cents pt 38cents plus')), { symbol: 'NEXR', entryPrice: 0.33, targetPrice: 0.38, targetIsMinimum: true, riskFlag: false });
  assert.deepEqual(pick(p('@everyone CCXI entry 14,40 pt 16 plus')), { symbol: 'CCXI', entryPrice: 14.4, targetPrice: 16, targetIsMinimum: true, riskFlag: false });
  assert.equal(p('@everyone SLXN entry 67cents pt 78cents plyus').targetIsMinimum, true, 'a typo of plus still counts');
  assert.equal(p('@everyone ZEO entry 34cents pt 55cents plus high risk').riskFlag, true);
  assert.equal(p('@everyone fngr ENTRY 16CENTS PT 20CENTS PLUS HIGH RISK').symbol, 'FNGR');
  assert.equal(p('@everyone AKAN entry 3.38 pt 3.55').targetIsMinimum, false);
  assert.equal(p('SPY calls 590 1/16').kind, 'option');
  assert.equal(p('good morning everyone'), null);
  assert.equal(p(''), null);
  assert.equal(p('@everyone BAD entry 0 pt 0 plus'), null, 'a zero price is not an alert');
});
const pick = (o) => ({ symbol: o.symbol, entryPrice: o.entryPrice, targetPrice: o.targetPrice, targetIsMinimum: o.targetIsMinimum, riskFlag: o.riskFlag });

const quote = (last, extra = {}) => Object.assign({ sym: 'X', last, chgPct: 0.5, o: last, h: last * 1.02, l: last * 0.98, c: last, v: 1e6, bid: last * 0.999, bs: 500, ask: last * 1.001, as: 500 }, extra);
const swing = (over = {}) => Object.assign({ channel: 'swings', kind: 'equity', symbol: 'X', entry: 2, target: 2.4, riskFlag: false, at: Date.now() - DAY }, over);

test('a thin, volatile penny stock grades far riskier than a large steady company', () => {
  const penny = R.gradeRisk({ alert: swing({ entry: 0.4, target: 0.6 }), quote: quote(0.4), daily: series(120, { start: 0.4, noise: 0.16, vol: 100000 }), spreadPct: 0.05, now: Date.now() });
  const blue = R.gradeRisk({ alert: swing({ entry: 150, target: 158 }), quote: quote(150), daily: series(260, { start: 120, drift: 0.001, noise: 0.012, vol: 40_000_000, end: 150 }), spreadPct: 0.0005, fin: fin(), company: { market_cap: 5e11 }, now: Date.now() });
  assert.ok(penny.score >= 65 && ['HIGH', 'EXTREME'].includes(penny.band), `penny ${penny.score} ${penny.band}`);
  assert.ok(blue.score <= 44 && ['LOW', 'MODERATE'].includes(blue.band), `blue chip ${blue.score} ${blue.band}`);
  assert.ok(penny.score - blue.score >= 30);
});

test('risk is scaled over the data that exists, and says how much that was', () => {
  const thin = R.gradeRisk({ alert: swing(), quote: quote(2), now: Date.now() });
  assert.ok(thin.coverage < 30 && thin.flags.some((f) => /Very little data/.test(f)));
  assert.ok(thin.score >= 0 && thin.score <= 100);
  const full = R.gradeRisk({ alert: swing(), quote: quote(2), daily: series(200, { start: 2 }), fin: fin(), company: { market_cap: 4e8, sic_description: 'SEMICONDUCTORS' }, short: { summary: { avg_ratio: 50 }, interest: [{ days_to_cover: 2 }] }, sentiment: { posts: [{ sentiment: 'Bullish', comment: 'up' }, { sentiment: 'Bullish', comment: 'ok' }, { sentiment: 'Bearish', comment: 'hmm' }] }, filings: [], market: { spyChgPct: 0.2 }, now: Date.now() });
  assert.ok(full.coverage > thin.coverage);
  assert.equal(full.factors.length, 11);
});

test('the author\'s own high-risk flag and share offerings raise the grade', () => {
  const base = { alert: swing(), quote: quote(2), daily: series(120, { start: 2 }), now: Date.now() };
  assert.ok(R.gradeRisk({ ...base, alert: swing({ riskFlag: true }) }).score >= 70);
  const cheap = R.gradeRisk({ ...base, filings: [] }), diluting = R.gradeRisk({ ...base, filings: [{ form_type: '424B5', filing_date: new Date(Date.now() - 10 * DAY).toISOString().slice(0, 10) }] });
  assert.ok(diluting.score > cheap.score);
  assert.ok(diluting.factors.find((f) => f.key === 'offerings').detail.includes('dilution'));
});

test('red-flag chatter and bearish sentiment raise risk, and bullish calm does not', () => {
  const posts = (arr) => ({ posts: arr.map(([s, c]) => ({ sentiment: s, comment: c })) });
  const base = { alert: swing(), quote: quote(2), daily: series(120, { start: 2 }), now: Date.now() };
  const calm = R.gradeRisk({ ...base, sentiment: posts([['Bullish', 'nice'], ['Bullish', 'good'], ['Bearish', 'eh']]) }).score;
  const scary = R.gradeRisk({ ...base, sentiment: posts([['Bearish', 'offering incoming'], ['Bearish', 'they will dilute, reverse split'], ['Bearish', 'halt?']]) }).score;
  assert.ok(scary > calm + 3);
});

test('the company checklist answers yes or no, and unknown when data is missing', () => {
  const good = R.checklist({ fin: fin(), company: { market_cap: 5e10 }, daily: series(260, { start: 50, drift: 0.002 }), quote: quote(90) });
  assert.equal(good.total, 9);
  const byKey = Object.fromEntries(good.items.map((i) => [i.key, i.ok]));
  assert.equal(byKey.profit, true); assert.equal(byKey.growth, true); assert.equal(byKey.cash, true); assert.equal(byKey.debt, true); assert.equal(byKey.size, true);
  const losing = R.checklist({ fin: fin({ income_statement: fin().income_statement.map((r) => ({ ...r, net_income_loss_attributable_common_shareholders: -5, diluted_shares_outstanding: r.diluted_shares_outstanding * (1 + (r.period_end < '2026-01-01' ? 0 : 0.3)) })), ratios: [{ debt_to_equity: 4, earnings_per_share: -1, market_cap: 2e7 }] }), company: { market_cap: 2e7 }, daily: series(260, { start: 50, drift: -0.003 }), quote: quote(20) });
  const lk = Object.fromEntries(losing.items.map((i) => [i.key, i.ok]));
  assert.equal(lk.profit, false); assert.equal(lk.debt, false); assert.equal(lk.size, false); assert.equal(lk.value, false);
  const none = R.checklist({ fin: null, company: null, daily: null, quote: null });
  assert.equal(none.unknown, none.total);
  assert.ok(none.items.every((i) => i.ok === null));
});

/* ---- plan ---- */
function planCase({ alert = swing(), last, since, risk = { band: 'MODERATE' }, algoView = { bias: 'long', latestSignal: null }, flow = null, sentiment = null, checklistValue = null, daily = series(120, { start: 2 }) }) {
  return R.planFor({ alert, quote: quote(last), daily, since: since || { high: Math.max(alert.entry, last), low: Math.min(alert.entry, last) }, risk, algoView, flow, sentiment, checklist: checklistValue, now: Date.now() });
}

test('plan: price under the invalidation line is a sell', () => {
  const p = planCase({ last: 1.5 });
  assert.equal(p.action, 'SELL'); assert.match(p.reasons.join(' '), /invalidation/);
});

test('plan: a target that was reached with strong momentum raises the target and trails the stop', () => {
  const p = planCase({ last: 2.5, since: { high: 2.52, low: 2 }, flow: { bias: 'bullish' } });
  assert.equal(p.action, 'RAISE_TARGET');
  assert.ok(p.target > 2.4 && p.stop >= 2, `${p.target} ${p.stop}`);
});

test('plan: target reached but the risk is high means take partial profits and keep a higher target for the rest', () => {
  const p = planCase({ last: 2.5, since: { high: 2.52, low: 2 }, risk: { band: 'HIGH' } });
  assert.equal(p.action, 'PARTIAL'); assert.ok(p.target > 2.4);
});

test('plan: target reached and then fading, or MEM ALGO turned, is a sell', () => {
  assert.equal(planCase({ last: 2.3, since: { high: 2.6, low: 2 } }).action, 'SELL');
  assert.equal(planCase({ last: 2.5, since: { high: 2.55, low: 2 }, algoView: { bias: 'short', latestSignal: { dir: -1, recent: true } } }).action, 'SELL');
});

test('plan: midway with weakening signals is a partial; healthy midway is a hold with reasons', () => {
  const weak = planCase({ last: 2.25, since: { high: 2.27, low: 2 }, flow: { bias: 'bearish' } });
  assert.equal(weak.action, 'PARTIAL');
  const ok = planCase({ last: 2.25, since: { high: 2.27, low: 2 }, flow: { bias: 'bullish' } });
  assert.equal(ok.action, 'HOLD'); assert.ok(ok.reasons.length >= 2);
});

test('plan: a swing that stalls for over a week is exited', () => {
  const p = planCase({ alert: swing({ at: Date.now() - 9 * DAY }), last: 2.03, since: { high: 2.08, low: 1.95 } });
  assert.equal(p.action, 'SELL'); assert.match(p.reasons.join(' '), /days/);
});

test('plan: long-term reached target with a weak company checklist takes partial profits rather than raising', () => {
  const alert = swing({ channel: 'longterm', entry: 100, target: 140, at: Date.now() - 60 * DAY });
  const weak = R.planFor({ alert, quote: quote(141), daily: series(260, { start: 80, end: 141 }), since: { high: 143, low: 100 }, risk: { band: 'MODERATE' }, algoView: { bias: 'long', latestSignal: null }, flow: null, sentiment: null, checklist: { yes: 2, no: 6, unknown: 1, total: 9 }, now: Date.now() });
  assert.equal(weak.action, 'PARTIAL');
  const strong = R.planFor({ alert, quote: quote(141), daily: series(260, { start: 80, end: 141 }), since: { high: 143, low: 100 }, risk: { band: 'LOW' }, algoView: { bias: 'long', latestSignal: null }, flow: null, sentiment: null, checklist: { yes: 8, no: 1, unknown: 0, total: 9 }, now: Date.now() });
  assert.equal(strong.action, 'RAISE_TARGET'); assert.ok(strong.target > 140);
});

/* ---- service ---- */
function makeFetch({ discord = {}, quotes = {}, log = [] } = {}) {
  const t0 = Date.parse('2026-09-24T14:00:00Z');
  return async (url, options = {}) => {
    log.push(String(url));
    const u = String(url);
    if (u.includes('discord.com')) {
      const m = /channels\/(\d+)\/messages/.exec(u); const id = m && m[1];
      const spec = discord[id];
      if (!spec || spec.status) return new Response(JSON.stringify({ message: 'no' }), { status: spec ? spec.status : 403 });
      const auth = options.headers && options.headers.authorization;
      if (spec.token && auth !== `Bot ${spec.token}`) return new Response('{}', { status: 401 });
      return new Response(JSON.stringify(spec.messages), { status: 200 });
    }
    if (u.includes('/sml-scanner/v1/quotes')) {
      const syms = decodeURIComponent(u.split('symbols=')[1]).split(',');
      return new Response(JSON.stringify({ rows: syms.map((s) => quote(quotes[s] || 10, { sym: s })) }), { status: 200 });
    }
    if (u.includes('/sml-short/v1/financials')) return new Response(JSON.stringify({ datasets: fin() }), { status: 200 });
    if (u.includes('/market-data/company')) return new Response(JSON.stringify({ name: 'Test Co', market_cap: 4e8, sic_description: 'SEMICONDUCTORS & RELATED DEVICES' }), { status: 200 });
    if (u.includes('/sml-short/v1/short')) return new Response(JSON.stringify({ summary: { avg_ratio: 42 }, interest: [{ days_to_cover: 2 }] }), { status: 200 });
    if (u.includes('/sml-stocktwits')) return new Response(JSON.stringify({ posts: [{ sentiment: 'Bullish', comment: 'ok', timestamp: new Date(t0).toISOString() }] }), { status: 200 });
    if (u.includes('/market-data/filings')) return new Response(JSON.stringify({ filings: [] }), { status: 200 });
    return new Response('{}', { status: 404 });
  };
}
const msg = (id, content, at) => ({ id, content, timestamp: at, author: { username: 'memscorekeeper' } });
const candles = async (symbol, tf) => ({ bars: series(tf === '1D' ? 200 : 300, { start: 2, end: 2.2 }).map((b, i, a) => (tf === '1D' ? b : { ...b, t: Date.now() - (a.length - i) * 300000 })) });

async function boot(opts = {}) {
  const log = [];
  const channels = [{ key: 'swings', id: '111', mirrorId: '211' }, { key: 'longterm', id: '222', mirrorId: '' }];
  const svc = createAlertsService({ tokens: [{ label: 'a', token: 'tok-a' }, { label: 'b', token: 'tok-b' }], channels, origin: 'https://wp.test', candles, fetchImpl: makeFetch({ ...opts, log }), now: () => Date.parse('2026-09-24T15:00:00Z') });
  return { svc, log, channels };
}
const good = () => ({ 111: { token: 'tok-b', messages: [msg('300', '@everyone GDC entry $2 pt 2.33 plus', '2026-09-24T13:00:00Z'), msg('299', 'chat', '2026-09-24T12:00:00Z'), msg('298', '@everyone ZEO entry 34cents pt 55cents plus high risk', '2026-09-23T13:00:00Z')] }, 222: { token: 'tok-b', messages: [msg('400', '@everyone INTC entry 102 pt 138 plus', '2026-09-10T13:00:00Z')] } });

test('the service reads both channels, tries the next token, and builds graded alerts with plans', async () => {
  const { svc } = await boot({ discord: good(), quotes: { GDC: 2.1, ZEO: 0.4, INTC: 120 } });
  await svc.poll(); await svc.refresh();
  assert.equal(svc.feed.swings.ok, true); assert.equal(svc.feed.swings.tokenLabel, 'b'); assert.equal(svc.feed.longterm.ok, true);
  const snap = svc.snapshot();
  assert.equal(snap.alerts.length, 3);
  const gdc = snap.alerts.find((a) => a.symbol === 'GDC'), zeo = snap.alerts.find((a) => a.symbol === 'ZEO'), intc = snap.alerts.find((a) => a.symbol === 'INTC');
  assert.ok(gdc.risk.score >= 0 && gdc.risk.band && gdc.plan.action && gdc.entry === 2 && gdc.target0 === 2.33);
  assert.ok(zeo.risk.score >= 70, 'the author flagged ZEO high risk'); assert.equal(zeo.riskFlag, true);
  assert.equal(gdc.checklist, null, 'swing alerts carry risk, not the company checklist');
  assert.equal(intc.channel, 'longterm'); assert.equal(intc.checklist.items.length, 9); assert.ok(intc.checklist.yes + intc.checklist.no + intc.checklist.unknown === 9);
  assert.equal(gdc.sector.name, 'Semiconductors');
  assert.match(snap.disclaimer, /Not advice/);
});

test('an unreadable channel falls back to its mirror, and a fully blocked one reports why without inventing alerts', async () => {
  const d = good(); d[111] = { status: 403 }; d[211] = { token: 'tok-a', messages: [msg('310', '@everyone QQQQ entry 5 pt 5.5 plus', '2026-09-24T13:30:00Z')] };
  const a = await boot({ discord: d, quotes: { QQQQ: 5.1 } });
  await a.svc.poll(); await a.svc.refresh();
  assert.equal(a.svc.feed.swings.via, 'mirror'); assert.equal(a.svc.snapshot().alerts.filter((x) => x.channel === 'swings').length, 1);
  const blocked = await boot({ discord: { 111: { status: 403 }, 222: { status: 403 } } });
  await blocked.svc.poll(); await blocked.svc.refresh();
  assert.equal(blocked.svc.feed.swings.ok, false); assert.match(blocked.svc.feed.swings.error, /discord_403/);
  assert.equal(blocked.svc.snapshot().alerts.length, 0);
});

test('a bot that cannot read message text is reported instead of silently showing nothing', async () => {
  const d = { 111: { token: 'tok-a', messages: [msg('1', '', '2026-09-24T13:00:00Z'), msg('2', '', '2026-09-24T13:10:00Z')] }, 222: { token: 'tok-a', messages: [] } };
  const { svc } = await boot({ discord: d });
  await svc.poll();
  assert.equal(svc.feed.swings.ok, false); assert.match(svc.feed.swings.error, /message content/i);
});

test('old alerts drop out of the desk, new ones are picked up incrementally, and duplicates are not doubled', async () => {
  const d = good();
  const { svc } = await boot({ discord: d, quotes: { GDC: 2.1 } });
  await svc.poll(); await svc.poll();
  assert.equal([...svc.alerts.values()].filter((a) => a.symbol === 'GDC').length, 1);
  d[111].messages = [msg('301', '@everyone NEW entry 1 pt 1.2 plus', '2026-09-24T14:30:00Z')];
  await svc.poll();
  assert.ok([...svc.alerts.values()].some((a) => a.symbol === 'NEW'));
  const old = createAlertsService({ tokens: [{ label: 'a', token: 't' }], channels: [{ key: 'swings', id: '1' }], now: () => Date.parse('2026-09-24T15:00:00Z') });
  old.ingest('swings', msg('5', '@everyone OLD entry 1 pt 1.2 plus', '2026-08-01T13:00:00Z'));
  assert.equal(old.active().length, 0, 'a swing alert older than a week is history');
});

test('the desk keeps the plan history when the plan changes', async () => {
  const q = { GDC: 2.05 };
  const { svc } = await boot({ discord: good(), quotes: q });
  await svc.poll(); await svc.refresh();
  const id = [...svc.alerts.values()].find((a) => a.symbol === 'GDC').id;
  const first = svc.alerts.get(id).planLog.length;
  assert.ok(first >= 1);
  const detail = await svc.detail(id);
  assert.ok(detail.factors.length >= 5 && detail.planLog.length >= 1 && Array.isArray(detail.chatter));
  assert.equal(await svc.detail('999999'), null);
});

test('default channels are the two GrandMaster streams and can be overridden by environment', () => {
  assert.deepEqual(defaultChannels({}).map((c) => [c.key, c.id]), [['swings', '938944129348558848'], ['longterm', '1509325055849529455']]);
  assert.deepEqual(defaultChannels({ SML_ACADEMY_ALERT_CHANNELS: '11:swings:12, 21:longterm' }), [{ id: '11', key: 'swings', mirrorId: '12' }, { id: '21', key: 'longterm', mirrorId: '' }]);
  assert.equal(sectorFor({ sic_description: 'PHARMACEUTICAL PREPARATIONS' }).etf, 'XBI');
  assert.equal(sectorFor({ sic_description: 'SOMETHING ODD' }), null);
});

test('news wording is part of the chatter grade and reaches the detail view', async () => {
  const base = { alert: swing(), quote: quote(2), daily: series(120, { start: 2 }), now: Date.now() };
  const fresh = new Date(Date.now() - DAY).toISOString(), old = new Date(Date.now() - 30 * DAY).toISOString();
  const calm = R.gradeRisk({ ...base, news: [{ title: 'Company signs a new customer', excerpt: 'a routine update', date: fresh }] }).factors.find((f) => f.key === 'chatter');
  const scary = R.gradeRisk({ ...base, news: [{ title: 'Company announces a public offering and reverse split', excerpt: '', date: fresh }] }).factors.find((f) => f.key === 'chatter');
  const stale = R.gradeRisk({ ...base, news: [{ title: 'Company announces an offering', excerpt: '', date: old }] }).factors.find((f) => f.key === 'chatter');
  assert.ok(scary.risk > calm.risk); assert.match(scary.detail, /red-flag/); assert.equal(stale.available, false, 'a month-old headline is not this week\'s news');
  const p = R.planFor({ alert: swing(), quote: quote(2.2), daily: series(120, { start: 2 }), since: { high: 2.25, low: 2 }, risk: { band: 'MODERATE' }, algoView: { bias: 'long', latestSignal: null }, flow: null, news: [{ title: 'Company files for bankruptcy protection', date: fresh }], now: Date.now() });
  assert.notEqual(p.action, 'RAISE_TARGET');
});

test('the desk starts at GLND (swings) and INTC (long-term) and shows everything after them, newest first', () => {
  const saved = process.env.ACADEMY_ALERTS_START; delete process.env.ACADEMY_ALERTS_START;
  delete require.cache[require.resolve('./academy-alerts')];
  const fresh = require('./academy-alerts');
  if (saved !== undefined) process.env.ACADEMY_ALERTS_START = saved; delete require.cache[require.resolve('./academy-alerts')];
  const NOW = Date.now(), H = 3600_000;
  const svc = fresh.createAlertsService({ channels: [{ key: 'swings', id: '1' }, { key: 'longterm', id: '2' }], now: () => NOW });
  const m = (id, sym, ago) => ({ id, content: `@everyone ${sym} entry $2 pt 3`, timestamp: new Date(NOW - ago).toISOString(), author: { id: '258456543', username: 'x' } });
  svc.ingest('swings', m('101', 'OLD', 30 * H)); svc.ingest('swings', m('102', 'GLND', 20 * H)); svc.ingest('swings', m('103', 'NEWA', 10 * H)); svc.ingest('swings', m('104', 'NEWB', 2 * H));
  svc.ingest('longterm', m('201', 'OLDB', 90 * 24 * H)); svc.ingest('longterm', m('202', 'INTC', 40 * 24 * H)); svc.ingest('longterm', m('203', 'NEWC', 5 * 24 * H));
  const list = svc.active();
  assert.deepEqual(list.filter((a) => a.channel === 'swings').map((a) => a.symbol), ['NEWB', 'NEWA', 'GLND']);
  assert.deepEqual(list.filter((a) => a.channel === 'longterm').map((a) => a.symbol), ['NEWC', 'INTC']);
});
