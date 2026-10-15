'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeGif, buildPalette } = require('./gif-encode');

function frame(w, h, fill) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = fill(x, y), i = (y * w + x) * 4; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255; }
  return { width: w, height: h, pixels: px };
}

test('a looping GIF89a with the right header, palette, frame count and trailer', () => {
  const frames = [];
  for (let k = 0; k < 6; k++) frames.push(frame(40, 24, (x, y) => (x < k * 6 ? [0, 196, 125] : y > 12 ? [7, 11, 16] : [255, 84, 112])));
  const gif = encodeGif(frames, { delayMs: 100, lastHoldMs: 900 });
  assert.equal(gif.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.equal(gif.readUInt16LE(6), 40); assert.equal(gif.readUInt16LE(8), 24);
  assert.equal(gif[gif.length - 1], 0x3B);
  let images = 0; for (let i = 0; i < gif.length; i++) if (gif[i] === 0x2C && gif[i + 1] === 0 && gif[i + 2] === 0 && gif[i + 3] === 0 && gif[i + 4] === 0) images++;
  assert.equal(images, 6);
  assert.ok(gif.indexOf(Buffer.from('NETSCAPE2.0')) > 0, 'loops');
  assert.ok(gif.length < 40 * 24 * 6, 'compressed');
  const pal = buildPalette(frames);
  assert.ok(pal.length >= 3 && pal.length <= 256);
});

test('a frame with many colours still fits a 256-entry palette and encodes', () => {
  const f = frame(64, 64, (x, y) => [x * 4, y * 4, (x + y) * 2]);
  const gif = encodeGif([f, f], { delayMs: 50 });
  assert.equal(gif.subarray(0, 6).toString('ascii'), 'GIF89a');
  assert.throws(() => encodeGif([]), /no_frames/);
});
