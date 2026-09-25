'use strict';

/* Whiteboard "simple version" renderer (academy-cartoon-visuals.js).
 * The browser runtime is loaded from the exact <script> the Activity serves and
 * driven with a tiny fake DOM, so these tests exercise the shipped code. */

const assert = require('node:assert/strict');
const test = require('node:test');
const { academyCartoonVisualsScript, whiteboardFit } = require('./academy-cartoon-visuals');
const { SEED_LESSONS } = require('./academy/curriculum');
const { EXAMPLE_LEAD } = require('./academy/lesson-parts');
const TOTAL_LESSONS = 121 + require('./academy/street-smarts').STREET_LESSONS.length; // the original 29 modules plus the Street Smarts track

const PAGE_BANNED = /<iframe|location\.assign|CLAUDE DESIGNED|Playing Grandmaster-Obi|next lesson is preloading/i;
const words = (text) => (String(text).match(/\S+/g) || []).length;
const escapeXml = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const id = (lesson) => `${lesson.moduleId}.${lesson.lessonId}`;
const lessonById = (key) => SEED_LESSONS.find((lesson) => id(lesson) === key);

function splitServed() {
  const served = academyCartoonVisualsScript();
  const match = /^<style>([\s\S]*)<\/style><script>([\s\S]*)<\/script>$/.exec(served);
  assert.ok(match, 'served as one <style> followed by one <script>');
  return { served, css: match[1], source: match[2] };
}

/* Contract: a frame (or a line with its own cue) with cue c appears once the
 * spoken word index inside the example part reaches
 * words('Here is the simple version.') + words(say[0..c-1]). */
function contractOffsets(example) {
  const offsets = [];
  let total = words(EXAMPLE_LEAD);
  for (const sentence of example.say) { offsets.push(total); total += words(sentence); }
  return offsets;
}

function expectedGroups(example) {
  const offsets = contractOffsets(example);
  let count = 0;
  for (const frame of example.frames) {
    count += 1;
    for (const item of frame.items) {
      if (item.k === 'line' && item.cue != null && offsets[item.cue] > offsets[frame.cue]) count += 1;
    }
  }
  return count;
}

/* Minimal DOM: just what the runtime touches (see the listener code). */
function classList(initial) {
  const set = new Set(String(initial || '').split(/\s+/).filter(Boolean));
  return { add: (name) => set.add(name), remove: (name) => set.delete(name), contains: (name) => set.has(name), toString: () => [...set].join(' ') };
}
function fakeGroup(className, at, frame) {
  const attributes = new Map([['data-at', at], ['data-frame', frame]]);
  return { classList: classList(className), getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null), querySelectorAll: () => [] };
}
function fakeElement(connected = false) {
  const attributes = new Map();
  const element = {
    nodeType: 1,
    className: '',
    parentNode: null,
    children: [],
    groups: [],
    markup: '',
    get isConnected() { return connected || Boolean(this.parentNode && this.parentNode.isConnected); },
    hasAttribute: (name) => attributes.has(name),
    getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null),
    setAttribute: (name, value) => { attributes.set(name, String(value)); },
    removeAttribute: (name) => { attributes.delete(name); },
    replaceChildren(...nodes) {
      this.children.forEach((child) => { child.parentNode = null; });
      this.children = nodes;
      nodes.forEach((child) => { child.parentNode = this; });
    },
    set innerHTML(markup) {
      this.markup = markup;
      this.groups = [...markup.matchAll(/<g class="(wb-r(?: wb-on)?)" data-at="(\d+)" data-frame="(\d+)">/g)]
        .map((match) => fakeGroup(match[1], match[2], match[3]));
    },
    get innerHTML() { return this.markup; },
    querySelectorAll(selector) { return selector === '.wb-r' ? this.groups : []; }
  };
  return element;
}

