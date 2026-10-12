'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createDmNotifier, signalText, targetHitText, newTargetText } = require('./academy-notify-dm');

const A = '200000000000000001', B = '200000000000000002';
const sig = { symbol: 'EBAY', style: 'swing', label: 'Swing trade', grade: 'A', score: 85, entry: 114.65, target: 131.85, pct: 15, stop: 109.1, relVolume: 2.1, why: ['BUY signal on the latest 1D candle', 'volume 2.1x normal'] };

test('the texts say what happened, with prices and the next step', () => {
  assert.match(signalText(sig), /BUY SIGNAL EBAY\*\* · Swing trade · grade A \(85\)\nEntry \$114\.65 → PT \$131\.85 \(\+15%\) · stop \$109\.10 · volume 2\.1x\n• BUY signal/);
  assert.match(targetHitText({ symbol: 'AIXI', target: 2.2, entry: 1.8, price: 2.31, suggested: 2.6 }), /AIXI hit your price target \$2\.20\*\* \(entry \$1\.80, high \$2\.31\)\.\nMEM ALGO suggests a new target of \$2\.60\./);
  assert.match(newTargetText({ symbol: 'AIXI', side: 'long', target: 2.6, pct: 18, n: 1, previous: 2.2, stopRange: { low: 2.0, high: 2.1 }, why: ['momentum intact'] }), /new price target \$2\.60\*\* \(\+18%\) · PT 1 \$2\.20 smashed\. Stop raised to below \$2\.00–\$2\.10\.\n• momentum intact/);
});

test('each recipient from recipientsFor gets the DM, capped per hour; failures are logged, never thrown; no client means nothing is sent', async () => {
  let t = 0; const dms = [], logs = [];
  const dm = { send: async (id, content) => { dms.push({ id, content }); return id === B ? { ok: false, code: 50007 } : { ok: true }; } };
  const n = createDmNotifier({ dm, recipientsFor: (kind) => (kind === 'signal' ? [A, B, A, 'junk'] : [A]), logger: (l, e, d) => logs.push([e, d]), now: () => t, maxPerHour: 2 });
  assert.deepEqual(await n.signal(sig), { sent: [A], skipped: [B] });
  assert.equal(dms.length, 2);
  assert.ok(logs.some(([e, d]) => e === 'academy_dm_failed' && d.recipient === B && d.code === 50007));
  assert.deepEqual(await n.targetHit({ symbol: 'AIXI', target: 2.2, entry: 1.8 }), { sent: [A], skipped: [] });
  assert.deepEqual(await n.newTarget({ symbol: 'AIXI', side: 'long', target: 2.6, pct: 18, n: 1, previous: 2.2 }), { sent: [], skipped: [A] }, 'third DM inside the hour is dropped');
  t += 3_600_001;
  assert.deepEqual(await n.newTarget({ symbol: 'AIXI', side: 'long', target: 2.6, pct: 18, n: 1, previous: 2.2 }), { sent: [A], skipped: [] });
  const none = createDmNotifier({ recipientsFor: () => [A] });
  assert.deepEqual(await none.signal(sig), { sent: [], skipped: [] });
});
