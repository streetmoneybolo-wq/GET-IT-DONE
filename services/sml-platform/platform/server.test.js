'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { createServer, calculateWindowChange, calculateThreeMinuteChange } = require('./server');
const { hmac } = require('./wordpress-gateway');
const { SEED_LESSONS } = require('./academy/curriculum');
const { lessonParts, narrationVersion, curriculumVersion, EXAMPLE_LEAD, CHECK_LEAD } = require('./academy/lesson-parts');
const { academyCurriculumScript, academyCurriculumVersion } = require('./academy-activity-curriculum');
const { academyCartoonVisualsScript } = require('./academy-cartoon-visuals');
const { academyVisualLabScript } = require('./academy-visual-lab');

/* Strings that must never reach the Activity page, in any injected script or
   comment, in any letter case. */
const PAGE_BANNED = /<iframe|location\.assign|CLAUDE DESIGNED|Playing Grandmaster-Obi|next lesson is preloading/i;

/* Every <script> on the served page must parse, not only the last one. Classic
   scripts are compiled with new Function; module scripts are syntax-checked by
   node --check (import declarations are not valid in a function body). */
function assertEveryScriptParses(html) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.equal(scripts.length, (html.match(/<script\b/gi) || []).length, 'every <script> is closed');
  let modules = 0;
  scripts.forEach(([, attributes, source], index) => {
    if (/\btype\s*=\s*["']?module/i.test(attributes)) {
      modules += 1;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-module-'));
      const file = path.join(dir, `script-${index}.mjs`);
      try {
        fs.writeFileSync(file, source);
        const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
        assert.equal(check.status, 0, `module <script> #${index} does not parse: ${check.stderr}`);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
      return;
    }
    assert.doesNotThrow(() => new Function(source), `<script> #${index} does not parse: ${source.slice(0, 80)}`);
  });
  return { total: scripts.length, modules };
}

async function withServer(options, run) {
  const server = createServer({
    checkDatabase: async () => true,
    acceptWordPressEvent: async () => 'accepted',
    logger: () => {},
    now: () => 1_700_000_000_000,
    ...options
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('S.I.R.E calculates the signed three-minute price change without exposing a rank', () => {
  const now = 1_700_000_180_000;
  const gain = calculateThreeMinuteChange(102.34, [{ t: now - 180_000, price: 100 }], now);
  const loss = calculateThreeMinuteChange(98.88, [{ t: now - 180_000, price: 100 }], now);
  assert.ok(Math.abs(gain.percent - 2.34) < 1e-10);
  assert.equal(gain.windowSeconds, 180);
  assert.ok(Math.abs(loss.percent + 1.12) < 1e-10);
  assert.equal(loss.windowSeconds, 180);
  const interpolated = calculateThreeMinuteChange(103, [
    { t: now - 190_000, price: 100 },
    { t: now - 170_000, price: 102 }
  ], now);
  assert.ok(Math.abs(interpolated.percent - ((103 - 101) / 101 * 100)) < 1e-10);
  assert.equal(interpolated.windowSeconds, 180);
  assert.deepEqual(calculateThreeMinuteChange(100, [{ t: now - 179_999, price: 99 }], now), {
    percent: null,
    windowSeconds: null
  });
  const serverSource = require('node:fs').readFileSync(require.resolve('./server'), 'utf8');
  assert.match(serverSource, /history\.slice\(-1_000\)/);
  assert.equal(calculateWindowChange(105, [{ t: now - 300_000, price: 100 }], now, 300_000).percent, 5);
});

test('health returns 200 only when the database check passes', async () => {
  await withServer({ checkDatabase: async () => true }, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
    const { data, ...rest } = await response.json();
    assert.deepEqual(rest, {
      ok: true,
      service: 'sml-platform-api',
      database: 'connected'
    });
    assert.ok(data && ['ok', 'unknown', 'degraded', 'down', 'rate_limited'].includes(data.overall));
    assert.equal(typeof data.marketOpen, 'boolean');
  });
});

test('data-status reports provider health and the ET market session without credentials', async () => {
  await withServer({ checkDatabase: async () => true }, async (base) => {
    const response = await fetch(`${base}/academy-activity/data-status`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.ok(['pre', 'regular', 'post', 'closed'].includes(body.session));
    assert.match(body.et, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    assert.equal(typeof body.providers, 'object');
    assert.doesNotMatch(JSON.stringify(body), /api[_-]?key|secret|bearer/i);
  });
});

test('health fails closed when the database check fails', async () => {
  await withServer({ checkDatabase: async () => { throw new Error('offline'); } }, async (base) => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      ok: false,
      service: 'sml-platform-api',
      database: 'unavailable'
    });
  });
});

test('all other routes are a no-store 404', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/not-a-route`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });
});

test('Academy Activity serves the read-only live chart host for Discord', async () => {
  await withServer({ academyAppId: '1551336038713139370' }, async (base) => {
    const response = await fetch(`${base}/academy-activity/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors https:\/\/discord\.com/);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.match(response.headers.get('content-security-policy'), /media-src 'self' blob:/);
    assert.match(response.headers.get('content-security-policy'), /frame-src 'self'/);
    const html = await response.text();
    assert.match(html, /Making Easy Money Academy/);
    assert.match(html, /Live interactive candlestick chart/);
    assert.match(html, /toggle\.textContent='Lessons \('/);
    assert.match(html, /Choose an Academy lesson/);
    assert.match(html, /academy-activity\/curriculum/);
    assert.match(html, /speechSynthesis/);
    assert.match(html, /academy-activity\/speech/);
    assert.match(html, /new Audio\(voiceUrl\)/);
    assert.match(html, /academy-voice-control/);
    assert.match(html, /playNarration/);
    assert.match(html, /render\(true\)/);
    assert.match(html, /Mute Voice/);
    assert.match(html, /voiceAudio\.muted=voiceMuted/);
    assert.match(html, /academy-live-deck/);
    assert.match(html, /Lesson presentation/);
    // The whiteboard "simple version" renderer replaces Codex's hard-coded 9.1
    // cartoon. Injected scripts are served verbatim (no `$'`-style replacement
    // corruption), with the renderer right after the curriculum client and
    // before the visual lab.
    const curriculumScript = academyCurriculumScript(SEED_LESSONS);
    const whiteboardScript = academyCartoonVisualsScript();
    const curriculumAt = html.indexOf(curriculumScript);
    const whiteboardAt = html.indexOf(whiteboardScript);
    assert.ok(curriculumAt > 0, 'curriculum client is served verbatim');
    assert.equal(whiteboardAt, curriculumAt + curriculumScript.length, 'whiteboard renderer follows the curriculum client verbatim');
    assert.equal(html.indexOf(academyVisualLabScript()), whiteboardAt + whiteboardScript.length, 'visual lab follows the whiteboard renderer');
    assert.doesNotMatch(html, /ORIGINAL ACADEMY VISUAL|cartoon-put|\$45 STRIKE/);
    assert.match(html, /win\.addEventListener\('sml-academy-slide-sync', onSync\)/);
    assert.match(html, /win\.addEventListener\('sml-academy-slide-progress', onProgress\)/);
    assert.match(html, /win\.SMLWhiteboard = api/);
    assert.match(html, /visual\.setAttribute\('data-board', 'whiteboard'\)/);
    assert.match(html, /\.academy-live-deck \.academy-slide-visual\[data-board\]/);
    assert.match(html, /'<svg class="wb-svg" xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 '/);
    assert.match(html, /@media \(prefers-reduced-motion:reduce\)\{[^@]*\.wb-r\{opacity:1!important/);
    // renderDeck dispatches the contract events the renderer listens to.
    assert.match(html, /window\.dispatchEvent\(new CustomEvent\('sml-academy-slide-sync',\{detail:\{lesson,lessonKey:key\(lesson\),slide:/);
    assert.match(html, /text:parts\[safe\],partIndex:safe,partProgress,visual:deckVisual,example:lesson\.example\|\|null,isExample,playing:voicePlaying\(\)\}\}\)\)/);
    assert.match(html, /window\.dispatchEvent\(new CustomEvent\('sml-academy-slide-progress',\{detail:\{lessonKey:key\(lesson\),partIndex:safe,wordIndex,wordCount:words\.length,partProgress,playing:voicePlaying\(\)\}\}\)\)/);
    assert.match(html, /const narrationParts=lesson=>Array\.isArray\(lesson\.parts\)&&lesson\.parts\.length\?lesson\.parts:/);
    // The example callout promises line-by-line drawing only while the voice
    // is playing (and motion is allowed); a board drawn all at once (no audio,
    // paused, reduced motion, manual browsing) gets a neutral callout, and a
    // pause re-renders the slide so the callout and the board update at once.
    assert.match(html, /if\(isExample\)\{const callout=voicePlaying\(\)&&!reduceMotion\(\)\?'Watch each line appear as it is explained\.':'Read the board from top to bottom\.';if\(deckCallout\.textContent!==callout\)deckCallout\.textContent=callout\}/);
    assert.doesNotMatch(html, /deckCallout\.textContent='Watch each line appear as it is explained\.'/);
    assert.match(html, /const reduceMotion=\(\)=>\{try\{return Boolean\(window\.matchMedia&&window\.matchMedia\('\(prefers-reduced-motion: reduce\)'\)\.matches\)\}/);
    assert.match(html, /voiceAudio\.onpause=\(\)=>\{if\(requestId!==voiceRequest\)return;deckWord=-1;renderDeck\(activeDeckPart,activeDeckProgress\)\}/);
    // The whiteboard SVG carries the example title, so the deck heading above
    // it is a short neutral label instead of the same title twice.
    assert.match(html, /deckTitle\.textContent=claudeSlide&&claudeSlide\.heading\?claudeSlide\.heading:'The simple version';/);
    assert.doesNotMatch(html, /sheet\.title\|\|'The simple version'/);
    // Versioned URLs: the curriculum payload and every lesson's audio change
    // URL whenever what is spoken or drawn changes.
    const version = curriculumVersion(SEED_LESSONS);
    assert.match(version, /^[0-9a-f]{12}$/);
    assert.equal(academyCurriculumVersion(SEED_LESSONS), version);
    assert.ok(html.includes(`const curriculumVersion='${version}';`), 'client embeds the curriculum version');
    assert.ok(html.includes("fetch('/academy-activity/curriculum?v='+curriculumVersion,{cache:'force-cache'})"), 'client fetches the versioned curriculum');
    assert.ok(html.includes(`'/academy-activity/curriculum?v=${version}'`), 'intro warm-up primes the same versioned URL');
    assert.doesNotMatch(html, /'\/academy-activity\/curriculum'/);
    assert.ok(html.includes("'/academy-activity/speech?moduleId='+encodeURIComponent(lesson.moduleId)+'&lessonId='+encodeURIComponent(lesson.lessonId)+'&v='+encodeURIComponent(lesson.narrationVersion||curriculumVersion)"), 'speech URL carries the narration version');
    assert.match(html, /syncVoiceDeck/);
    assert.match(html, /parts\[safe\]\.match\(\/\\S\+\\s\*\/g\)/);
    assert.doesNotMatch(html, /parts\[safe\]\.split\(\/\(\\s\+\)\//);
    assert.match(html, /requestAnimationFrame\(syncVoiceDeck\)/);
    assert.match(html, /Starting the next lesson/);
    assert.match(html, new RegExp(`All ${SEED_LESSONS.length} Academy lessons complete`));
    assert.match(html, /academy-activity\/slide-design/);
    assert.doesNotMatch(html, /CLAUDE DESIGNED|Playing Grandmaster-Obi|next lesson is preloading/i);
    assert.match(html, /copy\.hidden=true/);
    assert.match(html, /loadClaudeDesign/);
    assert.match(html, /ANALYST DASHBOARD/);
    assert.match(html, /data-tf="1D"/);
    assert.match(html, /TOP OF BOOK/);
    assert.match(html, /LIVE MARKET SCANNER/);
    assert.match(html, /academy-scan-table/);
    assert.match(html, /Search any U\.S\. symbol or company/);
    assert.match(html, /US STOCKS/);
    assert.match(html, /PREMARKET/);
    assert.match(html, /AFTER HOURS/);
    assert.match(html, /Pro Screener/);
    assert.match(html, /\['sire','S\.I\.R\.E\.'\]/);
    assert.doesNotMatch(html, /S\.I\.R\.E 3m %/);
    assert.match(html, /changeRate3min/);
    assert.doesNotMatch(html, /\['rank','#'\]/);
    assert.match(html, /Volume Ratio/);
    assert.match(html, /Dividend Yield/);
    assert.match(html, /Institutional Holdings/);
    assert.match(html, /Degree of Overlap/);
    assert.match(html, /Showing /);
    assert.match(html, /refreshScanner/);
    assert.match(html, /academy-activity\/scanner/);
    assert.match(html, /id="academy-scanner-host"/);
    assert.match(html, /academy-activity\/chat/, 'the trading-desk chat panel connects to the chat WebSocket');
    assert.match(html, /Global Chat.*Day Trade.*Swing Trade.*Short Sale.*Options Trading/s, 'the global room and all four switchable chat channels are offered');
    assert.match(html, /College Options Chain Lab/);
    assert.match(html, /academy-lesson-open/);
    assert.match(html, /width:calc\(100% - var\(--academy-lesson-rail\)\)/);
    assert.match(html, /body\.academy-lesson-open \.academy-below/);
    assert.match(html, /id="options-expiry"/);
    assert.match(html, /Call IV/);
    assert.match(html, /intrinsic value is immediate exercise value/);
    assert.match(html, /window\.SmlOptionsChain\.normalize\(data\)/, 'the chain renderer uses the shared normalizer');
    assert.match(html, /root\.SmlOptionsChain = factory\(\)/, 'the shared normalizer module is inlined');
    assert.match(html, /&expiration='\+encodeURIComponent\(value\)/, 'changing the expiration fetches that expiration');
    assert.match(html, /Select any strike for derived economics and risk interpretation/);
    assert.match(html, /height:calc\(100dvh - 86px\)/);
    assert.match(html, /canvas\.addEventListener\('wheel',\(\)=>\{\},\{passive:true\}\)/);
    assert.match(html, /LEVEL 2 DEPTH/);
    assert.match(html, /academy-depth-row/);
    assert.match(html, /Unlock Academy Tools/);
    assert.match(html, /DiscordSDK/);
    assert.match(html, /academy-activity\/sdk\/index\.mjs/);
    assert.match(html, /guilds\.members\.read/);
    assert.match(html, /academy-activity\/token/);
    assert.match(html, /sml-academy-session/);
    assert.match(html, /LIVE INTERACTIVE ACADEMY/);
    assert.match(html, /academy-tools-open/);
    assert.match(html, /body\.academy-tools-open \.lesson\{z-index:2147483600\}/);
    // unlocking the tools never locks the page: it scrolls down to the options chain and scanner either way
    assert.doesNotMatch(html, /body\.academy-tools-open\{overflow:hidden\}/);
    assert.doesNotMatch(html, /body\.academy-tools-open main\{position:fixed/);
    assert.match(html, /id="academy-intro-video"/);
    // the intro can never trap members behind a stalled video: hard time cap and an auto-dismissing tap-to-play fallback
    assert.match(html, /armCap/);
    assert.match(html, /fbSince/);
    assert.match(html, /making-easy-money-academy-intro\.mp4/);
    assert.match(html, /smlAcademyWarmPromise/);
    assert.match(html, /Preparing live chart, scanner, lessons, and Academy tools/);
    assert.match(html, /video\.addEventListener\('ended',finish/);
    assert.match(html, /const fitVideo=/);
    assert.match(html, /videoWidth\/video\.videoHeight/);
    assert.match(html, /new ResizeObserver\(fitVideo\)/);
    assert.match(html, /window\.visualViewport\?\.addEventListener\('resize',fitVideo/);
    assert.match(html, /academy-intro-rail-left/);
    assert.match(html, /academy-intro\.banner-mode/);
    assert.match(html, /availableWidth\/availableHeight>=2/);
    assert.match(html, /Tap to begin with sound/);
    assert.match(html, /keepWarm/);
    assert.doesNotMatch(html, /setInterval\(\(\)=>location\.reload\(\),30000\)/);
    assert.match(html, /let bars=\[/);
    assert.doesNotMatch(html, /location\.assign/);
    assert.match(html, /history\.replaceState/);
    assert.doesNotMatch(html, /academy-dashboard-frame/);
    assert.doesNotMatch(html, /<iframe/i);
    assert.doesNotMatch(html, /https:\/\/stockmarketloop\.com\/analyst-dashboard\/\?academy=1/);
    assert.doesNotMatch(html, /new ResizeObserver\(resize\)\.observe\(canvas\)/);
    assert.match(html, /const chartObserver=new ResizeObserver\(resize\)/);
    assert.match(html, /ctx\.setTransform\(\{a:d,b:0,c:0,d:d,e:0,f:0\}\)/);
    assert.doesNotMatch(html, /ctx\.setTransform\(d,0,0,d,0\)/);
    // setTransform takes six numbers; five throws "not of type 'DOMMatrixInit'" in the browser
    // and leaves that canvas unscaled on high-DPI screens (the Visual Math Lab overlay did this).
    assert.doesNotMatch(html, /\.setTransform\((?:\s*-?[\d.]+\s*,){4}\s*-?[\d.]+\s*\)/);
    assert.doesNotMatch(html, /\.setTransform\((?:[^(),]+,){4}[^(),]+\)/);
    assert.match(html, /overlay\.getContext\('2d'\)\.setTransform\(d,0,0,d,0,0\)/);
    assert.match(html, /requestAnimationFrame\(resize\)/);
    assert.match(html, /setTimeout\(resize,1000\)/);
    assert.match(html, /simulation-progress/);
    assert.match(html, /academy-activity\/progress/);
    assert.match(html, /\['Options',\[9,23\]\]/);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.doesNotThrow(() => new Function(scripts.at(-1)[1]));
    const parsed = assertEveryScriptParses(html);
    assert.ok(parsed.total >= 15, `expected every Activity script, found ${parsed.total}`);
    assert.equal(parsed.modules, 1, 'the Discord SDK bootstrap is the only module script');
    // Whole page and each injected Academy script, any letter case.
    assert.doesNotMatch(html, PAGE_BANNED);
    for (const script of [curriculumScript, whiteboardScript, academyVisualLabScript()]) assert.doesNotMatch(script, PAGE_BANNED);
  });
});

test('Academy curriculum client: every patch in the trailing replace chain still finds its target', () => {
  /* academy-activity-curriculum.js post-processes its template with a chain of
     .replace()/.replaceAll() calls whose targets are exact substrings of
     renderDeck and friends. A missed target fails silently, so check each one:
     the target exists in the template source, is gone from the output, and the
     replacement is present. */
  const source = fs.readFileSync(require.resolve('./academy-activity-curriculum'), 'utf8');
  const templateEnd = source.indexOf('})()</script>`');
  const template = source.slice(source.indexOf('return `<style>'), templateEnd);
  const chain = source.slice(templateEnd + '})()</script>`'.length, source.indexOf('module.exports'));
  const literal = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g;
  const patches = [...chain.matchAll(/\.(?:replace|replaceAll)\(/g)].map((match) => {
    const [target, replacement] = [...chain.slice(match.index).matchAll(literal)].slice(0, 2)
      .map((entry) => new Function(`return ${entry[0]}`)());
    return { target, replacement };
  });
  assert.equal(patches.length, 12);
  const output = academyCurriculumScript(SEED_LESSONS);
  for (const { target, replacement } of patches) {
    // Template-literal source keeps backslashes doubled (\\s, \\n).
    assert.ok(template.includes(target.replace(/\\/g, '\\\\')), `replace target missing from the template: ${target}`);
    if (!replacement.includes(target)) assert.equal(output.includes(target), false, `replace target survived: ${target}`);
    if (replacement) assert.ok(output.includes(replacement), `replacement not applied: ${replacement}`);
  }
  assert.ok(patches.some((patch) => patch.target === 'parts[safe].split(/(\\s+)/).forEach'));
});

test('Academy intro video supports cached byte-range streaming', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/academy-activity/assets/making-easy-money-academy-intro.mp4`, {
      headers: { range: 'bytes=0-1023' }
    });
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.equal(response.headers.get('accept-ranges'), 'bytes');
    assert.match(response.headers.get('cache-control'), /immutable/);
    assert.match(response.headers.get('content-range'), /^bytes 0-1023\/\d+$/);
    assert.equal((await response.arrayBuffer()).byteLength, 1024);
  });
});

test('Academy Discord banner is a cacheable animated GIF', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/academy-activity/assets/mem-academy-banner.gif`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/gif');
    assert.match(response.headers.get('cache-control'), /immutable/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.subarray(0, 6).toString('ascii'), 'GIF89a');
    assert.ok(bytes.length > 100_000);
  });
});

test('Academy curriculum loads separately and is cacheable after first paint', async () => {
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/academy-activity/curriculum`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /max-age=3600/);
    assert.equal(response.headers.get('content-encoding'), 'gzip');
    const payload = await response.json();
    assert.equal(payload.lessons.length, SEED_LESSONS.length);
    const text = JSON.stringify(payload);
    assert.match(text, /Market Structure and Price Discovery/);
    assert.match(text, /Cash-secured put/);
    assert.match(text, /Grandmaster-Obi Alert Analysis and Falsification/);
    assert.match(text, /Capstone: Investment Committee Defense/);
    assert.doesNotMatch(text, PAGE_BANNED);

    // The client deck plays exactly the parts the voice and designer use.
    assert.equal(payload.version, curriculumVersion(SEED_LESSONS));
    assert.match(payload.version, /^[0-9a-f]{12}$/);
    payload.lessons.forEach((lesson, index) => {
      const seed = SEED_LESSONS[index];
      const id = `${seed.moduleId}.${seed.lessonId}`;
      assert.equal(`${lesson.moduleId}.${lesson.lessonId}`, id);
      assert.deepEqual(Object.keys(lesson), ['moduleId', 'lessonId', 'title', 'description', 'duration', 'level', 'steps', 'question', 'simulation', 'parts', 'example', 'exampleIndex', 'narrationVersion'], id);
      assert.deepEqual(lesson.parts, lessonParts(seed), id);
      assert.equal(lesson.parts.length, 6, id);
      assert.equal(lesson.steps.length, 3, id);
      assert.equal(lesson.exampleIndex, 1, id);
      assert.equal(lesson.parts[0], lesson.title, id);
      assert.equal(lesson.parts[1], `${EXAMPLE_LEAD} ${lesson.example.say.join(' ')}`, id);
      assert.deepEqual(lesson.parts.slice(2, 5), lesson.steps, id);
      assert.equal(lesson.parts.at(-1), `${CHECK_LEAD}${lesson.question.prompt}`, `${id} knowledge check is last`);
      assert.deepEqual(lesson.example, JSON.parse(JSON.stringify(seed.example)), id);
      assert.equal(lesson.example.source, 'authored', id);
      assert.equal(lesson.example.id, id);
      assert.equal(lesson.narrationVersion, narrationVersion(seed), id);
      assert.equal(lesson.narrationVersion, crypto.createHash('sha256').update(lesson.parts.join('\n\n')).digest('hex').slice(0, 12), id);
    });

    // The versioned URL the client and intro warm-up use serves the same body.
    const versioned = await fetch(`${base}/academy-activity/curriculum?v=${payload.version}`);
    assert.equal(versioned.status, 200);
    assert.match(versioned.headers.get('cache-control'), /max-age=3600/);
    assert.deepEqual(await versioned.json(), payload);
  });
});

test('Discord Activity proxy root serves the same native Academy entry point', async () => {
  await withServer({ academyAppId: '1551336038713139370' }, async (base) => {
    const response = await fetch(`${base}/`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors https:\/\/discord\.com/);
    assert.match(response.headers.get('content-security-policy'), /frame-src 'self'/);
    const html = await response.text();
    assert.match(html, /Making Easy Money Academy/);
    assert.match(html, /Live interactive candlestick chart/);
    assert.doesNotMatch(html, /<iframe/i);
    assert.doesNotMatch(html, PAGE_BANNED);
    assert.ok(html.includes(academyCartoonVisualsScript()), 'proxy root serves the whiteboard renderer too');
    assertEveryScriptParses(html);
  });
});

test('Academy Activity serves the official embedded SDK and exchanges Activity authorization codes', async () => {
  const calls = [];
  const academyOAuth = {
    completeActivity: async ({ code }) => {
      calls.push(code);
      return code === 'discord-code'
        ? { ok: true, accessToken: 'discord-access', sessionToken: 'academy-session' }
        : { ok: false, status: 401, code: 'authorization_failed' };
    }
  };
  await withServer({ academyOAuth }, async (base) => {
    const sdk = await fetch(`${base}/academy-activity/sdk/index.mjs`);
    assert.equal(sdk.status, 200);
    assert.match(sdk.headers.get('content-type'), /^text\/javascript/);
    assert.match(await sdk.text(), /DiscordSDK/);
    const token = await fetch(`${base}/academy-activity/token`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'discord-code' })
    });
    assert.equal(token.status, 200);
    assert.deepEqual(await token.json(), { ok: true, access_token: 'discord-access', sessionToken: 'academy-session' });
  });
  assert.deepEqual(calls, ['discord-code']);
});

test('Academy Activity stores simulation progress only for an authenticated Discord user', async () => {
  const calls = [];
  const academyProgress = {
    configured: true,
    read: async (userId) => { calls.push(['read', userId]); return [{ moduleId: 10, lessonId: 1, score: 80, completed: true }]; },
    save: async (userId, input) => { calls.push(['save', userId, input]); return { ...input, completed: input.score >= 70 }; }
  };
  const academyOAuth = { verifySession: (authorization) => authorization === 'Bearer academy-session' ? { ok: true, userId: '123456789012345678' } : { ok: false, status: 401, code: 'authorization_required' } };
  await withServer({ academyOAuth, academyProgress }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/progress`)).status, 401);
    const read = await fetch(`${base}/academy-activity/progress`, { headers: { authorization: 'Bearer academy-session' } });
    assert.equal(read.status, 200);
    const save = await fetch(`${base}/academy-activity/progress`, { method: 'POST', headers: { authorization: 'Bearer academy-session', 'content-type': 'application/json' }, body: JSON.stringify({ moduleId: 10, lessonId: 1, score: 80 }) });
    assert.equal(save.status, 200);
    assert.deepEqual(calls.map((entry) => entry.slice(0, 2)), [['read', '123456789012345678'], ['save', '123456789012345678']]);
  });
});

test('Academy lesson narration works in Discord without a session and honors authenticated sessions', async () => {
  const calls = [];
  const academyOAuth = {
    verifySession: (authorization) => authorization === 'Bearer academy-session'
      ? { ok: true, userId: 'member-123' }
      : { ok: false, status: 401, code: 'authorization_required' }
  };
  const academyVoice = {
    configured: true,
    getLessonAudio: async (input) => {
      calls.push(input);
      return { audio: Buffer.from('lesson-mp3'), cached: false };
    }
  };
  await withServer({ academyOAuth, academyVoice }, async (base) => {
    const anonymous = await fetch(`${base}/academy-activity/speech?moduleId=1&lessonId=1`, {
      headers: { 'x-forwarded-for': '203.0.113.9', 'user-agent': 'Discord-Activity-Test' }
    });
    assert.equal(anonymous.status, 200);
    assert.match(calls[0].userId, /^anonymous:[a-f0-9]{24}$/);
    const allowed = await fetch(`${base}/academy-activity/speech?moduleId=1&lessonId=1`, {
      headers: { authorization: 'Bearer academy-session' }
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.headers.get('content-type'), 'audio/mpeg');
    assert.match(allowed.headers.get('cache-control'), /private/);
    assert.equal(Buffer.from(await allowed.arrayBuffer()).toString(), 'lesson-mp3');
    // The client appends &v=<narrationVersion> purely to bust the private
    // browser cache when narration changes; the server ignores it.
    const lesson = SEED_LESSONS.find((entry) => entry.moduleId === 9 && entry.lessonId === 1);
    const versioned = await fetch(`${base}/academy-activity/speech?moduleId=9&lessonId=1&v=${lesson.narrationVersion}`, {
      headers: { authorization: 'Bearer academy-session' }
    });
    assert.equal(versioned.status, 200);
    assert.match(versioned.headers.get('cache-control'), /private, max-age=86400/);
  });
  assert.deepEqual(calls[1], { moduleId: '1', lessonId: '1', userId: 'member-123' });
  assert.deepEqual(calls[2], { moduleId: '9', lessonId: '1', userId: 'member-123' });
});

test('Academy Claude slide design stays server-side, rate-scoped, and session-aware', async () => {
  const calls = [];
  const academyOAuth = {
    verifySession: (authorization) => authorization === 'Bearer academy-session'
      ? { ok: true, userId: 'member-123' }
      : { ok: false, status: 401, code: 'authorization_required' }
  };
  const academySlideDesigner = {
    configured: true,
    getLessonDesign: async (input) => {
      calls.push(input);
      return {
        cached: false,
        design: {
          provider: 'claude',
          model: 'claude-sonnet-5',
          slides: [{ heading: 'Auction', visual: 'Buyers and sellers meet.', callout: 'Price is discovered.', visualKind: 'auction' }]
        }
      };
    }
  };
  await withServer({ academyOAuth, academySlideDesigner }, async (base) => {
    const anonymous = await fetch(base + '/academy-activity/slide-design?moduleId=1&lessonId=1');
    assert.equal(anonymous.status, 401);
    assert.equal(calls.length, 0);
    const allowed = await fetch(base + '/academy-activity/slide-design?moduleId=1&lessonId=1', {
      headers: { authorization: 'Bearer academy-session' }
    });
    assert.equal(allowed.status, 200);
    const payload = await allowed.json();
    assert.equal(payload.provider, 'claude');
    assert.equal(payload.model, 'claude-sonnet-5');
    assert.equal(payload.slides[0].visualKind, 'auction');
    assert.equal(JSON.stringify(payload).includes('key'), false);
  });
  assert.deepEqual(calls[0], { moduleId: '1', lessonId: '1', userId: 'member-123' });
});

test('Academy private data is role-session gated before the WordPress bridge is called', async () => {
  let calls = 0;
  await withServer({
    academyOAuth: { verifySession: (authorization) => authorization === 'Bearer academy-session' ? { ok: true, userId: '1' } : { ok: false, status: 401, code: 'authorization_required' } },
    academyDataBridge: { get: async (kind, symbol) => { calls += 1; return { ok: true, status: 200, data: { kind, symbol } }; } }
  }, async (base) => {
    const denied = await fetch(`${base}/academy-activity/data/options?symbol=SPY`);
    assert.equal(denied.status, 401);
    assert.equal(calls, 0);
    const allowed = await fetch(`${base}/academy-activity/data/earnings?symbol=NVDA`, { headers: { authorization: 'Bearer academy-session' } });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { ok: true, data: { kind: 'earnings', symbol: 'NVDA' } });
    assert.equal(calls, 1);
  });
});

test('Academy short-sale data is role-session gated and comes from the alerts desk short-data lookup, not the options/earnings bridge', async () => {
  const calls = [];
  await withServer({
    academyOAuth: { verifySession: (authorization) => authorization === 'Bearer academy-session' ? { ok: true, userId: '1' } : { ok: false, status: 401, code: 'authorization_required' } },
    academyAlerts: { shortData: async (symbol) => { calls.push(symbol); return { summary: { avg_ratio: 42 }, interest: [{ days_to_cover: 2.1 }] }; } }
  }, async (base) => {
    const denied = await fetch(`${base}/academy-activity/data/short?symbol=SPY`);
    assert.equal(denied.status, 401);
    assert.equal(calls.length, 0);
    const allowed = await fetch(`${base}/academy-activity/data/short?symbol=SPY`, { headers: { authorization: 'Bearer academy-session' } });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), { ok: true, data: { summary: { avg_ratio: 42 }, interest: [{ days_to_cover: 2.1 }] } });
    assert.deepEqual(calls, ['SPY']);
  });
});

