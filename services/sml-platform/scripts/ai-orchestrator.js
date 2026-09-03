#!/usr/bin/env node
'use strict';

const { createDatabase } = require('../platform/database');
const { getConfig } = require('../platform/config');
const { createAiTaskStore } = require('../platform/ai-orchestrator');

async function readStdin(maxBytes = 256 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error('input is too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function validInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('input must be a JSON object');
  if (typeof input.idempotencyKey !== 'string' || !/^[A-Za-z0-9._:-]{8,200}$/.test(input.idempotencyKey)) throw new Error('idempotencyKey must be 8-200 safe characters');
  if (typeof input.goal !== 'string' || input.goal.trim().length < 10 || input.goal.length > 20000) throw new Error('goal must be 10-20000 characters');
  if (input.nextModel != null && !['claude', 'codex'].includes(input.nextModel)) throw new Error('nextModel must be claude or codex');
  if (input.context != null && (!input.context || typeof input.context !== 'object' || Array.isArray(input.context))) throw new Error('context must be a JSON object');
  if (input.payload != null && (!input.payload || typeof input.payload !== 'object' || Array.isArray(input.payload))) throw new Error('payload must be a JSON object');
  if (input.maxHops != null && (!Number.isInteger(input.maxHops) || input.maxHops < 1 || input.maxHops > 20)) throw new Error('maxHops must be 1-20');
  if (input.maxRetries != null && (!Number.isInteger(input.maxRetries) || input.maxRetries < 0 || input.maxRetries > 10)) throw new Error('maxRetries must be 0-10');
  if (input.budgetMicrousd != null && (!Number.isSafeInteger(input.budgetMicrousd) || input.budgetMicrousd < 0)) throw new Error('budgetMicrousd must be a non-negative integer');
  return input;
}

async function main() {
  const command = process.argv[2] || 'status';
  const database = createDatabase(getConfig());
  const store = createAiTaskStore(database.pool);
  try {
    if (command === 'enqueue') {
      const raw = await readStdin();
      const input = validInput(JSON.parse(raw));
      const row = await store.enqueue(input);
      process.stdout.write(JSON.stringify({ ok: true, id: row.id, status: row.status }) + '\n');
      return;
    }
    if (command === 'status') {
      const rows = await store.list(process.argv[3] || 50);
      process.stdout.write(JSON.stringify({ ok: true, tasks: rows }, null, 2) + '\n');
      return;
    }
    throw new Error('usage: ai-orchestrator.js enqueue < task.json | status [limit]');
  } finally { await database.close(); }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`ai orchestrator: ${error.message}\n`);
  process.exit(1);
});

module.exports = { readStdin, validInput };
