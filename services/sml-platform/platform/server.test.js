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
    const { data, memory, ...rest } = await response.json();
    assert.deepEqual(rest, {
      ok: true,
      service: 'sml-platform-api',
      database: 'connected'
    });
    assert.ok(data && ['ok', 'unknown', 'degraded', 'down', 'rate_limited'].includes(data.overall));
    assert.equal(typeof data.marketOpen, 'boolean');
    /* the process's weight in MB, so the 512 MB instance limit can be watched from outside */
    for (const k of ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers', 'heapLimit', 'uptimeS']) assert.equal(typeof memory[k], 'number', k);
    assert.ok(memory.rss > 0 && memory.heapUsed <= memory.heapTotal && memory.heapTotal <= memory.heapLimit);
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
    const sceneScript = require('./academy-scene-visuals').academySceneVisualsScript();
    assert.equal(html.indexOf(sceneScript), whiteboardAt + whiteboardScript.length, 'scene renderer follows the whiteboard renderer');
    assert.equal(html.indexOf(academyVisualLabScript()), whiteboardAt + whiteboardScript.length + sceneScript.length, 'visual lab follows the scene renderer');
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
    assert.match(html, /height:calc\(100svh - 86px\)/);
    assert.match(html, /canvas\.addEventListener\('wheel',\(\)=>\{\},\{passive:true\}\)/);
    assert.match(html, /LEVEL 2 DEPTH/);
    assert.match(html, /academy-depth-row/);
    assert.match(html, /Unlock Academy Tools/);
    assert.match(html, /DiscordSDK/);
    assert.match(html, /academy-activity\/sdk\/(v\d+\/)?index\.mjs/);
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
    for (const script of [curriculumScript, whiteboardScript, require('./academy-scene-visuals').academySceneVisualsScript(), academyVisualLabScript()]) assert.doesNotMatch(script, PAGE_BANNED);
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
    if (u.includes('/wp-json/sml/v1/history')) { asked.push(new URL(u).searchParams.get('tf')); return new Response(JSON.stringify({ bars: [{ t: Date.now() - 60_000, o: 1, h: 2, l: 1, c: 2, v: 5 }] }), { status: 200 }); }
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

test('an interval the site cannot serve, or stopped updating, is built from the Massive interval underneath it', async () => {
  const realFetch = globalThis.fetch;
  const open = Date.UTC(2026, 9, 12, 13, 30);
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/wp-json/sml/v1/history')) {
      const tf = new URL(u).searchParams.get('tf');
      if (tf === '1h') return new Response('down', { status: 503 });
      /* the site's 15m series stopped months ago */
      return new Response(JSON.stringify({ bars: [{ t: Date.UTC(2026, 6, 2, 15), o: 1, h: 2, l: 1, c: 2, v: 5 }] }), { status: 200 });
    }
    return realFetch(url, init);
  };
  const m5 = Array.from({ length: 24 }, (_, i) => ({ t: open + i * 300_000, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 10 }));
  const marketHistory = { enabled: true, get: async (symbol, tf) => (tf === '5m' ? { ok: true, data: { symbol, tf, bars: m5, source: 'massive-rest' } } : { ok: false, status: 503, code: 'massive_history_unavailable' }) };
  try {
    await withServer({ marketHistory }, async (base) => {
      const hour = await (await fetch(`${base}/academy-activity/market?symbol=ZZDERIVEH&tf=1h`)).json();
      assert.equal(hour.tf, '1h'); assert.equal(hour.source, 'massive-derived'); assert.equal(hour.bars.length, 2); assert.equal(hour.bars[0].t, open); assert.equal(hour.bars[0].v, 120);
      const quarter = await (await fetch(`${base}/academy-activity/market?symbol=ZZDERIVEM&tf=15m`)).json();
      assert.equal(quarter.source, 'massive-derived', 'months-old site bars are replaced'); assert.equal(quarter.bars.length, 8);
    });
  } finally { globalThis.fetch = realFetch; }
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
    assert.doesNotMatch(html, /paper backtest/i);
    assert.match(html, /S\.open = false; \/\/ the panel never pops open on load/, 'MEM ALGO starts closed');
    assert.match(html, /S\.min = true; \/\/ the map starts as a chip/, 'the smart-money map starts as a chip');
    assert.match(html, /hide options/, 'the map\'s hide control folds the add-on options only');
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

test('the flow-days route serves the week to members only and validates the symbol', async () => {
  const academyFlowDaily = { configured: true, summary: async (symbol, days) => ({ ok: true, symbol, days, days_: days, window: { available: false, days: 0 } }) };
  const academyOAuth = { verifySession: (auth) => (auth === 'Bearer member' ? { ok: true, tier: 'academy' } : { ok: false, status: 401, code: 'authorization_required' }) };
  await withServer({ academyFlowDaily, academyOAuth }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/flow-days?symbol=SPY`)).status, 401);
    const ok = await fetch(`${base}/academy-activity/flow-days?symbol=spy&days=7`, { headers: { authorization: 'Bearer member' } });
    assert.equal(ok.status, 200); const body = await ok.json(); assert.equal(body.symbol, 'SPY'); assert.equal(body.days_, 7);
    assert.equal((await fetch(`${base}/academy-activity/flow-days?symbol=../x`, { headers: { authorization: 'Bearer member' } })).status, 400);
  });
});

test('the signal outcomes route serves the measured hit rates to members only', async () => {
  await withServer({}, async (base) => { assert.equal((await fetch(`${base}/academy-activity/signal-outcomes`)).status, 503); });
  const academySignalOutcomes = { configured: true, summary: async (days) => ({ ok: true, days, depth: [], week: [], sweeps: [] }) };
  const academyOAuth = { verifySession: (auth) => (auth === 'Bearer member' ? { ok: true, tier: 'academy' } : auth === 'Bearer free' ? { ok: true, tier: 'free' } : { ok: false, status: 401, code: 'authorization_required' }) };
  await withServer({ academySignalOutcomes, academyOAuth }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/signal-outcomes`)).status, 401);
    assert.equal((await fetch(`${base}/academy-activity/signal-outcomes`, { headers: { authorization: 'Bearer free' } })).status, 403);
    const ok = await fetch(`${base}/academy-activity/signal-outcomes?days=7`, { headers: { authorization: 'Bearer member' } });
    assert.equal(ok.status, 200); const body = await ok.json(); assert.equal(body.days, 7); assert.ok(Array.isArray(body.sweeps));
  });
});