test('Academy short-sale data returns 503 when the alerts desk is not configured, and free-tier sessions are refused', async () => {
  await withServer({ academyOAuth: { verifySession: () => ({ ok: true, userId: '1' }) } }, async (base) => {
    const res = await fetch(`${base}/academy-activity/data/short?symbol=SPY`, { headers: { authorization: 'Bearer academy-session' } });
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, error: 'integration_unconfigured' });
  });
  await withServer({
    academyOAuth: { verifySession: () => ({ ok: true, userId: '1', tier: 'free' }) },
    academyAlerts: { shortData: async () => ({}) }
  }, async (base) => {
    const res = await fetch(`${base}/academy-activity/data/short?symbol=SPY`, { headers: { authorization: 'Bearer academy-session' } });
    assert.equal(res.status, 403);
  });
});

test('Academy short-sale data rejects a malformed symbol before any lookup, and reports the desk lookup returning null as an outage, not as an empty answer', async () => {
  const calls = [];
  await withServer({
    academyOAuth: { verifySession: () => ({ ok: true, userId: '1' }) },
    academyAlerts: { shortData: async (symbol) => { calls.push(symbol); return null; } }
  }, async (base) => {
    const bad = await fetch(`${base}/academy-activity/data/short?symbol=${encodeURIComponent('<script>')}`, { headers: { authorization: 'Bearer academy-session' } });
    assert.equal(bad.status, 400);
    assert.deepEqual(calls, []);
    const outage = await fetch(`${base}/academy-activity/data/short?symbol=spy`, { headers: { authorization: 'Bearer academy-session' } });
    assert.equal(outage.status, 503);
    assert.deepEqual(await outage.json(), { ok: false, error: 'short_data_unavailable' });
    assert.deepEqual(calls, ['SPY'], 'the symbol is upper-cased before the lookup');
  });
});

