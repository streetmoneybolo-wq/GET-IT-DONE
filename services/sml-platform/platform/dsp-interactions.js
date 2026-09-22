'use strict';

const crypto = require('node:crypto');
const { createDailySocialCommands } = require('./daily-social-commands');
const PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const SIGNATURE = /^[a-f0-9]{128}$/i;
const PUBLIC_KEY = /^[a-f0-9]{64}$/i;
const MAX_BODY_BYTES = 64 * 1024;

function send(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  response.end(payload);
}

function createDailySocialPayoutsInteractions({ config, pool } = {}) {
  const publicKeyHex = String(config && config.dailySocialPayoutsPublicKey || '').trim();
  let publicKey = null;
  if (PUBLIC_KEY.test(publicKeyHex)) {
    try { publicKey = crypto.createPublicKey({ key: Buffer.concat([PREFIX, Buffer.from(publicKeyHex, 'hex')]), format: 'der', type: 'spki' }); } catch (_) { publicKey = null; }
  }
  const commands = createDailySocialCommands({ pool, guildId: config.dailySocialPayoutsGuildId, channelId: config.dailySocialPayoutsChannelId, managerRoleId: config.dailySocialPayoutsManagerRoleId });

  async function handle(request, response, rawBody) {
    if (!publicKey) { send(response, 503, { error: 'integration_unconfigured' }); return; }
    // The shared HTTP reader returns UTF-8 text. Recreate the exact UTF-8
    // bytes before verifying Discord's timestamp || body signature.
    const body = Buffer.isBuffer(rawBody) ? rawBody : typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : null;
    if (!body || body.length > MAX_BODY_BYTES) { send(response, 413, { error: 'payload_too_large' }); return; }
    const signature = String(request.headers['x-signature-ed25519'] || '');
    const timestamp = String(request.headers['x-signature-timestamp'] || '');
    let valid = false;
    try { valid = SIGNATURE.test(signature) && timestamp.length > 0 && crypto.verify(null, Buffer.concat([Buffer.from(timestamp), body]), publicKey, Buffer.from(signature, 'hex')); } catch (_) { valid = false; }
    if (!valid) { send(response, 401, { error: 'invalid_signature' }); return; }
    let interaction;
    try { interaction = JSON.parse(body.toString('utf8')); } catch (_) { send(response, 400, { error: 'invalid_json' }); return; }
    if (interaction.type === 1) { send(response, 200, { type: 1 }); return; }
    if (interaction.type !== 2 && interaction.type !== 3) { send(response, 200, { type: 4, data: { content: 'Unsupported interaction.', flags: 64 } }); return; }
    const result = interaction.type === 3 ? await commands.handleComponent(interaction) : await commands.handleCommand(interaction);
    send(response, 200, result.response);
  }
  return Object.freeze({ handle });
}

module.exports = { MAX_BODY_BYTES, createDailySocialPayoutsInteractions };
