'use strict';
/*
 * Tests for the owner-delete client logic in js/home-feed.js.
 *
 * The shipped file is one big IIFE that expects a browser DOM, so we never
 * require() it. Instead we read its source text, slice out the REAL shipped
 * units under test with marker-based extraction (unique anchor strings from
 * the source), and evaluate them inside a sandbox built with `new Function`.
 * If the markers ever go stale, the extraction asserts fail loudly instead of
 * silently testing nothing.
 *
 * Units under test:
 *   - hfbNonce()                       (~line 113)
 *   - deleteErrorIn(button, message)   (~line 826)
 *   - the host 'click' delete handler  (~line 832)
 *
 * Run: node tests/home-feed-delete.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC_PATH = path.join(__dirname, '..', 'js', 'home-feed.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');

/* ---------------------------------------------------------------- extraction */

function sliceBetween(startMarker, endMarker, label) {
  const s = SRC.indexOf(startMarker);
  assert.ok(s >= 0, 'extraction: start marker for ' + label + ' not found: ' + JSON.stringify(startMarker));
  assert.strictEqual(SRC.indexOf(startMarker, s + 1), -1,
    'extraction: start marker for ' + label + ' is not unique: ' + JSON.stringify(startMarker));
  const e = SRC.indexOf(endMarker, s + startMarker.length);
  assert.ok(e > s, 'extraction: end marker for ' + label + ' not found after start: ' + JSON.stringify(endMarker));
  return SRC.slice(s, e).replace(/\s+$/, '');
}

const hfbNonceSrc = sliceBetween('function hfbNonce()', 'function hfbLoad', 'hfbNonce');
const deleteErrorInSrc = sliceBetween('function deleteErrorIn(', "host.addEventListener('click'", 'deleteErrorIn');
const clickHandlerSrc = sliceBetween("host.addEventListener('click'", '// ---- live feed', 'click handler');

// Sanity: the slices look like the units we intended to capture.
assert.ok(/^function hfbNonce\(\)/.test(hfbNonceSrc) && hfbNonceSrc.endsWith('}'),
  'hfbNonce slice does not look like a complete function');
assert.ok(deleteErrorInSrc.endsWith('}'), 'deleteErrorIn slice does not end with }');
assert.ok(clickHandlerSrc.endsWith('});'), 'click handler slice does not end with });');
assert.ok(clickHandlerSrc.indexOf('data-sml-delete-item') >= 0, 'click handler slice lost its delete-button selector');
assert.ok(clickHandlerSrc.indexOf('hfbNonce()') >= 0, 'click handler slice lost its hfbNonce() call');

/* ---------------------------------------------------------------- sandbox */

function compileHfbNonce(windowStub) {
  // Evaluates the REAL hfbNonce source with `window` bound to the stub.
  const fn = new Function('window', hfbNonceSrc + '\nreturn hfbNonce();');
  return fn(windowStub);
}

function fakeElement(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(),
    className: '',
    textContent: '',
    style: {},
    attrs: {},
    setAttribute(k, v) { this.attrs[k] = String(v); }
  };
}

/*
 * Builds a full harness around the shipped deleteErrorIn + click handler:
 * fake window/document/host/button/card, scripted fetch, recorded setTimeout.
 */