test('the screener snapshot route serves the service snapshot, and is 503 when the screener is off', async () => {
  await withServer({ academyScreener: { snapshot: () => ({ ok: true, updatedAt: 7, symbols: [{ symbol: 'AAA' }] }) } }, async (base) => {
    const res = await fetch(`${base}/academy-activity/screener`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, updatedAt: 7, symbols: [{ symbol: 'AAA' }] });
  });
  await withServer({}, async (base) => { assert.equal((await fetch(`${base}/academy-activity/screener`)).status, 503); });
});

test('the screener option suggestion is session-gated, validates its inputs, and runs the picker over the bridge chain and the swept daily bars', async () => {
  const calls = [];
  await withServer({
    academyOAuth: { verifySession: (a) => (a === 'Bearer academy-session' ? { ok: true, userId: '1' } : { ok: false, status: 401, code: 'authorization_required' }) },
    academyDataBridge: { get: async (kind, symbol) => { calls.push(kind + ':' + symbol); return { ok: true, status: 200, data: { rows: [] } }; } },
    academyScreener: { snapshot: () => ({ ok: true }), barsFor: (s) => (s === 'AAA' ? [{ t: 1, o: 1, h: 1, l: 1, c: 1 }] : []), optionFor: ({ symbol, side, horizon, rows, bars }) => ({ verdict: 'CALL', echo: { symbol, side, horizon, rows: rows.length, bars: bars.length } }) }
  }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/screener/option?symbol=AAA`)).status, 401);
    assert.equal(calls.length, 0);
    const bad = await fetch(`${base}/academy-activity/screener/option?symbol=${encodeURIComponent('<x>')}`, { headers: { authorization: 'Bearer academy-session' } });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${base}/academy-activity/screener/option?symbol=aaa&side=put&horizon=long`, { headers: { authorization: 'Bearer academy-session' } });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.suggestion.verdict, 'CALL');
    assert.deepEqual(body.suggestion.echo, { symbol: 'AAA', side: 'put', horizon: 'long', rows: 0, bars: 1 });
    assert.deepEqual(calls, ['options:AAA']);
  });
});

