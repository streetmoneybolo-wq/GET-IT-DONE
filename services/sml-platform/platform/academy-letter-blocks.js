'use strict';

/* Loop Letters store a letter as blocks, not HTML (letters-api.php: heading, paragraph with spans, list, quote, image,
 * disclosure, ...). The story desk drafts in HTML, so this turns that HTML into the block shapes the reader renders.
 * Only the tags the draft emits are handled (h2/h3/h4, p, ul/ol/li, blockquote, figure/img, strong/em/a, small); anything
 * else collapses to its text. Entities are decoded because the renderer escapes every span again. */

const decode = (s) => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
const squash = (s) => decode(String(s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
let nextId = 0;
const bid = (prefix) => `${prefix}${++nextId}`;

/* inline html -> spans with marks (bold, italic, link, ticker for $SYM words) */
function spansOf(html, { tickers = [] } = {}) {
  const out = [];
  const push = (text, mark, extra) => { const t = decode(text); if (!t) return; const last = out[out.length - 1]; if (last && !mark && !last.mark) { last.text += t; return; } out.push({ text: t, ...(mark ? { mark } : {}), ...(extra || {}) }); };
  const re = /<(strong|b|em|i|a)(\s[^>]*)?>([\s\S]*?)<\/\1>|<[^>]+>|([^<]+)/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    if (m[1]) {
      const tag = m[1].toLowerCase(), inner = m[3].replace(/<[^>]+>/g, '');
      if (tag === 'strong' || tag === 'b') push(inner, 'bold');
      else if (tag === 'em' || tag === 'i') push(inner, 'italic');
      else { const href = /href="([^"]+)"/.exec(m[2] || ''); if (href) push(inner, 'link', { href: decode(href[1]) }); else push(inner); }
    } else if (m[4]) {
      // split plain text on $SYM so the reader can link the ticker
      let text = m[4], hit;
      const tre = /\$([A-Z][A-Z0-9.\-]{0,9})\b/g;
      let at = 0;
      while ((hit = tre.exec(text))) {
        if (!tickers.length || tickers.includes(hit[1])) { push(text.slice(at, hit.index)); push('$' + hit[1], 'ticker', { symbol: hit[1] }); at = hit.index + hit[0].length; }
      }
      push(text.slice(at));
    }
  }
  // normalise whitespace inside each span without eating the boundaries between spans
  for (const s of out) s.text = s.text.replace(/\s+/g, ' ');
  while (out.length && !out[0].text.trim()) out.shift();
  while (out.length && !out[out.length - 1].text.trim()) out.pop();
  if (out.length) { out[0].text = out[0].text.replace(/^\s+/, ''); out[out.length - 1].text = out[out.length - 1].text.replace(/\s+$/, ''); }
  return out;
}

function htmlToBlocks(html, { tickers = [], cover = null, disclosure = null } = {}) {
  const blocks = [];
  if (cover && cover.url) blocks.push({ id: bid('img'), type: 'image', url: cover.url, alt: cover.alt || '', caption: cover.caption || '' });
  const re = /<(h[2-4]|p|ul|ol|blockquote|figure)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const tag = m[1].toLowerCase(), inner = m[3];
    if (tag[0] === 'h') { const text = squash(inner); if (text) blocks.push({ id: bid('h'), type: 'heading', level: Number(tag[1]), text }); }
    else if (tag === 'p') {
      const spans = spansOf(inner.replace(/<\/?small>/g, ''), { tickers });
      if (spans.length) blocks.push({ id: bid('p'), type: 'paragraph', spans });
    } else if (tag === 'ul' || tag === 'ol') {
      const items = []; let li; const lre = /<li(\s[^>]*)?>([\s\S]*?)<\/li>/gi;
      while ((li = lre.exec(inner))) { const t = squash(li[2]); if (t) items.push(t); }
      if (items.length) blocks.push({ id: bid('l'), type: 'list', style: tag === 'ol' ? 'number' : 'bullet', items });
    } else if (tag === 'blockquote') { const text = squash(inner); if (text) blocks.push({ id: bid('q'), type: 'quote', text }); }
    else if (tag === 'figure') {
      const src = /<img[^>]*\ssrc="([^"]+)"/i.exec(inner), alt = /<img[^>]*\salt="([^"]*)"/i.exec(inner), cap = /<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i.exec(inner);
      if (src && !(cover && cover.url === decode(src[1]))) blocks.push({ id: bid('img'), type: 'image', url: decode(src[1]), alt: alt ? decode(alt[1]) : '', caption: cap ? squash(cap[1]) : '' });
    }
  }
  if (disclosure) blocks.push({ id: bid('d'), type: 'disclosure', position: disclosure.position || 'no position disclosed', size: disclosure.size || '' });
  return blocks;
}

const plainText = (blocks) => blocks.map((b) => b.type === 'paragraph' ? b.spans.map((s) => s.text).join('') : b.type === 'list' ? b.items.join(' ') : b.text || '').join('\n');

module.exports = { htmlToBlocks, spansOf, plainText };
