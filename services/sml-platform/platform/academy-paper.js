'use strict';

/* Paper trading for the Academy: a SIMULATED brokerage account on real prices. Stocks and options, buy and sell, in the
 * regular session and in pre/after-market when a price exists, with the fills, fees and marks a real account would see:
 * buys lift the ask and sells hit the bid when a quote is there (last price with slippage otherwise), options cost a
 * per-contract fee, expired options settle at intrinsic value, short options need cash collateral. Every day is rolled up
 * (open, close, realized, fees, trades) for the P&L calendar, and a day can be recapped: what the market did, what the
 * account did, and what that says.
 *
 * The engine is pure (account in, account out) and tested; the service wraps it with the quote sources and a durable
 * store. No real money, no advice. */

const { etParts, marketState } = require('./market-clock');

/* every member's paper account starts with $25,000 (the owner's 1K -> 100K Challenge account is created with its own $1,000) */
const RULES = Object.freeze({ startCash: 25_000, stockFee: 0, optionFeePerContract: 0.65, slippageBps: 5, maxQty: 1e6, maxPositions: 60, maxTrades: 2000, maxEquityPoints: 3000 });
const MULT = 100;
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => Math.round(v * 100) / 100;
const r4 = (v) => Math.round(v * 10000) / 10000;
const etDate = (ms) => { const e = etParts(ms); return `${e.y}-${String(e.m).padStart(2, '0')}-${String(e.d).padStart(2, '0')}`; };
const sessionOf = (ms) => { const s = marketState(ms); return s.session === 'regular' ? 'regular' : s.session === 'pre' ? 'pre' : s.session === 'post' ? 'post' : 'closed'; };

function createAccount(id, { cash = RULES.startCash, name = 'Paper account', owner = '', now = Date.now() } = {}) {
  return { version: 1, id, name, owner, createdAt: now, cash: r2(cash), startCash: r2(cash), deposits: [{ t: now, amount: r2(cash), kind: 'start' }], positions: {}, trades: [], daily: {}, equity: [{ t: now, value: r2(cash) }], log: [], nextId: 1 };
}
function deposit(acct, amount, now, kind = 'deposit') { const a = r2(num(amount, 0)); if (!(a > 0)) return false; acct.cash = r2(acct.cash + a); acct.deposits.push({ t: now, amount: a, kind }); return true; }

/* contract key and label */
function contractKey(o) { return o.kind === 'option' ? `${o.symbol}|${o.expiry}|${num(o.strike)}|${o.right}` : o.symbol; }
function describe(o) { return o.kind === 'option' ? `${o.symbol} ${o.expiry} ${num(o.strike)} ${o.right === 'P' ? 'put' : 'call'}` : o.symbol; }
function validateOrder(o) {
  const out = { kind: o.kind === 'option' ? 'option' : 'stock', symbol: String(o.symbol || '').toUpperCase(), side: o.side === 'sell' ? 'sell' : 'buy', qty: num(o.qty), note: String(o.note || '').slice(0, 200), ideaId: o.ideaId ? String(o.ideaId).slice(0, 60) : '' };
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(out.symbol)) return { error: 'invalid_symbol' };
  if (!(out.qty > 0) || out.qty > RULES.maxQty) return { error: 'invalid_qty' };
  if (out.kind === 'option') {
    out.expiry = String(o.expiry || '').slice(0, 10); out.strike = num(o.strike); out.right = String(o.right || '').toUpperCase().startsWith('P') ? 'P' : 'C';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.expiry) || !(out.strike > 0)) return { error: 'invalid_contract' };
    out.qty = Math.floor(out.qty); if (out.qty < 1) return { error: 'invalid_qty' };
  } else out.qty = r4(out.qty);
  return { order: out };
}

/* the price a market order fills at: lift the ask / hit the bid when a quote exists, else last with slippage */
function fillFrom(q, side, rules = RULES) {
  if (!q) return null;
  const bid = num(q.bid), ask = num(q.ask), last = num(q.last) ?? num(q.mid);
  if (side === 'buy' && ask > 0) return r4(ask);
  if (side === 'sell' && bid > 0) return r4(bid);
  if (last > 0) return r4(last * (1 + (side === 'buy' ? 1 : -1) * rules.slippageBps / 1e4));
  return null;
}
function markFrom(q) { if (!q) return null; const bid = num(q.bid), ask = num(q.ask), last = num(q.last) ?? num(q.mid); if (bid > 0 && ask > 0 && ask >= bid) return r4((bid + ask) / 2); return last > 0 ? r4(last) : null; }

