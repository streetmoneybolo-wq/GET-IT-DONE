'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('./academy-alert-format');
const { parseAlertMessage } = require('./academy-alerts-parse');

const OBI_ENTRY = [
  '@everyone',
  '🔥 𝐏𝐌𝐈 𝐄𝐍𝐓𝐑𝐘 $𝟓.𝟐𝟎 | 𝐏𝐓 $𝟔.𝟒𝟒+ (𝐒𝐖𝐈𝐍𝐆 𝐓𝐑𝐀𝐃𝐄) 🔥',
  '📈 𝐒𝐄𝐓𝐔𝐏: PMI showing steady momentum — clean swing structure forming with controlled volatility.',
  '',
  '⚡ 𝐌𝐎𝐌𝐄𝐍𝐓𝐔𝐌: Strong upside pressure — watching for continuation toward upper range.',
  '',
  '👉 🎯 𝐓𝐀𝐑𝐆𝐄𝐓 𝐙𝐎𝐍𝐄 — $𝟔.𝟒𝟒+ 👈',
  'Likely range test if momentum continues.',
  '',
  '⚠️ 𝐌𝐈𝐃‑𝐇𝐈𝐆𝐇 𝐑𝐈𝐒𝐊 — 𝐒𝐖𝐈𝐍𝐆 𝐒𝐓𝐘𝐋𝐄  ',
  'Partial profits recommended on strength.',
  '',
  '🚨 𝐒𝐓𝐎𝐏 𝐋𝐎𝐒𝐒: Below $5.00 — trend weakens.'
].join('\n');

test('bold() maps letters and digits to bold serif and leaves everything else alone', () => {
  assert.equal(F.bold('PMI 5.20 | PT'), '𝐏𝐌𝐈 𝟓.𝟐𝟎 | 𝐏𝐓');
  assert.equal(F.bold('Entry'), '𝐄𝐧𝐭𝐫𝐲');
  assert.equal(F.bold('🔥 — $'), '🔥 — $');
  assert.equal(F.bold(null), '');
});

test('the equity entry alert is exactly GrandMaster-Obi\'s layout', () => {
  const text = F.formatEntryAlert({ ticker: 'PMI', entry: 5.2, pt: 6.44, plus: true, type: 'swing', risk: 'mid-high',
    setup: 'PMI showing steady momentum — clean swing structure forming with controlled volatility.',
    momentum: 'Strong upside pressure — watching for continuation toward upper range.', stop: 5.0 });
  assert.equal(text, OBI_ENTRY);
});

test('a stop loss is generated when none is given, below the entry for a long and above it for a short', () => {
  assert.equal(F.autoStop({ entry: 5.2, type: 'swing' }), 4.99);
  assert.equal(F.autoStop({ entry: 100, type: 'day' }), 97);
  assert.equal(F.autoStop({ entry: 100, type: 'long' }), 88);
  assert.equal(F.autoStop({ entry: 100, side: 'short', type: 'swing' }), 104);
  assert.equal(F.autoStop({ entry: 0 }), null);
  const long = F.formatEntryAlert({ ticker: 'AMD', entry: 100, pt: 110, type: 'swing' });
  assert.match(long, /𝐒𝐓𝐎𝐏 𝐋𝐎𝐒𝐒: Below \$96 — trend weakens\./);
  const short = F.formatEntryAlert({ ticker: 'AMD', side: 'short', entry: 100, pt: 90, type: 'swing' });
  assert.match(short, /𝐒𝐓𝐎𝐏 𝐋𝐎𝐒𝐒: Above \$104 — downtrend fails/);
  assert.match(short, /downside pressure/i);
});

