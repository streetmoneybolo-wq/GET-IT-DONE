'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { blockedIp } = require('./safe-fetch');

test('blocks loopback, private, link-local, and metadata-network addresses', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '172.16.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', 'fe80::1']) {
    assert.equal(blockedIp(address), true, address);
  }
});

test('allows ordinary public IPv4 and IPv6 addresses', () => {
  assert.equal(blockedIp('1.1.1.1'), false);
  assert.equal(blockedIp('2606:4700:4700::1111'), false);
});