/* collateral a short option needs: puts cash-secured at the strike, calls covered by shares or secured at the underlying price */
function collateralFor(o, qty, underlyingPrice) { return o.right === 'P' ? o.strike * MULT * qty : Math.max(num(underlyingPrice, o.strike), o.strike) * MULT * qty; }

function placeOrder(acct, raw, quote, now = Date.now(), rules = RULES) {
  const v = validateOrder(raw); if (v.error) return { ok: false, error: v.error };
  const o = v.order, key = contractKey(o), mult = o.kind === 'option' ? MULT : 1;
  const px = fillFrom(quote, o.side, rules); if (!(px > 0)) return { ok: false, error: 'no_price', message: 'No price is available for that right now.' };
  const session = sessionOf(now);
  if (session === 'closed') return { ok: false, error: 'market_closed', message: 'The market is closed (no pre- or after-market price). Orders fill from 4:00 am to 8:00 pm New York time.' };
  if (o.kind === 'option' && session !== 'regular') return { ok: false, error: 'options_regular_only', message: 'Options trade in the regular session only (9:30 to 4:00 New York time).' };
  const fee = r2(o.kind === 'option' ? rules.optionFeePerContract * o.qty : rules.stockFee);
  // the day's starting equity is the account as it stood before its first event of the day
  const day0 = (acct.daily[etDate(now)] = acct.daily[etDate(now)] || { realized: 0, fees: 0, trades: 0 }); if (day0.open == null) day0.open = equityOf(acct);
  const pos = acct.positions[key];
  const dir = o.side === 'buy' ? 1 : -1;
  const notional = px * o.qty * mult;
  let realized = 0;
  if (!pos || Math.sign(pos.qty) === dir) {
    // opening or adding
    if (dir > 0) { if (acct.cash < notional + fee) return { ok: false, error: 'insufficient_cash', message: `That costs $${r2(notional + fee)}; cash is $${acct.cash}.` }; acct.cash = r2(acct.cash - notional - fee); }
    else {
      if (o.kind === 'stock') { if (acct.cash < notional * 0.5) return { ok: false, error: 'insufficient_margin', message: 'Short stock needs cash equal to half the position.' }; acct.cash = r2(acct.cash + notional - fee); }
      else { const col = collateralFor(o, o.qty, quote && quote.underlying); if (acct.cash < col) return { ok: false, error: 'insufficient_collateral', message: `Writing that needs $${r2(col)} of collateral; cash is $${acct.cash}.` }; acct.cash = r2(acct.cash + notional - fee); }
    }
    const nq = (pos ? pos.qty : 0) + dir * o.qty, prevCost = pos ? pos.avg * Math.abs(pos.qty) : 0;
    acct.positions[key] = { key, kind: o.kind, symbol: o.symbol, expiry: o.expiry || null, strike: o.strike || null, right: o.right || null, qty: r4(nq), avg: r4((prevCost + px * o.qty) / Math.abs(nq)), openedAt: pos ? pos.openedAt : now, mark: px, markAt: now, fees: r2((pos ? pos.fees : 0) + fee), desc: describe(o) };
  } else {
    // closing (part or all), or flipping through zero
    const closeQty = Math.min(o.qty, Math.abs(pos.qty)), remaining = o.qty - closeQty;
    realized = r2((px - pos.avg) * closeQty * mult * Math.sign(pos.qty) - fee);
    // a long is sold for cash; a short (stock or written option) was credited its proceeds at the open and is bought back here
    if (pos.qty > 0) acct.cash = r2(acct.cash + px * closeQty * mult - fee);
    else acct.cash = r2(acct.cash - px * closeQty * mult - fee);
    const nq = r4(pos.qty + dir * closeQty);
    if (Math.abs(nq) < 1e-9) delete acct.positions[key]; else acct.positions[key] = { ...pos, qty: nq, mark: px, markAt: now, fees: r2(pos.fees + fee) };
    if (remaining > 0) { const again = placeOrder(acct, { ...raw, qty: remaining }, quote, now, rules); if (!again.ok) return { ...again, partial: true, realized }; realized = r2(realized + (again.realized || 0)); }
  }
  const trade = { id: acct.nextId++, t: now, kind: o.kind, symbol: o.symbol, desc: describe(o), side: o.side, qty: o.qty, price: px, fee, session, realized: r2(realized), note: o.note, ideaId: o.ideaId || undefined, opening: !pos || Math.sign(pos.qty) === dir };
  acct.trades.push(trade); if (acct.trades.length > rules.maxTrades) acct.trades.splice(0, acct.trades.length - rules.maxTrades);
  const d = (acct.daily[etDate(now)] = acct.daily[etDate(now)] || { realized: 0, fees: 0, trades: 0 }); d.realized = r2(d.realized + realized); d.fees = r2(d.fees + fee); d.trades += 1;
  return { ok: true, trade, cash: acct.cash, position: acct.positions[key] || null, realized: r2(realized) };
}