test('with Massive on, timeframes it does not serve (1h, 15m, 1Q, 1Y) fall back to the WordPress history feed instead of returning a 400', async () => {
  const asked = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/wp-json/sml/v1/history')) { asked.push(new URL(u).searchParams.get('tf')); return new Response(JSON.stringify({ bars: [{ t: 1, o: 1, h: 2, l: 1, c: 2, v: 5 }] }), { status: 200 }); }
    return realFetch(url, init);
  };
  const massiveCalls = [];
  const marketHistory = { enabled: true, get: async (symbol, tf) => { massiveCalls.push(tf); if (tf !== '1D') throw new TypeError('invalid_timeframe'); return { ok: true, data: { symbol, tf, bars: [{ t: 1, o: 1, h: 2, l: 1, c: 2, v: 5 }], source: 'massive' } }; } };
  try {
    await withServer({ marketHistory }, async (base) => {
      for (const tf of ['1h', '15m', '1Q', '1Y']) {
        const res = await fetch(`${base}/academy-activity/market?symbol=ZZTEST${tf.replace(/\W/g, '')}&tf=${tf}`);
        assert.equal(res.status, 200, tf + ' must not be a 400');
        assert.equal((await res.json()).tf, tf);
      }
      const daily = await fetch(`${base}/academy-activity/market?symbol=ZZTESTD&tf=1D`);
      assert.equal((await daily.json()).source, 'massive', 'a timeframe Massive does serve still uses Massive');
    });
  } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(asked.sort(), ['15m', '1Q', '1Y', '1h'].sort());
  assert.deepEqual(massiveCalls, ['1D'], 'Massive is only asked for the timeframes it serves');
});

function signedHeaders(secret, body, timestamp = '1700000000') {
  return {
    'content-type': 'application/json',
    'x-sml-timestamp': timestamp,
    'x-sml-signature': `sha256=${hmac(secret, timestamp, body)}`
  };
}

function eventBody(overrides = {}) {
  return JSON.stringify({
    version: 1,
    eventId: '7dc5f64b-7c05-4f38-9c55-31fcfa798706',
    eventType: 'system.integration.ping',
    occurredAt: '2023-11-14T22:13:20.000Z',
    actorUserId: 42,
    subject: { type: 'integration', id: 'wordpress' },
    data: { source: 'test' },
    ...overrides
  });
}

test('member email analytics fails closed until the private service is configured', async () => {
  const body = '{}';
  await withServer({ billingApiSecret: 'billing-test-secret' }, async (base) => {
    const response = await fetch(`${base}/v1/member-email/analytics`, {
      method: 'POST', body, headers: signedHeaders('billing-test-secret', body)
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: 'integration_unconfigured' });
  });
});

test('member email analytics requires a valid server signature and returns owner data only after verification', async () => {
  let calls = 0;
  const body = JSON.stringify({ limit: 25, includeRawEmails: true });
  const memberEmail = {
    analytics: async (input) => {
      calls += 1;
      assert.deepEqual(input, { limit: 25, includeRawEmails: true });
      return { summary: { contacts: 1 }, contacts: [{ email: 'member@example.com' }] };
    }
  };
  await withServer({ billingApiSecret: 'billing-test-secret', memberEmail }, async (base) => {
    const denied = await fetch(`${base}/v1/member-email/analytics`, {
      method: 'POST', body, headers: signedHeaders('wrong-secret', body)
    });
    assert.equal(denied.status, 401);
    assert.equal(calls, 0);
    const allowed = await fetch(`${base}/v1/member-email/analytics`, {
      method: 'POST', body, headers: signedHeaders('billing-test-secret', body)
    });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), {
      ok: true, summary: { contacts: 1 }, contacts: [{ email: 'member@example.com' }]
    });
  });
  assert.equal(calls, 1);
});

test('WordPress gateway fails closed until its secret exists', async () => {
  const body = eventBody();
  await withServer({}, async (base) => {
    const response = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: signedHeaders('not-configured', body)
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { ok: false, error: 'integration_unconfigured' });
  });
});

test('WordPress gateway accepts one valid signed event and exposes no payload', async () => {
  const received = [];
  const body = eventBody();
  await withServer({
    wordpressWebhookSecret: 'gateway-test-secret',
    acceptWordPressEvent: async (event) => { received.push(event); return 'accepted'; }
  }, async (base) => {
    const response = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: signedHeaders('gateway-test-secret', body)
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      ok: true,
      eventId: '7dc5f64b-7c05-4f38-9c55-31fcfa798706',
      status: 'accepted'
    });
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].eventType, 'system.integration.ping');
  assert.match(received[0].payloadHash, /^[0-9a-f]{64}$/);
});

test('WordPress gateway recognizes a replay without processing it twice', async () => {
  const body = eventBody();
  await withServer({
    wordpressWebhookSecret: 'gateway-test-secret',
    acceptWordPressEvent: async () => 'duplicate'
  }, async (base) => {
    const response = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: signedHeaders('gateway-test-secret', body)
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      eventId: '7dc5f64b-7c05-4f38-9c55-31fcfa798706',
      status: 'duplicate'
    });
  });
});

test('WordPress gateway rejects bad signatures and old requests before storage', async () => {
  const body = eventBody();
  let calls = 0;
  await withServer({
    wordpressWebhookSecret: 'gateway-test-secret',
    acceptWordPressEvent: async () => { calls += 1; return 'accepted'; }
  }, async (base) => {
    const bad = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: { ...signedHeaders('wrong-secret', body) }
    });
    assert.equal(bad.status, 401);
    assert.deepEqual(await bad.json(), { ok: false, error: 'invalid_signature' });

    const old = await fetch(`${base}/v1/wordpress/events`, {
      method: 'POST', body, headers: signedHeaders('gateway-test-secret', body, '1600000000')
    });
    assert.equal(old.status, 401);
    assert.deepEqual(await old.json(), { ok: false, error: 'stale_request' });
  });
  assert.equal(calls, 0);
});

test('news webhook queues one authenticated source URL and collapses duplicates', async () => {
  const received = [];
  await withServer({
    newsIngestToken: 'news-test-token',
    enqueueNewsArticle: async (job) => {
      received.push(job);
      return received.length === 1
        ? { id: 71, status: 'accepted' }
        : { id: 71, status: 'duplicate' };
    }
  }, async (base) => {
    const body = JSON.stringify({ source_url: 'https://example.com/story?utm_source=test' });
    const first = await fetch(`${base}/v1/news/articles`, {
      method: 'POST',
      headers: { authorization: 'Bearer news-test-token', 'content-type': 'application/json' },
      body
    });
    assert.equal(first.status, 202);
    assert.deepEqual(await first.json(), { ok: true, jobId: 71, status: 'accepted', jobStatus: 'queued' });
    const second = await fetch(`${base}/v1/news/articles`, {
      method: 'POST',
      headers: { authorization: 'Bearer news-test-token', 'content-type': 'application/json' },
      body
    });
    assert.equal(second.status, 200);
    assert.equal((await second.json()).status, 'duplicate');
  });
  assert.equal(received[0].sourceUrl, 'https://example.com/story');
  assert.match(received[0].sourceUrlHash, /^[a-f0-9]{64}$/);
});

test('news webhook fails closed before storing unauthenticated or invalid requests', async () => {
  let calls = 0;
  await withServer({
    newsIngestToken: 'news-test-token',
    enqueueNewsArticle: async () => { calls += 1; return { id: 1, status: 'accepted' }; }
  }, async (base) => {
    const denied = await fetch(`${base}/v1/news/articles`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"source_url":"https://example.com"}'
    });
    assert.equal(denied.status, 401);
    const invalid = await fetch(`${base}/v1/news/articles`, {
      method: 'POST', headers: { authorization: 'Bearer news-test-token', 'content-type': 'application/json' }, body: '{"source_url":"http://localhost"}'
    });
    assert.equal(invalid.status, 422);
  });
  assert.equal(calls, 0);
});

test('alert routes are signed and owner-scoped before reaching the router', async () => {
  const calls = [];
  const body = JSON.stringify({ groupId: 7, ownerUserId: 42 });
  await withServer({
    alertRouterSecret: 'alert-test-secret',
    alertRouter: { listRoutes: async (...args) => { calls.push(args); return [{ id: 1 }]; } }
  }, async (base) => {
    const response = await fetch(`${base}/v1/alerts/routes/list`, {
      method: 'POST', body, headers: signedHeaders('alert-test-secret', body)
    });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, routes: [{ id: 1 }] });
  });
  assert.deepEqual(calls, [[7, 42]]);
});

test('alert ingestion rejects bad signatures before the router is called', async () => {
  let calls = 0;
  const body = JSON.stringify({ groupId: 7 });
  await withServer({
    alertRouterSecret: 'alert-test-secret',
    alertRouter: { ingest: async () => { calls += 1; return { status: 'accepted' }; } }
  }, async (base) => {
    const response = await fetch(`${base}/v1/alerts/ingest`, {
      method: 'POST', body, headers: signedHeaders('wrong-secret', body)
    });
    assert.equal(response.status, 401);
  });
  assert.equal(calls, 0);
});

test('Academy Activity resumes each authenticated member at their own next lesson', async () => {
  const members = {
    'session-a': { userId: '111111111111111111', student: { currentModule: 14, currentLesson: 2, xp: 900, streakDays: 3, badges: ['first_lesson'] } },
    'session-b': { userId: '222222222222222222', student: { currentModule: 1, currentLesson: 1, xp: 0, streakDays: 0, badges: [] } }
  };
  const byUser = Object.fromEntries(Object.values(members).map((entry) => [entry.userId, entry.student]));
  const academyProgress = {
    configured: true,
    read: async () => [],
    state: async (userId) => byUser[userId],
    save: async (_userId, input) => ({ ...input, completed: input.score >= 70 })
  };
  const academyOAuth = { verifySession: (authorization) => {
    const entry = members[String(authorization).replace(/^Bearer /, '')];
    return entry ? { ok: true, userId: entry.userId } : { ok: false, status: 401, code: 'authorization_required' };
  } };
  await withServer({ academyOAuth, academyProgress }, async (base) => {
    const a = await (await fetch(`${base}/academy-activity/progress`, { headers: { authorization: 'Bearer session-a' } })).json();
    const b = await (await fetch(`${base}/academy-activity/progress`, { headers: { authorization: 'Bearer session-b' } })).json();
    assert.deepEqual([a.student.currentModule, a.student.currentLesson], [14, 2]);
    assert.deepEqual([b.student.currentModule, b.student.currentLesson], [1, 1]);
    // A user id in the query string is ignored; identity comes only from the session.
    const spoof = await fetch(`${base}/academy-activity/progress?discord_id=111111111111111111`, { headers: { authorization: 'Bearer expired' } });
    assert.equal(spoof.status, 401);
    const write = await fetch(`${base}/academy-activity/progress`, { method: 'POST', headers: { authorization: 'Bearer expired', 'content-type': 'application/json' }, body: JSON.stringify({ moduleId: 1, lessonId: 1, score: 100 }) });
    assert.equal(write.status, 401);
    // Modules 14-28 are real lessons and must save.
    const late = await fetch(`${base}/academy-activity/progress`, { method: 'POST', headers: { authorization: 'Bearer session-a', 'content-type': 'application/json' }, body: JSON.stringify({ moduleId: 28, lessonId: 5, score: 90 }) });
    assert.equal(late.status, 200);
  });
});

test('Activity client restores the authenticated lesson and keeps implementation labels off screen', () => {
  const { academyCurriculumScript } = require('./academy-activity-curriculum');
  const script = academyCurriculumScript(require('./academy/curriculum').SEED_LESSONS);
  assert.match(script, /restoreNextLesson\(data\.student\)/);
  assert.match(script, /render\(\);if\(session\)loadProgress\(\);/, 'a session issued before the curriculum loads is still used');
  assert.doesNotMatch(script, /Grandmaster-Obi narration|Claude generated|AI generated/i);
});