test('the heat map route serves the order-flow service\'s book columns, gated like order flow', async () => {
  await withServer({}, async (base) => { assert.equal((await fetch(`${base}/academy-activity/heatmap?symbol=SPY`)).status, 503); });
  const academyOrderFlow = { get: () => ({}), heatmap: (s, since) => { if (!/^[A-Z]+$/i.test(String(s))) throw new TypeError('invalid_symbol'); return { symbol: String(s).toUpperCase(), ready: true, since, columns: [{ t: 10, b: [[100, 5]], a: [[100.01, 6]] }] }; } };
  await withServer({ academyOrderFlow }, async (base) => {
    const ok = await fetch(`${base}/academy-activity/heatmap?symbol=spy&since=4`);
    assert.equal(ok.status, 200);
    const body = await ok.json(); assert.equal(body.symbol, 'SPY'); assert.equal(body.since, 4); assert.equal(body.columns.length, 1);
    assert.equal((await fetch(`${base}/academy-activity/heatmap?symbol=../x`)).status, 400);
  });
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m' });
  assert.match(html, /id = 'heat-toggle'/, 'the HEAT toggle script is on the page');
  assert.match(html, /mem-scn-strip/, 'the scenario insight strip lives under the candles, not over them');
  assert.match(html, /smlSnapshotBand/, 'the snapshot carries the scenario words as a band');
  assert.doesNotMatch(html, /extra room on top for the title and insight cards/, 'no price room is taken for an on-chart card any more');
  assert.match(html, /academy-activity\/heatmap\?symbol=/);
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

test('baked narration is served with no ElevenLabs key configured; an empty store with no key is still a 503', async () => {
  const baked = { configured: false, stored: true, getLessonAudio: async () => ({ audio: Buffer.from('mp3'), cached: true, partMs: [900] }) };
  await withServer({ academyVoice: baked }, async (base) => {
    const res = await fetch(`${base}/academy-activity/speech?moduleId=1&lessonId=1`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('x-academy-voice-cache'), 'hit');
  });
  const off = { configured: false, stored: false, getLessonAudio: async () => { throw new Error('must not be called'); } };
  await withServer({ academyVoice: off }, async (base) => {
    const res = await fetch(`${base}/academy-activity/speech?moduleId=1&lessonId=1`);
    assert.equal(res.status, 503);
  });
});

test('a lesson shows its written text once: no duplicate slide visual or filler callout, and chart panels stay out of the lesson', () => {
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  assert.match(html, /\.academy-live-deck \.academy-slide-visual:not\(:has\(svg\)\)\{display:none\}/);
  assert.match(html, /\.academy-live-deck:not\(:has\(\.wb-svg,\.sc-svg\)\) \.academy-slide-callout\{display:none\}/);
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
    send: async (user, body) => { calls.push({ user, body }); return body.symbol === 'LIMIT' ? { ok: false, status: 429, code: 'rate_limited', detail: 'slow down' } : { ok: true, messageId: '1', channelId: body.channelId, mentioned: false }; },
    chainFor: async ({ symbol, expiry }) => (symbol === 'AAPL' ? { ok: true, symbol, price: 190, expirations: ['2099-01-15', '2099-02-19'], loaded: expiry ? [expiry] : ['2099-01-15'], expiry: expiry || null, rows: [{ expiry: expiry || '2099-01-15', strike: 190, call: { bid: 5, ask: 5.2, mid: 5.1 }, put: { bid: 4.8, ask: 5, mid: 4.9 } }] } : { ok: false, status: 503, code: 'options_unavailable' })
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
    assert.equal((await fetch(u('chain?symbol=AAPL'), { headers: plain })).status, 402, 'the contract picker is part of the add-on');
    const chain = await (await fetch(u('chain?symbol=AAPL&expiry=2099-02-19'), { headers: sub })).json();
    assert.deepEqual(chain.expirations, ['2099-01-15', '2099-02-19']); assert.equal(chain.rows[0].call.mid, 5.1); assert.equal(chain.expiry, '2099-02-19');
    assert.equal((await fetch(u('chain?symbol=NOPE'), { headers: sub })).status, 503);
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
    for (const marker of ['SmlSmcExplain', 'CONCLUSION:', 'click-alert-toggle', 'academy-activity/click-alert/', 'data-ca="send"', 'data-kind="option"', 'data-ca="pstrike"', 'CATALYST CHECK', 'MAP READ']) assert.ok(html.includes(marker), marker + ' is on the page');
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
  for (const marker of ["type: 'vote'", 'parentId', 'HOT THREAD', 'data-reply', 'data-fold', "type: 'members'", 'mentions: mentionsIn(body)', 'class="mn', 'data-pick']) assert.ok(chat.includes(marker), marker);
  for (const marker of ['Customize your Academy', 'COLOR SCHEME', 'TEXT SIZE', 'localStorage']) assert.ok(look.includes(marker), marker);
  for (const [name, src] of [['chat', chat], ['loop bucks', lb]]) assert.ok(!/[`\\]|\$\{/.test(src), name + ' is inlined into a template literal and must hold no backtick, backslash or ${');
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

test('group pro tools route is signature-checked, validates input, passes preview through and hides internals on failure', async () => {
  const crypto = require('node:crypto');
  const secret = 'billing-test-secret';
  const post = (base, payload, { sign = true, ts = 1_700_000_000, secretUsed = secret } = {}) => {
    const raw = JSON.stringify(payload);
    const headers = { 'content-type': 'application/json', 'x-sml-timestamp': String(ts) };
    if (sign) headers['x-sml-signature'] = crypto.createHmac('sha256', secretUsed).update(`${ts}.${raw}`, 'utf8').digest('hex');
    return fetch(`${base}/v1/group-tools/run`, { method: 'POST', headers, body: raw });
  };
  const calls = [];
  const { GroupToolsInputError } = require('./academy-group-tools');
  const logged = [];
  const groupTools = { run: async (tool, input) => { calls.push([tool, input.symbol, input.preview]); if (tool === 'boom') throw new Error('secret internals'); if (tool === 'bug') throw new TypeError('Cannot read properties of undefined'); if (tool === 'bad') throw new GroupToolsInputError('invalid_symbol'); return { ok: true, tool, symbol: input.symbol, preview: !!input.preview }; } };
  await withServer({ billingApiSecret: secret, groupTools }, async (base) => {
    assert.equal((await post(base, { tool: 'setups', symbol: 'SPY' }, { sign: false })).status, 401);
    assert.equal((await post(base, { tool: 'setups', symbol: 'SPY' }, { secretUsed: 'wrong-secret' })).status, 401);
    assert.equal((await post(base, { tool: 'setups', symbol: 'SPY' }, { ts: 1_700_000_000 - 7200 })).status, 401, 'stale timestamp');
    const ok = await post(base, { tool: 'setups', symbol: 'SPY', groupId: 7, preview: true });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, tool: 'setups', symbol: 'SPY', preview: true });
    assert.deepEqual(calls, [['setups', 'SPY', true]]);
    assert.equal((await post(base, { tool: 'bad', symbol: 'x' })).status, 400);
    const bug = await post(base, { tool: 'bug', symbol: 'SPY' });
    assert.equal(bug.status, 503, 'an internal TypeError is a bug, not a bad request');
    assert.doesNotMatch(JSON.stringify(await bug.json()), /Cannot read/);
    const boom = await post(base, { tool: 'boom', symbol: 'SPY' });
    assert.equal(boom.status, 503);
    assert.doesNotMatch(JSON.stringify(await boom.json()), /secret internals/);
    const nonJson = await fetch(`${base}/v1/group-tools/run`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' });
    assert.equal(nonJson.status, 415);
  });
  await withServer({ billingApiSecret: secret }, async (base) => {
    assert.equal((await post(base, { tool: 'setups', symbol: 'SPY' })).status, 503, 'disabled without the service');
  });
});

test('site alerts desk is signature-checked and serves the view WordPress chose (live / closed / teaser)', async () => {
  const crypto = require('node:crypto');
  const secret = 'billing-test-secret';
  const post = (base, payload, { sign = true, ts = 1_700_000_000 } = {}) => {
    const raw = JSON.stringify(payload);
    const headers = { 'content-type': 'application/json', 'x-sml-timestamp': String(ts) };
    if (sign) headers['x-sml-signature'] = crypto.createHmac('sha256', secret).update(`${ts}.${raw}`, 'utf8').digest('hex');
    return fetch(`${base}/v1/group-tools/alerts`, { method: 'POST', headers, body: raw });
  };
  const seen = [];
  const academyAlerts = {
    snapshot: (opts) => { seen.push(['snap', opts ? opts.view : 'live']); return opts && opts.view === 'teaser' ? { ok: true, alerts: [], locked: true, teaser: { count: 3, closed: 1 } } : { ok: true, alerts: [{ id: '1', symbol: 'TXG' }] }; },
    detail: async (id, opts) => { seen.push(['detail', id, opts ? opts.closedOnly : false]); return id === '1' ? { id: '1', symbol: 'TXG' } : null; }
  };
  await withServer({ billingApiSecret: secret, academyAlerts }, async (base) => {
    assert.equal((await post(base, { groupId: 7, view: 'live' }, { sign: false })).status, 401);
    const live = await (await post(base, { groupId: 7, view: 'live' })).json();
    assert.equal(live.alerts[0].symbol, 'TXG'); assert.equal(live.view, 'live');
    const teaser = await (await post(base, { groupId: 7, view: 'teaser' })).json();
    assert.equal(teaser.teaser.count, 3); assert.equal(teaser.alerts.length, 0);
    assert.equal((await post(base, { groupId: 7, view: 'teaser', detail: '1' })).status, 403, 'a teaser never opens an alert');
    assert.equal((await post(base, { groupId: 7, view: 'live', detail: '1' })).status, 200);
    assert.equal((await post(base, { groupId: 7, view: 'live', detail: '9' })).status, 404);
    const odd = await (await post(base, { groupId: 7, view: 'anything' })).json();
    assert.equal(odd.view, 'teaser', 'an unknown view falls back to the teaser');
  });
  await withServer({ billingApiSecret: secret }, async (base) => {
    assert.equal((await post(base, { groupId: 7, view: 'live' })).status, 503);
  });
  // a linked member: their own desk, whatever view WordPress asked for
  const desks = [];
  const academyAlertSources = { presetSources: () => [], siteDesk: async (id, granted) => { desks.push([id, granted]); return { view: 'closed', tier: 'academy', sources: [{ key: 'c1', channelId: 'c1', view: 'closed' }] }; } };
  const memberAlerts = { ...academyAlerts, snapshot: (opts) => ({ ok: true, alerts: opts.sources.map((x) => ({ id: '1', source: x.channelId })) }), allows: (id, list) => (id === '1' ? list[0] : null) };
  await withServer({ billingApiSecret: secret, academyAlerts: memberAlerts, academyAlertSources }, async (base) => {
    const mine = await (await post(base, { discordUserId: '1087769175453339648', view: 'live' })).json();
    assert.equal(mine.perMember, true); assert.equal(mine.view, 'closed'); assert.equal(mine.sources, 1); assert.equal(mine.alerts[0].source, 'c1');
    await post(base, { groupId: 7, discordUserId: '1087769175453339648', view: 'live' });
    assert.deepEqual(desks, [['1087769175453339648', ''], ['1087769175453339648', 'live']], 'a group grant is passed only inside a group');
    seen.length = 0;
    assert.equal((await post(base, { discordUserId: '1087769175453339648', detail: '1' })).status, 200);
    assert.deepEqual(seen, [['detail', '1', true]], 'a closed source opens closed alerts only');
    assert.equal((await post(base, { discordUserId: '1087769175453339648', detail: '2' })).status, 404, 'an alert outside the member desk is not found');
  });
});

test('pop-out windows: ticket -> exchange -> renew re-checks access, and the link bus stays within one member', async () => {
  const { createAcademyOAuth } = require('./academy-oauth');
  const { createPopoutService } = require('./academy-popout');
  const oauth = createAcademyOAuth({ clientId: 'c', clientSecret: 's', academyAccess: { verify: async () => ({ ok: true }) } });
  const U = '420000000000000042', V = '430000000000000043';
  let tierNow = 'academy';
  const json = (base, path, body, token) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
  await withServer({ academyOAuth: oauth, academyPopout: createPopoutService(), academyTierLive: async () => tierNow }, async (base) => {
    const session = oauth.issuePopoutSession(U, 'member', 'Obi');
    assert.equal((await json(base, '/academy-activity/popout/ticket', { module: 'scanner' })).status, 401, 'needs a session');
    assert.equal((await json(base, '/academy-activity/popout/ticket', { module: '../x' }, session)).status, 400);
    const t = await (await json(base, '/academy-activity/popout/ticket', { module: 'scanner', symbol: 'nvda' }, session)).json();
    const url = new URL(t.url);
    assert.equal(url.origin, 'https://sml-platform-api.onrender.com');
    assert.equal(url.searchParams.get('popout'), 'scanner'); assert.equal(url.searchParams.get('symbol'), 'NVDA');
    const ticket = url.hash.replace('#pt=', '');
    assert.ok(!url.search.includes(ticket), 'the ticket never rides in the query');
    const ex = await (await json(base, '/academy-activity/popout/exchange', { ticket })).json();
    assert.equal(ex.ok, true); assert.equal(ex.tier, 'member'); assert.equal(oauth.verifySession('Bearer ' + ex.sessionToken).userId, U);
    assert.equal((await json(base, '/academy-activity/popout/exchange', { ticket })).status, 401, 'single use');
    const r1 = await (await json(base, '/academy-activity/popout/renew', { renew: ex.renew })).json();
    assert.equal(r1.tier, 'academy', 'renewal takes the access level as it is now');
    tierNow = 'none';
    const ended = await json(base, '/academy-activity/popout/renew', { renew: r1.renew });
    assert.equal(ended.status, 403); assert.equal((await ended.json()).error, 'access_ended');
    tierNow = 'free';
    assert.equal((await json(base, '/academy-activity/popout/renew', { renew: r1.renew })).status, 403, 'free sessions off: a free member cannot keep a pop-out');

    // link bus: my window hears my other window, never another member's
    const ctrl = new AbortController();
    const stream = await fetch(base + '/academy-activity/popout/bus', { headers: { authorization: 'Bearer ' + session }, signal: ctrl.signal });
    const reader = stream.body.getReader();
    await reader.read(); // ': linked'
    const other = oauth.issuePopoutSession(V, 'member');
    assert.equal((await (await json(base, '/academy-activity/popout/bus', { symbol: 'TSLA', from: 'x' }, other)).json()).delivered, 0);
    assert.equal((await (await json(base, '/academy-activity/popout/bus', { symbol: 'amd', from: 'w2' }, session)).json()).delivered, 1);
    const chunk = new TextDecoder().decode((await reader.read()).value);
    assert.match(chunk, /"symbol":"AMD"/); assert.doesNotMatch(chunk, /TSLA/);
    ctrl.abort();
  });
  await withServer({}, async (base) => {
    assert.equal((await fetch(base + '/academy-activity/popout/exchange', { method: 'POST' })).status, 503);
  });
});

test('market direction: Academy route needs a session, the site route needs the billing signature', async () => {
  const crypto = require('node:crypto');
  const { createAcademyOAuth } = require('./academy-oauth');
  const oauth = createAcademyOAuth({ clientId: 'c', clientSecret: 's', academyAccess: { verify: async () => ({ ok: true }) } });
  const asked = [];
  const marketDirection = { get: async (mode) => { asked.push(mode); return { ok: true, mode, label: 'Neutral', bias: 0 }; } };
  const secret = 'billing-test-secret';
  const signed = (base, payload) => { const raw = JSON.stringify(payload), ts = 1_700_000_000; return fetch(base + '/v1/group-tools/direction', { method: 'POST', headers: { 'content-type': 'application/json', 'x-sml-timestamp': String(ts), 'x-sml-signature': crypto.createHmac('sha256', secret).update(`${ts}.${raw}`, 'utf8').digest('hex') }, body: raw }); };
  await withServer({ academyOAuth: oauth, marketDirection, billingApiSecret: secret }, async (base) => {
    assert.equal((await fetch(base + '/academy-activity/direction')).status, 401);
    const token = oauth.issuePopoutSession('420000000000000042', 'free');
    const day = await (await fetch(base + '/academy-activity/direction?mode=day', { headers: { authorization: 'Bearer ' + token } })).json();
    assert.equal(day.mode, 'day');
    assert.equal((await fetch(base + '/academy-activity/direction?mode=swing', { headers: { authorization: 'Bearer ' + token } })).status, 200);
    assert.ok([400, 401].includes((await fetch(base + '/v1/group-tools/direction', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status), 'unsigned is refused');
    assert.equal((await (await signed(base, { mode: 'swing' })).json()).mode, 'swing');
    assert.deepEqual(asked, ['day', 'swing', 'swing']);
  });
});

test('unusual volume (Academy): needs a session and returns the whole-market list', async () => {
  const { createAcademyOAuth } = require('./academy-oauth');
  const oauth = createAcademyOAuth({ clientId: 'c', clientSecret: 's', academyAccess: { verify: async () => ({ ok: true }) } });
  const marketDirection = { get: async () => ({ ok: true }), unusualVolume: async () => ({ ok: true, session: 'pre', asOf: 1, universe: 6500, rows: [{ sym: 'MEDS', ratio: 13.4, vol: 4858168, chg: 16 }] }) };
  await withServer({ academyOAuth: oauth, marketDirection }, async (base) => {
    assert.equal((await fetch(base + '/academy-activity/unusual-volume')).status, 401);
    const token = oauth.issuePopoutSession('420000000000000042', 'free');
    const j = await (await fetch(base + '/academy-activity/unusual-volume', { headers: { authorization: 'Bearer ' + token } })).json();
    assert.equal(j.rows[0].sym, 'MEDS');
  });
});

test('SML VIX (Academy): needs a session; returns the level, history and change since the open', async () => {
  const { createAcademyOAuth } = require('./academy-oauth');
  const oauth = createAcademyOAuth({ clientId: 'c', clientSecret: 's', academyAccess: { verify: async () => ({ ok: true }) } });
  const academySmlVix = { get: async () => ({ ok: true, level: 15.14, asOf: 1, terms: [] }), history: () => [{ t: Date.now(), level: 15.14 }], changeSince: () => ({ from: 15, to: 15.14, change: 0.14, pct: 0.93 }) };
  await withServer({ academyOAuth: oauth, academySmlVix }, async (base) => {
    assert.equal((await fetch(base + '/academy-activity/vix')).status, 401);
    const token = oauth.issuePopoutSession('420000000000000042', 'free');
    const j = await (await fetch(base + '/academy-activity/vix', { headers: { authorization: 'Bearer ' + token } })).json();
    assert.equal(j.level, 15.14); assert.equal(j.history.length, 1);
  });
  await withServer({ academyOAuth: oauth }, async (base) => {
    const token = oauth.issuePopoutSession('420000000000000042', 'free');
    assert.equal((await fetch(base + '/academy-activity/vix', { headers: { authorization: 'Bearer ' + token } })).status, 503);
  });
});

test('Hedge & Income (Academy): session required, free tier refused, members get ideas with cleaned inputs', async () => {
  const academyOAuth = { verifySession: (a) => (a === 'Bearer member' ? { ok: true, userId: 'u1', tier: 'member' } : a === 'Bearer free' ? { ok: true, userId: 'u2', tier: 'free' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const asked = [];
  const academyHedge = { plan: async (q) => { asked.push(q); return { ok: true, symbol: q.symbol, ideas: [{ kind: 'protective_put' }], disclaimer: 'Educational' }; } };
  await withServer({ academyOAuth, academyHedge }, async (base) => {
    assert.equal((await fetch(base + '/academy-activity/hedge?symbol=AAPL')).status, 401);
    const free = await fetch(base + '/academy-activity/hedge?symbol=AAPL', { headers: { authorization: 'Bearer free' } });
    assert.equal(free.status, 403); assert.match((await free.json()).message, /Academy/);
    assert.equal((await fetch(base + '/academy-activity/hedge?symbol=%3Cx%3E', { headers: { authorization: 'Bearer member' } })).status, 400);
    const r = await fetch(base + '/academy-activity/hedge?symbol=aapl&shares=250&entry=180&stop=-4&horizon=long&dir=bear&strength=900&side=short', { headers: { authorization: 'Bearer member' } });
    assert.equal(r.status, 200);
    const j = await r.json(); assert.equal(j.ideas[0].kind, 'protective_put');
    const q = asked[0];
    assert.equal(q.symbol, 'AAPL'); assert.equal(q.shares, 250); assert.equal(q.entry, 180); assert.equal(q.stop, null); assert.equal(q.target, null);
    assert.equal(q.horizon, 'long'); assert.equal(q.dir, 'bear'); assert.equal(q.strength, 100); assert.equal(q.side, 'short'); assert.equal(q.userId, 'u1'); assert.equal(q.view, 'live');
  });
  await withServer({ academyOAuth }, async (base) => {
    assert.equal((await fetch(base + '/academy-activity/hedge?symbol=AAPL', { headers: { authorization: 'Bearer member' } })).status, 503);
  });
});

test('stockmarketloop.com dashboard: signed hedge and contract-alert preview routes (no Academy session, desks never read)', async () => {
  const secret = 'billing-test-secret';
  const post = (base, path, payload) => { const raw = JSON.stringify(payload), ts = 1_700_000_000; return fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sml-timestamp': String(ts), 'x-sml-signature': crypto.createHmac('sha256', secret).update(`${ts}.${raw}`, 'utf8').digest('hex') }, body: raw }); };
  const asked = [], previews = [];
  const academyHedge = { plan: async (q) => { asked.push(q); return { ok: true, symbol: q.symbol, ideas: [{ kind: 'collar' }] }; } };
  const academyClickAlert = { sitePreview: async (q) => { previews.push(q); return q.contract.strike === 999 ? { ok: false, status: 404, code: 'contract_not_found', detail: 'gone' } : { ok: true, analysis: { target: 110 }, scenarios: { images: [{ svg: '<svg/>' }, { svg: '<svg/>' }] } }; } };
  await withServer({ academyHedge, academyClickAlert, billingApiSecret: secret }, async (base) => {
    // unsigned is refused
    assert.ok([400, 401].includes((await fetch(base + '/v1/group-tools/hedge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"symbol":"AAPL"}' })).status));
    assert.ok([400, 401].includes((await fetch(base + '/v1/group-tools/contract-alert-preview', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"symbol":"AAPL"}' })).status));
    assert.equal((await post(base, '/v1/group-tools/hedge', { symbol: '<x>' })).status, 400);
    const r = await post(base, '/v1/group-tools/hedge', { symbol: 'aapl', shares: 250, entry: 180, target: 'x', stop: -4, horizon: 'long', side: 'short', dir: 'bear', strength: 900, userId: 'smuggled', view: 'live' });
    assert.equal(r.status, 200); assert.equal((await r.json()).ideas[0].kind, 'collar');
    const q = asked[0];
    assert.equal(q.symbol, 'AAPL'); assert.equal(q.shares, 250); assert.equal(q.entry, 180); assert.equal(q.target, null); assert.equal(q.stop, null);
    assert.equal(q.horizon, 'long'); assert.equal(q.side, 'short'); assert.equal(q.dir, 'bear'); assert.equal(q.strength, 100);
    assert.equal(q.noAlerts, true); assert.equal(q.userId, null); assert.equal(q.view, 'site', 'a caller cannot ask for an Academy desk');
    assert.equal((await post(base, '/v1/group-tools/hedge', { symbol: 'AAPL' })).status, 200);
    assert.equal(asked[1].strength, null); assert.equal(asked[1].horizon, 'swing'); assert.equal(asked[1].shares, 100);
    // contract preview
    assert.equal((await post(base, '/v1/group-tools/contract-alert-preview', { symbol: 'AAPL', contract: { type: 'x', strike: 100, expiry: '2026-11-20' } })).status, 400);
    assert.equal((await post(base, '/v1/group-tools/contract-alert-preview', { symbol: 'AAPL', contract: { type: 'call', strike: 100, expiry: 'soon' } })).status, 400);
    const ok = await post(base, '/v1/group-tools/contract-alert-preview', { symbol: 'aapl', contract: { type: 'call', strike: '100', expiry: '2026-11-20', extra: 1 } });
    assert.equal(ok.status, 200); assert.equal((await ok.json()).scenarios.images.length, 2);
    assert.deepEqual(previews[0], { symbol: 'AAPL', contract: { type: 'call', strike: 100, expiry: '2026-11-20' }, chainData: null });
    const gone = await post(base, '/v1/group-tools/contract-alert-preview', { symbol: 'AAPL', contract: { type: 'put', strike: 999, expiry: '2026-11-20' } });
    assert.equal(gone.status, 404); assert.deepEqual(await gone.json(), { ok: false, error: 'contract_not_found', detail: 'gone' });
  });
  await withServer({ billingApiSecret: secret }, async (base) => {
    assert.equal((await post(base, '/v1/group-tools/hedge', { symbol: 'AAPL' })).status, 503);
    assert.equal((await post(base, '/v1/group-tools/contract-alert-preview', { symbol: 'AAPL', contract: { type: 'call', strike: 1, expiry: '2026-11-20' } })).status, 503);
  });
});

test('the StockMarketLoop app shell is served at /app/: page with manifest and service worker, scoped worker headers, manifest, PNG icons, and a 404 for anything else', async () => {
  await withServer({}, async (base) => {
    const page = await fetch(`${base}/app/`);
    assert.equal(page.status, 200); assert.match(page.headers.get('content-type'), /text\/html/);
    assert.match(page.headers.get('content-security-policy') || '', /script-src 'self'/);
    const html = await page.text();
    for (const marker of ['rel="manifest" href="/app/manifest.webmanifest"', 'src="/app/app.js"', 'apple-mobile-web-app-capable', 'StockMarketLoop']) assert.ok(html.includes(marker), marker);
    const redirect = await fetch(`${base}/app?x=1`, { redirect: 'manual' });
    assert.equal(redirect.status, 301); assert.equal(redirect.headers.get('location'), '/app/?x=1');
    const sw = await fetch(`${base}/app/sw.js`);
    assert.equal(sw.status, 200); assert.equal(sw.headers.get('service-worker-allowed'), '/app/'); assert.match(sw.headers.get('cache-control'), /no-cache/);
    assert.match(await sw.text(), /addEventListener\('push'/);
    const js = await fetch(`${base}/app/app.js`); assert.equal(js.status, 200); assert.match(js.headers.get('content-type'), /javascript/);
    const script = await js.text();
    for (const marker of ['/auth/login', '/auth/refresh', '/scanner/stream', 'access_token=', '/push/devices', '/tickers/', 'beforeinstallprompt']) assert.ok(script.includes(marker), marker);
    const css = await fetch(`${base}/app/app.css`); assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /text\/css/);
    const man = await (await fetch(`${base}/app/manifest.webmanifest`)).json();
    assert.equal(man.scope, '/app/'); assert.equal(man.start_url, '/app/'); assert.equal(man.display, 'standalone'); assert.equal(man.icons.length, 3);
    for (const name of ['icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']) {
      const r = await fetch(`${base}/app/${name}`); assert.equal(r.status, 200, name); assert.equal(r.headers.get('content-type'), 'image/png');
      const buf = Buffer.from(await r.arrayBuffer()); assert.equal(buf.toString('hex', 0, 8), '89504e470d0a1a0a', name + ' is a PNG');
    }
    assert.equal((await fetch(`${base}/app/nope.js`)).status, 404);
    assert.equal((await fetch(`${base}/app/../server.js`)).status, 404);
  });
});

test('the alerts desk buttons: New PT and Sell post through the service as a reply, only on the member own alerts (any alert for the owner), and the desk learns who is looking', async () => {
  const calls = [];
  const rec = { id: '900000000000000009', symbol: 'GDC', entry: 2, target: 2.33, at: 1, source: 'swings', authorId: 'sub' };
  const academyAlerts = {
    snapshot: () => ({ ok: true, asOf: 1, feed: {}, alerts: [{ id: rec.id, symbol: 'GDC', authorId: 'sub', channelId: '111' }], pending: 0 }),
    detail: async () => null,
    alerts: new Map([[rec.id, rec]]), evaluated: new Map([[rec.id, { plan: { action: 'RAISE_TARGET', target: 2.6, stop: 2.2, reasons: ['Target 2.33 was reached'] } }]]),
    channelIdFor: (key) => (key === 'swings' ? '111' : '')
  };
  const academyClickAlert = { deskAction: async (user, args) => { calls.push({ user, args }); return args.action === 'sell' ? { ok: true, messageId: '2', repliedTo: rec.id, gainPct: 5, partial: false } : { ok: true, messageId: '3', repliedTo: rec.id, smashed: true }; } };
  const academyOAuth = { verifySession: (a) => (a === 'Bearer sub' ? { ok: true, userId: 'sub', tier: 'academy', displayName: 'Ana' } : a === 'Bearer other' ? { ok: true, userId: 'other', tier: 'academy' } : a === 'Bearer owner' ? { ok: true, userId: '1087769175453339648', tier: 'academy', displayName: 'Obi' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const json = (t) => ({ authorization: 'Bearer ' + t, 'content-type': 'application/json' });
  await withServer({ academyAlerts, academyClickAlert, academyOAuth }, async (base) => {
    const u = `${base}/academy-activity/click-alert/desk`;
    assert.equal((await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    assert.equal((await fetch(u, { method: 'POST', headers: { authorization: 'Bearer sub' }, body: '{}' })).status, 415);
    assert.equal((await fetch(u, { method: 'POST', headers: json('sub'), body: JSON.stringify({ alertId: rec.id, action: 'nope' }) })).status, 400);
    assert.equal((await fetch(u, { method: 'POST', headers: json('sub'), body: JSON.stringify({ alertId: '1', action: 'sell' }) })).status, 404);
    const notMine = await fetch(u, { method: 'POST', headers: json('other'), body: JSON.stringify({ alertId: rec.id, action: 'sell' }) });
    assert.equal(notMine.status, 403); assert.equal((await notMine.json()).error, 'not_your_alert'); assert.equal(calls.length, 0);
    const sold = await fetch(u, { method: 'POST', headers: json('sub'), body: JSON.stringify({ alertId: rec.id, action: 'sell' }) });
    assert.equal(sold.status, 200); assert.equal((await sold.json()).repliedTo, rec.id);
    assert.deepEqual(calls[0].user, { userId: 'sub', displayName: 'Ana' });
    assert.equal(calls[0].args.action, 'sell'); assert.equal(calls[0].args.alert.channelId, '111'); assert.equal(calls[0].args.alert.plan.action, 'RAISE_TARGET'); assert.equal(calls[0].args.asMe, true);
    const pt = await fetch(u, { method: 'POST', headers: json('owner'), body: JSON.stringify({ alertId: rec.id, action: 'pt', target: 2.6, mention: false }) });
    assert.equal(pt.status, 200, 'the owner may update any alert'); assert.equal(calls[1].args.target, 2.6); assert.equal(calls[1].args.mention, false);
    const me = await (await fetch(`${base}/academy-activity/alerts`, { headers: { authorization: 'Bearer owner' } })).json();
    assert.deepEqual(me.me, { userId: '1087769175453339648', owner: true });
    assert.deepEqual((await (await fetch(`${base}/academy-activity/alerts`, { headers: { authorization: 'Bearer sub' } })).json()).me, { userId: 'sub', owner: false });
  });
  await withServer({ academyAlerts, academyOAuth }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/click-alert/desk`, { method: 'POST', headers: json('sub'), body: '{}' })).status, 503, 'off without the service');
  });
});