/* marks every position, settles expired options at intrinsic value, rolls the day up, records the curve */
function markAccount(acct, quotes, now = Date.now(), rules = RULES) {
  const today = etDate(now);
  for (const p of Object.values(acct.positions)) {
    const q = quotes[p.key] || (p.kind === 'stock' ? quotes[p.symbol] : null);
    if (p.kind === 'option' && p.expiry < today) {
      const under = num(quotes[p.symbol] && (quotes[p.symbol].last ?? quotes[p.symbol].mid)), intrinsic = under > 0 ? Math.max(0, p.right === 'C' ? under - p.strike : p.strike - under) : null;
      if (intrinsic != null) {
        const realized = r2((intrinsic - p.avg) * Math.abs(p.qty) * MULT * Math.sign(p.qty));
        acct.cash = r2(acct.cash + (p.qty > 0 ? intrinsic * p.qty * MULT : -intrinsic * Math.abs(p.qty) * MULT)); // a long collects intrinsic; a short pays it
        acct.trades.push({ id: acct.nextId++, t: now, kind: 'option', symbol: p.symbol, desc: p.desc, side: p.qty > 0 ? 'sell' : 'buy', qty: Math.abs(p.qty), price: r4(intrinsic), fee: 0, session: 'settlement', realized, note: intrinsic > 0 ? 'expired in the money, settled at intrinsic value' : 'expired worthless' });
        const d = (acct.daily[today] = acct.daily[today] || { realized: 0, fees: 0, trades: 0 }); d.realized = r2(d.realized + realized); d.trades += 1;
        delete acct.positions[p.key]; continue;
      }
    }
    const m = markFrom(q); if (m != null) { p.mark = m; p.markAt = now; }
  }
  const value = equityOf(acct);
  const d = (acct.daily[today] = acct.daily[today] || { realized: 0, fees: 0, trades: 0 });
  if (d.open == null) d.open = value; d.close = value; d.cash = acct.cash;
  const last = acct.equity[acct.equity.length - 1];
  if (!last || now - last.t >= 4 * 60_000 || last.value !== value) { acct.equity.push({ t: now, value }); if (acct.equity.length > rules.maxEquityPoints) acct.equity = acct.equity.filter((_, i) => i % 2 === 0); }
  return value;
}
/* cash plus the market value of every position; a short's value is negative, which is the liability to buy it back */
function equityOf(acct) { return r2(acct.cash + Object.values(acct.positions).reduce((s, p) => s + p.qty * p.mark * (p.kind === 'option' ? MULT : 1), 0)); }

function summary(acct, now = Date.now()) {
  const equity = equityOf(acct), deposited = acct.deposits.reduce((s, d) => s + d.amount, 0);
  const positions = Object.values(acct.positions).map((p) => { const mult = p.kind === 'option' ? MULT : 1; return { ...p, value: r2(p.qty * p.mark * mult), pnl: r2((p.mark - p.avg) * p.qty * mult), pnlPct: p.avg > 0 ? r2((p.mark - p.avg) / p.avg * 100 * Math.sign(p.qty)) : null }; });
  const closed = acct.trades.filter((t) => !t.opening), wins = closed.filter((t) => t.realized > 0), losses = closed.filter((t) => t.realized < 0);
  const today = acct.daily[etDate(now)] || null;
  let peak = 0, dd = 0; for (const e of acct.equity) { peak = Math.max(peak, e.value); dd = Math.max(dd, peak > 0 ? (peak - e.value) / peak : 0); }
  return { equity, cash: r2(acct.cash), deposited: r2(deposited), pnl: r2(equity - deposited), returnPct: r2((equity - deposited) / Math.max(1, deposited) * 100), unrealized: r2(positions.reduce((s, p) => s + p.pnl, 0)), realizedTotal: r2(acct.trades.reduce((s, t) => s + (t.realized || 0), 0)), feesTotal: r2(acct.trades.reduce((s, t) => s + (t.fee || 0), 0)),
    today: today ? { realized: today.realized, fees: today.fees, trades: today.trades, change: today.open != null && today.close != null ? r2(today.close - today.open) : null } : null,
    closedTrades: closed.length, winRate: closed.length ? r2(wins.length / closed.length * 100) : null, avgWin: wins.length ? r2(wins.reduce((s, t) => s + t.realized, 0) / wins.length) : null, avgLoss: losses.length ? r2(losses.reduce((s, t) => s + t.realized, 0) / losses.length) : null, maxDrawdownPct: r2(dd * 100), positions };
}