test('Activity opens on the chart: a resumed lesson is selected but not popped open, and nothing is called a paper trade', async () => {
  const { academyCurriculumScript } = require('./academy-activity-curriculum');
  const script = academyCurriculumScript(require('./academy/curriculum').SEED_LESSONS);
  assert.match(script, /current=index;rebuildPicker\(\);document\.body\.dataset\.academyResumed=/, 'resume selects the lesson');
  assert.doesNotMatch(script, /rebuildPicker\(\);panel\.classList\.add\('open'\)/, 'resume no longer opens the lesson rail on load');
  await withServer({ academyAppId: '1551336038713139370' }, async (base) => {
    const html = await (await fetch(`${base}/academy-activity/`)).text();
    assert.doesNotMatch(html, /paper trade|paper backtest/i);
    assert.match(html, /S\.open = false; \/\/ the panel never pops open on load/, 'MEM ALGO starts closed');
    assert.match(html, /S\.collapsed = true; \/\/ the map starts as a chip/, 'the smart-money map starts collapsed');
    assert.doesNotMatch(html, /pat\.classList\.add\('on'\); panel\.classList\.add\('open'\)/, 'the patterns list does not open on load');
  });
});

test('Activity resume points are saved only for the signed-in member and validated', async () => {
  const calls = [];
  const academyProgress = {
    configured: true, read: async () => [], state: async () => ({}), save: async () => ({}),
    saveResume: async (userId, input) => {
      calls.push([userId, input]);
      if (input.timeframe === '2h') throw new TypeError('invalid_timeframe');
      return input;
    }
  };
  const academyOAuth = { verifySession: (authorization) => authorization === 'Bearer member-a'
    ? { ok: true, userId: '111111111111111111' } : { ok: false, status: 401, code: 'authorization_required' } };
  await withServer({ academyOAuth, academyProgress }, async (base) => {
    const post = (authorization, body) => fetch(`${base}/academy-activity/resume`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await post('Bearer expired', { moduleId: 1, lessonId: 1 })).status, 401);
    const ok = await post('Bearer member-a', { moduleId: 9, lessonId: 1, part: 2, positionMs: 1000, symbol: 'SPY', timeframe: '5m', userId: '222222222222222222' });
    assert.equal(ok.status, 200);
    assert.equal((await post('Bearer member-a', { moduleId: 1, lessonId: 1, timeframe: '2h' })).status, 400);
    // Identity always comes from the session, never from the request body.
    assert.deepEqual(calls.map(([userId]) => userId), ['111111111111111111', '111111111111111111']);
  });
});

test('Activity sign-in explains access problems and renews expired sessions', async () => {
  let html = '';
  await withServer({}, async (base) => { html = await (await fetch(`${base}/academy-activity/`)).text(); });
  assert.match(html, /academy_role_required:\['ACCESS REQUIRED'/);
  assert.match(html, /Check again/);
  assert.match(html, /window\.smlAcademyReauth=/);
  assert.doesNotMatch(html, /SIGN IN RETRY/, 'the vague retry-forever status is gone');
  const { academyCurriculumScript } = require('./academy-activity-curriculum');
  const script = academyCurriculumScript(require('./academy/curriculum').SEED_LESSONS);
  assert.match(script, /response\.status===401&&typeof window\.smlAcademyReauth==='function'/);
  assert.match(script, /'\/academy-activity\/resume'/);
  assert.match(script, /pendingResume\.positionMs\/1000/);
});

test('activity page carries the chart guard and never collapses the chart', () => {
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, { appId: '123456789012345678' });
  assert.match(html, /__smlChartGuard/);
  assert.match(html, /\.chart canvas\{min-height:240px\}/);
  assert.match(html, /academy-activity\/report/);
  assert.ok(html.trimEnd().endsWith('</html>'));
});

test('a blank-chart report is accepted, logged and capped', async () => {
  await withServer({}, async (base) => {
    for (let i = 0; i < 7; i++) {
      const res = await fetch(`${base}/academy-activity/report`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ kind: 'chart_blank', w: 0, h: 0, symbol: 'SPY', tf: '5m', misses: 5 }) });
      assert.equal(res.status, 204);
    }
  });
});

test('an empty chart still loads while the Activity window reports hidden', () => {
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  assert.match(html, /if\(refreshPending\|\|\(document\.hidden&&window\.smlAcademyChartState&&window\.smlAcademyChartState\(\)\.bars\.length\)\)return/);
  assert.match(html, /const fix=async\(\)=>\{if\(document\.hidden&&bars\(\)\.length\)return/);
});

test('activity page ships the MEM ALGO engine and panel, and the chart still loads without them', () => {
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  assert.match(html, /window\.MemAlgoEngine=module\.exports/);
  assert.match(html, /mem-algo-toggle/);
  assert.match(html, /Day Trading/);
  assert.match(html, /Swing Trading/);
  assert.ok(html.indexOf('__smlChartGuard') < html.indexOf('MemAlgoEngine'), 'the chart guard loads before the model');
});

test('the order flow route validates symbols, reports disabled, and serves the reading', async () => {
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/orderflow?symbol=SPY`)).status, 503);
  });
  const academyOrderFlow = { get: (s) => { if (!/^[A-Z]+$/i.test(String(s))) throw new TypeError('invalid_symbol'); return { symbol: String(s).toUpperCase(), ready: false, state: 'warming' }; } };
  await withServer({ academyOrderFlow }, async (base) => {
    const ok = await fetch(`${base}/academy-activity/orderflow?symbol=spy`);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).symbol, 'SPY');
    assert.equal((await fetch(`${base}/academy-activity/orderflow?symbol=../x`)).status, 400);
  });
});

test('the activity page carries the order flow panel', () => {
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  assert.match(html, /academy-activity\/orderflow/);
  assert.match(html, /mem-of/);
});

test('the chart guard lifts the Indicator Engine out of the chart grid so the candles keep their row', () => {
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  assert.match(html, /\.chart > \.academy-intelligence/);
});

test('the chart offers week, month, quarter and year intervals and ships the chart mechanics', () => {
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  for (const tf of ['1W', '1M', '1Q', '1Y']) assert.match(html, new RegExp(`data-tf="${tf}"`));
  assert.match(html, /smlChartModel/);
  assert.match(html, /academy-pro-layer/);
  assert.match(html, /academy-pro-draw/);
});

test('the market route accepts the long intervals and still rejects junk', async () => {
  await withServer({}, async (base) => {
    for (const tf of ['1M', '1Q', '1Y']) {
      const res = await fetch(`${base}/academy-activity/market?symbol=SPY&tf=${tf}`);
      assert.notEqual(res.status, 400, tf);
    }
    assert.equal((await fetch(`${base}/academy-activity/market?symbol=SPY&tf=9x`)).status, 400);
  });
});

test('a phone member can always get from an open lesson back to the chart', () => {
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  assert.match(html, /id='academy-back-to-chart'|backBtn\.id='academy-back-to-chart'/);
  assert.match(html, /body\.academy-lesson-open #academy-back-to-chart/);
});

test('the live tick route serves the fast book + prints, validates symbols, and the page carries the live feed', async () => {
  await withServer({}, async (base) => { assert.equal((await fetch(`${base}/academy-activity/live?symbol=SPY`)).status, 503); });
  const academyOrderFlow = { get: () => ({}), live: (s) => { if (!/^[A-Z]+$/i.test(String(s))) throw new TypeError('invalid_symbol'); return { symbol: String(s).toUpperCase(), ready: true, book: { bids: [], asks: [] }, tape: [] }; } };
  await withServer({ academyOrderFlow }, async (base) => {
    const ok = await fetch(`${base}/academy-activity/live?symbol=spy`);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).symbol, 'SPY');
    assert.equal((await fetch(`${base}/academy-activity/live?symbol=../x`)).status, 400);
  });
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  assert.match(html, /__smlLiveTape/);
  assert.match(html, /body:not\(\.academy-lesson-open\) \.academy-guide/);
});

test('the options chain sits under the chart with a price calculator beside it', () => {
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  assert.match(html, /__smlOptionsDock/);
  assert.match(html, /OPTIONS PRICE CALCULATOR/);
  assert.match(html, /SmlOptionsCalc/);
});

test('MEM ALGO lists all five strategies including mid-term hold, long-term hold and short sale', () => {
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  for (const label of ['Mid-Term Hold', 'Long-Term Hold', 'Short Sale']) assert.ok(html.includes(label), label);
});

test('every chart layer draws at a capped resolution so phones repaint far fewer pixels', () => {
  const fs = require('node:fs'), path = require('node:path');
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  assert.match(html, /window\.smlChartDpr\s*=/);
  for (const file of ['academy-visual-lab.js', 'academy-chart-intelligence.js', 'academy-mem-algo-ui.js']) {
    assert.match(fs.readFileSync(path.join(__dirname, file), 'utf8'), /smlChartDpr/, file + ' reads the cap');
  }
});

test('the frame-rate beacon is logged as numbers only and junk is ignored safely', async () => {
  const events = [];
  await withServer({ logger: (level, name, data) => events.push({ level, name, data }) }, async (base) => {
    const body = JSON.stringify({ kind: 'perf', fps: 41.234, p95: 33.3, worst: 80, n: 60, layers: 6.1, pro: 1.2, by: { candles: 2, indicators: 1.5, memalgo: 2.6, evil: 9 }, dpr: 3, cap: 1.5, w: 365, h: 394, tf: '5m', bars: 600, view: 48, mem: true, patterns: false, ua: 'x'.repeat(500), extra: '<script>' });
    const ok = await fetch(`${base}/academy-activity/report`, { method: 'POST', body, headers: { 'content-type': 'text/plain', 'x-forwarded-for': '9.9.9.9' } });
    assert.equal(ok.status, 204);
    const junk = await fetch(`${base}/academy-activity/report`, { method: 'POST', body: '{not json', headers: { 'content-type': 'text/plain', 'x-forwarded-for': '9.9.9.9' } });
    assert.equal(junk.status, 204);
  });
  const perf = events.find((e) => e.name === 'academy_chart_perf');
  assert.ok(perf, 'logged');
  assert.equal(perf.data.fps, 41.2); assert.equal(perf.data.frames, 60); assert.equal(perf.data.cap, 1.5);
  assert.deepEqual(Object.keys(perf.data.layers).sort(), ['candles', 'indicators', 'memalgo'], 'only known layer names are kept');
  assert.ok(perf.data.ua.length <= 90);
  assert.ok(!JSON.stringify(perf.data).includes('script'));
});

test('lesson narration reports the real length of every part so slides change when the voice does', async () => {
  const academyVoice = { configured: true, getLessonAudio: async () => ({ audio: Buffer.from('mp3'), cached: true, partMs: [1200, 8400, 9100] }) };
  await withServer({ academyVoice }, async (base) => {
    const res = await fetch(`${base}/academy-activity/speech?moduleId=1&lessonId=1`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-academy-part-ms'), '1200,8400,9100');
  });
  const { academyCurriculumScript: academyActivityCurriculumScript } = require('./academy-activity-curriculum');
  const script = academyActivityCurriculumScript(SEED_LESSONS.slice(0, 2), 'v-test');
  assert.match(script, /x-academy-part-ms/);
  assert.match(script, /measured\?duration\*exact\[index\]\/measuredTotal/);
});

test('a lesson shows its written text once: no duplicate slide visual or filler callout, and chart panels stay out of the lesson', () => {
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  assert.match(html, /\.academy-live-deck \.academy-slide-visual:not\(:has\(svg\)\)\{display:none\}/);
  assert.match(html, /\.academy-live-deck:not\(:has\(\.wb-svg\)\) \.academy-slide-callout\{display:none\}/);
  assert.match(html, /body\.academy-lesson-open #mem-algo-panel/);
});

test('the chart glides after a flick and pauses other repaints while a finger is on it', () => {
  const fs = require('node:fs'), path = require('node:path');
  const pro = fs.readFileSync(path.join(__dirname, 'academy-chart-pro.js'), 'utf8');
  assert.match(pro, /function startInertia/);
  assert.match(pro, /window\.smlChartGesture = false/);
  assert.match(fs.readFileSync(path.join(__dirname, 'academy-live.js'), 'utf8'), /if \(window\.smlChartGesture\) \{ st\.deferred = d; return; \}/);
  assert.match(fs.readFileSync(path.join(__dirname, 'academy-options-dock.js'), 'utf8'), /if \(window\.smlChartGesture\) return;/);
});

test('the alerts desk route is members-only, serves the snapshot and one alert in detail, and the page carries the desk', async () => {
  const academyAlerts = {
    snapshot: () => ({ ok: true, asOf: 1, feed: {}, alerts: [{ id: '1', symbol: 'GDC' }], pending: 0, disclaimer: 'Not advice' }),
    detail: async (id) => (id === '1' ? { id: '1', symbol: 'GDC', factors: [] } : null)
  };
  const academyOAuth = { verifySession: (a) => (a === 'Bearer member' ? { ok: true, userId: 'u1' } : { ok: false, status: 401, code: 'authorization_required' }) };
  await withServer({ academyAlerts, academyOAuth }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/alerts`)).status, 401);
    const ok = await fetch(`${base}/academy-activity/alerts`, { headers: { authorization: 'Bearer member' } });
    assert.equal(ok.status, 200); assert.equal((await ok.json()).alerts[0].symbol, 'GDC');
    const one = await fetch(`${base}/academy-activity/alerts?detail=1`, { headers: { authorization: 'Bearer member' } });
    assert.equal((await one.json()).alert.symbol, 'GDC');
    assert.equal((await fetch(`${base}/academy-activity/alerts?detail=999`, { headers: { authorization: 'Bearer member' } })).status, 404);
  });
  await withServer({ academyOAuth }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/alerts`, { headers: { authorization: 'Bearer member' } })).status, 503, 'disabled without a service');
  });
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  assert.match(html, /__smlAlertsUi/); assert.match(html, /ALERTS DESK/); assert.match(html, /academy-alerts-fab/);
});

test('per-member alert sources: the desk shows only the member own sources, and the picker routes are members-only', async () => {
  const seen = [];
  const academyAlerts = {
    snapshot: (opts) => { seen.push(opts); return { ok: true, asOf: 1, feed: {}, alerts: [{ id: '9', symbol: 'NVDA' }], pending: 0 }; },
    allows: (id, sources) => (id === '9' ? sources[0] : null),
    detail: async (id, opts) => (id === '9' ? { id: '9', symbol: 'NVDA', closedOnly: opts.closedOnly } : null)
  };
  const added = [];
  const academyAlertSources = {
    viewFor: async (userId, view) => [{ key: '500000000000000005', view: 'live', access: true }, { key: '938944129348558848', view, access: true, premium: true }, { key: '500000000000000006', view: 'live', access: false }],
    list: async () => ({ sources: added, presets: [{ channelId: '938944129348558848', label: 'GrandMaster Swings', style: 'swings' }], max: 12 }),
    guilds: async (u, current) => [{ id: '100000000000000001', name: 'House of Traders', current: current === '100000000000000001' }],
    channels: async (u, g) => (g === '100000000000000001' ? [{ id: '500000000000000005', name: 'swing-alerts', category: '' }] : null),
    preview: async (u, ch) => (ch === '500000000000000005' ? { channel: { id: ch }, read: 3, posters: [], alerts: [] } : null),
    add: async (u, input) => { if (input.channel === '500000000000000006') { const e = new Error('no'); e.code = 'no_access'; throw e; } added.push({ channelId: input.channel }); return { sources: added }; },
    remove: async () => ({ sources: [] })
  };
  const academyOAuth = { verifySession: (a) => (a === 'Bearer member' ? { ok: true, userId: 'u1', tier: 'free' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const auth = { authorization: 'Bearer member' };
  const json = { ...auth, 'content-type': 'application/json' };
  await withServer({ academyAlerts, academyAlertSources, academyOAuth }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/alerts/sources`)).status, 401);
    const desk = await (await fetch(`${base}/academy-activity/alerts`, { headers: auth })).json();
    assert.equal(desk.perMember, true); assert.equal(desk.sources, 2, 'a source the member lost access to is left out');
    assert.deepEqual(seen[0].sources.map((s) => [s.key, s.view]), [['500000000000000005', 'live'], ['938944129348558848', 'teaser']], 'free: owner stream as a teaser, own channel live');
    assert.equal((await (await fetch(`${base}/academy-activity/alerts?detail=9`, { headers: auth })).json()).alert.symbol, 'NVDA');
    assert.equal((await fetch(`${base}/academy-activity/alerts?detail=10`, { headers: auth })).status, 404, 'an alert outside the member sources is not found');
    assert.equal((await (await fetch(`${base}/academy-activity/alerts/guilds?current=100000000000000001`, { headers: auth })).json()).guilds[0].current, true);
    assert.equal((await fetch(`${base}/academy-activity/alerts/channels?guild=1`, { headers: auth })).status, 404);
    assert.equal((await fetch(`${base}/academy-activity/alerts/channel?channel=500000000000000005`, { headers: auth })).status, 200);
    const ok = await fetch(`${base}/academy-activity/alerts/sources`, { method: 'POST', headers: json, body: JSON.stringify({ channel: '500000000000000005' }) });
    assert.equal(ok.status, 200); assert.equal((await ok.json()).sources.length, 1);
    const denied = await fetch(`${base}/academy-activity/alerts/sources`, { method: 'POST', headers: json, body: JSON.stringify({ channel: '500000000000000006' }) });
    assert.equal(denied.status, 403); assert.equal((await denied.json()).error, 'no_access');
    assert.equal((await fetch(`${base}/academy-activity/alerts/sources`, { method: 'POST', headers: auth, body: '{}' })).status, 415);
    assert.equal((await fetch(`${base}/academy-activity/alerts/sources`, { method: 'DELETE', headers: json, body: JSON.stringify({ channel: '500000000000000005' }) })).status, 200);
  });
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  assert.match(html, /＋ Sources/); assert.match(html, /Your alerts desk is empty/);
});

