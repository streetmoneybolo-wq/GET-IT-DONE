'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

/* The service has to get through its whole start-up with the Article Desk, the voice and the media store switched on. A reference to something that is built later in
   start-up (a const used before its line runs) only fails when the process boots, so this boots it, with no real database or provider, and waits for api_started. */
test('the service boots with the story desk, the voice and the article audio switched on', async () => {
  const env = { ...process.env, MASSIVE_API_KEY: 'x', DATABASE_URL: 'postgres://u:p@127.0.0.1:5999/x', SML_ACADEMY_TRIAL_PUBLIC_URL: 'https://api.example', SML_ACADEMY_ELEVENLABS_VOICE_ID: 'v', ELEVENLABS_API_KEY: 'k', ANTHROPIC_API_KEY: 'k', PORT: String(19000 + Math.floor(Math.random() * 900)), SML_STORY_WARM: 'off', SML_ACADEMY_TOUR_BAKE: 'off' };
  const child = spawn(process.execPath, [path.join(__dirname, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  const result = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timeout'), 25000);
    const on = (d) => { out += d; if (/"event":"api_started"/.test(out)) { clearTimeout(timer); resolve('started'); } else if (/"event":"api_start_failed"/.test(out)) { clearTimeout(timer); resolve('failed'); } };
    child.stdout.on('data', on); child.stderr.on('data', on);
    child.on('exit', () => { clearTimeout(timer); resolve(/"event":"api_started"/.test(out) ? 'started' : 'failed'); });
  });
  child.kill('SIGKILL');
  assert.equal(result, 'started', out.split('\n').filter((l) => /api_start_failed|story_desk/.test(l)).join('\n').slice(0, 600));
  assert.match(out, /"event":"story_desk_enabled"/);
});
