'use strict';

/* End-to-end over a real socket: attachChatServer on a real http.Server, a real `ws` client, a
   signed-session lookup faked at the verifySession boundary. Covers the glue academy-chat.test.js
   deliberately leaves out: the upgrade handshake, token refusal, and that the verified session
   name (not the ?name= the client sends) is what the room sees. */

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { WebSocketServer, WebSocket } = require('ws');
const { createChatStore, createChatHub, attachChatServer } = require('./academy-chat');

const U1 = '200000000000000001';
const verify = (authorization) => {
  const token = /^Bearer\s+(\S+)$/i.exec(String(authorization || ''));
  if (token && token[1] === 'good') return { ok: true, userId: U1, tier: 'member', displayName: 'Ace Trader' };
  return { ok: false, status: 401, code: 'authorization_required' };
};

async function withChatServer(run) {
  const server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
  const hub = createChatHub({ store: createChatStore(), verifySession: verify });
  const wss = attachChatServer(server, hub, { WebSocketServer });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try { await run(`ws://127.0.0.1:${server.address().port}/academy-activity/chat`); }
  finally { wss.close(); await new Promise((resolve) => server.close(resolve)); }
}
const frames = (ws) => { const out = []; ws.on('message', (d) => out.push(JSON.parse(String(d)))); return out; };
const until = (list, pred, ms = 2000) => new Promise((resolve, reject) => { const t0 = Date.now(); (function poll() { const hit = list.find(pred); if (hit) return resolve(hit); if (Date.now() - t0 > ms) return reject(new Error('timed out waiting for frame')); setTimeout(poll, 10); })(); });

test('a real WebSocket client with a good token joins the global room, posts, and the room sees the verified name rather than the name it sent', async () => {
  await withChatServer(async (url) => {
    const ws = new WebSocket(url + '?token=good&name=' + encodeURIComponent('Not Me'));
    const got = frames(ws);
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    ws.send(JSON.stringify({ type: 'join', channel: 'global' }));
    const history = await until(got, (f) => f.type === 'history');
    assert.equal(history.channel, 'global');
    assert.deepEqual(history.messages, []);
    ws.send(JSON.stringify({ type: 'message', body: 'first' }));
    const msg = await until(got, (f) => f.type === 'message');
    assert.equal(msg.message.body, 'first');
    assert.equal(msg.message.authorName, 'Ace Trader', 'the signed session name, never the client-chosen one');
    assert.equal(msg.message.discordId, U1);
    ws.close();
  });
});

test('a bad token never completes the upgrade', async () => {
  await withChatServer(async (url) => {
    const ws = new WebSocket(url + '?token=bad');
    const outcome = await new Promise((resolve) => { ws.once('open', () => resolve('open')); ws.once('error', () => resolve('refused')); ws.once('close', () => resolve('refused')); });
    assert.equal(outcome, 'refused');
  });
});