test('site export ingest verifies the server signature and writes one SMLX log line per chunk', async () => {
  const lines = [];
  const body = JSON.stringify({ name: 'facts.json.gz', seq: 2, total: 3, data: 'SGVsbG8=' });
  await withServer({ billingApiSecret: 'billing-test-secret', siteExportSink: (line) => lines.push(line) }, async (base) => {
    const denied = await fetch(`${base}/v1/site-export/ingest`, { method: 'POST', body, headers: signedHeaders('wrong-secret', body) });
    assert.equal(denied.status, 401);
    const bad = JSON.stringify({ name: '../etc', seq: 1, total: 1, data: 'x' });
    const rejected = await fetch(`${base}/v1/site-export/ingest`, { method: 'POST', body: bad, headers: signedHeaders('billing-test-secret', bad) });
    assert.equal(rejected.status, 400);
    const ok = await fetch(`${base}/v1/site-export/ingest`, { method: 'POST', body, headers: signedHeaders('billing-test-secret', body) });
    assert.equal(ok.status, 201);
    assert.deepEqual(await ok.json(), { ok: true, name: 'facts.json.gz', seq: 2, total: 3 });
  });
  assert.deepEqual(lines, ['SMLX ' + JSON.stringify({ name: 'facts.json.gz', seq: 2, total: 3, data: 'SGVsbG8=' })]);
});

test('the SIRE stream is Server-Sent Events: a snapshot, then ticks, and the viewer is released on disconnect', async () => {
  const http = require('node:http');
  const viewers = [];
  const academySireFeed = { subscribe(write, opts) { const v = { write, opts, off: false }; viewers.push(v); write('snapshot', { rows: [{ s: 'SPY', p: 500, c: 1, r1: 0.1, r3: 0.3, rv: 1.2 }], asOf: 1, live: true }); return () => { v.off = true; }; } };
  await withServer({ academySireFeed }, async (base) => {
    const html = await (await fetch(`${base}/academy-activity/`)).text();
    assert.match(html, /academy-activity\/sire-stream/, 'the SIRE panel connects to the stream');
    const events = [];
    await new Promise((resolve, reject) => {
      const req = http.get(`${base}/academy-activity/sire-stream`, (res) => {
        assert.match(res.headers['content-type'], /text\/event-stream/);
        assert.equal(res.headers['cache-control'], 'no-cache, no-transform');
        let buf = '';
        res.on('data', (d) => {
          buf += d; const parts = buf.split('\n\n'); buf = parts.pop();
          for (const p of parts) { const m = /event: (\w+)\ndata: (.*)/.exec(p); if (m) events.push([m[1], JSON.parse(m[2])]); }
          if (events.some((e) => e[0] === 'tick')) { req.destroy(); resolve(); }
        });
        setTimeout(() => viewers[0].write('tick', { at: 2, rows: [{ s: 'SPY', p: 500.5, t: 2 }] }), 30);
      });
      req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
      setTimeout(() => reject(new Error('no tick event')), 3000);
    });
    assert.deepEqual(events[0], ['snapshot', { rows: [{ s: 'SPY', p: 500, c: 1, r1: 0.1, r3: 0.3, rv: 1.2 }], asOf: 1, live: true }]);
    assert.deepEqual(events[1], ['tick', { at: 2, rows: [{ s: 'SPY', p: 500.5, t: 2 }] }]);
    assert.equal(viewers[0].opts.filter, null, 'with the gate off every symbol streams');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(viewers[0].off, true, 'closing the connection unsubscribes the viewer');
  });
});