function loadRuntime({ reducedMotion = false } = {}) {
  const { source } = splitServed();
  const listeners = new Map();
  const timers = [];
  const win = {
    addEventListener: (type, handler) => { listeners.set(type, [...(listeners.get(type) || []), handler]); },
    matchMedia: (query) => ({ matches: reducedMotion && /prefers-reduced-motion: reduce/.test(query) }),
    setTimeout: (handler, ms) => { timers.push({ handler, ms, cleared: false }); return timers.length; },
    clearTimeout: (handle) => { if (timers[handle - 1]) timers[handle - 1].cleared = true; }
  };
  const doc = { createElement: () => fakeElement(), querySelector: () => null };
  new Function('window', 'document', source)(win, doc);
  const emit = (type, detail) => (listeners.get(type) || []).forEach((handler) => handler({ detail }));
  const liveTimer = () => timers.filter((timer) => !timer.cleared).at(-1);
  return { api: win.SMLWhiteboard, listeners, emit, timers, liveTimer };
}

const visible = (board) => board.groups.map((group) => group.classList.contains('wb-on'));

test('the whiteboard ships as one CSP-safe style and script pair with no page-banned text', () => {
  const { served, css, source } = splitServed();
  assert.equal((served.match(/<script\b/gi) || []).length, 1);
  assert.equal((served.match(/<\/script/gi) || []).length, 1);
  assert.equal(served.includes('<!--'), false);
  assert.doesNotThrow(() => new Function(source));
  assert.equal(academyCartoonVisualsScript(), served, 'memoised and deterministic');
  // CSP allows no images, no web fonts and no network: inline SVG + system fonts only.
  assert.doesNotMatch(served, /url\(|@import|@font-face|<img|<image|href|https?:\/\/(?!www\.w3\.org\/2000\/svg)|fetch\(|XMLHttpRequest|import\(/i);
  assert.match(css, /font-family:'Segoe Print','Ink Free','Marker Felt','Chalkboard SE','Comic Sans MS',system-ui,sans-serif/);
  // Reduced motion (and the static fallbacks) always end with everything visible.
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)\{[^@]*\.wb-r\{opacity:1!important;animation:none!important\}/);
  assert.match(css, /\.academy-live-deck \.academy-slide-visual\[data-board\]/);
  assert.match(css, /max-width:430px/);
  // Only classes and data-board change; the visual lab watches style/data-kind.
  assert.doesNotMatch(source, /\.style\b|dataset|setAttribute\('(?:style|data-kind|class)'/);
  assert.match(source, /win\.addEventListener\('sml-academy-slide-sync', onSync\)/);
  assert.match(source, /win\.addEventListener\('sml-academy-slide-progress', onProgress\)/);
  assert.doesNotMatch(served, PAGE_BANNED);
  assert.doesNotMatch(served, /\b(?:brian|dave|buster|clear\s?value)\b/i);
});

test('cue offsets follow the shared word-offset contract for every lesson', () => {
  const { api } = loadRuntime();
  for (const lesson of SEED_LESSONS) {
    const example = lesson.example;
    const part = lesson.parts[lesson.exampleIndex];
    assert.equal(part, `${EXAMPLE_LEAD} ${example.say.join(' ')}`, id(lesson));
    const captionWords = (part.match(/\S+\s*/g) || []).length; // client caption spans
    const expected = contractOffsets(example);
    assert.deepEqual(api.offsets(example), expected, id(lesson));
    assert.ok(expected.at(-1) < captionWords, `${id(lesson)} last cue is reachable while speaking`);
    for (const frame of example.frames) {
      for (const item of frame.items) {
        if (item.k === 'line' && item.cue != null) assert.ok(item.cue >= frame.cue, `${id(lesson)} line cue precedes its frame`);
      }
    }
  }
});

test('every lesson example renders a complete, well-formed whiteboard SVG', () => {
  const { api } = loadRuntime();
  const heights = [];
  for (const lesson of SEED_LESSONS) {
    const example = lesson.example;
    const { markup, height, offsets, groups } = api.build(example);
    const label = id(lesson);
    assert.match(markup, /^<svg class="wb-svg" xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 360 (\d+)"/, label);
    assert.equal(Number(/viewBox="0 0 360 (\d+)"/.exec(markup)[1]), height, label);
    assert.ok(height >= 200 && height <= 900, `${label} height ${height}`);
    heights.push(height);
    assert.doesNotMatch(markup, /undefined|NaN|Infinity|\[object /, label);
    assert.doesNotMatch(markup, /<script|<foreignObject|\son[a-z]+=|href/i, label);
    // Balanced tags (a well-formedness proxy for innerHTML/DOMParser).
    const stack = [];
    for (const [, close, name, selfClose] of markup.matchAll(/<(\/?)([a-zA-Z]+)\b[^>]*?(\/?)>/g)) {
      if (selfClose) continue;
      if (close) assert.equal(stack.pop(), name, `${label} closes ${name}`);
      else stack.push(name);
    }
    assert.deepEqual(stack, [], label);
    assert.equal(groups, expectedGroups(example), `${label} reveal groups`);
    const ats = [...markup.matchAll(/<g class="wb-r wb-on" data-at="(\d+)"/g)].map((match) => Number(match[1]));
    assert.equal(ats.length, groups, `${label} all groups visible when not animating`);
    for (const at of ats) assert.ok(offsets.includes(at), `${label} data-at ${at} is a cue offset`);
    assert.deepEqual([...ats].sort((a, b) => a - b), ats, `${label} groups reveal top to bottom`);
    assert.equal(ats[0], offsets[0], `${label} first frame appears with the first sentence`);
    assert.equal(api.build(example, -1).markup.includes('wb-on'), false, `${label} nothing visible before speech`);
    assert.equal(api.svg(example), markup);
    assert.equal(api.build(example).markup, markup, `${label} deterministic`);
    assert.ok(markup.includes(`<title>${escapeXml(example.title)}</title>`), `${label} title`);
  }
  assert.equal(heights.length, TOTAL_LESSONS);
});

test('the 9.1 put example draws its computed numbers and escapes hostile text', () => {
  const { api } = loadRuntime();
  const put = lessonById('9.1').example;
  const markup = api.svg(put);
  for (const text of ['One put, two endings', 'Leo', 'Maya', '$200 premium', 'Right to sell at $45', 'Break-even $43', 'Strike $45', 'Leo +$300', 'Maya -$300', 'Ends $55: Leo -$200, Maya +$200', '$45 − $2 = $43']) {
    assert.ok(markup.includes(`>${text}<`), `9.1 whiteboard shows ${text}`);
  }
  const hostile = { ...put, title: '<script>alert(1)</script> & "q"', frames: [{ cue: 0, items: [{ k: 'line', text: '<img src=x onerror=alert(1)>' }] }] };
  const escaped = api.svg(hostile);
  assert.doesNotMatch(escaped, /<script|<img/);
  assert.match(escaped, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; &quot;q&quot;/);
  assert.equal(api.build({}).groups, 0, 'malformed examples still build an empty board');
});

test('the live deck pages through the frames as the voice reaches them', () => {
  const { emit, liveTimer } = loadRuntime();
  const lesson = lessonById('9.1');
  const example = lesson.example;
  const offsets = contractOffsets(example);
  const visual = fakeElement(true);
  const base = { lesson, lessonKey: '9:1', visual, example, text: lesson.parts[1] };

  emit('sml-academy-slide-sync', { ...base, partIndex: 0, isExample: false, playing: true });
  assert.equal(visual.hasAttribute('data-board'), false, 'title slide stays a normal slide');

  // renderDeck dispatches progress (word 0) before sync on a part change.
  emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: 0, wordCount: 90, playing: true });
  emit('sml-academy-slide-sync', { ...base, partIndex: 1, isExample: true, playing: true });
  assert.equal(visual.getAttribute('data-board'), 'whiteboard');
  const board = visual.children[0];
  assert.equal(board.className, 'wb-board wb-anim');
  assert.equal(board.groups.length, expectedGroups(example));
  assert.deepEqual(visible(board), board.groups.map(() => false), 'nothing is drawn before the first sentence');
  // While playing, every frame is drawn in the same spot: the board is one frame tall.
  const paged = Number(/viewBox="0 0 360 (\d+)"/.exec(board.markup)[1]);
  assert.ok(paged < loadRuntime().api.build(example).height, 'the playing board is shorter than the whole board');

  emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: offsets[0], playing: true });
  assert.deepEqual(visible(board), [true, false, false, false, false]);
  assert.equal(board.groups[0].classList.contains('wb-go'), true, 'reveals animate while audio plays');

  emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: offsets[1], playing: true });
  assert.deepEqual(visible(board), [false, true, false, false, false], 'a new frame replaces the previous one');

  emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: offsets[2], playing: true });
  assert.deepEqual(visible(board), [false, false, true, false, false], 'lines with their own later cue wait');
  emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: offsets[3], playing: true });
  assert.deepEqual(visible(board), [false, false, true, true, false]);

  // Seeking back in the audio turns the page back too.
  emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: offsets[1], playing: true });
  assert.deepEqual(visible(board), [false, true, false, false, false]);
  emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: offsets[3], playing: true });

  // A repeated sync for the same part keeps the board (no restart).
  emit('sml-academy-slide-sync', { ...base, partIndex: 1, isExample: true, playing: true });
  assert.equal(visual.children[0], board);

  // Watchdog: if progress stops (paused tab, throttling) the whole board is shown.
  const timer = liveTimer();
  assert.equal(timer.ms, 4000);
  timer.handler();
  assert.equal(board.className, 'wb-board');
  assert.deepEqual(visible(board), [true, true, true, true, true]);

  // Moving on releases the visual for the normal step slide.
  emit('sml-academy-slide-sync', { ...base, partIndex: 2, isExample: false, playing: true });
  assert.equal(visual.hasAttribute('data-board'), false);
});

