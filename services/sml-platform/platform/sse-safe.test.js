'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { sseWrite, sseEvent } = require('./sse-safe');

const fake = (over = {}) => { const w = []; return { w, destroyed: false, writableEnded: false, writableLength: 0, write(c) { w.push(c); return true; }, destroy() { this.destroyed = true; }, ...over }; };

test('writes normally and frames events', () => {
  const r = fake();
  assert.equal(sseEvent(r, 'quote', { a: 1 }), true);
  assert.equal(r.w[0], 'event: quote\ndata: {"a":1}\n\n');
  assert.equal(sseWrite(r, ': keep-alive\n\n'), true);
});

test('drops a client whose send buffer is backed up instead of buffering without bound', () => {
  const r = fake({ writableLength: 600 * 1024 });
  assert.equal(sseWrite(r, 'x'), false);
  assert.equal(r.destroyed, true);
  assert.equal(r.w.length, 0);
});

test('never throws on closed or broken sockets', () => {
  assert.equal(sseWrite(fake({ destroyed: true }), 'x'), false);
  assert.equal(sseWrite(fake({ writableEnded: true }), 'x'), false);
  assert.equal(sseWrite(fake({ write() { throw new Error('EPIPE'); } }), 'x'), false);
  assert.equal(sseWrite(null, 'x'), false);
});