test('Academy profile song upload: raw bytes from a signed-in member are checked by their first bytes, kept, and played back through the Academy with seeking', async () => {
  const { createProfilePages } = require('./academy-profile-pages');
  const ME = '123456789012345678';
  const academyOAuth = { verifySession: (authorization) => authorization === 'Bearer academy-session' ? { ok: true, userId: ME } : { ok: false, status: 401, code: 'authorization_required' } };
  const academyProfilePages = createProfilePages({});
  const mp3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(3000, 7)]);
  await withServer({ academyOAuth, academyProfilePages }, async (base) => {
    const post = (body, token = 'academy-session', qs = '') => fetch(`${base}/academy-activity/profiles/audio-upload${qs}`, { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'audio/mpeg' }, body });
    assert.equal((await post(mp3, 'nope')).status, 401, 'signed-in members only');
    const bad = await post(Buffer.from('this is plain text, not a song'.repeat(80)));
    assert.equal(bad.status, 400); assert.equal((await bad.json()).error, 'not_audio');
    const huge = await post(Buffer.concat([Buffer.from('ID3'), Buffer.alloc(51 * 1024 * 1024)]));
    assert.equal(huge.status, 413);
    const ok = await post(mp3, 'academy-session', '?title=My%20Track');
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.deepEqual([body.ok, body.song.kind, body.song.upload, body.song.title], [true, 'audio', true, 'My Track']);
    const full = await fetch(`${base}/academy-activity/profiles/${ME}/audio?t=academy-session`);
    assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'audio/mpeg'); assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(Buffer.from(await full.arrayBuffer()).length, mp3.length);
    const part = await fetch(`${base}/academy-activity/profiles/${ME}/audio?t=academy-session`, { headers: { range: 'bytes=10-19' } });
    assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), `bytes 10-19/${mp3.length}`); assert.equal(Buffer.from(await part.arrayBuffer()).length, 10);
    assert.equal((await fetch(`${base}/academy-activity/profiles/${ME}/audio`)).status, 401, 'playing a song needs a session too');
    /* replacing the song with a link removes the stored file */
    const put = await fetch(`${base}/academy-activity/profiles/me`, { method: 'PUT', headers: { authorization: 'Bearer academy-session', 'content-type': 'application/json' }, body: JSON.stringify({ song: { url: 'https://open.spotify.com/track/abc123' } }) });
    assert.equal(put.status, 200);
    assert.equal((await fetch(`${base}/academy-activity/profiles/${ME}/audio?t=academy-session`)).status, 404);
  });
});

