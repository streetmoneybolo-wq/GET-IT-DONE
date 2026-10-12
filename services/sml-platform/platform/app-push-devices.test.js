'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppPushDevices } = require('./app-push-devices');

test('a phone registers once, re-registering refreshes it, and the token follows whoever signs in on that phone', async () => {
  let t = 1_760_000_000_000;
  const devices = createAppPushDevices({ now: () => t });
  const apns = 'f'.repeat(64);
  const first = await devices.register(7, { platform: 'ios', token: apns, deviceId: 'iphone-1', appVersion: '1.0.0' });
  assert.equal(first.ok, true); assert.equal(first.device.userId, 7); assert.equal(first.device.platform, 'ios');
  t += 60_000;
  const again = await devices.register(7, { platform: 'ios', token: apns, deviceId: 'iphone-1', appVersion: '1.0.1' });
  assert.equal(again.device.id, first.device.id, 'same row'); assert.equal(again.device.appVersion, '1.0.1'); assert.notEqual(again.device.lastSeenAt, first.device.lastSeenAt);
  assert.equal((await devices.list(7)).length, 1);
  await devices.register(9, { platform: 'ios', token: apns });
  assert.deepEqual(await devices.list(7), []);
  assert.deepEqual(await devices.tokensFor(9), [{ platform: 'ios', token: apns }]);
  assert.deepEqual(await devices.remove(7, apns), { ok: true, status: 200, removed: false }, 'only the owner can remove it');
  assert.deepEqual(await devices.remove(9, apns), { ok: true, status: 200, removed: true });
  assert.deepEqual(await devices.tokensFor(9), []);
});

test('bad registrations are refused with a reason', async () => {
  const devices = createAppPushDevices();
  assert.equal((await devices.register(7, { platform: 'blackberry', token: 'x'.repeat(40) })).error, 'invalid_platform');
  assert.equal((await devices.register(7, { platform: 'android', token: 'short' })).error, 'invalid_token');
  assert.equal((await devices.register(7, { platform: 'android', token: 'has space ' + 'x'.repeat(30) })).error, 'invalid_token');
  assert.equal((await devices.remove(7, 'x')).error, 'invalid_token');
  const fcm = await devices.register(7, { platform: 'android', token: 'dGhpcyBpcyBhIGZha2UgZmNtIHRva2Vu:APA91bF' + 'y'.repeat(100) });
  assert.equal(fcm.ok, true);
});