test('every trade type and risk level has its label', () => {
  for (const [k, label] of [['day', 'DAY TRADE'], ['swing', 'SWING TRADE'], ['mid', 'MID HOLD'], ['long', 'LONG TERM HOLD']]) {
    assert.match(F.formatEntryAlert({ ticker: 'SPY', entry: 500, pt: 510, type: k }), new RegExp('\\(' + F.bold(label) + '\\)'));
  }
  assert.match(F.formatEntryAlert({ ticker: 'SPY', entry: 5, pt: 6, risk: 'extreme' }), /𝐄𝐗𝐓𝐑𝐄𝐌𝐄 𝐑𝐈𝐒𝐊/);
  assert.match(F.formatEntryAlert({ ticker: 'SPY', entry: 5, pt: 6, plus: false }), /𝐏𝐓 \$𝟔\.𝟎𝟎 \(/);
});

test('sub-dollar and round prices keep a readable form', () => {
  assert.equal(F.priceText(0.8), '$𝟎.𝟖𝟎');
  assert.equal(F.priceText(0.245), '$𝟎.𝟐𝟒𝟓');
  assert.equal(F.priceText(64, { plus: true }), '$𝟔𝟒+');
  assert.equal(F.priceText(12.5), '$𝟏𝟐.𝟓𝟎');
  assert.equal(F.priceText(-1), '');
  assert.equal(F.plainPrice(5), '$5.00');
  assert.equal(F.plainPrice(96), '$96');
});

test('model text cannot add mentions or control characters to an alert', () => {
  const t = F.formatEntryAlert({ ticker: 'A@everyone', entry: 5, pt: 6, setup: 'hello @here <@123> `x`\u0000 world' });
  assert.equal(t.match(/@/g).length, 1, 'only the template\'s own @everyone');
  assert.ok(!/<@|`|\u0000/.test(t));
  assert.ok(!F.formatEntryAlert({ ticker: 'SPY', entry: 5, pt: 6, mention: false }).includes('@everyone'));
});

test('bad input is refused', () => {
  assert.throws(() => F.formatEntryAlert({ entry: 5, pt: 6 }), /needs_ticker/);
  assert.throws(() => F.formatEntryAlert({ ticker: 'X', entry: 0, pt: 6 }), /needs_ticker/);
  assert.throws(() => F.formatPtSmashed({ ticker: 'X' }), /pt_smashed/);
  assert.throws(() => F.formatOptionsAlert({ ticker: 'X' }), /options_alert/);
  assert.throws(() => F.formatOptionsPtSmashed({ ticker: 'X' }), /options_pt_smashed/);
});

test('the PT smashed template', () => {
  const t = F.formatPtSmashed({ ticker: 'XRPN', newPt: 64, plus: true });
  assert.equal(t, [
    '@everyone',
    '🔥 𝐗𝐑𝐏𝐍 𝐏𝐓 𝐒𝐌𝐀𝐒𝐇𝐄𝐃 — 𝐍𝐄𝐖 𝐏𝐓 𝐒𝐄𝐓 $𝟔𝟒+ 🔥',
    '🎯 Previous PT smashed — momentum still strong.',
    '',
    '👉 🆕 NEW TARGET ZONE — $64+  ',
    'Continuation still valid while momentum holds.',
    '',
    '⚠️ HIGH‑RISK / EXTREME‑RISK ZONE  ',
    'Take partial or full profits into strength.',
    '',
    '🚨 Protect gains — volatility elevated.'
  ].join('\n'));
});

test('the options templates', () => {
  const calls = F.formatOptionsAlert({ ticker: 'SPY', contract: 'calls', strike: 590, expiry: 'daily', target: '$592' });
  assert.match(calls, /^@everyone\n🔥 𝐒𝐏𝐘 𝐂𝐀𝐋𝐋𝐒 \| 𝐒𝐓𝐑𝐈𝐊𝐄 𝟓𝟗𝟎 \| 𝐃𝐀𝐈𝐋𝐘 🔥\n📉📈 Direction: Needs upside toward strike for contract expansion\.\n⚡ Daily Behavior: Fast movement, fast risk — manage size tight\./);
  assert.match(calls, /🚨 Stop Loss: Below the recent support level\./);
  const puts = F.formatOptionsAlert({ ticker: 'TSLA', contract: 'puts', strike: 400, expiry: '0dte' });
  assert.match(puts, /Needs downside toward strike/);
  assert.match(puts, /Zero‑Day Behavior: EXTREME risk — contract moves violently\./);
  assert.match(puts, /⚠️ Risk Level: EXTREME‑RISK/);
  assert.match(puts, /Stop Loss: Above the recent rejection level\./);
  const smashed = F.formatOptionsPtSmashed({ ticker: 'XRPN', contract: 'calls', newPt: '$64+' });
  assert.match(smashed, /^@everyone\n🔥 𝐗𝐑𝐏𝐍 𝐂𝐀𝐋𝐋𝐒 𝐏𝐓 𝐒𝐌𝐀𝐒𝐇𝐄𝐃 — 𝐍𝐄𝐖 𝐏𝐓 𝐒𝐄𝐓 𝟔𝟒\+? 🔥|𝐍𝐄𝐖 𝐏𝐓 𝐒𝐄𝐓/);
  assert.match(smashed, /Protect gains — options volatility increases sharply at extended levels\./);
});

test('the alerts desk reads the bold layout back as the same alert', () => {
  const read = parseAlertMessage(OBI_ENTRY, Date.UTC(2026, 9, 5, 15));
  assert.equal(read.kind, 'equity');
  assert.equal(read.symbol, 'PMI');
  assert.equal(read.entryPrice, 5.2);
  assert.equal(read.targetPrice, 6.44);
  assert.equal(read.targetIsMinimum, true);
  // and the plain "entry $2 pt 2.33 plus" style still reads as before
  const plain = parseAlertMessage('@everyone GDC entry $2 pt 2.33 plus', Date.UTC(2026, 9, 5, 15));
  assert.deepEqual([plain.symbol, plain.entryPrice, plain.targetPrice, plain.targetIsMinimum], ['GDC', 2, 2.33, true]);
  // a generated alert round-trips
  const made = F.formatEntryAlert({ ticker: 'AMD', entry: 150, pt: 171.5, plus: true, type: 'swing' });
  const back = parseAlertMessage(made, Date.UTC(2026, 9, 5, 15));
  assert.deepEqual([back.symbol, back.entryPrice, back.targetPrice], ['AMD', 150, 171.5]);
});