test('mobile scanner stays put: phone columns are built directly, live refreshes patch cells in place and only re-sort when idle, the page height never follows the browser toolbar', async () => {
  await withServer({}, async (base) => {
    const html = await (await fetch(`${base}/academy-activity/`)).text();
    assert.match(html, /function phoneCols\(c\)\{return phoneMQ\.matches\?c\.filter/, 'phone columns are chosen while rendering, not hidden afterwards');
    assert.match(html, /const cols=phoneCols\(columns\[preset\]\|\|columns\.full\)/);
    assert.match(html, /function softRender\(\)\{const quiet=Date\.now\(\)-\(window\.__smlScanTouch\|\|0\)>5000&&Date\.now\(\)-lastSort>20000/, 'a refresh re-sorts only after 5 s without touch and 20 s since the last sort');
    assert.match(html, /rows=payload\.rows;overlayLive\(\);softRender\(\)/, 'the 4 s refresh no longer rebuilds the table');
    assert.doesNotMatch(html, /main\{height:calc\(100dvh - 86px\)/, 'the page frame uses the small viewport height so it does not resize while the toolbar slides');
    assert.match(html, /height:calc\(100svh - 86px\)/);
    assert.match(html, /table-layout:fixed;font-size:\.62rem;font-variant-numeric:tabular-nums/, 'phone table has fixed columns and equal-width digits');
    assert.match(html, /records\.every\(\(r\) => \{ const t = r\.target/, 'live cell ticks do not trigger the compact-layout pass');
  });
});

test('Academy sign-in: a silent renewal survives the SDK saying "Already authenticated", diagnostics do not flood, and the Lessons button closes the rail it opened', () => {
  const html = require('./server').academyActivityHtml({ symbol: 'SPY', bars: [] }, { appId: '1551336038713139370' });
  const script = (html.match(/<script type="module">([\s\S]*?)<\/script>/) || [])[1] || '';
  assert.match(script, /already authenticated/i, 'the SDK accepts authenticate once per Activity; the second time is not a failure');
  assert.match(script, /__academySdkAuthed/, 'authenticate is not sent again once it has succeeded');
  assert.match(script, /academyDiagSeen/, 'each diagnostic stage beacons a bounded number of times');
  assert.match(html, /lesson-toggle'\)\.onclick=\(\)=>\{if\(lesson\.classList\.contains\('open'\)\)\{lesson\.classList\.remove\('open'\)/, 'Lessons toggles closed as well as open');
  /* the SDK refuses a second authorize too ("Already authenticated"), so a renewal never calls the SDK: the signed key from sign-in goes to /academy-activity/renew */
  assert.match(script, /if\(window\.smlAcademyRenewKey\)return academyRenew\(\)/, 'a renewal uses the key, not the SDK');
  assert.match(script, /fetch\('\/academy-activity\/renew'/);
  assert.match(script, /if\(payload\.renew\)window\.smlAcademyRenewKey=payload\.renew/, 'the token response hands over the renewal key');
  assert.match(script, /academyReloadForSignIn/, 'with no key left, an authorize refused as already authenticated reloads the page once a minute');
  assert.match(script, /payload\.error==='access_ended'\?'academy_role_required'/, 'a refused renewal shows the access notice, not the pop-out one');
  const gated = require('./server').academyActivityHtml({ symbol: 'SPY', bars: [] }, { appId: '1551336038713139370', gate: { contentGate: true, links: true } });
  assert.match(gated, /path==='\/academy-activity\/token'\|\|path==='\/academy-activity\/renew'/, 'the gate client reads the tier from a renewal too');
  const intent = fs.readFileSync(path.join(__dirname, 'academy-smart-intent-ui.js'), 'utf8');
  assert.match(intent, /res\.status === 401 && typeof window\.smlAcademyReauth === 'function'/, 'INTENT renews an expired session and reads again');
});

test('Activity renewal: the token response carries a renewal key; /academy-activity/renew re-checks access and issues a new session without the SDK', async () => {
  const { createAcademyOAuth } = require('./academy-oauth');
  const U = '420000000000000042';
  const oauth = createAcademyOAuth({ clientId: 'c', clientSecret: 's', academyAccess: { verify: async () => ({ ok: true, userId: U, tier: 'member' }) },
    fetchImpl: async (url) => (String(url).includes('/oauth2/token') ? new Response(JSON.stringify({ access_token: 'discord-access' }), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response(JSON.stringify({ global_name: 'Obi' }), { status: 200, headers: { 'content-type': 'application/json' } })) });
  let tierNow = 'member';
  const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await withServer({ academyOAuth: oauth, academyTierLive: async () => tierNow }, async (base) => {
    const signedIn = await (await post(base, '/academy-activity/token', { code: 'discord-code' })).json();
    assert.equal(signedIn.ok, true);
    assert.match(signedIn.renew, /^p1\./, 'the renewal key rides in the token response body');
    assert.equal(oauth.verifySession('Bearer ' + signedIn.renew).ok, false, 'the key is never a session');
    const renewed = await post(base, '/academy-activity/renew', { renew: signedIn.renew });
    assert.equal(renewed.status, 200);
    const r = await renewed.json();
    assert.equal(r.ok, true); assert.equal(r.tier, 'member'); assert.equal(r.displayName, 'Obi');
    assert.deepEqual(oauth.verifySession('Bearer ' + r.sessionToken), { ok: true, userId: U, tier: 'member', displayName: 'Obi' }, 'a renewed session is an ordinary session');
    assert.match(r.renew, /^p1\./, 'and a fresh key comes with it');
    tierNow = 'academy';
    assert.equal((await (await post(base, '/academy-activity/renew', { renew: r.renew })).json()).tier, 'academy', 'the renewal takes the access level as it is now');
    tierNow = 'none';
    const ended = await post(base, '/academy-activity/renew', { renew: r.renew });
    assert.equal(ended.status, 403); assert.equal((await ended.json()).error, 'access_ended');
    tierNow = 'free';
    assert.equal((await post(base, '/academy-activity/renew', { renew: r.renew })).status, 403, 'free sessions off: a free member gets no session');
    assert.equal((await post(base, '/academy-activity/renew', { renew: 'p1.bogus.sig' })).status, 401);
    assert.equal((await post(base, '/academy-activity/renew', { renew: r.sessionToken })).status, 401, 'a session is not a renewal key');
    assert.equal((await post(base, '/academy-activity/renew', {})).status, 401);
    assert.equal((await fetch(base + '/academy-activity/renew', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'x' })).status, 415);
  });
  await withServer({ academyOAuth: { verifySession: () => ({ ok: false, status: 401, code: 'authorization_required' }) } }, async (base) => {
    assert.equal((await post(base, '/academy-activity/renew', { renew: 'x' })).status, 503, 'no renewal keys configured: fails closed');
  });
});

test('Ask Obi is the owner\'s only: members get 403, the owner gets the answer, nobody anonymous gets in', async () => {
  const academyAsk = { configured: true, owners: new Set(['100000000000000001']), ask: async ({ question, userId }) => ({ answer: 'Here is the thing about ' + question + ', ' + userId + '.', sources: [{ source: '0.1', title: 'What a Share Actually Is' }], model: 'm', passages: 3 }) };
  const academyOAuth = { verifySession: (a) => (a === 'Bearer owner' ? { ok: true, userId: '100000000000000001', tier: 'member' } : a === 'Bearer member' ? { ok: true, userId: '100000000000000002', tier: 'academy' } : { ok: false, status: 401, code: 'authorization_required' }) };
  await withServer({ academyAsk, academyOAuth }, async (base) => {
    const anon = await fetch(`${base}/academy-activity/ask`); assert.equal(anon.status, 401);
    const who = await fetch(`${base}/academy-activity/ask`, { headers: { authorization: 'Bearer member' } });
    assert.deepEqual(await who.json(), { ok: true, owner: false, configured: false });
    const denied = await fetch(`${base}/academy-activity/ask`, { method: 'POST', headers: { authorization: 'Bearer member', 'content-type': 'application/json' }, body: JSON.stringify({ question: 'what is a share' }) });
    assert.equal(denied.status, 403); assert.equal((await denied.json()).error, 'owner_only');
    const me = await fetch(`${base}/academy-activity/ask`, { headers: { authorization: 'Bearer owner' } });
    assert.deepEqual(await me.json(), { ok: true, owner: true, configured: true });
    const empty = await fetch(`${base}/academy-activity/ask`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ question: '  ' }) });
    assert.equal(empty.status, 400);
    const ok = await fetch(`${base}/academy-activity/ask`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ question: 'what is a share' }) });
    assert.equal(ok.status, 200);
    const j = await ok.json();
    assert.match(j.answer, /what is a share, 100000000000000001/); assert.equal(j.sources[0].source, '0.1');
  });
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m', bars: [], scanner: { rows: [] }, depth: { bids: [], asks: [] } }, {});
  assert.match(html, /academy-ask-btn/, 'the Ask Obi script ships with the page');
  assert.match(html, /'academy-ask-btn', 'academy-profile-btn'/, 'and its button docks in the top-bar rail');
});


test('the free trial pages are served without a session and send the visitor to Discord', async () => {
  const { createAcademyTrial } = require('./academy-trial');
  const { createPassStore } = require('./academy-passes');
  const academyTrial = createAcademyTrial({ clientId: '1551336038713139370', clientSecret: 's', publicUrl: 'https://academy.example', store: createPassStore() });
  await withServer({ academyTrial }, async (base) => {
    const landing = await fetch(`${base}/academy-activity/trial?via=x`);
    assert.equal(landing.status, 200); assert.match(await landing.text(), /FREE TRIAL · 15 DAYS/);
    const start = await fetch(`${base}/academy-activity/trial/start`, { redirect: 'manual' });
    assert.equal(start.status, 302); assert.match(start.headers.get('location'), /^https:\/\/discord\.com\/oauth2\/authorize\?/);
    const bad = await fetch(`${base}/academy-activity/trial/callback?code=x&state=bad`);
    assert.equal(bad.status, 400);
  });
  await withServer({}, async (base) => {
    const none = await fetch(`${base}/academy-activity/trial`);
    assert.notEqual(none.status, 200, 'without the trial module the path is not a trial page');
  });
});

test('the option-bars route serves one contract\'s candles to members only, with strict contract validation', async () => {
  await withServer({}, async (base) => { assert.equal((await fetch(`${base}/academy-activity/option-bars?contract=SPY251219C00600000`)).status, 503); });
  const academyOAuth = { verifySession: (auth) => (auth === 'Bearer member' ? { ok: true, tier: 'academy' } : auth === 'Bearer free' ? { ok: true, tier: 'free' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const { createMassiveOptionBars } = require('./market-data-service');
  const optionBars = createMassiveOptionBars({ apiKey: 'k', fetchImpl: async () => new Response(JSON.stringify({ results: [{ t: 1000, o: 3, h: 3.5, l: 2.9, c: 3.4, v: 10 }] }), { status: 200 }) });
  await withServer({ academyOAuth, optionBars }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/option-bars?contract=SPY251219C00600000`)).status, 401);
    assert.equal((await fetch(`${base}/academy-activity/option-bars?contract=SPY251219C00600000`, { headers: { authorization: 'Bearer free' } })).status, 403);
    const ok = await fetch(`${base}/academy-activity/option-bars?contract=spy251219c00600000&tf=1h`, { headers: { authorization: 'Bearer member' } });
    assert.equal(ok.status, 200); const body = await ok.json();
    assert.equal(body.ok, true); assert.equal(body.contract, 'SPY251219C00600000'); assert.equal(body.tf, '1h'); assert.equal(body.bars[0].c, 3.4);
    const bad = await fetch(`${base}/academy-activity/option-bars?contract=SPY`, { headers: { authorization: 'Bearer member' } });
    assert.equal(bad.status, 400); assert.equal((await bad.json()).error, 'invalid_contract');
    assert.equal((await fetch(`${base}/academy-activity/option-bars?contract=SPY251219C00600000&tf=3m`, { headers: { authorization: 'Bearer member' } })).status, 400);
  });
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m' });
  assert.match(html, /id = 'chain-toggle'/, 'the CHAIN switch puts the options chain where the candles are');
  assert.match(html, /id = 'opt-mini'/, 'the contract mini chart card is on the page');
  assert.match(html, /academy-activity\/option-bars\?contract=/);
  assert.match(html, /window\.SmlBuyPrefs=module\.exports/, 'the buy-button preferences core is on the page');
  assert.match(html, /sml-settings-btn/, 'the Settings button sits beside Customize');
  assert.match(html, /'sml-settings-btn', 'aa-btn'/, 'and docks in the top-bar rail with it');
  assert.match(html, /data-leg-trade=/, 'hedge legs carry Buy / Sell buttons');
  assert.match(html, /'#opt-mini'\]/, 'the chart dock can hold the mini chart');
  assert.match(html, /#intent-layer\{[^}]*background:none/, 'the intent layer must not inherit the opaque canvas gradient that would cover the candles');
  assert.match(html, /window\.smlChartLock = \{/, 'the chart lock (nothing moves or shrinks the live chart) ships with the chart page');
  assert.match(html, /window\.smlLoopKick = \{/, 'LOOP-KICK exposes its panel, grip and badge to the Academy notifications feed');
  assert.match(html, /window\.smlViz = \{/, 'the chart kit (one look for every graph, bar, meter and pie) ships with the page');
  assert.ok(html.indexOf('window.smlViz = {') < html.indexOf('paper-donut') && html.indexOf('window.smlViz = {') < html.indexOf('earnings-insight'), 'and loads before the modules that draw with it');
  assert.match(html, /window\.smlAcademyNotify = \{/, 'the Academy notifications feed (followers, wall comments, posts by followed traders, likes) ships inside LOOP-KICK');
  assert.ok(html.indexOf('window.smlLoopKick = {') < html.indexOf('window.__smlSocialNotifyUi'), 'the feed loads after the LOOP-KICK module it attaches to');
  assert.match(html, /LK\.send\('academy-notifications'/, 'the feed hands its items to the phone, which shows them in its own Alerts tab');
  assert.match(html, /d\.type\.indexOf\('sml-loop-kick:academy-'\) === 0/, 'the phone\'s taps on Academy alerts (read, open, follow back) come back to the page');
  assert.match(html, /data-like="' \+ esc\(c\.id\)/, 'Ticker Talk comments carry a like button');
  assert.match(html, /data-pv="walllike"/, 'Trading Wall comments carry a like button');
  assert.ok(html.indexOf('window.smlChartLock = {') < html.indexOf('const DOCKABLE = ['), 'the chart lock is defined before the chart dock reads it');
  assert.match(html, /Reset this paper account to ' \+ \(S\.account === 'challenge' \? '\$1,000' : '\$25,000'\)/, 'the paper trader starts members at $25,000');
  assert.doesNotMatch(html, PAGE_BANNED);
});

test('the profile page shows a member\'s Ticker Talk comments, chat posts and stockmarketloop.com activity as one Activity module', () => {
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m' });
  assert.match(html, /tabs\.push\(\['talk', 'Ticker Talk'/, 'the Activity module has a Ticker Talk tab');
  assert.match(html, /data-pv="talksend"/, 'a comment can be replied to from the profile');
  assert.match(html, /Open on stockmarketloop\.com/, 'site items open on the site');
  assert.match(html, /window\.smlAcademyChatOpen = /, 'a chat post opens its room');
  assert.match(html, /openComment, state:/, 'Ticker Talk can bring one comment into view');
  assert.match(html, /\['showTalk', 'My Ticker Talk comments'\]/);
  assert.doesNotMatch(html, PAGE_BANNED);
});

test('the Ticker Talk routes use the service createServer is given (and say so when there is none)', async () => {
  const academyOAuth = { verifySession: (auth) => (auth === 'Bearer member' ? { ok: true, tier: 'academy', userId: '100000000000000001', displayName: 'Obi' } : { ok: false, status: 401, code: 'authorization_required' }) };
  await withServer({ academyOAuth }, async (base) => { assert.equal((await fetch(`${base}/academy-activity/talk/SPY/count`, { headers: { authorization: 'Bearer member' } })).status, 503, 'no service: a clean 503, not a thrown ReferenceError'); });
  const tickerTalk = require('./academy-ticker-talk').createTickerTalk({});
  await withServer({ academyOAuth, tickerTalk }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/talk/SPY/count`)).status, 401);
    const posted = await fetch(`${base}/academy-activity/talk/SPY`, { method: 'POST', headers: { authorization: 'Bearer member', 'content-type': 'application/json' }, body: JSON.stringify({ body: 'SPY holding 600' }) });
    assert.equal(posted.status, 200); const c = (await posted.json()).comment; assert.equal(c.symbol, 'SPY'); assert.equal(c.authorName, 'Obi');
    const count = await (await fetch(`${base}/academy-activity/talk/SPY/count`, { headers: { authorization: 'Bearer member' } })).json();
    assert.equal(count.count, 1);
    const list = await (await fetch(`${base}/academy-activity/talk/spy`, { headers: { authorization: 'Bearer member' } })).json();
    assert.equal(list.comments.length, 1); assert.equal(list.viewer.id, '100000000000000001');
  });
});

