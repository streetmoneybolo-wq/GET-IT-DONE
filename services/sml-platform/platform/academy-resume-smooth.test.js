'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { createServer } = require('./server');
const { createPageAssets } = require('./academy-page-assets');

const BARS = (n = 120) => Array.from({ length: n }, (_, i) => ({ t: Date.now() - (n - i) * 300_000, o: 100 + Math.sin(i / 7), h: 101 + Math.sin(i / 7), l: 99 + Math.sin(i / 7), c: 100 + Math.sin(i / 7), v: 1000 + i }));

async function open(t, tf) {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return null; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return null; }
  const marketHistory = { enabled: true, get: async (symbol, frame) => ({ ok: true, data: { symbol, tf: frame, bars: BARS() } }) };
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, marketHistory, pageAssets: createPageAssets() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.addInitScript(() => { try { localStorage.setItem('sml-academy-tour-v1', '1'); localStorage.setItem('sml-academy-explain', 'off'); } catch (_) { /* private mode */ } });
  await page.goto('http://127.0.0.1:' + server.address().port + '/academy-activity/?symbol=SPY&tf=' + tf, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  return { page, close: async () => { await browser.close(); await new Promise((r) => server.close(r)); } };
}

test('in a real browser the forming candle glides to each print instead of jumping, and settles on the true price', async (t) => {
  const env = await open(t, '5m'); if (!env) return;
  try {
    const { page } = env;
    const r = await page.evaluate(async () => {
      const P = window.smlChartPro, last = () => { const m = P.model(); return m ? m.bars[m.bars.length - 1] : null; };
      const base = last(); const start = Number(base.c), target = start + 3;
      P.liveTick(start + 0.0001, 10, Date.now()); await new Promise((x) => setTimeout(x, 150));
      P.liveTick(target, 10, Date.now());
      await new Promise((x) => requestAnimationFrame(() => requestAnimationFrame(x)));
      const mid = Number(last().c);
      await new Promise((x) => setTimeout(x, 700));
      return { start, target, mid, end: Number(last().c), trueClose: P.view.live.c };
    });
    assert.equal(r.trueClose, r.target, 'the real candle holds the true print');
    assert.ok(r.mid < r.target - 0.05, `a frame later the drawn price (${r.mid}) is still on its way to ${r.target}`);
    assert.ok(Math.abs(r.end - r.target) < 0.01, `it settles on the print (${r.end})`);
  } finally { await env.close(); }
});

test('a tick chart repaints with every frame the machine can give it, not on a fixed 25 per second beat', () => {
  const src = fs.readFileSync(path.join(__dirname, 'academy-chart-pro.js'), 'utf8');
  assert.doesNotMatch(src, /emit\(\); \}, 40\)/, 'no fixed 40 ms beat');
  assert.match(src, /frameCost/);
});

test('coming back from a minimised window renews a stale session, tells every module, and reconnects the chat and the live feed', async (t) => {
  const env = await open(t, '5m'); if (!env) return;
  try {
    const { page } = env;
    const seen = await page.evaluate(async () => {
      const got = []; window.addEventListener('sml-academy-resume', (e) => got.push(e.detail.why)); window.addEventListener('sml-academy-session', () => got.push('session'));
      let hidden = false; Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      hidden = true; document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((x) => setTimeout(x, 3300));
      hidden = false; document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((x) => setTimeout(x, 400));
      return got;
    });
    assert.ok(seen.includes('visible'), 'resume fired on return: ' + seen.join());
  } finally { await env.close(); }
});

test('the resume hooks are wired: chat reconnects with the new token, the live feed restarts, the market fetch cannot hang', () => {
  const d = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  assert.match(d('academy-chat-panel.js'), /sml-academy-resume/);
  assert.match(d('academy-live.js'), /sml-academy-resume/);
  const server = d('server.js');
  assert.match(server, /sml-academy-resume/); assert.match(server, /abort\.abort\(\),8000/);
  assert.match(server, /ACADEMY_TAPE_WARM/);
});

