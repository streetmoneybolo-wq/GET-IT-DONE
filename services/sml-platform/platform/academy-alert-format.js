'use strict';

/* GrandMaster-Obi's alert layout, as Discord-ready text.
 *
 * Four fixed templates (equity entry, equity PT smashed, options, options PT smashed): bold-serif Unicode for the ticker, entry, PT, strike and headers, the emojis
 * exactly as written, one short line under each header, and a stop loss that is generated whenever none is given. The structure never changes; only the
 * values and the one-line notes do. Pure functions: nothing here posts anything.
 *
 *   @everyone
 *   🔥 𝐏𝐌𝐈 𝐄𝐍𝐓𝐑𝐘 $𝟓.𝟐𝟎 | 𝐏𝐓 $𝟔.𝟒𝟒+ (𝐒𝐖𝐈𝐍𝐆 𝐓𝐑𝐀𝐃𝐄) 🔥
 *   📈 𝐒𝐄𝐓𝐔𝐏: ...
 *
 * The alerts desk reads these messages back (academy-alerts-parse.js normalizes the bold letters), so what is posted here is what the desk tracks. */

const NBH = '‑'; // the non-breaking hyphen the layout uses in MID‑HIGH, HIGH‑RISK, ...

/* Mathematical Bold: A-Z, a-z and 0-9 become their bold-serif forms; everything else (symbols, punctuation, emoji) passes through. */
function bold(text) {
  let out = '';
  for (const ch of String(text == null ? '' : text)) {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) out += String.fromCodePoint(0x1D400 + c - 65);
    else if (c >= 97 && c <= 122) out += String.fromCodePoint(0x1D41A + c - 97);
    else if (c >= 48 && c <= 57) out += String.fromCodePoint(0x1D7CE + c - 48);
    else out += ch;
  }
  return out;
}

/* "$" stays a plain dollar sign, the digits are bold, the decimal point is plain: $𝟓.𝟐𝟎 */
function priceText(value, { plus = false } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  let s;
  if (n >= 1) s = Number.isInteger(n) && n >= 10 ? String(n) : n.toFixed(2);
  else s = n.toFixed(n < 0.1 ? 4 : 3).replace(/0+$/, '').replace(/(\.\d)$/, '$10');
  return '$' + bold(s) + (plus ? '+' : '');
}
const plainPrice = (value) => { const t = priceText(value); return t ? '$' + t.slice(1).replace(/[\u{1D7CE}-\u{1D7D7}]/gu, (d) => String(d.codePointAt(0) - 0x1D7CE)) : ''; };

const TRADE_TYPES = {
  day: { label: 'DAY TRADE', style: 'DAY STYLE', stopPct: 0.03 },
  swing: { label: 'SWING TRADE', style: 'SWING STYLE', stopPct: 0.04 },
  mid: { label: 'MID HOLD', style: 'MID' + NBH + 'TERM STYLE', stopPct: 0.08 },
  long: { label: 'LONG TERM HOLD', style: 'LONG' + NBH + 'TERM STYLE', stopPct: 0.12 }
};
const tradeType = (key) => TRADE_TYPES[String(key || 'swing').toLowerCase()] || TRADE_TYPES.swing;

const RISKS = {
  low: 'LOW RISK', mid: 'MID RISK', 'mid-high': 'MID' + NBH + 'HIGH RISK', high: 'HIGH RISK', extreme: 'EXTREME RISK'
};
const riskLabel = (key) => RISKS[String(key || 'mid-high').toLowerCase()] || RISKS['mid-high'];

/* A stop slightly under (long) or over (short) the entry unless one is given. Returned as a number rounded for the price's size. */
function autoStop({ entry, side = 'long', type = 'swing' }) {
  const e = Number(entry); if (!(e > 0)) return null;
  const pct = tradeType(type).stopPct;
  const raw = side === 'short' ? e * (1 + pct) : e * (1 - pct);
  return e >= 1 ? Math.round(raw * 100) / 100 : Math.round(raw * 10000) / 10000;
}