test('social notifications reach LOOP-KICK: a follow, a wall comment, a followed trader\'s post, a reply and a like each land in the inbox; likes ride with the Ticker Talk page', async () => {
  const ME = '100000000000000001', ACE = '100000000000000002';
  const sess = (id, name) => ({ ok: true, tier: 'academy', userId: id, displayName: name });
  const academyOAuth = { verifySession: (a) => (a === 'Bearer me' ? sess(ME, 'Me') : a === 'Bearer ace' ? sess(ACE, 'Ace') : { ok: false, status: 401, code: 'authorization_required' }) };
  const talk = require('./academy-ticker-talk').createTickerTalk({});
  const wall = require('./academy-profile-wall').createProfileWall({});
  const profiles = require('./academy-profile-pages').createProfilePages({ wall, talk: () => talk });
  const notify = require('./academy-social-notify').createSocialNotify({ profiles, talk, wall, names: async (id) => (id === ACE ? 'Ace' : id === ME ? 'Me' : '') });
  await withServer({ academyOAuth }, async (base) => { assert.equal((await fetch(`${base}/academy-activity/notify`, { headers: { authorization: 'Bearer me' } })).status, 503, 'no service: a clean 503'); });
  await withServer({ academyOAuth, tickerTalk: talk, academyProfilePages: profiles, academyProfileWall: wall, academySocialNotify: notify }, async (base) => {
    const me = { authorization: 'Bearer me' }, ace = { authorization: 'Bearer ace' }, json = { 'content-type': 'application/json' };
    assert.equal((await fetch(`${base}/academy-activity/notify`)).status, 401);
    assert.deepEqual((await (await fetch(`${base}/academy-activity/notify`, { headers: me })).json()).items, []);
    // Ace follows me, writes on my wall; I follow Ace, Ace posts on SPY and replies to my comment; Ace likes my comment
    assert.equal((await fetch(`${base}/academy-activity/profiles/${ME}/follow`, { method: 'POST', headers: ace })).status, 200);
    assert.equal((await fetch(`${base}/academy-activity/profiles/${ME}/wall`, { method: 'POST', headers: { ...ace, ...json }, body: JSON.stringify({ body: 'great calls' }) })).status, 200);
    assert.equal((await fetch(`${base}/academy-activity/profiles/${ACE}/follow`, { method: 'POST', headers: me })).status, 200);
    const mine = (await (await fetch(`${base}/academy-activity/talk/SPY`, { method: 'POST', headers: { ...me, ...json }, body: JSON.stringify({ body: 'SPY holding 600' }) })).json()).comment;
    assert.equal((await fetch(`${base}/academy-activity/talk/SPY`, { method: 'POST', headers: { ...ace, ...json }, body: JSON.stringify({ body: 'Ace on SPY' }) })).status, 200);
    assert.equal((await fetch(`${base}/academy-activity/talk/SPY`, { method: 'POST', headers: { ...ace, ...json }, body: JSON.stringify({ body: 'agreed', parentId: mine.id }) })).status, 200);
    const liked = await (await fetch(`${base}/academy-activity/likes`, { method: 'POST', headers: { ...ace, ...json }, body: JSON.stringify({ kind: 'talk', id: mine.id, on: true }) })).json();
    assert.equal(liked.ok, true); assert.equal(liked.likes, 1); assert.equal(liked.liked, true);
    assert.equal((await fetch(`${base}/academy-activity/likes`, { method: 'POST', headers: { ...ace, ...json }, body: JSON.stringify({ kind: 'talk', id: '999', on: true }) })).status, 404);
    await new Promise((r) => setTimeout(r, 60)); // the notifications are written off the request path
    const box = await (await fetch(`${base}/academy-activity/notify`, { headers: me })).json();
    assert.equal(box.ok, true); assert.equal(box.unread, 5);
    assert.deepEqual(box.items.map((x) => x.kind), ['like', 'reply', 'post', 'wall_comment', 'follow']);
    assert.ok(box.items.every((x) => x.actorId === ACE && x.actorName === 'Ace'), JSON.stringify(box.items));
    assert.equal(box.items[2].ref.symbol, 'SPY'); assert.equal(box.items[2].body, 'Ace on SPY'); assert.equal(box.items[3].body, 'great calls'); assert.equal(box.items[1].ref.rootId, mine.id);
    const aces = await (await fetch(`${base}/academy-activity/notify`, { headers: ace })).json();
    assert.deepEqual(aces.items.map((x) => x.kind + ':' + x.actorName), ['post:Me', 'follow:Me'], 'Ace hears about my follow and my SPY comment, nothing about Ace');
    // the Ticker Talk page carries the like counts, and the wall counts come from the likes route
    const page = await (await fetch(`${base}/academy-activity/talk/SPY`, { headers: me })).json();
    const row = page.comments.find((c) => c.id === mine.id); assert.equal(row.likes, 1); assert.equal(row.liked, false);
    const wl = await (await fetch(`${base}/academy-activity/likes?kind=wall&ids=1`, { headers: me })).json(); assert.deepEqual(wl.likes, { 1: { likes: 0, liked: false } });
    const read = await (await fetch(`${base}/academy-activity/notify/read`, { method: 'POST', headers: { ...me, ...json }, body: JSON.stringify({ ids: [box.items[0].id] }) })).json();
    assert.equal(read.unread, 4);
    assert.equal((await (await fetch(`${base}/academy-activity/notify/read`, { method: 'POST', headers: { ...me, ...json }, body: JSON.stringify({ all: true }) })).json()).unread, 0);
    assert.equal((await fetch(`${base}/academy-activity/notify`, { method: 'DELETE', headers: me })).status, 405);
  });
});

test('the earnings insight route serves the model, signals and brief to paid members, and the panel script is on the page', async () => {
  await withServer({}, async (base) => { assert.equal((await fetch(`${base}/academy-activity/earnings-insight?symbol=AAPL`)).status, 503); });
  const academyOAuth = { verifySession: (auth) => (auth === 'Bearer member' ? { ok: true, tier: 'academy', userId: '1' } : auth === 'Bearer free' ? { ok: true, tier: 'free' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const svc = { insight: async (s) => ({ ok: true, available: true, symbol: s, quarters: [], signals: [{ key: 'growth', tone: 'up', text: 'x' }], ai: { available: false, reason: 'ai_unconfigured' } }) };
  await withServer({ academyOAuth, getEarningsInsight: () => svc }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/earnings-insight?symbol=AAPL`)).status, 401);
    assert.equal((await fetch(`${base}/academy-activity/earnings-insight?symbol=AAPL`, { headers: { authorization: 'Bearer free' } })).status, 403);
    assert.equal((await fetch(`${base}/academy-activity/earnings-insight?symbol=bad!`, { headers: { authorization: 'Bearer member' } })).status, 400);
    const ok = await fetch(`${base}/academy-activity/earnings-insight?symbol=aapl`, { headers: { authorization: 'Bearer member' } });
    assert.equal(ok.status, 200); const body = await ok.json(); assert.equal(body.symbol, 'AAPL'); assert.equal(body.signals[0].key, 'growth');
  });
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m' });
  assert.match(html, /academy-activity\/earnings-insight\?symbol=/, 'the insight loads under the earnings calendar');
  assert.match(html, /EARNINGS INSIGHT/); assert.match(html, /data-ei="cost"/, 'the cost stack chart');
  assert.doesNotMatch(html, PAGE_BANNED);
});

test('the short insight route serves the two scores and the verdicts to paid members, and the panel reads it', async () => {
  await withServer({}, async (base) => { assert.equal((await fetch(`${base}/academy-activity/short-insight?symbol=AAPL`)).status, 503); });
  const academyOAuth = { verifySession: (auth) => (auth === 'Bearer member' ? { ok: true, tier: 'academy', userId: '1' } : auth === 'Bearer free' ? { ok: true, tier: 'free' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const svc = { insight: async (s) => ({ ok: true, available: true, symbol: s, pressing: { score: 70, components: [] }, squeeze: { score: 20, components: [] }, verdict: { shortSeller: { call: 'press', tone: 'up', reasons: [] }, long: { call: 'no', tone: 'down', reasons: [] } } }) };
  await withServer({ academyOAuth, getShortInsight: () => svc }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/short-insight?symbol=AAPL`)).status, 401);
    assert.equal((await fetch(`${base}/academy-activity/short-insight?symbol=AAPL`, { headers: { authorization: 'Bearer free' } })).status, 403);
    assert.equal((await fetch(`${base}/academy-activity/short-insight?symbol=../x`, { headers: { authorization: 'Bearer member' } })).status, 400);
    const ok = await fetch(`${base}/academy-activity/short-insight?symbol=aapl`, { headers: { authorization: 'Bearer member' } });
    assert.equal(ok.status, 200); const body = await ok.json(); assert.equal(body.symbol, 'AAPL'); assert.equal(body.pressing.score, 70);
  });
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m' });
  assert.match(html, /academy-activity\/short-insight\?symbol=/); assert.match(html, /SHORTS PRESSING/); assert.match(html, /SQUEEZE RISK/);
  assert.doesNotMatch(html, PAGE_BANNED);
});