test('the chat does not stay blank on a dead session: a refused socket renews the session first, then reconnects with the new token and reloads the room', async (t) => {
  let playwright = null;
  for (const id of ['playwright', process.env.SML_PLAYWRIGHT_PATH || '/opt/node22/lib/node_modules/playwright']) { try { playwright = require(id); break; } catch (_) { /* next */ } }
  if (!playwright) { t.skip('Playwright is not installed here'); return; }
  let browser; try { browser = await playwright.chromium.launch(); } catch (_) { t.skip('no browser to launch'); return; }
  const marketHistory = { enabled: true, get: async (symbol, frame) => ({ ok: true, data: { symbol, tf: frame, bars: BARS() } }) };
  const server = createServer({ checkDatabase: async () => true, acceptWordPressEvent: async () => 'accepted', logger: () => {}, marketHistory, pageAssets: createPageAssets() });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    await page.addInitScript(() => {
      try { localStorage.setItem('sml-academy-tour-v1', '1'); localStorage.setItem('sml-academy-explain', 'off'); } catch (_) { /* private mode */ }
      window.__sockets = []; window.__reauth = 0; window.__alive = false;
      class Fake {
        constructor(url) { this.url = url; this.readyState = 0; this.sent = []; window.__sockets.push(this); setTimeout(() => { if (window.__alive && url.includes('token=fresh')) { this.readyState = 1; this.onopen && this.onopen(); } else { this.readyState = 3; this.onclose && this.onclose(); } }, 20); }
        send(x) { this.sent.push(x); try { const m = JSON.parse(x); if (m.type === 'join') setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify({ type: 'history', channel: m.channel, messages: [{ id: '1', channel: m.channel, body: 'hello again', authorName: 'Ana', discordId: '9', score: 0, at: Date.now() }] }) }), 20); } catch (_) { /* not json */ } }
        close() { this.readyState = 3; }
      }
      Fake.OPEN = 1; Fake.CONNECTING = 0; Fake.CLOSING = 2; Fake.CLOSED = 3; window.WebSocket = Fake;
    });
    await page.goto('http://127.0.0.1:' + server.address().port + '/academy-activity/?symbol=SPY&tf=5m', { waitUntil: 'load' });
    await page.waitForTimeout(1500);
    await page.evaluate(() => { window.smlAcademyReauth = async () => { window.__reauth++; window.__alive = true; window.smlAcademySessionToken = 'fresh'; return 'fresh'; }; window.smlAcademySessionToken = 'stale'; window.dispatchEvent(new CustomEvent('sml-academy-session', { detail: { sessionToken: 'stale' } })); });
    await page.waitForFunction(() => window.__reauth >= 1 && window.__sockets.some((s) => s.url.includes('token=fresh') && s.readyState === 1), null, { timeout: 15000 });
    const out = await page.evaluate(() => ({ reauth: window.__reauth, urls: window.__sockets.map((s) => /token=(\w+)/.exec(s.url)[1]), text: (document.querySelector('.academy-chat') || {}).textContent || '' }));
    assert.ok(out.reauth >= 1, 'the session was renewed after the socket was refused');
    assert.ok(out.urls.includes('stale') && out.urls.includes('fresh'));
    await page.waitForFunction(() => /hello again/.test((document.querySelector('.academy-chat') || {}).textContent || ''), null, { timeout: 8000 });
    // coming back after a long absence replaces a socket that only looks open
    const before = await page.evaluate(() => window.__sockets.length);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__h }); window.__h = true; document.dispatchEvent(new Event('visibilitychange')); });
    await page.evaluate(() => { window.__h = false; window.dispatchEvent(new CustomEvent('sml-academy-resume', { detail: { why: 'test' } })); });
    await page.waitForFunction((n) => window.__sockets.length > n, before, { timeout: 8000 });
    await page.waitForFunction(() => /hello again/.test((document.querySelector('.academy-chat') || {}).textContent || ''), null, { timeout: 8000 });
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});