test('the options chain stream is members-only Server-Sent Events, one subscribe per connection, released on disconnect', async () => {
  const http = require('node:http');
  const subs = [];
  const academyOptionsStream = {
    subscribe(symbol, write) {
      if (symbol === 'BADSYM') return null;
      const sub = { symbol, write, off: false };
      subs.push(sub);
      write('snapshot', { symbol, spot: 500, rows: [], error: null, at: 1 });
      return () => { sub.off = true; };
    }
  };
  const academyOAuth = { verifySession: (a) => (a === 'Bearer member' ? { ok: true, userId: 'u1', tier: 'member' } : a === 'Bearer free' ? { ok: true, userId: 'u2', tier: 'free' } : { ok: false, status: 401, code: 'authorization_required' }) };
  await withServer({ academyOptionsStream, academyOAuth }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/options-stream?symbol=SPY`)).status, 401, 'no session');
    const freeResp = await fetch(`${base}/academy-activity/options-stream?symbol=SPY`, { headers: { authorization: 'Bearer free' } });
    assert.equal(freeResp.status, 403);
    assert.equal((await freeResp.json()).error, 'academy_access_required');

    const events = [];
    await new Promise((resolve, reject) => {
      const req = http.get(`${base}/academy-activity/options-stream?symbol=SPY`, { headers: { authorization: 'Bearer member' } }, (res) => {
        assert.match(res.headers['content-type'], /text\/event-stream/);
        let buf = '';
        res.on('data', (d) => {
          buf += d; const parts = buf.split('\n\n'); buf = parts.pop();
          for (const p of parts) { const m = /event: (\w+)\ndata: (.*)/.exec(p); if (m) events.push([m[1], JSON.parse(m[2])]); }
          if (events.length) { req.destroy(); resolve(); }
        });
      });
      req.on('error', (e) => { if (e.code !== 'ECONNRESET') reject(e); });
      setTimeout(() => reject(new Error('no snapshot event')), 3000);
    });
    assert.deepEqual(events[0], ['snapshot', { symbol: 'SPY', spot: 500, rows: [], error: null, at: 1 }]);
    assert.equal(subs[0].symbol, 'SPY');
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(subs[0].off, true, 'disconnecting unsubscribes');

    const refused = await fetch(`${base}/academy-activity/options-stream?symbol=BADSYM`, { headers: { authorization: 'Bearer member' } });
    assert.equal(refused.status, 200, 'the SSE headers already went out; the refusal arrives as an error event, not an HTTP error status');
    const text = await refused.text();
    assert.match(text, /event: error/);
    assert.match(text, /invalid_symbol/);
  });
});

test('Academy offers moomoo, Webull and Robinhood quote links, and the broker route only redirects to quote pages', async () => {
  const { createBrokerLinks } = require('./academy-brokers');
  const brokerLinks = createBrokerLinks({ apiKey: 'k', fetchImpl: async () => ({ ok: true, json: async () => ({ results: { primary_exchange: 'XNAS' } }) }) });
  await withServer({ academyAppId: '1551336038713139370', brokerLinks }, async (base) => {
    const html = await (await fetch(`${base}/academy-activity/`)).text();
    for (const id of ['academy-moomoo-buy', 'academy-webull-buy', 'academy-robinhood-buy']) assert.match(html, new RegExp(`'academy-'\\+key\\+'-buy'|${id}`));
    assert.match(html, /\['webull','Webull'/);
    assert.match(html, /robinhood\.com\/stocks\//);
    assert.match(html, /\['etoro','eToro'/); assert.match(html, /etoro\.com\/markets\//);
    assert.match(html, /#academy-moomoo-buy\{border-color:#ff7a1a/, 'the moomoo button is orange');
    assert.doesNotMatch(html, /academy-broker-join/, 'no separate Join buttons on the chart');
    assert.match(html, /\/academy-activity\/open/, 'moomoo and Webull Buy buttons go through the app-or-sign-up launcher');
    assert.match(html, /id="sire-toggle"|btn\.id = 'sire-toggle'/, 'the SIRE panel ships with the page');
    const moomoo = await (await fetch(`${base}/academy-activity/open?b=moomoo&symbol=spy`)).text();
    assert.match(moomoo, /ftmm:\/\/url\//, 'moomoo tries the app on the quote first');
    assert.match(moomoo, /https:\/\/j\.moomoo\.com\/00isCK/, 'moomoo falls back to the owner referral link');
    assert.match(moomoo, /referral link/, 'the launcher discloses the referral link');
    const wb = await (await fetch(`${base}/academy-activity/open?b=webull&symbol=aapl`)).text();
    assert.match(wb, /https:\/\/www\.webull\.com\/quote\/nasdaq-aapl/);
    assert.match(wb, /https:\/\/a\.webull\.com\/gsHkJGq3lyekBxLcvC/);
    assert.equal((await fetch(`${base}/academy-activity/open?b=evil&symbol=AAPL`)).status, 400);
    assert.equal((await fetch(`${base}/academy-activity/open?b=moomoo&symbol=%3C%3E`)).status, 400);
    assert.match(html, /\[\?&\]perf=1/, 'the drag performance readout only shows with ?perf=1');
    const webull = await fetch(`${base}/academy-activity/broker?b=webull&symbol=aapl`, { redirect: 'manual' });
    assert.equal(webull.status, 302);
    assert.equal(webull.headers.get('location'), 'https://www.webull.com/quote/nasdaq-aapl');
    const bad = await fetch(`${base}/academy-activity/broker?b=webull&symbol=%3C%3E`, { redirect: 'manual' });
    assert.equal(bad.status, 400);
    const other = await fetch(`${base}/academy-activity/broker?b=https://evil.example&symbol=AAPL`, { redirect: 'manual' });
    assert.equal(other.status, 400);
  });
});

test('Click-to-Alert routes need a session, a subscription, and answer with the service\'s reasons', async () => {
  const calls = [];
  const academyClickAlert = {
    entitlement: async (u) => (u === 'sub' ? { configured: true, entitled: true } : { configured: true, entitled: false }),
    destinations: async () => [{ id: '100000000000000001', name: 'House of Traders', current: true }],
    channels: async (u, g) => (g === '100000000000000001' ? [{ id: '500000000000000005', name: 'alerts', category: '', mentionEveryone: false }] : null),
    preview: async (u, body) => (u === 'sub' ? { ok: true, entitlement: { entitled: true }, analysis: { horizon: 'swing', symbol: body.symbol } } : { ok: false, status: 402, code: 'click_alert_subscription_required' }),
    send: async (user, body) => { calls.push({ user, body }); return body.symbol === 'LIMIT' ? { ok: false, status: 429, code: 'rate_limited', detail: 'slow down' } : { ok: true, messageId: '1', channelId: body.channelId, mentioned: false }; }
  };
  const academyOAuth = { verifySession: (a) => (a === 'Bearer sub' ? { ok: true, userId: 'sub', tier: 'academy', displayName: 'Ana' } : a === 'Bearer plain' ? { ok: true, userId: 'plain', tier: 'academy' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const sub = { authorization: 'Bearer sub' }, plain = { authorization: 'Bearer plain' };
  const json = (h) => ({ ...h, 'content-type': 'application/json' });
  await withServer({ academyClickAlert, academyOAuth }, async (base) => {
    const u = (p) => `${base}/academy-activity/click-alert/${p}`;
    assert.equal((await fetch(u('status'))).status, 401);
    assert.deepEqual(await (await fetch(u('status'), { headers: plain })).json(), { ok: true, configured: true, entitled: false, guilds: [] }, 'a non-subscriber learns only that the add-on is locked');
    const status = await (await fetch(u('status?current=100000000000000001'), { headers: sub })).json();
    assert.equal(status.entitled, true); assert.equal(status.guilds[0].name, 'House of Traders');
    assert.equal((await fetch(u('channels?guild=100000000000000001'), { headers: plain })).status, 402);
    assert.equal((await (await fetch(u('channels?guild=100000000000000001'), { headers: sub })).json()).channels[0].name, 'alerts');
    assert.equal((await fetch(u('channels?guild=1'), { headers: sub })).status, 404);
    assert.equal((await fetch(u('preview'), { method: 'POST', headers: plain, body: '{}' })).status, 415);
    assert.equal((await fetch(u('preview'), { method: 'POST', headers: json(sub), body: 'nope' })).status, 400);
    const denied = await fetch(u('preview'), { method: 'POST', headers: json(plain), body: JSON.stringify({ symbol: 'AAPL', target: 200 }) });
    assert.equal(denied.status, 402); assert.equal((await denied.json()).error, 'click_alert_subscription_required');
    const preview = await (await fetch(u('preview'), { method: 'POST', headers: json(sub), body: JSON.stringify({ symbol: 'AAPL', target: 200 }) })).json();
    assert.equal(preview.analysis.horizon, 'swing');
    const sent = await fetch(u('send'), { method: 'POST', headers: json(sub), body: JSON.stringify({ symbol: 'AAPL', target: 200, channelId: '500000000000000005' }) });
    assert.equal(sent.status, 200);
    assert.deepEqual(calls[0].user, { userId: 'sub', displayName: 'Ana' }, 'the service is told who is sending, from the session and not from the body');
    const limited = await fetch(u('send'), { method: 'POST', headers: json(sub), body: JSON.stringify({ symbol: 'LIMIT', target: 2, channelId: '500000000000000005' }) });
    assert.equal(limited.status, 429); assert.equal((await limited.json()).detail, 'slow down');
    assert.equal((await fetch(u('status'), { method: 'DELETE', headers: sub })).status, 405);
  });
  await withServer({ academyOAuth }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/click-alert/status`, { headers: sub })).status, 503, 'off when the service is not built');
  });
});

test('The Academy page carries the smart-money hover explainer and the Click-to-Alert panel as plain inline scripts', async () => {
  await withServer({}, async (base) => {
    const html = await (await fetch(`${base}/academy-activity/`)).text();
    for (const marker of ['SmlSmcExplain', 'smc-tip', 'CONCLUSION:', 'click-alert-toggle', 'academy-activity/click-alert/', 'data-ca="send"', 'MAP READ']) assert.ok(html.includes(marker), marker + ' is on the page');
    // the page is one template literal: an inlined script must have no backslash escapes or template placeholders that would be rewritten
    assert.ok(!/\\u[0-9a-f]{4}/i.test(html.slice(html.indexOf('SmlSmcExplain'), html.indexOf('SmlSmcExplain') + 200)), 'no stray escapes');
  });
});

test('Chat profile routes need a session and return a card and an avatar as bytes', async () => {
  const img = Buffer.from('89504e470d0a1a0a', 'hex');
  const academyProfiles = {
    profile: async (id) => (id === '420000000000000001' ? { discordId: id, discord: { name: 'Ana' }, site: { linked: false } } : null),
    avatar: async (id) => (id === '420000000000000001' ? { contentType: 'image/png', bytes: img } : null)
  };
  const academyOAuth = { verifySession: (a) => (a === 'Bearer m' ? { ok: true, userId: 'u', tier: 'free' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const auth = { authorization: 'Bearer m' };
  await withServer({ academyProfiles, academyOAuth }, async (base) => {
    const u = (p) => `${base}/academy-activity/${p}`;
    assert.equal((await fetch(u('profile?user=420000000000000001'))).status, 401);
    assert.equal((await fetch(u('avatar?user=420000000000000001'))).status, 401, 'an avatar is never served without a session');
    const card = await (await fetch(u('profile?user=420000000000000001'), { headers: auth })).json();
    assert.equal(card.ok, true); assert.equal(card.card.discord.name, 'Ana');
    assert.equal((await fetch(u('profile?user=1'), { headers: auth })).status, 404);
    const res = await fetch(u('avatar?user=420000000000000001'), { headers: auth });
    assert.equal(res.status, 200); assert.equal(res.headers.get('content-type'), 'image/png'); assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual([...Buffer.from(await res.arrayBuffer())], [...img]);
    assert.equal((await fetch(u('avatar?user=1'), { headers: auth })).status, 404);
  });
  await withServer({ academyOAuth }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/profile?user=1`, { headers: auth })).status, 503, 'off when the service is not built');
  });
});

test('The chat panel shows the avatar before the name and opens a profile card on hover', async () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(require('node:path').join(__dirname, 'academy-chat-panel.js'), 'utf8');
  for (const marker of ['class="ava"', "'/academy-activity/avatar?user='", "'/academy-activity/profile?user='", 'mouseover', 'Add on Discord', 'Follow profile', 'Follow channel', 'smlAcademyOpenExternal']) assert.ok(src.includes(marker), marker);
  assert.ok(src.indexOf('class="ava"') < src.indexOf('class="nm"'), 'avatar comes before the username');
});

