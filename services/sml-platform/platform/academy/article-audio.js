'use strict';

/* The listen-to-this-article script. An article is not read in full: the voice reads the part a listener wants (the headline, the standfirst, the lede, each
 * section's heading and opening paragraph, the close and one standard line), about three hundred words, so a piece costs a fraction of a full read. The script is
 * cut into short parts and each part is stored by its own text (academy-voice.js partAudio), so a part spoken before, for any article or lesson, is never paid for
 * twice: the standard closing line, a repeated heading, a repeated sentence. Tickers are spelled out letter by letter so the voice does not say them as words. */

const MAX_CHARS = 2400, PART_CHARS = 420, INTRO_CHARS = 520;
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

/** n: the narrative { title, dek, lede[], sections[{heading, paragraphs[]}], bottom }.
 *  Returns { parts, hash, chars, intro, introHash, rest }:
 *    intro  the opening (headline, standfirst, the first lede paragraph, up to INTRO_CHARS): the only part spoken in the owner's voice unless the owner turns the full voice on
 *    rest   everything else as plain speakable text, read by the listener's own browser voice (free) on the listen page
 *    parts  the whole script as voice parts (intro, the rest, the standard closing line): recorded in the owner's voice only for articles the owner picks */
function audioScript(n) {
  const empty = { parts: [], hash: '', chars: 0, intro: [], introHash: '', rest: '' };
  if (!n) return empty;
  const pieces = [];
  const add = (t) => { const s = plain(t); if (s) pieces.push(/[.!?]$/.test(s) ? s : s + '.'); };
  add(n.title); add(n.dek);
  for (const p of (n.lede || [])) add(p);
  for (const sec of (n.sections || [])) { add(sec.heading); if (sec.paragraphs && sec.paragraphs[0]) add(sec.paragraphs[0]); }
  add(n.bottom);
  const hashOf = (list) => require('node:crypto').createHash('sha256').update(list.join('\n')).digest('hex').slice(0, 12);
  /* the intro: whole pieces from the top while they fit, so it ends on a sentence */
  let introText = '', used = 0;
  for (const piece of pieces) { const sp = speakable(piece); if (introText && (introText + ' ' + sp).length > INTRO_CHARS) break; introText = introText ? introText + ' ' + sp : sp; used += 1; if (introText.length >= INTRO_CHARS * 0.8) break; }
  const restText = pieces.slice(used).map(speakable).join(' ');
  const intro = packed(introText);
  let all = pieces.join(' ');
  if (all.length > MAX_CHARS) { all = all.slice(0, MAX_CHARS); all = all.slice(0, Math.max(all.lastIndexOf('. '), all.lastIndexOf('? '), all.lastIndexOf('! ')) + 1) || all; }
  const parts = packed(all); const chars = parts.reduce((n2, x) => n2 + x.length, 0);
  parts.push(CLOSER);
  return { parts, hash: hashOf(parts), chars: chars + CLOSER.length, intro, introHash: hashOf(intro), rest: (restText ? restText + ' ' : '') + CLOSER };
}

module.exports = { audioScript, speakable, packed, CLOSER, MAX_CHARS, PART_CHARS, INTRO_CHARS };
