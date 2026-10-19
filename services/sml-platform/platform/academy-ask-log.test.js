'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAskLog, readCall } = require('./academy-ask-log');

test('readCall tells a direction question from a lesson question and reads the call out of the answer', () => {
  const q = 'So what direction do you fellas think the markets will be going tomorrow?';
  assert.deepEqual(readCall(q, 'Up. SPY holds 580 and squeezes toward 586; wrong if it loses 578 on a close.'), { direction: 'up', subject: 'market', horizon: 'tomorrow', asksDirection: true, kind: 'direction' });
  assert.equal(readCall(q, 'Down tomorrow. The tape rolled over at the close.').direction, 'down');
  assert.equal(readCall(q, 'Flat. Chop between 578 and 584 until the Fed.').direction, 'flat');
  assert.equal(readCall('Where is $NVDA going this week?', 'Higher. It reclaimed the 20-day.').subject, 'NVDA');
  assert.equal(readCall('Where is $NVDA going this week?', 'Higher.').horizon, 'week');
  assert.equal(readCall('What does it mean to own a share?', 'A slice of a real business.').asksDirection, false);
  assert.equal(readCall('What does it mean to own a share?', 'A slice of a real business.').direction, null);
});

test('an entry question is a call too: any ticker is found, lower-case included, the chart symbol stands in, and the yes or no is read', () => {
  const r = readCall('is hubc worth it to enter still ?', 'Yes at 3.40, not at 4.10: it is five ATRs above the 10-day low. Stop 3.05, first target 4.60, about 2.5 to 1.');
  assert.deepEqual(r, { direction: 'up', subject: 'HUBC', horizon: null, asksDirection: true, kind: 'entry' });
  assert.equal(readCall('should I buy the dip on $amd this week?', 'No, not here. Wait for 150 to hold.').direction, 'down');
  assert.equal(readCall('should I buy the dip on $amd this week?', '').subject, 'AMD');
  assert.equal(readCall('should I buy the dip on $amd this week?', '').horizon, 'week');
  assert.equal(readCall('Is NVDA worth a swing here?', 'Yes.').subject, 'NVDA');
  assert.equal(readCall('is it still worth entering?', 'Yes at the reclaim.', { symbol: 'hubc' }).subject, 'HUBC', 'no ticker in the words: the chart on screen is the subject');
  assert.equal(readCall('is it still worth entering?', '').asksDirection, false, 'with nothing on screen either, there is nothing to call');
  assert.equal(readCall('What is a buy limit order?', 'An order that fills at your price or better.').asksDirection, false, 'a lesson question that says buy is still a lesson question');
  assert.equal(readCall('is worth worth buying?', '', { isSymbol: (w) => w === 'WRTH' }).asksDirection, false, 'an English word is not a ticker');
  assert.equal(readCall('is tsla worth holding into earnings?', '', { isSymbol: (w) => w === 'TSLA' }).subject, 'TSLA');
  assert.equal(readCall('should I sell the market here?', 'Yes.').kind, 'direction', 'the market is a direction question, not an entry');
});

test('the log records every answer with its call, lists newest first, scores outcomes and sums a track record', async () => {
  let t = 1_700_000_000_000;
  const log = createAskLog({ now: () => (t += 1000) });
  assert.equal(log.configured, false);
  const a = await log.record({ userId: 'owner', question: 'Which way is the market going tomorrow?', answer: 'Up. Breadth turned and SPY held VWAP all afternoon.', model: 'claude-sonnet-5-5', context: 'SPY 580.12 +0.4%' });
  const b = await log.record({ userId: 'owner', question: 'What is a stop loss?', answer: 'The price where you admit you were wrong and get out.', model: 'claude-sonnet-5-5' });
  const c = await log.record({ userId: 'owner', question: 'TSLA into earnings next week?', answer: 'Down into the print. The chart is below the 50-day.', model: 'claude-sonnet-5-5' });
  assert.equal(a.direction, 'up'); assert.equal(a.subject, 'market'); assert.equal(a.horizon, 'tomorrow'); assert.equal(a.context, 'SPY 580.12 +0.4%');
  assert.equal(b.asksDirection, false); assert.equal(b.direction, null);
  assert.equal(c.direction, 'down'); assert.equal(c.subject, 'TSLA'); assert.equal(c.horizon, 'week');
  const all = await log.list();
  assert.deepEqual(all.map((r) => r.id), [c.id, b.id, a.id]);
  const calls = await log.list({ directionOnly: true });
  assert.deepEqual(calls.map((r) => r.id), [c.id, a.id]);
  assert.equal((await log.score(a.id, { outcome: 'right', note: 'SPY +0.8%' })).ok, true);
  assert.equal((await log.score(c.id, { outcome: 'wrong' })).ok, true);
  assert.equal((await log.score(b.id, { outcome: 'maybe' })).error, 'invalid_outcome');
  assert.equal((await log.score('999', { outcome: 'right' })).error, 'not_found');
  assert.deepEqual((await log.list({ directionOnly: true, unscored: true })), []);
  const st = await log.stats();
  assert.equal(st.total.calls, 2); assert.equal(st.total.scored, 2); assert.equal(st.total.right, 1); assert.equal(st.hitRate, 50);
  assert.equal(st.byHorizon.tomorrow.right, 1); assert.equal(st.byHorizon.week.wrong, 1);
});

test('with a pool the log writes to academy_ask_log and reads back through it', async () => {
  const sql = [];
  const pool = { query: async (text, params) => { sql.push({ text, params }); if (/^INSERT/.test(text)) return { rows: [{ id: 7, user_id: params[0], question: params[1], answer: params[2], model: params[3], asks_direction: params[4], direction: params[5], subject: params[6], horizon: params[7], context: params[8], created_at: new Date(0) }] }; if (/^SELECT/.test(text)) return { rows: [] }; if (/^UPDATE/.test(text)) return { rows: [{ id: params[0], user_id: 'o', question: 'q', answer: 'a', outcome: params[1], outcome_note: params[2], created_at: new Date(0), scored_at: new Date(0) }] }; return { rows: [] }; } };
  const log = createAskLog({ pool });
  assert.equal(log.configured, true);
  await log.ensureSchema();
  assert.match(sql[0].text, /CREATE TABLE IF NOT EXISTS academy_ask_log/);
  const r = await log.record({ userId: 'owner', question: 'Market tomorrow?', answer: 'Up.', model: 'm' });
  assert.equal(r.id, '7'); assert.equal(r.direction, 'up'); assert.equal(r.asksDirection, true);
  assert.match(sql.at(-1).text, /INSERT INTO academy_ask_log/);
  await log.list({ limit: 5, directionOnly: true, unscored: true });
  assert.match(sql.at(-1).text, /WHERE asks_direction = true AND outcome IS NULL ORDER BY id DESC LIMIT \$1/);
  const sc = await log.score(7, { outcome: 'right', note: 'closed green' });
  assert.equal(sc.ok, true); assert.equal(sc.row.outcome, 'right');
});