test('Quick Snapshot routes need a session, take a PNG data URL, and pass the member and the channel to the service', async () => {
  const zlib = require('node:zlib');
  const crc = (buf) => { let x = 0xffffffff; for (const v of buf) { x ^= v; for (let k = 0; k < 8; k++) x = x & 1 ? 0xedb88320 ^ (x >>> 1) : x >>> 1; } return (x ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(640, 0); ihdr.writeUInt32BE(360, 4); ihdr[8] = 8;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.alloc(641 * 360, 5))), chunk('IEND', Buffer.alloc(0))]);
  const seen = [];
  const academySnapshot = {
    destinations: async () => [{ id: '100000000000000001', name: 'House', current: true }],
    channels: async (u, g) => (g === '100000000000000001' ? [{ id: '500000000000000005', name: 'charts', category: '' }] : null),
    send: async (user, body) => { seen.push({ user, body }); return body.channelId === '500000000000000009' ? { ok: false, status: 403, code: 'you_cannot_attach_there', detail: 'no files' } : { ok: true, messageId: '1', channelId: body.channelId, channelName: 'charts' }; }
  };
  const academyOAuth = { verifySession: (a) => (a === 'Bearer m' ? { ok: true, userId: 'u1', tier: 'free', displayName: 'Ana' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const auth = { authorization: 'Bearer m' }, json = { ...auth, 'content-type': 'application/json' };
  await withServer({ academySnapshot, academyOAuth }, async (base) => {
    const u = (p) => `${base}/academy-activity/snapshot/${p}`;
    assert.equal((await fetch(u('status'))).status, 401);
    assert.equal((await (await fetch(u('status'), { headers: auth })).json()).guilds[0].name, 'House');
    assert.equal((await (await fetch(u('channels?guild=100000000000000001'), { headers: auth })).json()).channels[0].name, 'charts');
    assert.equal((await fetch(u('channels?guild=1'), { headers: auth })).status, 404);
    const image = 'data:image/png;base64,' + png.toString('base64');
    assert.equal((await fetch(u('send'), { method: 'POST', headers: auth, body: '{}' })).status, 415);
    assert.equal((await fetch(u('send'), { method: 'POST', headers: json, body: 'nope' })).status, 400);
    assert.equal((await fetch(u('send'), { method: 'POST', headers: json, body: JSON.stringify({ channelId: '500000000000000005', image: 'data:image/jpeg;base64,AAAA' }) })).status, 422, 'only PNG data URLs');
    const ok = await fetch(u('send'), { method: 'POST', headers: json, body: JSON.stringify({ channelId: '500000000000000005', image, symbol: 'SPY', tf: '1D', note: 'look' }) });
    assert.equal(ok.status, 200); assert.equal((await ok.json()).channelName, 'charts');
    assert.deepEqual(seen[0].user, { userId: 'u1', displayName: 'Ana' }, 'the sender comes from the session');
    assert.ok(Buffer.isBuffer(seen[0].body.png) && seen[0].body.png.equals(png)); assert.equal(seen[0].body.symbol, 'SPY');
    const denied = await fetch(u('send'), { method: 'POST', headers: json, body: JSON.stringify({ channelId: '500000000000000009', image }) });
    assert.equal(denied.status, 403); assert.equal((await denied.json()).error, 'you_cannot_attach_there');
    assert.equal((await fetch(u('status'), { method: 'DELETE', headers: auth })).status, 405);
  });
  await withServer({ academyOAuth }, async (base) => { assert.equal((await fetch(`${base}/academy-activity/snapshot/status`, { headers: auth })).status, 503); });
});

test('The Academy page has the SNAP button and the buy buttons (eToro too, moomoo orange)', async () => {
  await withServer({}, async (base) => {
    const html = await (await fetch(`${base}/academy-activity/`)).text();
    for (const marker of ['snap-toggle', 'academy-activity/snapshot/', 'SNAPSHOT TO DISCORD', 'academy-etoro-buy']) assert.ok(html.includes(marker), marker);
  });
});

test('The options chain gets the broker buy bar, wired to the clicked contract', async () => {
  await withServer({}, async (base) => {
    const html = await (await fetch(`${base}/academy-activity/`)).text();
    for (const marker of ['SmlOptionContract', 'BUY THIS CONTRACT ON YOUR BROKER', 'opt-buy', 'options/chains/', 'data-b=moomoo']) assert.ok(html.includes(marker), marker);
    assert.ok(html.indexOf('SmlOptionContract = api') < html.indexOf('BUY THIS CONTRACT ON YOUR BROKER'), 'the contract module loads before the bar');
  });
});

test('The chat panel threads replies with votes and pins the busiest threads; the appearance panel ships with the page', () => {
  const fs = require('node:fs'), p = (f) => fs.readFileSync(require('node:path').join(__dirname, f), 'utf8');
  const chat = p('academy-chat-panel.js'), look = p('academy-appearance-ui.js'), lb = p('academy-lb-ui.js');
  for (const marker of ["type: 'vote'", 'parentId', 'HOT THREAD', 'data-reply', 'data-fold']) assert.ok(chat.includes(marker), marker);
  for (const marker of ['Customize your Academy', 'COLOR SCHEME', 'TEXT SIZE', 'localStorage']) assert.ok(look.includes(marker), marker);
  for (const [name, src] of [['chat', chat], ['appearance', look], ['loop bucks', lb]]) assert.ok(!/[`\\]|\$\{/.test(src), name + ' is inlined into a template literal and must hold no backtick, backslash or ${');
  assert.ok(p('server.js').includes('ACADEMY_APPEARANCE + ') && p('server.js').includes('ACADEMY_LB_UI + '), 'injected into the page');
});

test('Loop Bucks pass routes take a session or a buy ticket, report what blocks a purchase, and charge through the service', async () => {
  const U = '300000000000000001', calls = [];
  const academyOAuth = { verifySession: (a) => (a === 'Bearer m' ? { ok: true, userId: U, tier: 'free' } : { ok: false, status: 401, code: 'authorization_required' }), verifyBuyTicket: (t) => (t === 'tick' ? { userId: U } : null) };
  const academyPasses = {
    configured: true, catalog: () => [{ plan: 'daily', label: 'Daily', days: 1, price: 50 }],
    status: async (id) => ({ ok: true, catalog: [], pass: null, linked: true, eligible: false, blocked: 'two_step_required', url: 'https://x.test/', balance: 10, id }),
    buy: async (o) => { calls.push(o); return o.plan === 'weekly' ? { ok: false, status: 402, code: 'insufficient_funds', balance: 10, needed: 250 } : { ok: true, pass: { plan: o.plan }, balance: 5 }; }
  };
  await withServer({ academyPasses, academyOAuth }, async (base) => {
    const u = (p) => `${base}/academy-activity/passes/${p}`, json = { 'content-type': 'application/json' };
    assert.equal((await fetch(u('catalog'))).status, 200);
    assert.equal((await fetch(u('status'))).status, 401, 'no session or ticket');
    const st = await (await fetch(u('status'), { headers: { 'x-academy-ticket': 'tick' } })).json();
    assert.equal(st.blocked, 'two_step_required');
    const bought = await fetch(u('buy'), { method: 'POST', headers: { ...json, authorization: 'Bearer m' }, body: JSON.stringify({ plan: 'daily', orderKey: 'order-0001' }) });
    assert.equal(bought.status, 200); assert.deepEqual(calls[0], { discordId: U, plan: 'daily', orderKey: 'order-0001' });
    const poor = await fetch(u('buy'), { method: 'POST', headers: { ...json, 'x-academy-ticket': 'tick' }, body: JSON.stringify({ plan: 'weekly', orderKey: 'order-0002' }) });
    assert.equal(poor.status, 402); assert.equal((await poor.json()).needed, 250);
  });
  await withServer({ academyOAuth }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/passes/status`, { headers: { authorization: 'Bearer m' } })).status, 503, 'off when not configured');
  });
});

test('Tick charts: tf=100T builds a candle per 100 trades from the Massive record, warms up honestly, and rejects odd sizes', async () => {
  const trades = Array.from({ length: 250 }, (_, i) => [1_700_000_000_000 + i * 50, 100 + (i % 7) * 0.01, 10]);
  const watched = [];
  const academyMassive = { status: () => ({ enabled: true }), watch: (s) => { watched.push(s); return true; }, ticks: (s) => (s === 'SPY' ? trades : []), peek: () => null, on: () => () => {} };
  const marketHistory = { enabled: true, trades: async () => [], get: async () => ({ ok: false }) };
  await withServer({ academyMassive, marketHistory }, async (base) => {
    const m = (q) => fetch(`${base}/academy-activity/market?${q}`);
    const ok = await m('symbol=SPY&tf=100T');
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.deepEqual(body.bars.map((b) => b.n), [100, 100, 50]);
    assert.equal(body.tf, '100T'); assert.equal(body.source, 'massive-ticks'); assert.ok(watched.includes('SPY'));
    const cold = await m('symbol=QQQ&tf=100T');
    assert.equal(cold.status, 503); assert.equal((await cold.json()).error, 'ticks_warming');
    assert.notEqual((await m('symbol=SPY&tf=7T')).status, 200, '7T is not an offered size');
  });
  await withServer({}, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/market?symbol=SPY&tf=100T`)).status, 503, 'no stream, no ticks');
  });
});

test('The tick picker ships with the page and the chart folds live prints into tick candles', () => {
  const fs = require('node:fs'), p = (f) => fs.readFileSync(require('node:path').join(__dirname, f), 'utf8');
  const ui = p('academy-tick-ui.js'), pro = p('academy-chart-pro.js');
  assert.ok(ui.includes('Tick interval') && ui.includes('100T') === false && ui.includes('SIZES'));
  assert.ok(!/[`\\]|\$\{/.test(ui), 'inlined script: no backtick, backslash or ${');
  assert.ok(pro.includes('tick chart: a candle holds N trades'));
  assert.ok(p('server.js').includes('ACADEMY_TICK_UI + '));
});

test('Pass routes pick the Click-to-Alert add-on with product=click_alert', async () => {
  const U = '300000000000000001', seen = [];
  const academyOAuth = { verifySession: (a) => (a === 'Bearer m' ? { ok: true, userId: U, tier: 'academy' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const mk = (name) => ({ configured: true, catalog: () => [], status: async () => ({ ok: true, name }), buy: async (o) => { seen.push([name, o.plan]); return { ok: true, pass: { plan: o.plan }, balance: 1 }; } });
  await withServer({ academyOAuth, academyPasses: mk('academy'), academyClickAlertPasses: mk('click_alert') }, async (base) => {
    const h = { authorization: 'Bearer m', 'content-type': 'application/json' };
    assert.equal((await (await fetch(`${base}/academy-activity/passes/status`, { headers: h })).json()).name, 'academy');
    assert.equal((await (await fetch(`${base}/academy-activity/passes/status?product=click_alert`, { headers: h })).json()).name, 'click_alert');
    await fetch(`${base}/academy-activity/passes/buy?product=click_alert`, { method: 'POST', headers: h, body: JSON.stringify({ plan: 'weekly', orderKey: 'order-0001' }) });
    assert.deepEqual(seen, [['click_alert', 'weekly']]);
  });
});

test('Click-to-Alert shows a Discord-style preview of the exact post and destination before it can be sent', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'academy-click-alert-ui.js'), 'utf8');
  for (const marker of ['THIS IS WHAT WILL BE POSTED', 'Posting to', "'Send to #'", 'dpics']) assert.ok(src.includes(marker), marker);
  assert.ok(src.indexOf('data-ca="channel"') < src.indexOf('THIS IS WHAT WILL BE POSTED') && src.indexOf('THIS IS WHAT WILL BE POSTED') < src.indexOf('data-ca="send"'), 'destination, then preview, then send');
  assert.ok(!/[`\\]|\$\{/.test(src), 'inlined script: no backtick, backslash or ${');
});

test('The options lab reads the Academy session when it is used, not only from the sign-in event, and the scanner OPTIONS tab loads the chain', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'server.js'), 'utf8');
  assert.ok(!src.includes("let session='',chain=[]"), 'the options lab no longer starts with an empty session');
  assert.ok(src.includes("session=String(window.smlAcademySessionToken||'')"));
  assert.ok(src.includes("if(!session)session=String(window.smlAcademySessionToken||'');if(!session){status.classList.add('options-error')"));
  assert.ok(src.includes("const lb=document.getElementById('load-options');if(lb&&!lb.disabled&&window.smlAcademySessionToken"));
});

test('Academy sentiment route is session and tier gated, validates the symbol and surfaces provider failure as 503', async () => {
  const calls = [];
  const oauth = { verifySession: (a) => a === 'Bearer member' ? { ok: true, userId: '1', tier: 'member' } : a === 'Bearer free' ? { ok: true, userId: '2', tier: 'free' } : { ok: false, status: 401, code: 'authorization_required' } };
  await withServer({ academyOAuth: oauth, academySentiment: { get: async (s) => { calls.push(s); if (s === 'BOOM') throw new Error('x'); return { ok: true, symbol: s, available: true, scorePct: 12, label: 'leaning bullish', coverage: 100, components: {}, notes: [] }; } } }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/sentiment?symbol=SPY`)).status, 401);
    assert.equal((await fetch(`${base}/academy-activity/sentiment?symbol=SPY`, { headers: { authorization: 'Bearer free' } })).status, 403);
    assert.equal((await fetch(`${base}/academy-activity/sentiment?symbol=bad%20sym`, { headers: { authorization: 'Bearer member' } })).status, 400);
    const ok = await fetch(`${base}/academy-activity/sentiment?symbol=spy`, { headers: { authorization: 'Bearer member' } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).label, 'leaning bullish');
    assert.equal((await fetch(`${base}/academy-activity/sentiment?symbol=BOOM`, { headers: { authorization: 'Bearer member' } })).status, 503);
    assert.deepEqual(calls, ['SPY', 'BOOM']);
  });
  await withServer({ academyOAuth: oauth }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/sentiment?symbol=SPY`, { headers: { authorization: 'Bearer member' } })).status, 503);
  });
});