test('the squeeze list is the owner\'s: the probe tells the page who is the owner, the list is refused to everyone else', async () => {
  const { OWNER_IDS } = require('./academy-free-users');
  const owner = OWNER_IDS[0] || '100000000000000009';
  const academyOAuth = { verifySession: (auth) => (auth === 'Bearer owner' ? { ok: true, tier: 'academy', userId: owner } : auth === 'Bearer member' ? { ok: true, tier: 'academy', userId: '100000000000000001' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const svc = { list: ({ refresh }) => ({ ok: true, rows: [{ rank: 1, symbol: 'GME', squeeze: 88 }], building: false, done: 40, total: 40, asOf: 1, refreshed: !!refresh }) };
  await withServer({ academyOAuth, getSqueezeList: () => svc }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/squeeze-list`)).status, 401);
    const probe = await fetch(`${base}/academy-activity/squeeze-list?probe=1`, { headers: { authorization: 'Bearer member' } });
    assert.equal(probe.status, 200); assert.deepEqual(await probe.json(), { ok: true, owner: false });
    assert.equal((await fetch(`${base}/academy-activity/squeeze-list`, { headers: { authorization: 'Bearer member' } })).status, 403);
    const mine = await fetch(`${base}/academy-activity/squeeze-list?probe=1`, { headers: { authorization: 'Bearer owner' } }); assert.deepEqual(await mine.json(), { ok: true, owner: true });
    const list = await fetch(`${base}/academy-activity/squeeze-list?refresh=1`, { headers: { authorization: 'Bearer owner' } });
    assert.equal(list.status, 200); const body = await list.json(); assert.equal(body.owner, true); assert.equal(body.rows[0].symbol, 'GME'); assert.equal(body.refreshed, true);
  });
  await withServer({ academyOAuth }, async (base) => { assert.equal((await fetch(`${base}/academy-activity/squeeze-list`, { headers: { authorization: 'Bearer owner' } })).status, 503); });
  const { academyActivityHtml } = require('./server');
  const html = academyActivityHtml({ symbol: 'SPY', tf: '5m' });
  assert.match(html, /id = 'squeeze-btn'/); assert.match(html, /academy-activity\/squeeze-list/); assert.doesNotMatch(html, PAGE_BANNED);
});

test('Activity page assets: with page assets on, the page ships its static scripts and styles as immutable bundles the server serves', async () => {
  const { createPageAssets } = require('./academy-page-assets');
  const pageAssets = createPageAssets();
  await withServer({ pageAssets }, async (base) => {
    const res = await fetch(`${base}/academy-activity/?symbol=SPY`);
    const html = await res.text();
    assert.match(res.headers.get('content-security-policy'), /style-src 'self' 'unsafe-inline'/, 'external stylesheets are allowed');
    const scripts = [...html.matchAll(/<script src="(\/academy-activity\/a\/[a-f0-9]{20}\.js)"/g)].map((m) => m[1]);
    const styles = [...html.matchAll(/<link rel="stylesheet" href="(\/academy-activity\/a\/[a-f0-9]{20}\.css)"/g)].map((m) => m[1]);
    assert.ok(scripts.length >= 3 && styles.length >= 3, 'bundles replace the inline blocks');
    assert.ok(html.length < 400_000, 'the shell is a fraction of the inline page: ' + html.length);
    assert.match(html, /academy-scanner-host/, 'the request\'s own market data stays inline');
    assert.match(html, /<script type="module">/, 'module scripts stay inline');
    const js = await fetch(base + scripts[scripts.length - 1]);
    assert.equal(js.status, 200); assert.match(js.headers.get('cache-control'), /immutable/); assert.match(js.headers.get('content-type'), /javascript/);
    const css = await fetch(base + styles[0]);
    assert.equal(css.status, 200); assert.match(css.headers.get('content-type'), /text\/css/);
    assert.equal((await fetch(base + '/academy-activity/a/00000000000000000000.js')).status, 404);
    /* the inline page is unchanged when assets are off */
  });
  await withServer({}, async (base) => {
    const html = await (await fetch(`${base}/academy-activity/?symbol=SPY`)).text();
    assert.doesNotMatch(html, /\/academy-activity\/a\//);
  });
});

test('Activity navigation: one grouped tool rail (CHART, FLOW, DESK, SHARE) with a guide and a phone QUOTE sheet, and the top-bar rail lets go of its pills on a phone', () => {
  const html = require('./server').academyActivityHtml({ symbol: 'SPY', bars: [] }, { appId: '1551336038713139370' });
  assert.match(html, /id = 'tool-rail'/, 'the rail exists');
  for (const label of ['CHART', 'FLOW', 'DESK', 'SHARE']) assert.match(html, new RegExp("label: '" + label + "'"));
  for (const id of ['depth-walls', 'heat-toggle', 'smc-toggle', 'intent-btn', 'buysell-toggle', 'darkpool-toggle', 'shortsale-toggle', 'sentiment-toggle', 'squeeze-btn', 'chain-toggle', 'mem-algo-toggle', 'sire-toggle', 'earnings-toggle', 'catalysts-toggle', 'paper-toggle', 'challenge-toggle', 'talk-btn', 'snap-toggle', 'click-alert-toggle']) assert.ok(html.includes("'" + id + "'"), id + ' is in a group');
  assert.match(html, /tool-guide-btn/); assert.match(html, /tool-quote-btn/); assert.match(html, /sml-quote-open main \.side\{display:flex!important/, 'the quote column opens as a phone sheet');
  assert.match(html, /narrowed to a phone width: the pills go back to floating/);
  assert.match(html, /#sml-settings-btn\{right:auto;left:10px;bottom:48px\}/, 'Settings no longer sits on the Loop Bucks pill on phones');
});

test('an Academy data route that never answers is cut with a 503 at the route budget, and a stream is untouched', async () => {
  const { OWNER_IDS } = require('./academy-free-users');
  const academyOAuth = { verifySession: (a) => (a === 'Bearer owner' ? { ok: true, userId: OWNER_IDS[0], tier: 'academy' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const logs = [];
  await withServer({ academyOAuth, routeBudgetMs: 300, getShortInsight: () => ({ insight: (symbol) => (symbol === 'HANG' ? new Promise(() => {}) : Promise.resolve({ ok: true, symbol })) }), logger: (l, e, x) => logs.push([e, x]) }, async (base) => {
    const t0 = Date.now();
    const res = await fetch(`${base}/academy-activity/short-insight?symbol=HANG`, { headers: { authorization: 'Bearer owner' } });
    assert.equal(res.status, 503); assert.deepEqual(await res.json(), { ok: false, error: 'timeout' });
    assert.ok(Date.now() - t0 < 5000);
    assert.ok(logs.some((l) => l[0] === 'academy_route_timeout' && l[1].path === '/academy-activity/short-insight'));
    const quick = await fetch(`${base}/academy-activity/short-insight?symbol=SPY`, { headers: { authorization: 'Bearer owner' } });
    assert.equal(quick.status, 200, 'a route that answers in time is unaffected');
  });
});

test('Academy Evolve routes: beacons from anyone, knobs for the page, the brief and the queue for the owner only; every Academy route is timed into the ledger', async () => {
  const { createEvolve } = require('./academy-evolve');
  const { OWNER_IDS } = require('./academy-free-users');
  const academyEvolve = createEvolve({ logger: () => {}, now: Date.now });
  const academyOAuth = { verifySession: (a) => (a === 'Bearer owner' ? { ok: true, userId: OWNER_IDS[0], tier: 'academy' } : a === 'Bearer member' ? { ok: true, userId: '100000000000000002', tier: 'academy' } : { ok: false, status: 401, code: 'authorization_required' }) };
  await withServer({ academyOAuth, academyEvolve, getShortInsight: () => ({ insight: async (symbol) => ({ ok: true, symbol }) }) }, async (base) => {
    const ev = await fetch(`${base}/academy-activity/evolve/event`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ events: [{ kind: 'visit', phone: true, discord: true }, { kind: 'tool', id: 'mem-algo-toggle', on: true, phone: true }, { kind: 'nope' }] }) });
    assert.equal(ev.status, 204);
    const cfg = await fetch(`${base}/academy-activity/evolve/config`);
    assert.equal(cfg.status, 200); const c = await cfg.json(); assert.equal(c.ok, true); assert.equal(c.livePollMs, 2500);
    assert.equal((await fetch(`${base}/academy-activity/evolve`)).status, 401);
    const member = await fetch(`${base}/academy-activity/evolve`, { headers: { authorization: 'Bearer member' } });
    assert.equal(member.status, 403); assert.equal((await member.json()).error, 'owner_only');
    assert.deepEqual(await (await fetch(`${base}/academy-activity/evolve?probe=1`, { headers: { authorization: 'Bearer member' } })).json(), { ok: true, owner: false });
    await fetch(`${base}/academy-activity/short-insight?symbol=SPY`, { headers: { authorization: 'Bearer owner' } });
    const snap = await (await fetch(`${base}/academy-activity/evolve`, { headers: { authorization: 'Bearer owner' } })).json();
    assert.equal(snap.ok, true); assert.equal(snap.today.devices.phone, 1); assert.equal(snap.today.tools[0].id, 'mem-algo-toggle');
    assert.ok(snap.today.busiest.some((r) => r.route === 'short-insight' && r.n === 1), 'the short-insight call was timed');
    assert.ok(snap.today.busiest.some((r) => r.route === 'evolve/event'), 'so was the beacon');
    const run = await fetch(`${base}/academy-activity/evolve/run`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: '{}' });
    assert.equal(run.status, 200); const r = await run.json(); assert.equal(r.ok, true); assert.equal(r.brief.model, 'rules');
    const after = await (await fetch(`${base}/academy-activity/evolve`, { headers: { authorization: 'Bearer owner' } })).json();
    assert.ok(after.brief && after.brief.summary.includes('visits'));
    if (after.proposals.length) {
      const set = await fetch(`${base}/academy-activity/evolve/proposal`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ id: after.proposals[0].id, status: 'approved' }) });
      assert.equal((await set.json()).proposal.status, 'approved');
    }
    const knob = await fetch(`${base}/academy-activity/evolve/knob`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ knob: 'livePollMs', value: 4000, pinned: true }) });
    assert.deepEqual((await knob.json()).knob, { value: 4000, pinned: true });
    assert.equal((await (await fetch(`${base}/academy-activity/evolve/config`)).json()).livePollMs, 4000, 'the page reads the turned knob');
    assert.equal((await fetch(`${base}/academy-activity/evolve/proposal`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ id: 'nope', status: 'approved' }) })).status, 404);
    assert.equal((await fetch(`${base}/academy-activity/evolve/other`, { headers: { authorization: 'Bearer owner' } })).status, 404);
    const queue = await (await fetch(`${base}/academy-activity/evolve/queue`)).json();
    assert.equal(queue.ok, true); assert.ok(Array.isArray(queue.proposals) && Array.isArray(queue.briefs) && queue.briefs.length === 1, 'the builder reads the queue without a session');
    assert.equal(JSON.stringify(queue).includes('busiest'), false, 'the queue carries no telemetry');
  });
  const html = require('./server').academyActivityHtml({ symbol: 'SPY', bars: [] }, { appId: '1551336038713139370' });
  assert.match(html, /\/academy-activity\/evolve\/event/, 'the page carries the beacons');
  assert.match(html, /id = 'evolve-btn'/, 'and the owner panel');
  assert.match(require('node:fs').readFileSync(require('node:path').join(__dirname, 'academy-live.js'), 'utf8'), /smlEvolveConfig\.livePollMs/, 'the live poll reads its cadence from the knob');
});

test('Ticker Talk comments carry the author\'s Discord avatar and open the shared profile card, whose Academy section (with Follow) sits right under the name', () => {
  const html = require('./server').academyActivityHtml({ symbol: 'SPY', bars: [] }, { appId: '1551336038713139370' });
  assert.match(html, /window\.smlAcademyAvatar = avatarFor/, 'the chat panel shares its avatar loader');
  assert.match(html, /window\.smlAcademyProfileCard = \{ show:/, 'and its profile card');
  assert.match(html, /<div class="apc-slot"><\/div>/, 'the card has a slot under the name for the Academy section');
  assert.match(html, /const slot = cardEl\.querySelector\('\.apc-slot'\);\s*if \(slot\) slot\.replaceChildren\(div\);/, 'the Academy section (tier, followers, Follow) fills that slot');
  assert.match(html, /<span class="ava"' \+ anchor \+ '>/, 'Talk avatars are member anchors');
  assert.match(html, /function paintAvatars\(root\)/); assert.match(html, /function cardOn\(host\)/);
  assert.match(html, /cardOn\(panel\);/); assert.match(html, /shield\(m\); cardOn\(m\); \}/, 'the expanded view opens the card too');
});

test('Alert Chart routes: post, thread updates, follow with push, settings, premium lock and owner grants, the feed; the page carries the renderer, the profile section and the Traders tab', async () => {
  const { createTraderAlerts } = require('./academy-trader-alerts');
  const { OWNER_IDS } = require('./academy-free-users');
  const A = OWNER_IDS[0], B = '200000000000000002';
  const traderAlerts = createTraderAlerts({ candles: async () => ({ bars: [{ t: Date.now() - 300_000, o: 100, h: 101, l: 99, c: 100, v: 1 }, { t: Date.now() - 30_000, o: 100, h: 110, l: 99, c: 108, v: 1 }] }), logger: () => {}, names: async () => 'Ace' });
  const academyOAuth = { verifySession: (a) => (a === 'Bearer owner' ? { ok: true, userId: A, tier: 'academy' } : a === 'Bearer member' ? { ok: true, userId: B, tier: 'academy' } : a === 'Bearer free' ? { ok: true, userId: '300000000000000003', tier: 'free' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const J = (tok, body) => ({ method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  await withServer({ academyOAuth, traderAlerts }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/trader-alerts`)).status, 401);
    assert.equal((await fetch(`${base}/academy-activity/trader-alerts`, J('free', { symbol: 'NVDA', entry: 100, targets: [110] }))).status, 403, 'free sessions read, members post');
    const posted = await (await fetch(`${base}/academy-activity/trader-alerts`, J('owner', { symbol: 'nvda', entry: 100, targets: '110, 120', stop: 95, note: 'breakout' }))).json();
    assert.equal(posted.ok, true); assert.equal(posted.alert.symbol, 'NVDA'); assert.equal(posted.alert.metrics.peakPct, 10);
    const bad = await (await fetch(`${base}/academy-activity/trader-alerts`, J('owner', { symbol: 'NVDA', entry: 100, targets: [90] }))).json();
    assert.equal(bad.error, 'targets_wrong_side');
    const upd = await (await fetch(`${base}/academy-activity/trader-alerts/${posted.alert.id}/update`, J('owner', { kind: 'pt_hit', targetIndex: 0, price: 110.2, body: 'PT1 smashed' }))).json();
    assert.equal(upd.ok, true);
    assert.equal((await fetch(`${base}/academy-activity/trader-alerts/${posted.alert.id}/update`, J('member', { kind: 'update', body: 'hi' }))).status, 403);
    assert.equal((await fetch(`${base}/academy-activity/trader-alerts/999999/update`, J('owner', { kind: 'update', body: 'hi' }))).status, 404);
    const fol = await (await fetch(`${base}/academy-activity/trader-alerts/follow`, J('member', { trader: A, on: true, push: true }))).json();
    assert.deepEqual(fol, { ok: true, following: true, push: true, followers: 1 });
    const list = await (await fetch(`${base}/academy-activity/trader-alerts?user=${A}`, { headers: { authorization: 'Bearer member' } })).json();
    assert.equal(list.alerts[0].updates.length, 1); assert.equal(list.viewer.following, true); assert.equal(list.trader.name, 'Ace'); assert.equal(list.alerts[0].targets[0].hit, true);
    const set = await (await fetch(`${base}/academy-activity/trader-alerts/settings`, J('owner', { channels: [{ name: 'Main' }, { name: 'VIP', premium: true }], prices: { month: 2999 } }))).json();
    assert.equal(set.settings.premium, true);
    const vip = await (await fetch(`${base}/academy-activity/trader-alerts`, J('owner', { symbol: 'TSLA', entry: 100, targets: [130], channel: 'vip', note: 'secret' }))).json();
    const asMember = await (await fetch(`${base}/academy-activity/trader-alerts?user=${A}`, { headers: { authorization: 'Bearer member' } })).json();
    const locked = asMember.alerts.find((x) => x.id === vip.alert.id);
    assert.equal(locked.locked, true); assert.equal(locked.symbol, null); assert.equal(locked.metrics.peakPct, 10, 'the numbers tease');
    assert.equal((await fetch(`${base}/academy-activity/trader-alerts/checkout`, J('member', { trader: A, plan: 'month' }))).status, 503, 'checkout waits for the site bridge');
    assert.equal((await fetch(`${base}/academy-activity/trader-alerts/grant`, J('member', { member: B, trader: A, plan: 'month' }))).status, 403, 'grants are the owner\'s');
    const grant = await (await fetch(`${base}/academy-activity/trader-alerts/grant`, J('owner', { member: B, trader: A, plan: 'month' }))).json();
    assert.equal(grant.ok, true);
    const unlocked = await (await fetch(`${base}/academy-activity/trader-alerts?user=${A}`, { headers: { authorization: 'Bearer member' } })).json();
    assert.equal(unlocked.alerts.find((x) => x.id === vip.alert.id).symbol, 'TSLA'); assert.equal(unlocked.viewer.access.plan, 'month');
    const feed = await (await fetch(`${base}/academy-activity/trader-alerts/feed`, { headers: { authorization: 'Bearer member' } })).json();
    assert.equal(feed.alerts.length, 2); assert.equal(feed.alerts[0].followed, true); assert.equal(feed.alerts[0].authorName, 'Ace');
    const mine = await (await fetch(`${base}/academy-activity/trader-alerts/settings`, { headers: { authorization: 'Bearer owner' } })).json();
    assert.equal(mine.stats.alerts, 2); assert.equal(mine.stats.active, true);
    const noSeller = await (await fetch(`${base}/academy-activity/trader-alerts/seller`, { headers: { authorization: 'Bearer owner' } })).json();
    assert.equal(noSeller.configured, false); assert.equal(noSeller.ready, false);
    assert.equal((await fetch(`${base}/academy-activity/trader-alerts/seller`, J('owner', { terms: true, fee: true, disputes: true, activity: true }))).status, 503, 'no billing wired');
    const paidPage = await fetch(`${base}/academy-activity/alert-chart/paid?k=ac_${'a'.repeat(32)}`);
    assert.equal(paidPage.status, 200); assert.match(await paidPage.text(), /being confirmed/);
  });
  /* premium billing through stockmarketloop.com (alert-chart-billing.js) wired in: seller status + consents + Stripe onboarding, then checkout */
  const calls = [];
  const alertChartBilling = {
    configured: true,
    sellerStatus: async (id) => ({ ok: true, configured: true, linked: true, consented: false, stripe: { connected: false, ready: false }, ready: false, feeBps: 600, disputeFeeBps: 1500, who: id }),
    onboardSeller: async (id, c) => { calls.push(['onboard', id, c]); return c.terms && c.fee && c.disputes && c.activity ? { ok: true, url: 'https://connect.stripe.com/setup/e/acct_1/x', sellerId: 4 } : { ok: false, error: 'consent_required' }; },
    checkout: async (i) => { calls.push(['checkout', i]); return i.plan === 'week' ? { ok: false, error: 'plan_not_offered' } : { ok: true, url: 'https://checkout.stripe.com/c/pay/cs_1', checkoutKey: 'ac_' + 'b'.repeat(32), plan: i.plan, priceCents: 2999, feeBps: 600 }; },
    checkoutState: async (k) => (k === 'ac_' + 'b'.repeat(32) ? { ok: true, plan: 'month', status: 'active', until: new Date(Date.now() + 33 * 86_400_000).toISOString() } : { ok: false, error: 'not_found' })
  };
  await withServer({ academyOAuth, traderAlerts, alertChartBilling }, async (base) => {
    const st = await (await fetch(`${base}/academy-activity/trader-alerts/seller`, { headers: { authorization: 'Bearer owner' } })).json();
    assert.equal(st.who, A); assert.equal(st.disputeFeeBps, 1500);
    assert.equal((await fetch(`${base}/academy-activity/trader-alerts/seller`, J('free', { terms: true, fee: true, disputes: true, activity: true }))).status, 403);
    assert.equal((await fetch(`${base}/academy-activity/trader-alerts/seller`, J('owner', { terms: true, fee: true }))).status, 400, 'every consent is required');
    const on = await (await fetch(`${base}/academy-activity/trader-alerts/seller`, J('owner', { terms: true, fee: true, disputes: true, activity: true }))).json();
    assert.match(on.url, /connect\.stripe\.com/); assert.deepEqual(calls[1], ['onboard', A, { terms: true, fee: true, disputes: true, activity: true }]);
    const co = await (await fetch(`${base}/academy-activity/trader-alerts/checkout`, J('member', { trader: A, plan: 'month' }))).json();
    assert.match(co.url, /checkout\.stripe\.com/); assert.deepEqual(calls[2], ['checkout', { memberId: B, traderId: A, plan: 'month' }]);
    assert.equal((await fetch(`${base}/academy-activity/trader-alerts/checkout`, J('member', { trader: A, plan: 'week' }))).status, 400, 'a plan the trader does not sell');
    assert.equal((await fetch(`${base}/academy-activity/trader-alerts/checkout`, J('member', { trader: A, plan: 'forever' }))).status, 400);
    const paid = await (await fetch(`${base}/academy-activity/alert-chart/paid?k=ac_${'b'.repeat(32)}`)).text();
    assert.match(paid, /Payment received/); assert.match(paid, /unlocked for you until/);
    assert.match(await (await fetch(`${base}/academy-activity/alert-chart/paid?cancel=1`)).text(), /Nothing was charged/);
    assert.match(await (await fetch(`${base}/academy-activity/alert-chart/stripe?done=1`)).text(), /Stripe setup complete/);
  });
  const html = require('./server').academyActivityHtml({ symbol: 'SPY', bars: [] }, { appId: '1551336038713139370' });
  assert.match(html, /data-ac="stripe-connect"/, 'the settings form carries the Get paid with Stripe flow');
  assert.match(html, /window\.smlLayoutEngine = \{ run/, 'the layout engine ships with the page: the market trio in one row, an empty Level 2 collapsed with the scanner top rows in its place, the calculator folded on phones');
  assert.match(html, /15% of the disputed amount/, 'the dispute fee consent is on the page');
  assert.match(html, /window\.smlAlertChart = \{ mount/, 'the renderer ships with the page');
  assert.match(html, /pv-alerts-wrap/, 'the profile page has the Alert Chart section');
  assert.match(html, /90-DAY WIN RATE/, 'the profile page has the alert record module');
  assert.match(html, /\['traders', 'Traders'\]/, 'the Alerts desk has a Traders tab');
});

test('Community routes: suggestions, the Following stream, the inbox and one Follow that does both follows; the page carries the strip, tab, starters and toasts', async () => {
  const { createCommunity } = require('./academy-community');
  const { createTickerTalk } = require('./academy-ticker-talk');
  const { createProfilePages } = require('./academy-profile-pages');
  const { createTraderAlerts } = require('./academy-trader-alerts');
  const ME = '100000000000000001', ACE = '200000000000000002';
  const talk = createTickerTalk({ logger: () => {} });
  const profiles = createProfilePages({});
  const alerts = createTraderAlerts({ logger: () => {} });
  const community = createCommunity({ talk, alerts, profiles, names: async (id) => (id === ACE ? 'Ace' : 'Me'), logger: () => {} });
  await talk.post('SPY', { id: ACE, name: 'Ace' }, { body: 'Ace on SPY' });
  const academyOAuth = { verifySession: (a) => (a === 'Bearer me' ? { ok: true, userId: ME, tier: 'academy' } : { ok: false, status: 401, code: 'authorization_required' }) };
  await withServer({ academyOAuth, academyCommunity: community, tickerTalk: talk, academyProfilePages: profiles, traderAlerts: alerts }, async (base) => {
    const H = { authorization: 'Bearer me' };
    assert.equal((await fetch(`${base}/academy-activity/community/suggest`)).status, 401);
    const s = await (await fetch(`${base}/academy-activity/community/suggest`, { headers: H })).json();
    assert.equal(s.ok, true); assert.equal(s.traders[0].id, ACE); assert.match(s.traders[0].reason, /1 comment this week/);
    const f0 = await (await fetch(`${base}/academy-activity/community/following`, { headers: H })).json();
    assert.equal(f0.following, 0);
    const fol = await (await fetch(`${base}/academy-activity/community/follow`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ user: ACE, on: true }) })).json();
    assert.equal(fol.ok, true); assert.equal(fol.followers, 1);
    assert.equal((await (await fetch(`${base}/academy-activity/profiles/${ACE}`, { headers: H })).json()).profile.viewerFollows, true, 'the profile follow is set');
    assert.equal((await alerts.followState(ME, ACE)).following, true, 'and the Alert Chart follow');
    const f1 = await (await fetch(`${base}/academy-activity/community/following`, { headers: H })).json();
    assert.equal(f1.items.length, 1); assert.equal(f1.items[0].kind, 'comment'); assert.equal(f1.items[0].authorName, 'Ace');
    assert.deepEqual((await (await fetch(`${base}/academy-activity/community/suggest`, { headers: H })).json()).traders, [], 'followed traders leave the suggestions');
    const inbox = await (await fetch(`${base}/academy-activity/community/inbox?since=2020-01-01T00:00:00.000Z`, { headers: H })).json();
    assert.equal(inbox.ok, true); assert.ok(Array.isArray(inbox.events));
    assert.equal((await fetch(`${base}/academy-activity/community/follow`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ user: 'x' }) })).status, 400);
    assert.equal((await fetch(`${base}/academy-activity/community/nope`, { headers: H })).status, 404);
  });
  const html = require('./server').academyActivityHtml({ symbol: 'SPY', bars: [] }, { appId: '1551336038713139370' });
  assert.match(html, /window\.smlCommunity = \{ strip/); assert.match(html, /tk-cm-strip/); assert.match(html, /data-cm-tab="following"/); assert.match(html, /be the first to reply/); assert.match(html, /cm-toasts/);
});