function makeHarness(opts) {
  opts = opts || {};
  const calls = { fetch: [], timeouts: [], dedupe: 0, confirms: 0 };

  const win = opts.window || {};
  if (typeof win.confirm !== 'function') {
    win.confirm = function () { calls.confirms++; return opts.confirm !== false; };
  }

  const doc = {
    created: [],
    createElement(tag) { const el = fakeElement(tag); this.created.push(el); return el; }
  };

  const card = {
    className: 'oh-post',
    children: [],
    style: {},
    removed: false,
    _err: null,
    querySelector(sel) { return sel === '.sml-owner-delete-err' ? this._err : null; },
    appendChild(el) {
      this.children.push(el);
      if (el.className === 'sml-owner-delete-err') this._err = el;
    },
    remove() { this.removed = true; }
  };

  const button = {
    disabled: false,
    textContent: 'Delete',
    parentNode: card,
    attrs: { 'data-sml-delete-item': ('itemId' in opts) ? opts.itemId : '123' },
    getAttribute(k) {
      return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null;
    },
    closest(sel) {
      if (sel === '.oh-post') return card;
      if (sel === '[data-sml-delete-item]') return this;
      return null;
    }
  };

  const host = {
    listeners: {},
    addEventListener(type, fn) { this.listeners[type] = fn; },
    contains() { return true; }
  };

  const fetchStub = function (url, init) {
    calls.fetch.push({ url: url, init: init });
    return Promise.resolve(opts.response ? opts.response(url, init) : { ok: true, status: 200, json: () => Promise.resolve({}) });
  };

  const setTimeoutStub = function (fn, ms) { calls.timeouts.push({ fn: fn, ms: ms }); return calls.timeouts.length; };
  const dedupeFeed = function () { calls.dedupe++; };

  // Evaluate the REAL shipped source: hfbNonce + deleteErrorIn definitions,
  // then the addEventListener statement, which registers on our fake host.
  const locationStub = opts.location || { origin: 'https://stockmarketloop.test' };
  const install = new Function(
    'window', 'document', 'fetch', 'host', 'setTimeout', 'dedupeFeed', 'location', 'URL',
    hfbNonceSrc + '\n' + deleteErrorInSrc + '\n' + clickHandlerSrc
  );
  install(win, doc, fetchStub, host, setTimeoutStub, dedupeFeed, locationStub, URL);

  assert.strictEqual(typeof host.listeners.click, 'function', 'shipped code registered a click listener on host');

  function click() {
    const event = {
      prevented: false,
      stopped: false,
      target: { closest(sel) { return sel === '[data-sml-delete-item]' ? button : null; } },
      preventDefault() { this.prevented = true; },
      stopPropagation() { this.stopped = true; }
    };
    host.listeners.click(event);
    return event;
  }

  return { win, doc, card, button, host, calls, click };
}

// Let the handler's internal promise chain fully settle (fetch stub resolves
// synchronously-queued promises; setImmediate runs after microtasks drain).
function flush() { return new Promise((r) => setImmediate(r)); }

/* ---------------------------------------------------------------- test runner */

const cases = [];
function test(name, fn) { cases.push({ name, fn }); }

/* ------------------------------------------------ 1. nonce priority */
test('hfbNonce prefers SMLHomeOwnerControls.nonce over every other source', () => {
  const n = compileHfbNonce({
    SMLHomeOwnerControls: { nonce: 'owner-n' },
    wpApiSettings: { nonce: 'wp-n' },
    SMLHomeFeedEngagement: { nonce: 'eng-n' },
    SML_CG_NONCE: 'cg-n',
    SML_LB_NONCE: 'lb-n'
  });
  assert.strictEqual(n, 'owner-n');
});

/* ------------------------------------------------ 2. fallback chain order */
test('hfbNonce falls back down the chain in order when earlier sources are absent', () => {
  // owner controls absent -> wpApiSettings wins
  assert.strictEqual(compileHfbNonce({
    wpApiSettings: { nonce: 'wp-n' },
    SMLHomeFeedEngagement: { nonce: 'eng-n' },
    SML_CG_NONCE: 'cg-n',
    SML_LB_NONCE: 'lb-n'
  }), 'wp-n');
  // owner controls present but empty nonce also falls through (|| chain)
  assert.strictEqual(compileHfbNonce({
    SMLHomeOwnerControls: { nonce: '' },
    wpApiSettings: { nonce: 'wp-n' }
  }), 'wp-n');
  // wpApiSettings absent -> engagement wins
  assert.strictEqual(compileHfbNonce({
    SMLHomeFeedEngagement: { nonce: 'eng-n' },
    SML_CG_NONCE: 'cg-n',
    SML_LB_NONCE: 'lb-n'
  }), 'eng-n');
  // only the CG global
  assert.strictEqual(compileHfbNonce({ SML_CG_NONCE: 'cg-n', SML_LB_NONCE: 'lb-n' }), 'cg-n');
  // only the LB global (last resort before '')
  assert.strictEqual(compileHfbNonce({ SML_LB_NONCE: 'lb-n' }), 'lb-n');
});

