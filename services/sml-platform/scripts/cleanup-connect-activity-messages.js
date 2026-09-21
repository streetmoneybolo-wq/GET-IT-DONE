#!/usr/bin/env node
'use strict';

const API = 'https://discord.com/api/v10';
const CHANNEL_ID = '938971234346106910';
const CONNECT_APP_ID = '1537698927401377894';
const apply = process.argv.includes('--apply');
const token = String(process.env.SML_DISCORD_CONNECT_BOT_TOKEN || '').trim();

if (!token) throw new Error('SML_DISCORD_CONNECT_BOT_TOKEN is required');

async function discord(path, options = {}) {
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

(async () => {
  const messages = await discord(`/channels/${CHANNEL_ID}/messages?limit=100`);
  const matches = messages.filter((message) => applicationId(message) === CONNECT_APP_ID);
  if (apply) {
    for (const message of matches) {
      await discord(`/channels/${CHANNEL_ID}/messages/${message.id}`, { method: 'DELETE' });
    }
  }
  console.log(JSON.stringify({ channelId: CHANNEL_ID, applicationId: CONNECT_APP_ID,
    matched: matches.length, deleted: apply ? matches.length : 0,
    messageIds: matches.map((message) => message.id) }, null, 2));
})().catch((error) => { console.error(error.message); process.exit(1); });
