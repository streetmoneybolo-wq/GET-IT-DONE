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

module.exports = { bold, priceText, plainPrice, autoStop, tradeType, riskLabel, formatEntryAlert, formatPtSmashed, formatOptionsAlert, formatOptionsPtSmashed, TRADE_TYPES, RISKS };