/* ------------------------------------------------ 3. empty + never throws */
test("hfbNonce returns '' when nothing is set, and never throws", () => {
  assert.strictEqual(compileHfbNonce({}), '');
  // Even a hostile window whose property access throws is swallowed by the try/catch.
  let n;
  assert.doesNotThrow(() => { n = compileHfbNonce(undefined); });
  assert.strictEqual(n, '');
  const hostileWindow = new Proxy({}, { get() { throw new Error('boom'); } });
  assert.doesNotThrow(() => { n = compileHfbNonce(hostileWindow); });
  assert.strictEqual(n, '');
});

/* ------------------------------------------------ 4. click with no nonce */
test('click with no nonce: fetch NOT called, in-card refresh error shown, button untouched', async () => {
  const h = makeHarness({ window: {} }); // no nonce globals at all
  const ev = h.click();
  await flush();
  assert.strictEqual(ev.prevented, true, 'preventDefault was called');
  assert.strictEqual(h.calls.confirms, 1, 'confirm dialog was shown');
  assert.strictEqual(h.calls.fetch.length, 0, 'fetch must not be called without a nonce');
  assert.ok(h.card._err, 'in-card error element was created');
  assert.strictEqual(h.card._err.className, 'sml-owner-delete-err');
  assert.strictEqual(h.card._err.attrs.role, 'alert');
  assert.strictEqual(h.card._err.textContent,
    'Your session needs to be refreshed before deleting. Reload the page and try again.');
  assert.strictEqual(h.card._err.style.display, 'block');
  assert.strictEqual(h.button.disabled, false, 'button was not disabled');
  assert.strictEqual(h.button.textContent, 'Delete', 'button label unchanged');
  assert.strictEqual(h.card.removed, false, 'card not removed');
});

/* ------------------------------------------------ 5. non-2xx with JSON message */
test('non-2xx JSON error: button restored, exact server message in-card, card kept', async () => {
  const h = makeHarness({
    window: { SMLHomeOwnerControls: { nonce: 'n1' } },
    response: () => ({
      ok: false, status: 403,
      json: () => Promise.resolve({ message: 'You can only delete content you own.' })
    })
  });
  h.click();
  await flush();
  assert.strictEqual(h.calls.fetch.length, 1, 'exactly one fetch');
  assert.strictEqual(h.button.disabled, false, 'button re-enabled after failure');
  assert.strictEqual(h.button.textContent, 'Delete', "button label restored to 'Delete'");
  assert.ok(h.card._err, 'in-card error element was created');
  assert.strictEqual(h.card._err.textContent, 'You can only delete content you own.',
    'error shows the exact server message');
  assert.strictEqual(h.card.removed, false, 'card must NOT be removed');
  assert.strictEqual(h.calls.timeouts.length, 0, 'no removal was scheduled');
});

/* ------------------------------------------------ 6. non-2xx with non-JSON body */
test('non-2xx non-JSON body: error message includes the HTTP status', async () => {
  const h = makeHarness({
    window: { SMLHomeOwnerControls: { nonce: 'n1' } },
    response: () => ({
      ok: false, status: 500,
      json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON'))
    })
  });
  h.click();
  await flush();
  assert.ok(h.card._err, 'in-card error element was created');
  assert.ok(h.card._err.textContent.indexOf('500') >= 0,
    'error message includes the HTTP status, got: ' + h.card._err.textContent);
  assert.strictEqual(h.card._err.textContent, 'The post could not be deleted (HTTP 500).');
  assert.strictEqual(h.button.disabled, false);
  assert.strictEqual(h.button.textContent, 'Delete');
  assert.strictEqual(h.card.removed, false);
});