test('manual browsing, pausing and reduced motion always show the whole board', () => {
  const lesson = lessonById('9.1');
  const base = { lesson, lessonKey: '9:1', partIndex: 1, isExample: true, example: lesson.example, text: lesson.parts[1] };
  const offsets = contractOffsets(lesson.example);

  const manual = loadRuntime();
  const still = fakeElement(true);
  manual.emit('sml-academy-slide-sync', { ...base, visual: still, playing: false });
  assert.equal(still.children[0].className, 'wb-board');
  assert.ok(visible(still.children[0]).every(Boolean));

  const reduced = loadRuntime({ reducedMotion: true });
  const calm = fakeElement(true);
  reduced.emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: 0, playing: true });
  reduced.emit('sml-academy-slide-sync', { ...base, visual: calm, playing: true });
  assert.equal(calm.children[0].className, 'wb-board', 'no animation class under reduced motion');
  assert.ok(visible(calm.children[0]).every(Boolean));
  reduced.emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: offsets[1], playing: true });
  assert.ok(visible(calm.children[0]).every(Boolean), 'reduced motion never pages or hides anything');

  const paused = loadRuntime();
  const deck = fakeElement(true);
  paused.emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: 0, playing: true });
  paused.emit('sml-academy-slide-sync', { ...base, visual: deck, playing: true });
  const board = deck.children[0];
  assert.equal(visible(board).some(Boolean), false);
  paused.emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: 3, playing: false });
  assert.equal(board.className, 'wb-board');
  assert.ok(visible(board).every(Boolean), 'pausing shows the whole board');
  // Playing again pages the board back to the frame the voice is on.
  paused.emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: offsets[1], playing: true });
  assert.equal(deck.children[0], board);
  assert.equal(board.className, 'wb-board wb-anim');
  assert.deepEqual(visible(board), [false, true, false, false, false]);

  // The curriculum rewrote the visual (e.g. a Claude design arrived): rebuild
  // on the frame already reached without replaying earlier frames.
  const rewrite = loadRuntime();
  const host = fakeElement(true);
  rewrite.emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: offsets[1], playing: true });
  rewrite.emit('sml-academy-slide-sync', { ...base, visual: host, playing: true });
  const first = host.children[0];
  host.replaceChildren();
  rewrite.emit('sml-academy-slide-progress', { lessonKey: '9:1', partIndex: 1, wordIndex: offsets[1], playing: true });
  rewrite.emit('sml-academy-slide-sync', { ...base, visual: host, playing: true });
  assert.notEqual(host.children[0], first);
  assert.deepEqual(visible(host.children[0]), [false, true, false, false, false]);
});