test('Article Desk: the public live-chart feed answers bars and a quote with CORS for the site only; the owner panel and the write route take a ticker or a topic and file:false', async () => {
  const bars = (n, ms) => Array.from({ length: n }, (_, i) => ({ t: 1_700_000_000_000 - (n - i) * ms, o: 10 + i * 0.01, h: 10.2 + i * 0.01, l: 9.9, c: 10.1 + i * 0.01, v: 1000 + i }));
  const marketHistory = { enabled: true, get: async (symbol, tf) => ({ ok: true, data: { symbol, tf, bars: bars(tf === '1D' ? 120 : 200, tf === '1D' ? 86_400_000 : 300_000), asOf: Date.now(), source: 'massive-rest' } }), trades: async () => [] };
  await withServer({ marketHistory }, async (base) => {
    const ok = await fetch(`${base}/academy-activity/article-chart?symbol=abcd`, { headers: { origin: 'https://stockmarketloop.com' } });
    assert.equal(ok.status, 200); assert.equal(ok.headers.get('access-control-allow-origin'), 'https://stockmarketloop.com'); assert.match(ok.headers.get('cache-control'), /max-age/);
    const body = await ok.json();
    assert.equal(body.symbol, 'ABCD'); assert.equal(body.daily.length, 80); assert.equal(body.intraday.length, 160); assert.equal(body.daily[0].length, 6); assert.ok(body.quote.last > 0 && body.quote.prevClose > 0 && typeof body.quote.changePct === 'number'); assert.equal(body.quote.source, 'bars');
    const foreign = await fetch(`${base}/academy-activity/article-chart?symbol=ABCD`, { headers: { origin: 'https://evil.example' } });
    assert.equal(foreign.status, 200); assert.equal(foreign.headers.get('access-control-allow-origin'), null, 'no CORS for other origins');
    assert.equal((await fetch(`${base}/academy-activity/article-chart?symbol=bad%20sym`)).status, 400);
    const embed = await fetch(`${base}/academy-activity/article-chart-embed?symbol=ABCD`);
    assert.equal(embed.status, 200); assert.match(embed.headers.get('content-security-policy'), /frame-ancestors \*/); const embedHtml = await embed.text(); assert.match(embedHtml, /<svg class="mem-chart"/, 'the chart is drawn on the server'); assert.match(embedHtml, /academy-activity\/article-chart\?symbol=/); assert.equal((embedHtml.match(/<script/g) || []).length, 1);
    assert.equal((await fetch(`${base}/academy-activity/article-chart-embed?symbol=bad%20sym`)).status, 400);
  });
  const { OWNER_IDS } = require('./academy-free-users');
  const owner = OWNER_IDS[0] || '100000000000000009';
  const academyOAuth = { verifySession: (auth) => (auth === 'Bearer owner' ? { ok: true, tier: 'academy', userId: owner } : auth === 'Bearer member' ? { ok: true, tier: 'academy', userId: '100000000000000001' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const calls = [];
  const desk = { status: async () => ({ day: '2026-10-19', count: 1, written: 1, log: [] }), write: async (subject, opts) => { calls.push({ subject, opts }); return subject === '???' ? { ok: false, error: 'invalid_symbol' } : { ok: true, subject: { symbol: 'USO', topic: 'crude oil' }, article: { title: 'x', html: '<article class="mem-article"></article>', css: '.mem-article{}', head: '<title>x</title>', document: '<!doctype html>', modules: ['chart'], links: [] }, filed: null }; } };
  await withServer({ academyOAuth, getStoryDesk: () => desk }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/articles`, { headers: { authorization: 'Bearer member' } })).status, 403);
    const st = await fetch(`${base}/academy-activity/articles`, { headers: { authorization: 'Bearer owner' } }); assert.equal(st.status, 200); assert.equal((await st.json()).count, 1);
    const w = await fetch(`${base}/academy-activity/articles/write`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ symbol: 'oil', file: false }) });
    assert.equal(w.status, 200); const out = await w.json(); assert.equal(out.subject.symbol, 'USO'); assert.equal(out.article.css, '.mem-article{}');
    assert.deepEqual(calls[0], { subject: 'oil', opts: { publish: false, file: false } });
    const bad = await fetch(`${base}/academy-activity/articles/write`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: JSON.stringify({ symbol: '???' }) });
    assert.equal(bad.status, 400); assert.deepEqual(calls[1].opts, { publish: false, file: true });
    assert.equal((await fetch(`${base}/academy-activity/articles/write`, { method: 'POST', headers: { authorization: 'Bearer owner', 'content-type': 'application/json' }, body: '{}' })).status, 400);
  });
  const html = require('./server').academyActivityHtml({ symbol: 'SPY', tf: '5m' });
  assert.match(html, /id = 'article-btn'/); assert.match(html, /academy-activity\/articles/); assert.match(html, /COPY HTML/); assert.match(html, /COPY CSS/); assert.match(html, /COPY HEAD/); assert.match(html, /'article-btn'\] \}/, 'the button sits in the SHARE group');
  assert.doesNotMatch(html, PAGE_BANNED);
});

test('the screener option route warms the chain, says plainly when a stock has no listed options, reports a busy feed, and judges contracts against the target ladder', async () => {
  const daily = Array.from({ length: 120 }, (_, i) => { const t = Date.UTC(2026, 5, 1) + i * 86_400_000, c = 20 + Math.sin(i / 7) * 2 + i * 0.02; return { t, o: c, h: c * 1.015, l: c * 0.985, c, v: 1e6 }; });
  let mode = 'ok', optionArgs = null; const asked = [];
  const base0 = {
    academyOAuth: { verifySession: (a) => (a === 'Bearer academy-session' ? { ok: true, userId: '1' } : { ok: false, status: 401, code: 'authorization_required' }) },
    academyDataBridge: { get: async (kind, symbol) => { asked.push(symbol); if (mode === 'none') return { ok: false, status: 503, code: 'academy_data_unavailable', detail: 'Academy data is temporarily unavailable. Options data unavailable: Licensed options data returned an unusable response.' }; if (mode === 'busy') return { ok: false, status: 429, code: 'academy_data_unavailable', detail: 'The site answered 429.', retryAfterSec: 12 }; return { ok: true, status: 200, data: { rows: [] }, cached: true, ageSec: 40 }; } },
    academyScreener: { snapshot: () => ({ ok: true }), barsFor: () => daily, optionFor: (args) => { optionArgs = args; return { verdict: 'CALL', contract: { strike: 21 }, targetUsed: { first: args.targets && args.targets.t1, source: 'target engine' } }; } }
  };
  await withServer(base0, async (base) => {
    const h = { headers: { authorization: 'Bearer academy-session' } };
    const warm = await (await fetch(`${base}/academy-activity/screener/option?symbol=AAA&side=call&horizon=swing&warm=1`, h)).json();
    assert.deepEqual({ ok: warm.ok, warmed: warm.warmed, available: warm.available, cached: warm.cached }, { ok: true, warmed: true, available: true, cached: true });
    const ok = await (await fetch(`${base}/academy-activity/screener/option?symbol=AAA&side=call&horizon=swing`, h)).json();
    assert.equal(ok.suggestion.verdict, 'CALL');
    assert.ok(optionArgs.targets && optionArgs.targets.t1 > 0 && optionArgs.targets.t2 > optionArgs.targets.t1, 'the engine\'s first and second targets reach the picker');
    assert.ok(ok.shares && ok.shares.targets.length === 3 && ok.shares.stop.price > 0 && ok.source.ageSec === 40);
    mode = 'none';
    const none = await fetch(`${base}/academy-activity/screener/option?symbol=AAA&side=call&horizon=swing`, h);
    assert.equal(none.status, 200); const nb = await none.json();
    assert.equal(nb.suggestion.noOptions, true); assert.match(nb.suggestion.reason, /no listed options/); assert.ok(nb.shares.targets.length === 3, 'the plan for the shares stands in');
    mode = 'busy';
    const busy = await fetch(`${base}/academy-activity/screener/option?symbol=AAA&side=put&horizon=swing`, h);
    assert.equal(busy.status, 429); const bb = await busy.json();
    assert.equal(bb.error, 'busy'); assert.equal(bb.retryAfterSec, 12); assert.ok(bb.shares);
  });
});

test('the pre-alert route is session-gated, validates its inputs, and answers GO, CAUTION or WAIT from the candles', async () => {
  const realFetch = globalThis.fetch;
  const daily = Array.from({ length: 120 }, (_, i) => { const t = Date.UTC(2026, 5, 1) + i * 86_400_000, c = 20 + Math.sin(i / 7) * 2 + i * 0.02; return { t, o: c, h: c * 1.015, l: c * 0.985, c, v: 1e6 }; });
  const marketHistory = { enabled: true, get: async (symbol, tf) => ({ ok: true, data: { symbol, tf, bars: tf === '1D' ? daily : [], asOf: Date.now(), source: 'massive-rest' } }) };
  await withServer({ marketHistory, academyOAuth: { verifySession: (a) => (a === 'Bearer academy-session' ? { ok: true, userId: '1' } : { ok: false, status: 401, code: 'authorization_required' }) } }, async (base) => {
    const h = { headers: { authorization: 'Bearer academy-session' } };
    assert.equal((await fetch(`${base}/academy-activity/prealert?symbol=AAA&target=21`)).status, 401);
    assert.equal((await fetch(`${base}/academy-activity/prealert?symbol=${encodeURIComponent('<x>')}&target=21`, h)).status, 400);
    assert.equal((await fetch(`${base}/academy-activity/prealert?symbol=AAA`, h)).status, 400, 'a target is required');
    const last = daily[daily.length - 1].c;
    const wrong = await (await fetch(`${base}/academy-activity/prealert?symbol=AAA&side=long&entry=${last}&target=${last * 0.9}&stop=${last * 0.95}`, h)).json();
    assert.equal(wrong.verdict, 'wait'); assert.ok(wrong.findings.some((f) => f.code === 'target_wrong_side'));
    const far = await (await fetch(`${base}/academy-activity/prealert?symbol=AAA&side=long&entry=${last}&target=${last * 1.4}&stop=${last * 0.985}&horizon=swing`, h)).json();
    assert.equal(far.ok, true); assert.ok(['wait', 'caution'].includes(far.verdict)); assert.ok(far.suggested && far.suggested.targets.length === 3);
    assert.match(far.advice, /never blocks/);
  });
});

test('Trading Room routes: the owner sets the room up, visitors see locked doors, followers chat, tiers are bought through the checkout', async () => {
  const { createTraderAlerts } = require('./academy-trader-alerts');
  const { createTradingRoom } = require('./academy-trading-room');
  const { OWNER_IDS } = require('./academy-free-users');
  const A = OWNER_IDS[0], B = '200000000000000002', V = '400000000000000004';
  const traderAlerts = createTraderAlerts({ logger: () => {}, names: async () => 'Ace' });
  const tradingRoom = createTradingRoom({ traderAlerts, names: async (id) => (id === A ? 'Ace' : 'Fan'), logger: () => {} });
  const academyOAuth = { verifySession: (a) => (a === 'Bearer owner' ? { ok: true, userId: A, tier: 'academy' } : a === 'Bearer member' ? { ok: true, userId: B, tier: 'academy' } : a === 'Bearer free' ? { ok: true, userId: V, tier: 'free' } : { ok: false, status: 401, code: 'authorization_required' }) };
  const checkouts = [];
  const traderAlertsCheckout = async (i) => { checkouts.push(i); const o = await tradingRoom.offerFor(i.traderId, i.tier, i.plan); return o.ok ? { ok: true, url: 'https://pay.example/x', priceCents: o.priceCents, tier: i.tier } : { ok: false, error: o.error }; };
  const J = (tok, body) => ({ method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const G = (tok) => ({ headers: { authorization: 'Bearer ' + tok } });
  await withServer({ academyOAuth, traderAlerts, tradingRoom, traderAlertsCheckout }, async (base) => {
    assert.equal((await fetch(`${base}/academy-activity/room?owner=${A}`)).status, 401);
    assert.equal((await fetch(`${base}/academy-activity/room?owner=${A}`, G('member'))).status, 404, 'a closed room does not exist for visitors');
    assert.equal((await fetch(`${base}/academy-activity/room/template`, J('free', { key: 'classic' }))).status, 403, 'setting up needs Academy access');
    assert.equal((await fetch(`${base}/academy-activity/room/template`, J('owner', { key: 'nope' }))).status, 400);
    assert.equal((await fetch(`${base}/academy-activity/room/template`, J('owner', { key: 'classic' }))).status, 200);
    const mine = await (await fetch(`${base}/academy-activity/room`, G('owner'))).json();
    assert.equal(mine.role.kind, 'owner'); assert.ok(mine.advice.some((a) => a.id === 'open') && mine.templates.length >= 5 && mine.settings.tiers.length === 1);
    const saved = await (await fetch(`${base}/academy-activity/room/settings`, J('owner', { room: { enabled: true, name: 'Ace Trades', tiers: [{ name: 'Premium', prices: { month: 4900 } }], categories: mine.settings.categories } }))).json();
    assert.equal(saved.ok, true); assert.equal(saved.room.tiers[0].prices.month, 4900);
    const v = await (await fetch(`${base}/academy-activity/room?owner=${A}`, G('member'))).json();
    assert.equal(v.ok, true); assert.equal(v.role.kind, 'visitor'); assert.equal(v.following, false); assert.equal(v.settings, undefined);
    assert.equal((await fetch(`${base}/academy-activity/room/channel?owner=${A}&channel=general`, G('member'))).status, 403);
    assert.equal((await fetch(`${base}/academy-activity/room/follow`, J('member', { owner: A }))).status, 200);
    assert.equal((await (await fetch(`${base}/academy-activity/room/channel?owner=${A}&channel=general`, G('member'))).json()).ok, true);
    const said = await fetch(`${base}/academy-activity/room/post`, J('member', { owner: A, channel: 'general', body: 'hi all' })); assert.equal(said.status, 200);
    assert.equal((await fetch(`${base}/academy-activity/room/post`, J('member', { owner: A, channel: 'welcome', body: 'x' }))).status, 403);
    const read = await (await fetch(`${base}/academy-activity/room/channel?owner=${A}&channel=general`, G('owner'))).json(); assert.equal(read.posts[0].body, 'hi all');
    const paid = await fetch(`${base}/academy-activity/room/checkout`, J('member', { owner: A, tier: 'premium', plan: 'month' })); const pj = await paid.json();
    assert.equal(paid.status, 200); assert.equal(pj.priceCents, 4900); assert.equal(checkouts[0].tier, 'premium'); assert.equal(checkouts[0].memberId, B);
    assert.equal((await fetch(`${base}/academy-activity/room/checkout`, J('member', { owner: A, tier: 'premium', plan: 'week' }))).status, 400, 'a plan with no price is not for sale');
    assert.equal((await fetch(`${base}/academy-activity/room/checkout`, J('member', { owner: A, plan: 'month' }))).status, 400);
    const members = await (await fetch(`${base}/academy-activity/room/members`, G('owner'))).json(); assert.equal(members.total, 1);
    assert.equal((await fetch(`${base}/academy-activity/room/ban`, J('owner', { member: B }))).status, 200);
    assert.equal((await fetch(`${base}/academy-activity/room/post`, J('member', { owner: A, channel: 'general', body: 'still here' }))).status, 403);
  });
});