function calendar(acct, month) {
  const m = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : etDate(Date.now()).slice(0, 7);
  const days = Object.entries(acct.daily).filter(([d]) => d.startsWith(m)).sort(([a], [b]) => a.localeCompare(b)).map(([date, d]) => ({ date, realized: d.realized, fees: d.fees, trades: d.trades, change: d.open != null && d.close != null ? r2(d.close - d.open) : null, close: d.close ?? null }));
  const t = days.reduce((s, d) => s + (d.change ?? d.realized), 0);
  return { month: m, days, total: r2(t), green: days.filter((d) => (d.change ?? d.realized) > 0).length, red: days.filter((d) => (d.change ?? d.realized) < 0).length, best: days.length ? days.reduce((a, b) => ((b.change ?? b.realized) > (a.change ?? a.realized) ? b : a)) : null, worst: days.length ? days.reduce((a, b) => ((b.change ?? b.realized) < (a.change ?? a.realized) ? b : a)) : null };
}

/* one day's recap: the market, the account's activity, and a plain read of what the day says */
function dayRecap(acct, date, market = null) {
  const d = acct.daily[date] || null;
  const trades = acct.trades.filter((t) => etDate(t.t) === date);
  const change = d && d.open != null && d.close != null ? r2(d.close - d.open) : null;
  const symbols = [...new Set(trades.map((t) => t.symbol))];
  const insight = [];
  if (!trades.length && change == null) insight.push('No activity and no open positions marked this day.');
  if (trades.length) {
    const opens = trades.filter((t) => t.opening).length, closes = trades.length - opens, realized = r2(trades.reduce((s, t) => s + (t.realized || 0), 0)), fees = r2(trades.reduce((s, t) => s + (t.fee || 0), 0));
    insight.push(`${trades.length} fill${trades.length === 1 ? '' : 's'} across ${symbols.join(', ')}: ${opens} opening, ${closes} closing, ${realized >= 0 ? '+' : ''}$${realized} realized${fees ? ` after $${fees} in fees` : ''}.`);
    const ext = trades.filter((t) => t.session === 'pre' || t.session === 'post').length; if (ext) insight.push(`${ext} of them outside the regular session, where spreads are wider and fills are worse than they look.`);
    const wins = trades.filter((t) => t.realized > 0).length, losses = trades.filter((t) => t.realized < 0).length;
    if (losses > wins && losses >= 2) insight.push('More losers than winners closed today; the question is whether the losers were cut at the plan or held past it.');
    if (wins >= 2 && !losses) insight.push('Every close was a winner; check the open positions for the ones not yet counted.');
    if (trades.length >= 6) insight.push('Six or more fills in one day is a lot of decisions; the best days are usually the quiet ones.');
  }
  if (change != null) {
    const pct = d.open > 0 ? r2(change / d.open * 100) : null;
    if (market && market.ok && num(market.spyChangePct) != null) {
      const spy = num(market.spyChangePct);
      if (pct != null) insight.push(pct > spy + 0.5 ? `The account beat the market today (${pct}% vs SPY ${spy}%).` : pct < spy - 0.5 ? `The account trailed the market today (${pct}% vs SPY ${spy}%).` : `The account moved with the market today (${pct}% vs SPY ${spy}%).`);
    } else if (pct != null) insight.push(`Account ${pct >= 0 ? 'up' : 'down'} ${Math.abs(pct)}% on the day.`);
  }
  return { date, market: market || null, account: { open: d ? d.open ?? null : null, close: d ? d.close ?? null : null, change, realized: d ? d.realized : 0, fees: d ? d.fees : 0, trades, symbols }, insight };
}

