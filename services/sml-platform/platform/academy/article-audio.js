'use strict';

/* The listen-to-this-article script. An article is not read in full: the voice reads the part a listener wants (the headline, the standfirst, the lede, each
 * section's heading and opening paragraph, the close and one standard line), about three hundred words, so a piece costs a fraction of a full read. The script is
 * cut into short parts and each part is stored by its own text (academy-voice.js partAudio), so a part spoken before, for any article or lesson, is never paid for
 * twice: the standard closing line, a repeated heading, a repeated sentence. Tickers are spelled out letter by letter so the voice does not say them as words. */

const MAX_CHARS = 2400, PART_CHARS = 420;
const CLOSER = 'This is an educational analysis, not financial advice.';

const plain = (s) => String(s == null ? '' : s).replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/* "$NVDA" -> "N V D A"; a bare dollar figure stays as it is ("$191.77" is spoken as money); symbols that read badly are spoken as words */
function speakable(text) {
  return plain(text)
    .replace(/\$([A-Z]{1,5})(?:\.([A-Z]))?\b(?![\d.])/g, (m, t, cls) => t.split('').join(' ') + (cls ? ' ' + cls : ''))
    .replace(/\bETFs?\b/g, 'E T Fs').replace(/\bFINRA\b/g, 'FINRA').replace(/\bSEC\b/g, 'S E C').replace(/\bVWAP\b/g, 'V W A P').replace(/\bATR\b/g, 'A T R').replace(/\bIV\b/g, 'I V')
    .replace(/\b(\d+(?:\.\d+)?)x\b/g, '$1 times').replace(/%/g, ' percent').replace(/\s+([.,;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
}

/* sentences, packed into parts no longer than PART_CHARS */
function packed(text) {
  const out = []; let cur = '';
  for (const s of speakable(text).split(/(?<=[.!?])\s+/)) {
    if (!s) continue;
    if (cur && (cur + ' ' + s).length > PART_CHARS) { out.push(cur); cur = s; } else cur = cur ? cur + ' ' + s : s;
  }
  if (cur) out.push(cur);
  return out.flatMap((p) => (p.length > PART_CHARS * 1.5 ? p.match(new RegExp('.{1,' + PART_CHARS + '}(?:\\s|$)', 'g')).map((x) => x.trim()) : [p]));
}

/** n: the narrative { title, dek, lede[], sections[{heading, paragraphs[]}], bottom }. Returns { parts, hash, chars }. */
function audioScript(n) {
  if (!n) return { parts: [], hash: '', chars: 0 };
  const pieces = [];
  const add = (t) => { const s = plain(t); if (s) pieces.push(/[.!?]$/.test(s) ? s : s + '.'); };
  add(n.title); add(n.dek);
  for (const p of (n.lede || [])) add(p);
  for (const s of (n.sections || [])) { add(s.heading); if (s.paragraphs && s.paragraphs[0]) add(s.paragraphs[0]); }
  add(n.bottom);
  /* packed into parts of up to PART_CHARS so the voice keeps its rhythm across sentences and the number of calls stays small; capped at MAX_CHARS */
  let all = pieces.join(' ');
  if (all.length > MAX_CHARS) { all = all.slice(0, MAX_CHARS); all = all.slice(0, Math.max(all.lastIndexOf('. '), all.lastIndexOf('? '), all.lastIndexOf('! ')) + 1) || all; }
  const parts = packed(all); const chars = parts.reduce((n, x) => n + x.length, 0);
  parts.push(CLOSER);
  const hash = require('node:crypto').createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 12);
  return { parts, hash, chars: chars + CLOSER.length };
}

module.exports = { audioScript, speakable, packed, CLOSER, MAX_CHARS, PART_CHARS };
