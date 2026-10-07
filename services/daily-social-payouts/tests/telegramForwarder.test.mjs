/**
 * Discord -> Telegram forwarder tests.  Run: node --test tests/telegramForwarder.test.mjs
 *
 * No Discord, no Telegram, no bot process: global fetch is stubbed and the dedup log lives in a
 * temporary DATA_DIR. What is defended here:
 *   - an alert is sent once, and seeing the same message again does not resend it
 *   - a failed send is retried the next time the message is seen, but only up to MAX_ATTEMPTS
 *   - a record left 'pending' by a crash is retried once it is stale, a fresh one is not
 *   - the forum General topic (1) is addressed by omitting message_thread_id; other topics pass it
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dsp-tg-test-'));
delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TG_BOT_TOKEN; delete process.env.TELEGRAM_CHAT_ID; delete process.env.TG_CHAT_ID;

const { forwardAlertToTelegram } = await import('../utils/telegramForwarder.js');
const { paths } = await import('../utils/storage.js');

const settings = { telegramForward: { enabled: true, botToken: 'bot-token', chatId: '-100', channelIds: ['111', '222'], allowBotChannelIds: [], topicByChannel: { 111: 11, 222: 1 } } };
let calls = [], respond = () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 77 } }), text: async () => '' });
globalThis.fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return respond(); };
const message = (id, channelId = '111', content = 'SNDK long above 1690') => ({ guildId: '999', channelId, id, content, author: { bot: false, username: 'trader' }, attachments: { size: 0 }, channel: { name: 'swings' } });
const log = () => JSON.parse(readFileSync(paths.telegramForwardLog, 'utf8'));
const failOnce = () => { respond = () => ({ ok: false, status: 429, text: async () => 'Too Many Requests', json: async () => ({}) }); };
const succeed = () => { respond = () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 77 } }), text: async () => '' }); };

test('sends an alert once and does not resend it when the same message is seen again', async () => {
  calls = []; succeed();
  await forwardAlertToTelegram(message('m1'), settings);
  await forwardAlertToTelegram(message('m1'), settings, 'updated');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.message_thread_id, 11, 'the channel\'s topic is passed through');
  assert.equal(log().sent['999:111:m1'].status, 'sent');
});

test('a failed send is retried when the message is seen again, and gives up after MAX_ATTEMPTS', async () => {
  calls = []; failOnce();
  await forwardAlertToTelegram(message('m2'), settings);
  assert.equal(log().sent['999:111:m2'].status, 'failed');
  await forwardAlertToTelegram(message('m2'), settings, 'updated');
  assert.equal(calls.length, 2, 'the edit retried the failed send');
  await forwardAlertToTelegram(message('m2'), settings, 'updated');
  assert.equal(calls.length, 3);
  await forwardAlertToTelegram(message('m2'), settings, 'updated');
  await forwardAlertToTelegram(message('m2'), settings, 'updated');
  assert.equal(calls.length, 3, 'three failures: no further attempts, a permanently rejected message is not retried forever');
  succeed();
});

test('a record stuck in pending (the process died mid-send) is retried once stale, a fresh one is left alone', async () => {
  calls = []; succeed();
  mkdirSync(path.dirname(paths.telegramForwardLog), { recursive: true });
  const current = log();
  current.sent['999:111:stale'] = { status: 'pending', observedAt: new Date(Date.now() - 20 * 60_000).toISOString(), attempts: 1 };
  current.sent['999:111:fresh'] = { status: 'pending', observedAt: new Date().toISOString(), attempts: 1 };
  writeFileSync(paths.telegramForwardLog, JSON.stringify(current));
  await forwardAlertToTelegram(message('stale'), settings);
  await forwardAlertToTelegram(message('fresh'), settings);
  assert.equal(calls.length, 1, 'only the stale pending record was resent');
  assert.ok(calls[0].body.text.includes('/999/111/stale'), 'and it was the stale one (its jump link names the message)');
  assert.equal(log().sent['999:111:stale'].status, 'sent');
});

test('the forum General topic (1) is addressed by omitting message_thread_id', async () => {
  calls = []; succeed();
  await forwardAlertToTelegram(message('m3', '222'), settings);
  assert.equal(calls.length, 1);
  assert.equal('message_thread_id' in calls[0].body, false);
});

test('uses the configured SML News forum when an alert-specific chat ID is absent', async () => {
  calls = []; succeed();
  const fallbackSettings = {
    telegramForward: { enabled: true, botToken: 'bot-token', channelIds: ['111'], allowBotChannelIds: ['111'], topicByChannel: { 111: 11 } },
    telegramNewsForward: { chatId: '-100-forum' },
  };
  await forwardAlertToTelegram({ ...message('m3b'), author: { bot: true } }, fallbackSettings);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.chat_id, '-100-forum');
});

test('messages outside the configured channels, and bot messages from channels that do not allow them, are ignored', async () => {
  calls = []; succeed();
  assert.equal(await forwardAlertToTelegram(message('m4', '333'), settings), false);
  assert.equal(await forwardAlertToTelegram({ ...message('m5'), author: { bot: true } }, settings), false);
  assert.equal(calls.length, 0);
});

test('TELEGRAM_FORWARD_OWNER makes only the named identity forward; unset lets every identity forward', async () => {
  calls = []; succeed();
  try {
    process.env.BOT_RUNTIME_MODE = 'daily-social';
    process.env.TELEGRAM_FORWARD_OWNER = 'legacy';
    assert.equal(await forwardAlertToTelegram(message('own1'), settings), false, 'the daily-social identity stands down when legacy owns forwarding');
    assert.equal(calls.length, 0);
    process.env.TELEGRAM_FORWARD_OWNER = 'daily-social';
    await forwardAlertToTelegram(message('own2'), settings);
    assert.equal(calls.length, 1, 'and forwards when it is the owner');
    delete process.env.BOT_RUNTIME_MODE;
    assert.equal(await forwardAlertToTelegram(message('own3'), settings), false, 'the legacy identity stands down when daily-social owns it');
    delete process.env.TELEGRAM_FORWARD_OWNER;
    await forwardAlertToTelegram(message('own4'), settings);
    assert.equal(calls.length, 2, 'unset: any identity forwards, as before');
  } finally { delete process.env.BOT_RUNTIME_MODE; delete process.env.TELEGRAM_FORWARD_OWNER; }
});