/* ------------------------------------------------------------------ service */
function createPaperService({ storeFor, quote, optionQuote = null, marketDay = null, now = Date.now, rules = RULES, logger = () => {} } = {}) {
  const accounts = new Map(), stores = new Map();
  const storeOf = (id) => { if (!stores.has(id)) stores.set(id, storeFor(id)); return stores.get(id); };
  async function load(id, opts = {}) {
    if (accounts.has(id)) return accounts.get(id);
    const saved = await storeOf(id).read();
    const acct = saved && saved.version === 1 ? saved : createAccount(id, { ...opts, now: now() });
    /* an account opened before the $25,000 start (at the old $1,000) is brought up to it once, as a deposit, so its P&L stays honest */
    const want = Number(opts.cash) || rules.startCash;
    const topUp = saved && acct.id !== 'challenge' && want > acct.startCash && !acct.deposits.some((d) => d.kind === 'start-adjust');
    if (topUp) { deposit(acct, want - acct.startCash, now(), 'start-adjust'); acct.startCash = want; acct.log.push({ t: now(), text: `Starting balance raised to $${want.toLocaleString('en-US')}` }); }
    accounts.set(id, acct); if (!saved || topUp) await storeOf(id).write(acct);
    return acct;
  }
  const persist = (acct) => storeOf(acct.id).write(acct);
  async function quotesFor(acct) {
    const out = {};
    for (const p of Object.values(acct.positions)) {
      try {
        if (p.kind === 'stock') out[p.symbol] = await quote(p.symbol);
        else { if (!out[p.symbol]) out[p.symbol] = await quote(p.symbol); out[p.key] = optionQuote ? await optionQuote({ symbol: p.symbol, expiry: p.expiry, strike: p.strike, right: p.right }) : null; }
      } catch (error) { logger('warn', 'paper_quote_failed', { key: p.key, error: String(error && error.message || error) }); }
    }
    return out;
  }
  async function mark(id) { const acct = await load(id); const q = await quotesFor(acct); markAccount(acct, q, now(), rules); await persist(acct); return acct; }
  async function order(id, raw, opts = {}) {
    const acct = await load(id, opts);
    const v = validateOrder(raw); if (v.error) return { ok: false, error: v.error };
    let q = null;
    try { q = v.order.kind === 'stock' ? await quote(v.order.symbol) : (optionQuote ? await optionQuote({ symbol: v.order.symbol, expiry: v.order.expiry, strike: v.order.strike, right: v.order.right }) : null); if (v.order.kind === 'option' && q) q.underlying = num((await quote(v.order.symbol) || {}).last); }
    catch (error) { logger('warn', 'paper_fill_quote_failed', { error: String(error && error.message || error) }); }
    const res = placeOrder(acct, v.order, q, now(), rules);
    if (res.ok) { acct.log.push({ t: now(), text: `${res.trade.side.toUpperCase()} ${res.trade.qty} ${res.trade.desc} @ $${res.trade.price} (${res.trade.session})` }); if (acct.log.length > 200) acct.log.shift(); markAccount(acct, await quotesFor(acct), now(), rules); await persist(acct); }
    return res;
  }
  async function snapshot(id, opts = {}) { const acct = await load(id, opts); try { markAccount(acct, await quotesFor(acct), now(), rules); await persist(acct); } catch (_) { /* a mark failure still shows the account */ }
    return { ok: true, simulated: true, id: acct.id, name: acct.name, createdAt: acct.createdAt, asOf: now(), session: sessionOf(now()), summary: summary(acct, now()), trades: acct.trades.slice(-60).reverse(), equity: acct.equity.slice(-500), deposits: acct.deposits.slice(-20).reverse(), log: acct.log.slice(-30).reverse(), disclaimer: 'SIMULATED account on real market prices. No real money, no advice. Educational only.' }; }
  async function month(id, m) { const acct = await load(id); return { ok: true, ...calendar(acct, m) }; }
  async function day(id, date) { const acct = await load(id); const d = /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) ? date : etDate(now()); const mk = marketDay ? await Promise.resolve(marketDay(d)).catch(() => null) : null; return { ok: true, ...dayRecap(acct, d, mk) }; }
  async function reset(id, opts = {}) { const acct = createAccount(id, { ...opts, now: now() }); accounts.set(id, acct); await persist(acct); return snapshot(id); }
  async function addDeposit(id, amount, kind) { const acct = await load(id); deposit(acct, amount, now(), kind); await persist(acct); return acct.cash; }
  return { load, mark, order, snapshot, month, day, reset, addDeposit, rules };
}

module.exports = { RULES, createAccount, deposit, placeOrder, markAccount, summary, calendar, dayRecap, equityOf, validateOrder, fillFrom, markFrom, contractKey, createPaperService };
