#!/usr/bin/env node
'use strict';

/* Configure the story desk on the sml-platform-api service without the credential ever leaving your machine in the open:
 *
 *   RENDER_API_KEY=rnd_xxx node scripts/render-configure-story-desk.js [--service srv-da4vqlu1egvs73afb9ag] [--autopublish on|off] [--llm on|off]
 *
 * It asks for the WordPress application password of the byline account (user "ben", Vaughn McNair) on the terminal with the
 * echo off, then sets SML_LETTERS_USERNAME / SML_LETTERS_APP_PASSWORD (and the optional switches) through the Render API,
 * which triggers a deploy. Make the application password at stockmarketloop.com → Users → Profile → Application Passwords
 * while signed in as that account. Nothing is printed back. */

const readline = require('node:readline');

const SERVICE = (process.argv.includes('--service') ? process.argv[process.argv.indexOf('--service') + 1] : '') || 'srv-da4vqlu1egvs73afb9ag';
const flag = (name) => (process.argv.includes(name) ? String(process.argv[process.argv.indexOf(name) + 1] || '').toLowerCase() : '');
const KEY = String(process.env.RENDER_API_KEY || '').trim();
if (!KEY) { console.error('RENDER_API_KEY is not set. Create one at dashboard.render.com → Account Settings → API Keys and run again.'); process.exit(1); }

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) { const w = rl._writeToOutput; rl._writeToOutput = function (s) { if (s.includes('\n')) w.call(rl, '\n'); }; }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(String(answer || '').trim()); });
  });
}

(async () => {
  const username = (await ask('WordPress username of the byline account [ben]: ')) || 'ben';
  const password = await ask('Application password for that account (hidden): ', { hidden: true });
  if (!password) { console.error('No password given; nothing changed.'); process.exit(1); }
  const autopublish = flag('--autopublish') || (await ask('Publish automatically when the account checks out? (on/off) [off]: ')).toLowerCase() || 'off';
  const llm = flag('--llm') || (await ask('Let the newsroom model polish the voice? (on/off) [off]: ')).toLowerCase() || 'off';
  const envVars = [
    { key: 'SML_LETTERS_USERNAME', value: username },
    { key: 'SML_LETTERS_APP_PASSWORD', value: password },
    { key: 'SML_LETTERS_AUTHOR_ID', value: '258456581' },
    { key: 'SML_STORY_AUTOPUBLISH', value: autopublish === 'on' ? 'on' : 'off' },
    { key: 'SML_STORY_LLM', value: llm === 'on' ? 'on' : 'off' }
  ];
  // merge: read the current list, replace or add these keys, write the list back (Render's env endpoint is a full PUT)
  const headers = { authorization: `Bearer ${KEY}`, accept: 'application/json', 'content-type': 'application/json' };
  const cur = await fetch(`https://api.render.com/v1/services/${SERVICE}/env-vars?limit=100`, { headers });
  if (!cur.ok) { console.error('Could not read the service (' + cur.status + '). Check the API key and the service id.'); process.exit(1); }
  const list = (await cur.json()).map((x) => x.envVar || x).filter((x) => x && x.key).map((x) => ({ key: x.key, value: x.value }));
  for (const v of envVars) { const i = list.findIndex((x) => x.key === v.key); if (i >= 0) list[i] = v; else list.push(v); }
  const put = await fetch(`https://api.render.com/v1/services/${SERVICE}/env-vars`, { method: 'PUT', headers, body: JSON.stringify(list) });
  if (!put.ok) { console.error('Render refused the update (' + put.status + '): ' + (await put.text()).slice(0, 200)); process.exit(1); }
  console.log(`Set ${envVars.map((v) => v.key).join(', ')} on ${SERVICE}. A deploy follows; the next story desk tick files letters as ${username}.`);
})().catch((error) => { console.error(String(error && error.message || error)); process.exit(1); });