test('a playing board stays about one frame tall and shows only the frame being spoken', () => {
  const { api } = loadRuntime();
  let tallest = 0;
  for (const lesson of SEED_LESSONS) {
    const example = lesson.example;
    const label = id(lesson);
    const stacked = api.build(example);
    const paged = api.build(example, Infinity, true);
    tallest = Math.max(tallest, paged.height);
    // At most about 400px tall on the widest (430px) deck, so the caption stays in view.
    assert.ok(paged.height <= 380, `${label} playing board is ${paged.height} units tall`);
    if (example.frames.length > 1) assert.ok(paged.height < stacked.height, `${label} paging saves height`);
    assert.equal(paged.groups, stacked.groups, `${label} same reveal groups`);
    paged.frames.forEach((frameAt, index) => {
      const markup = api.build(example, frameAt, true).markup;
      const on = [...markup.matchAll(/<g class="wb-r wb-on" data-at="\d+" data-frame="(\d+)">/g)].map((match) => Number(match[1]));
      assert.ok(on.length >= 1, `${label} frame ${index} shows something when it starts`);
      assert.ok(on.every((frame) => frame === index), `${label} only frame ${index} is visible`);
    });
  }
  assert.ok(tallest >= 200, 'measured real boards');
});

test('every lesson board keeps every label readable on a 270px deck', () => {
  const { api } = loadRuntime();
  for (const lesson of SEED_LESSONS) {
    const label = id(lesson);
    assert.deepEqual(whiteboardFit(lesson.example), [], label);
    const markup = api.svg(lesson.example);
    assert.doesNotMatch(markup, /textLength=/, `${label} squeezes a label`);
    for (const [, size] of markup.matchAll(/<text [^>]*font-size="([\d.]+)"/g)) {
      assert.ok(Number(size) >= 11, `${label} has a ${size}-unit label`);
    }
  }
  // The same measurements catch labels that are too long for their slot.
  const tooLong = { ...lessonById('9.1').example, frames: [{ cue: 0, items: [
    { k: 'actors', left: { name: 'Parking and sales', icon: 'shop' }, right: { name: 'Leo', icon: 'person' }, flows: [] },
    { k: 'numberLine', marks: [{ at: 100, label: 'Maya $100' }, { at: 101, label: 'Leo $101' }, { at: 102, label: 'Zoe $102' }, { at: 150, label: 'End $150' }] }
  ] }] };
  const problems = whiteboardFit(tooLong).join(' | ');
  assert.match(problems, /"Parking and sales" drops to 10/);
  assert.match(problems, /number line labels .* overlap/);
});

test('boards carry Making Easy Money Academy branding and draw no skin-toned people', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, 'academy-cartoon-visuals.js'), 'utf8');
  assert.match(src, /MAKING EASY MONEY/);
  assert.doesNotMatch(src, /SKIN\b/, 'no skin-tone colour is defined or used');
  assert.doesNotMatch(src, /#f3d2b3|#e9c39d|#fde4cc/i, 'no skin-tone hex values');
  const board = loadRuntime().api.build(require('./academy/curriculum').SEED_LESSONS.find((l) => l.moduleId === 0 && l.lessonId === 13).example);
  assert.match(board.markup, /MAKING EASY MONEY/);
  assert.match(board.markup, /Making Easy Money Academy whiteboard/);
});
