'use strict';

/* A small animated GIF (GIF89a) encoder with no dependencies: RGBA frames in, a looping GIF out.
 * Colours are reduced to a palette of up to 256 entries built from the frames (a 5-bit-per-channel histogram, most used
 * colours first), then LZW-coded per frame. Good for chart animations (flat colours, few hues); not meant for photos. */

function buildPalette(frames, max = 256) {
  const hist = new Map();
  for (const f of frames) {
    const p = f.pixels;
    for (let i = 0; i < p.length; i += 4) {
      if (p[i + 3] < 128) continue;
      const key = ((p[i] >> 3) << 10) | ((p[i + 1] >> 3) << 5) | (p[i + 2] >> 3);
      hist.set(key, (hist.get(key) || 0) + 1);
    }
  }
  const top = [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, max - 1);
  const pal = [[0, 0, 0]]; // index 0 stays black (also the transparent slot when needed)
  for (const [key] of top) pal.push([((key >> 10) & 31) << 3 | 4, ((key >> 5) & 31) << 3 | 4, (key & 31) << 3 | 4]);
  while (pal.length < 2) pal.push([255, 255, 255]);
  return pal;
}
function nearestIndexer(pal) {
  const cache = new Map();
  return (r, g, b) => {
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    const hit = cache.get(key); if (hit != null) return hit;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pal.length; i++) { const d = (pal[i][0] - r) ** 2 + (pal[i][1] - g) ** 2 + (pal[i][2] - b) ** 2; if (d < bd) { bd = d; best = i; if (d === 0) break; } }
    cache.set(key, best); return best;
  };
}
function indexFrame(frame, index) {
  const { pixels, width, height } = frame, out = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) out[j] = pixels[i + 3] < 128 ? 0 : index(pixels[i], pixels[i + 1], pixels[i + 2]);
  return out;
}

/* LZW as the GIF spec wants it: variable code size, clear and end codes, sub-blocks of at most 255 bytes. */
function lzw(indexes, minCodeSize) {
  const out = []; let block = [];
  let bitBuf = 0, bitCnt = 0;
  const emit = (code, size) => { bitBuf |= code << bitCnt; bitCnt += size; while (bitCnt >= 8) { block.push(bitBuf & 255); bitBuf >>>= 8; bitCnt -= 8; if (block.length === 255) { out.push(255, ...block); block = []; } } };
  const CLEAR = 1 << minCodeSize, END = CLEAR + 1;
  let dict = new Map(), codeSize = minCodeSize + 1, next = END + 1;
  const reset = () => { dict = new Map(); codeSize = minCodeSize + 1; next = END + 1; };
  emit(CLEAR, codeSize);
  let prefix = -1;
  for (let i = 0; i < indexes.length; i++) {
    const k = indexes[i];
    if (prefix < 0) { prefix = k; continue; }
    const key = prefix * 4096 + k;
    const found = dict.get(key);
    if (found != null) { prefix = found; continue; }
    emit(prefix, codeSize);
    if (next < 4096) { dict.set(key, next++); if (next - 1 === (1 << codeSize) && codeSize < 12) codeSize++; }
    else { emit(CLEAR, codeSize); reset(); }
    prefix = k;
  }
  if (prefix >= 0) emit(prefix, codeSize);
  emit(END, codeSize);
  if (bitCnt > 0) block.push(bitBuf & 255);
  if (block.length) out.push(block.length, ...block);
  out.push(0);
  return Uint8Array.from(out);
}

/* frames: [{ width, height, pixels (RGBA Uint8Array) }], all the same size. delayMs per frame (array or number). */
function encodeGif(frames, { delayMs = 120, loop = 0, lastHoldMs = null } = {}) {
  if (!frames || !frames.length) throw new Error('no_frames');
  const { width, height } = frames[0];
  const pal = buildPalette(frames);
  const index = nearestIndexer(pal);
  let bits = 1; while ((1 << bits) < pal.length) bits++;
  const palSize = 1 << bits;
  const bytes = [];
  const u16 = (v) => bytes.push(v & 255, (v >> 8) & 255);
  // header + logical screen
  bytes.push(0x47, 0x49, 0x46, 0x38, 0x39, 0x61); u16(width); u16(height);
  bytes.push(0x80 | ((bits - 1) << 4) | (bits - 1), 0, 0);
  for (let i = 0; i < palSize; i++) { const c = pal[i] || [0, 0, 0]; bytes.push(c[0], c[1], c[2]); }
  // looping
  bytes.push(0x21, 0xFF, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1); u16(loop); bytes.push(0);
  const minCode = Math.max(2, bits);
  frames.forEach((f, i) => {
    const d = Array.isArray(delayMs) ? delayMs[i] : (i === frames.length - 1 && lastHoldMs != null ? lastHoldMs : delayMs);
    bytes.push(0x21, 0xF9, 4, 0x04, 0, 0, 0, 0); // graphic control: do not dispose, no transparency
    const pos = bytes.length - 5; bytes[pos] = Math.round(d / 10) & 255; bytes[pos + 1] = (Math.round(d / 10) >> 8) & 255;
    bytes.push(0x2C); u16(0); u16(0); u16(width); u16(height); bytes.push(0); // image descriptor, global palette
    bytes.push(minCode);
    const data = lzw(indexFrame(f, index), minCode);
    for (let k = 0; k < data.length; k++) bytes.push(data[k]);
  });
  bytes.push(0x3B);
  return Buffer.from(bytes);
}

module.exports = { encodeGif, buildPalette, lzw };