/* ------------------------------------------------ 7. 200 success removes card */
test('200 {deleted:true}: removal path runs (transition set, remove scheduled), no error element', async () => {
  const h = makeHarness({
    window: { SMLHomeOwnerControls: { nonce: 'n1' } },
    response: () => ({
      ok: true, status: 200,
      json: () => Promise.resolve({ deleted: true })
    })
  });
  h.click();
  await flush();
  assert.strictEqual(h.calls.fetch.length, 1);
  assert.ok(String(h.card.style.transition || '').indexOf('opacity') >= 0, 'fade transition was set');
  assert.strictEqual(h.card.style.opacity, '0', 'card faded out');
  assert.strictEqual(h.card.style.transform, 'scale(.98)');
  assert.strictEqual(h.calls.timeouts.length, 1, 'removal scheduled exactly once');
  assert.strictEqual(h.calls.timeouts[0].ms, 260, 'removal scheduled after the 260ms fade');
  assert.strictEqual(h.card.removed, false, 'card not removed until the timer fires');
  h.calls.timeouts[0].fn(); // fire the scheduled removal
  assert.strictEqual(h.card.removed, true, 'card.remove() called by the scheduled callback');
  assert.strictEqual(h.calls.dedupe, 1, 'dedupeFeed re-ran after removal');
  assert.strictEqual(h.card._err, null, 'no error element on success');
  assert.strictEqual(h.doc.created.length, 0, 'no elements created on success');
});

/* ------------------------------------------------ 8. endpoint selection */
test('endpoint from SMLHomeOwnerControls.endpoint when present, default path otherwise', async () => {
  // configured endpoint wins
  const a = makeHarness({
    window: { SMLHomeOwnerControls: { nonce: 'n-a', endpoint: '/wp-json/custom-owner/v9/zap' } },
    itemId: '55',
    response: () => ({ ok: true, status: 200, json: () => Promise.resolve({ deleted: true }) })
  });
  a.click();
  await flush();
  assert.strictEqual(a.calls.fetch.length, 1);
  assert.strictEqual(a.calls.fetch[0].url, '/wp-json/custom-owner/v9/zap');

  // a cross-origin configured endpoint is REFUSED: same-origin credentials
  // would be silently dropped, so the client falls back to the relative route
  const x = makeHarness({
    window: { SMLHomeOwnerControls: { nonce: 'n-x', endpoint: 'https://evil.example/wp-json/steal' } },
    response: () => ({ ok: true, status: 200, json: () => Promise.resolve({ deleted: true }) })
  });
  x.click();
  await flush();
  assert.strictEqual(x.calls.fetch.length, 1);
  assert.strictEqual(x.calls.fetch[0].url, '/wp-json/sml-home-owner/v1/content', 'cross-origin endpoint ignored');
  assert.strictEqual(a.calls.fetch[0].init.method, 'DELETE');
  assert.strictEqual(a.calls.fetch[0].init.credentials, 'same-origin');
  assert.strictEqual(a.calls.fetch[0].init.headers['X-WP-Nonce'], 'n-a');
  assert.strictEqual(a.calls.fetch[0].init.headers['Content-Type'], 'application/json');
  assert.deepStrictEqual(JSON.parse(a.calls.fetch[0].init.body), { item_id: '55' });

  // no SMLHomeOwnerControls (nonce from wpApiSettings) -> default endpoint
  const b = makeHarness({
    window: { wpApiSettings: { nonce: 'n-b' } },
    response: () => ({ ok: true, status: 200, json: () => Promise.resolve({ deleted: true }) })
  });
  b.click();
  await flush();
  assert.strictEqual(b.calls.fetch.length, 1);
  assert.strictEqual(b.calls.fetch[0].url, '/wp-json/sml-home-owner/v1/content');
  assert.strictEqual(b.calls.fetch[0].init.headers['X-WP-Nonce'], 'n-b');

  // SMLHomeOwnerControls present but without endpoint -> default endpoint too
  const c = makeHarness({
    window: { SMLHomeOwnerControls: { nonce: 'n-c' } },
    response: () => ({ ok: true, status: 200, json: () => Promise.resolve({ deleted: true }) })
  });
  c.click();
  await flush();
  assert.strictEqual(c.calls.fetch[0].url, '/wp-json/sml-home-owner/v1/content');
});

/* ---------------------------------------------------------------- run */

(async function run() {
  let failed = 0;
  for (const c of cases) {
    try {
      await c.fn();
      console.log('PASS  ' + c.name);
    } catch (e) {
      failed++;
      console.error('FAIL  ' + c.name);
      console.error('      ' + String(e && e.message ? e.message : e).split('\n').join('\n      '));
    }
  }
  console.log('');
  console.log(failed === 0
    ? 'All ' + cases.length + ' tests passed.'
    : failed + ' of ' + cases.length + ' tests FAILED.');
  process.exit(failed === 0 ? 0 : 1);
})();
