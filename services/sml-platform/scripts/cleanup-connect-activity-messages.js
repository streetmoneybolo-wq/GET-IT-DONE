#!/usr/bin/env node
'use strict';

const API = 'https://discord.com/api/v10';
const CHANNEL_ID = '938971234346106910';
const CONNECT_APP_ID = '1537698927401377894';
let lastCleanupResult = null;
async function discord(token, path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { authorization: `Bot ${token}`, ...(options.headers || {}) }
  });
  if (!response.ok) throw new Error(`Discord request failed: ${response.status}`);
  return response.status === 204 ? null : response.json();
}

function applicationId(message) {
  return String(message.application_id || message.interaction?.application_id ||
    message.interaction_metadata?.application_id || '');
}

async function cleanupConnectActivityMessages({
  token = process.env.SML_DISCORD_CONNECT_BOT_TOKEN,
  apply = false
} = {}) {
  token = String(token || '').trim();
  if (!token) throw new Error('SML_DISCORD_CONNECT_BOT_TOKEN is required');
  const messages = await discord(token, `/channels/${CHANNEL_ID}/messages?limit=100`);
  const matches = messages.filter((message) => applicationId(message) === CONNECT_APP_ID);
  if (apply) {
    for (const message of matches) {
      await discord(token, `/channels/${CHANNEL_ID}/messages/${message.id}`, { method: 'DELETE' });
    }
  }
  const result = { channelId: CHANNEL_ID, applicationId: CONNECT_APP_ID,
    matched: matches.length, deleted: apply ? matches.length : 0,
    messageIds: matches.map((message) => message.id) };
  lastCleanupResult = result;
  return result;
}

function getLastCleanupResult() {
  if (!lastCleanupResult) return null;
  return { matched: lastCleanupResult.matched, deleted: lastCleanupResult.deleted };
}

if (require.main === module) {
  cleanupConnectActivityMessages({ apply: process.argv.includes('--apply') })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => { console.error(error.message); process.exit(1); });
}

module.exports = { cleanupConnectActivityMessages, applicationId, getLastCleanupResult };