const clean = (s, max = 220) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f<>@`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const sentence = (s, fallback) => { const t = clean(s); return t || fallback; };
const everyone = (on) => (on === false ? [] : ['@everyone']);

/* ---------- equity entry ---------- */
function formatEntryAlert(a) {
  const side = a.side === 'short' ? 'short' : 'long';
  const type = tradeType(a.type), t = a.type || 'swing';
  const entry = Number(a.entry), pt = Number(a.pt);
  if (!a.ticker || !(entry > 0) || !(pt > 0)) throw new TypeError('entry_alert_needs_ticker_entry_and_pt');
  const stop = Number(a.stop) > 0 ? Number(a.stop) : autoStop({ entry, side, type: t });
  const up = side === 'long';
  const plus = a.plus !== false && (a.plus === true || !!a.plus);
  const lines = [
    ...everyone(a.mention),
    '🔥 ' + bold(String(a.ticker).toUpperCase().replace(/[^A-Z0-9.]/g, '')) + ' ' + bold('ENTRY') + ' ' + priceText(entry) + ' | ' + bold('PT') + ' ' + priceText(pt, { plus }) + ' (' + bold(type.label) + ') 🔥',
    '📈 ' + bold('SETUP') + ': ' + sentence(a.setup, up ? String(a.ticker).toUpperCase() + ' showing steady momentum — clean structure forming with controlled volatility.' : String(a.ticker).toUpperCase() + ' showing steady selling pressure — clean breakdown structure forming.'),
    '',
    '⚡ ' + bold('MOMENTUM') + ': ' + sentence(a.momentum, up ? 'Strong upside pressure — watching for continuation toward upper range.' : 'Strong downside pressure — watching for continuation toward lower range.'),
    '',
    '👉 🎯 ' + bold('TARGET ZONE') + ' — ' + priceText(pt, { plus }) + ' 👈',
    sentence(a.targetNote, plus ? 'Likely range test if momentum continues.' : 'Target zone in play if momentum holds.'),
    '',
    '⚠️ ' + bold(riskLabel(a.risk)) + ' — ' + bold(type.style) + '  ',
    sentence(a.riskNote, 'Partial profits recommended on strength.'),
    '',
    '🚨 ' + bold('STOP LOSS') + ': ' + (up ? 'Below ' : 'Above ') + plainPrice(stop) + ' — ' + sentence(a.stopNote, up ? 'trend weakens.' : 'downtrend fails.')
  ];
  return lines.join('\n');
}

/* ---------- equity PT smashed ---------- */
function formatPtSmashed(a) {
  const pt = Number(a.newPt);
  if (!a.ticker || !(pt > 0)) throw new TypeError('pt_smashed_needs_ticker_and_new_pt');
  const plus = !!a.plus;
  /* the wide-buffer layout: a stop given as a range (Below $1.98–$2.05, or Above for a short) */
  if (Number(a.stopLow) > 0 && Number(a.stopHigh) > 0) {
    const tk = String(a.ticker).toUpperCase().replace(/[^A-Z0-9.]/g, ''), short = a.side === 'short';
    const lo = Math.min(Number(a.stopLow), Number(a.stopHigh)), hi = Math.max(Number(a.stopLow), Number(a.stopHigh));
    return [
      ...everyone(a.mention),
      '🔥 ' + bold(tk) + ' ' + bold('PT SMASHED') + ' — ' + bold('NEW PT SET') + ' ' + priceText(pt, { plus }) + ' 🔥',
      '🎯 Previous PT smashed — ' + sentence(a.status, short ? 'momentum still pushing downward.' : 'momentum still pushing upward.'),
      '',
      '👉 🆕 ' + bold('NEW TARGET ZONE') + ' — ' + plainPrice(pt) + (plus ? '+' : '') + '  ',
      sentence(a.targetNote, 'Continuation valid — strong extension forming.'),
      ...(Array.isArray(a.why) && a.why.length ? ['', '📊 ' + bold('WHY IT CAN KEEP ' + (short ? 'DROPPING' : 'RUNNING')), ...a.why.slice(0, 5).map((w) => '• ' + String(w).trim())] : []),
      '',
      '⚠️ ' + bold('HIGH' + NBH + 'RISK ZONE') + '  ',
      sentence(a.riskNote, 'Volatility elevated — consider majority profits as we push deeper into extended territory.'),
      '',
      a.stopWas
        ? '🚨 ' + bold(short ? 'STOP LOWERED' : 'STOP RAISED') + ': ' + (short ? 'Above ' : 'Below ') + plainPrice(lo) + '–' + plainPrice(hi) + ' (was ' + String(a.stopWas) + ') — ' + (short ? 'locks in the gains from the drop.' : 'locks in gains, gives ' + tk + ' room to breathe.')
        : '🚨 ' + bold('WIDE STOP LOSS') + ': ' + (short ? 'Above ' : 'Below ') + plainPrice(lo) + '–' + plainPrice(hi).replace(/^\$/, '$') + ' (wide buffer for ' + tk + ' volatility)'
    ].join('\n');
  }
  return [
    ...everyone(a.mention),
    '🔥 ' + bold(String(a.ticker).toUpperCase().replace(/[^A-Z0-9.]/g, '')) + ' ' + bold('PT SMASHED') + ' — ' + bold('NEW PT SET') + ' ' + priceText(pt, { plus }) + ' 🔥',
    '🎯 Previous PT smashed — ' + sentence(a.status, 'momentum still strong.'),
    '',
    '👉 🆕 NEW TARGET ZONE — ' + plainPrice(pt) + (plus ? '+' : '') + '  ',
    sentence(a.targetNote, 'Continuation still valid while momentum holds.'),
    '',
    '⚠️ HIGH' + NBH + 'RISK / EXTREME' + NBH + 'RISK ZONE  ',
    sentence(a.riskNote, 'Take partial or full profits into strength.'),
    '',
    '🚨 Protect gains — volatility elevated.'
  ].join('\n');
}

/* ---------- equity take profits ----------
 * The exit post from the alerts desk's SELL button: the entry, where price is now and the gain, why the Academy says lock it in, and what
 * to do with any runner. The same voice as the entry and PT SMASHED posts; a.why lines come from the desk's own read of the stock. */
function formatTakeProfits(a) {
  const entry = Number(a.entry), price = Number(a.price);
  if (!a.ticker || !(entry > 0) || !(price > 0)) throw new TypeError('take_profits_needs_ticker_entry_and_price');
  const tk = String(a.ticker).toUpperCase().replace(/[^A-Z0-9.]/g, ''), short = a.side === 'short';
  const gain = (short ? (entry - price) / entry : (price - entry) / entry) * 100;
  const gainText = (gain >= 0 ? '+' : '−') + Math.abs(gain).toFixed(gain >= 10 ? 0 : 1) + '%';
  const partial = a.partial === true;
  const why = Array.isArray(a.why) ? a.why.map((w) => clean(w, 160)).filter(Boolean).slice(0, 5) : [];
  return [
    ...everyone(a.mention),
    '💰 ' + bold(tk) + ' ' + bold(partial ? 'TAKE PARTIAL PROFITS' : 'TAKE PROFITS') + ' — ' + bold('ENTRY') + ' ' + priceText(entry) + ' | ' + bold('NOW') + ' ' + priceText(price) + ' (' + bold(gainText) + ') 💰',
    '🏁 ' + sentence(a.status, gain >= 0 ? (partial ? 'Bank the bulk here — let a small runner work.' : 'Lock it in — the move has done its job.') : 'Cut it here — the setup is not holding.'),
    ...(why.length ? ['', '📊 ' + bold('WHY NOW'), ...why.map((w) => '• ' + w)] : []),
    '',
    '⚠️ ' + bold(partial ? 'RUNNER RULES' : 'DO NOT CHASE') + '  ',
    sentence(a.riskNote, partial ? 'Stop on the rest moves to the entry — the runner can only win from here.' : 'Profits are profits. A re-entry needs a fresh setup, not a feeling.'),
    '',
    '🚨 ' + bold('STOP') + ': ' + sentence(a.stopNote, partial && Number(a.stop) > 0 ? (short ? 'Above ' : 'Below ') + plainPrice(a.stop) + ' on what is left.' : 'Out — nothing left to protect.')
  ].join('\n');
}

/* the analyst moves the price target before it is hit: PT RAISED (further in the trade's direction) or PT LOWERED (closer, but still beyond the live price) */
function formatPtAdjust(a) {
  const to = Number(a.newPt), was = Number(a.oldPt);
  if (!a.ticker || !(to > 0) || !(was > 0)) throw new TypeError('pt_adjust_needs_ticker_old_and_new_pt');
  const tk = String(a.ticker).toUpperCase().replace(/[^A-Z0-9.]/g, ''), short = a.side === 'short';
  const raised = short ? to < was : to > was;
  const price = Number(a.price), entry = Number(a.entry);
  const away = price > 0 ? Math.abs((to - price) / price) * 100 : null;
  return [
    ...everyone(a.mention),
    (raised ? '📈 ' : '📉 ') + bold(tk) + ' ' + bold(raised ? 'PT RAISED' : 'PT LOWERED') + ' — ' + bold('NEW PT') + ' ' + priceText(to) + ' (' + bold('WAS') + ' ' + plainPrice(was) + ')',
    raised ? '🎯 ' + sentence(a.status, 'Target moved ' + (short ? 'lower' : 'higher') + ' before the old one was hit — the move still has room.') : '🎯 ' + sentence(a.status, 'Target brought in — taking the realistic level and protecting the gain.'),
    '',
    ...(price > 0 ? ['📍 ' + bold('NOW') + ' ' + plainPrice(price) + (away != null ? ' — ' + away.toFixed(away >= 10 ? 0 : 1) + '% to the new PT' : '') + (entry > 0 ? ' | ' + bold('ENTRY') + ' ' + plainPrice(entry) : '')] : []),
    '',
    '⚠️ ' + bold(raised ? 'MANAGE THE RISK' : 'WHAT THIS MEANS') + '  ',
    sentence(a.riskNote, raised ? 'A higher target is not a reason to ignore the stop. Size and stop stay the same.' : 'Aim for the new level. If price goes through the stop first, the plan is wrong.')
  ].join('\n');
}

/* ---------- midday report ---------- */
const MID_PROMO = [
  'Want every alert the moment it posts?',
  'Start the free trial and get access to the entire Discord server.',
  'It also unlocks the new MEM Academy trading tool, with live charts, scanners and the alert desk in one place.',
  'And you can follow the $1K to $100K challenge live as it is traded.'
];
/* a.rows: [{ ticker, side, entry, price, target, movePct, state: 'target'|'stopped'|'open' }]; a.when: a Date */
function formatMiddayReport(a) {
  const rows = Array.isArray(a.rows) ? a.rows : [];
  const when = a.when instanceof Date ? a.when : new Date();
  const day = when.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
  const time = when.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });
  const pct = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(Math.abs(v) >= 10 ? 0 : 1) + '%';
  const up = rows.filter((r) => r.movePct > 0.05).length, down = rows.filter((r) => r.movePct < -0.05).length, flat = rows.length - up - down;
  const hit = rows.filter((r) => r.state === 'target').length, stopped = rows.filter((r) => r.state === 'stopped').length;
  const avg = rows.length ? rows.reduce((n, r) => n + r.movePct, 0) / rows.length : 0;
  const sorted = rows.slice().sort((x, y) => y.movePct - x.movePct);
  const shown = sorted.slice(0, 10);
  const lines = [
    ...everyone(a.mention),
    '📊 ' + bold('MIDDAY REPORT') + ' — ' + day + ' · ' + time + ' ET',
    ''
  ];
  if (!rows.length) {
    lines.push('No alerts went out this morning. Patience is a position too — the next setup gets posted the moment it is there.');
  } else {
    lines.push('🎯 ' + bold(String(rows.length)) + ' alert' + (rows.length === 1 ? '' : 's') + ' today · ' + bold(String(up)) + ' up · ' + bold(String(down)) + ' down' + (flat ? ' · ' + flat + ' flat' : '') + ' · ' + bold(String(hit)) + ' target' + (hit === 1 ? '' : 's') + ' hit' + (stopped ? ' · ' + stopped + ' stopped' : ''));
    lines.push('📈 ' + bold('AVERAGE MOVE FROM ENTRY') + ': ' + pct(avg), '');
    for (const r of shown) {
      const tk = String(r.ticker).toUpperCase().replace(/[^A-Z0-9.]/g, '');
      lines.push((r.state === 'target' ? '✅' : r.state === 'stopped' ? '🛑' : r.movePct >= 0 ? '🟢' : '🔴') + ' ' + bold(tk) + (r.side === 'short' ? ' (short)' : '') + ' — ' + plainPrice(r.entry) + ' → ' + plainPrice(r.price) + ' (' + pct(r.movePct) + ')' + (r.state === 'target' ? ' · target hit' : r.state === 'stopped' ? ' · stopped' : r.progress != null ? ' · ' + Math.max(0, Math.min(100, Math.round(r.progress))) + '% to target' : ''));
    }
    if (rows.length > shown.length) lines.push('…and ' + (rows.length - shown.length) + ' more.');
    if (rows.length > 1) lines.push('', '🏆 ' + bold('BEST') + ' ' + String(sorted[0].ticker).toUpperCase() + ' ' + pct(sorted[0].movePct) + ' · ' + bold('WEAKEST') + ' ' + String(sorted[sorted.length - 1].ticker).toUpperCase() + ' ' + pct(sorted[sorted.length - 1].movePct));
  }
  lines.push('', '🔥 ' + MID_PROMO.join(' '));
  const link = clean(a.trialLink, 200);
  if (/^https?:\/\//.test(link)) lines.push('👉 ' + link);
  lines.push('-# Moves are measured from each alert\'s entry to the latest price. Educational, not financial advice.');
  return lines.join('\n');
}

/* ---------- options ---------- */
const EXPIRY = {
  daily: { label: 'DAILY', note: 'Fast movement, fast risk — manage size tight.' },
  weekly: { label: 'WEEKLY', note: 'More breathing room but still volatile.' },
  '0dte': { label: '0DTE', note: 'EXTREME risk — contract moves violently.' }
};
function formatOptionsAlert(a) {
  const puts = /^put/i.test(String(a.contract || ''));
  const strike = Number(a.strike);
  const ex = EXPIRY[String(a.expiry || 'weekly').toLowerCase()] || EXPIRY.weekly;
  if (!a.ticker || !(strike > 0)) throw new TypeError('options_alert_needs_ticker_and_strike');
  const risk = a.risk ? riskLabel(a.risk) : (ex.label === '0DTE' ? RISKS.extreme : ex.label === 'DAILY' ? RISKS.high : RISKS['mid-high']);
  const stop = a.stop != null && clean(a.stop) ? clean(a.stop, 80) : (puts ? 'Above the recent rejection level.' : 'Below the recent support level.');
  return [
    ...everyone(a.mention),
    '🔥 ' + bold(String(a.ticker).toUpperCase().replace(/[^A-Z0-9.]/g, '')) + ' ' + bold(puts ? 'PUTS' : 'CALLS') + ' | ' + bold('STRIKE') + ' ' + priceText(strike).replace(/^\$/, '') + ' | ' + bold(ex.label) + ' 🔥',
    '📉📈 Direction: ' + (puts ? 'Needs downside toward strike for contract expansion.' : 'Needs upside toward strike for contract expansion.'),
    '⚡ ' + (ex.label === 'DAILY' ? 'Daily' : ex.label === 'WEEKLY' ? 'Weekly' : 'Zero' + NBH + 'Day') + ' Behavior: ' + ex.note,
    '👉 🎯 ' + bold('TARGET ZONE') + ' — ' + sentence(a.target, 'the next resistance level') + ' 👈',
    sentence(a.targetNote, 'Continuation or a range test if momentum holds.'),
    '⚠️ Risk Level: ' + risk.replace(' RISK', NBH + 'RISK'),
    '🚨 Stop Loss: ' + stop
  ].join('\n');
}

/* ---------- options contract, from a Click-to-Alert double-click on the chain ----------
 * The stock entry layout (setup, momentum, target zone, risk, stop) plus what the contract itself adds: its price, the cost of one contract, breakeven,
 * what it is estimated to be worth at the target and at the stop, the Greeks and how easy it is to trade. Every number comes from buildOptionsAlert. */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const expiryText = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso)); return m ? MONTHS[Number(m[2]) - 1] + ' ' + Number(m[3]) : String(iso); };
const signed = (n) => (n == null || !Number.isFinite(Number(n)) ? 'n/a' : (Number(n) >= 0 ? '+' : '−') + Math.abs(Number(n)).toFixed(0) + '%');
const money = (n) => (n == null || !Number.isFinite(Number(n)) ? 'n/a' : (Number(n) < 0 ? '−$' : '$') + Math.abs(Number(n)).toFixed(Math.abs(Number(n)) >= 1 ? 2 : 3));

function formatOptionsContractAlert(a) {
  const c = a.contract, e = a.estimates;
  if (!a.ticker || !c || !e || !(Number(c.mid) > 0)) throw new TypeError('options_contract_alert_needs_contract');
  const side = a.side === 'short' ? 'short' : 'long';
  const type = tradeType(a.type), puts = c.type === 'put';
  const pt = Number(a.pt), up = side === 'long';
  const tick = bold(String(a.ticker).toUpperCase().replace(/[^A-Z0-9.]/g, ''));
  const stopPx = Number(a.stop) > 0 ? Number(a.stop) : autoStop({ entry: a.entry, side, type: a.type });
  const plus = !!a.plus;
  const t = e.atTarget, d = t.days || {};
  const spread = c.bid != null && c.ask != null ? money(c.bid) + ' × ' + money(c.ask) : null;
  const lines = [
    ...everyone(a.mention),
    '🔥 ' + tick + ' ' + bold(puts ? 'PUTS' : 'CALLS') + ' | ' + bold('STRIKE') + ' ' + priceText(c.strike).replace(/^\$/, '') + ' | ' + bold(expiryText(c.expiry)) + ' | ' + bold('ENTRY') + ' ' + priceText(c.mid) + ' | ' + bold('PT') + ' ' + priceText(pt, { plus }) + ' (' + bold(type.label) + ') 🔥',
    '📈 ' + bold('SETUP') + ': ' + sentence(a.setup, tick + ' showing steady ' + (up ? 'momentum' : 'selling pressure') + '.'),
    '',
    '⚡ ' + bold('MOMENTUM') + ': ' + sentence(a.momentum, up ? 'Strong upside pressure — watching for continuation.' : 'Strong downside pressure — watching for continuation.'),
    '',
    '👉 🎯 ' + bold('TARGET ZONE') + ' — stock ' + priceText(pt, { plus }) + ' 👈',
    sentence(a.targetNote, 'Target zone in play if momentum holds.'),
    '',
    '📋 ' + bold('CONTRACT') + ': ' + clean(c.name, 60) + ' · ' + c.dte + ' days left',
    '💵 ' + bold('PRICE') + ' ' + money(c.mid) + ' (' + (spread ? 'bid × ask ' + spread : 'mid') + ') · ' + bold('COST') + ' $' + c.perContract + ' per contract',
    '⚖️ ' + bold('BREAKEVEN') + ' ' + money(e.breakeven) + ' at expiry (' + signed(e.breakevenMovePct) + ' move in the stock)',
    '🎯 ' + bold('AT TARGET') + ': about ' + money(t.base) + ' (' + signed(t.basePct) + ') in ~' + Math.round(d.base || 0) + ' days · fast ' + signed(t.fastPct) + ' · slow ' + signed(t.slowPct),
    '🛑 ' + bold('AT STOP') + ': about ' + money(e.atStop.value) + ' (' + signed(e.atStop.pct) + ') · worst case −$' + c.perContract,
    '🧮 ' + bold('GREEKS') + ': Δ ' + (c.delta == null ? 'n/a' : c.delta) + ' · Θ ' + (c.thetaPerDay == null ? 'n/a' : money(c.thetaPerDay) + '/day') + ' · Vega ' + (c.vegaPer1pct == null ? 'n/a' : money(c.vegaPer1pct)) + ' · IV ' + (c.iv == null ? 'n/a' : c.iv + '%') + ' · ' + (c.probITMPct == null ? 'n/a' : c.probITMPct + '%') + ' chance in the money',
    '🔎 ' + bold('LIQUIDITY') + ': ' + String(c.liquidity || 'unknown').toUpperCase() + ' · OI ' + (c.oi == null ? 'n/a' : c.oi) + ' · vol ' + (c.volume == null ? 'n/a' : c.volume) + (c.spreadPct == null ? '' : ' · spread ' + c.spreadPct + '%'),
    '',
    '⚠️ ' + bold(riskLabel(a.risk)) + ' — ' + bold(type.style) + '  ',
    sentence(a.riskNote, 'Partial profits recommended on strength.'),
    '',
    '🚨 ' + bold('STOP LOSS') + ': Stock ' + (up ? 'below ' : 'above ') + plainPrice(stopPx) + ' — ' + sentence(a.stopNote, up ? 'trend weakens.' : 'downtrend fails.')
  ];
  let text = lines.join('\n');
  if (text.length > 1700) text = lines.filter((l) => !/^(🧮|🔎)/u.test(l)).join('\n');
  return text;
}

function formatOptionsPtSmashed(a) {
  const puts = /^put/i.test(String(a.contract || ''));
  const pt = clean(a.newPt, 40);
  if (!a.ticker || !pt) throw new TypeError('options_pt_smashed_needs_ticker_and_new_pt');
  return [
    ...everyone(a.mention),
    '🔥 ' + bold(String(a.ticker).toUpperCase().replace(/[^A-Z0-9.]/g, '')) + ' ' + bold(puts ? 'PUTS' : 'CALLS') + ' ' + bold('PT SMASHED') + ' — ' + bold('NEW PT SET') + ' ' + bold(pt) + ' 🔥',
    '🎯 Previous PT smashed — contract still expanding.',
    '👉 🆕 NEW TARGET ZONE — ' + pt + '  ',
    sentence(a.targetNote, 'Continuation still valid while momentum holds.'),
    '⚠️ HIGH' + NBH + 'RISK / EXTREME' + NBH + 'RISK ZONE  ',
    sentence(a.riskNote, 'Take partial or full profits into strength.'),
    '🚨 Protect gains — options volatility increases sharply at extended levels.'
  ].join('\n');
}

module.exports = { bold, priceText, plainPrice, autoStop, tradeType, riskLabel, formatEntryAlert, formatPtSmashed, formatPtAdjust, formatTakeProfits, formatMiddayReport, MID_PROMO, formatOptionsAlert, formatOptionsContractAlert, formatOptionsPtSmashed, TRADE_TYPES, RISKS };
