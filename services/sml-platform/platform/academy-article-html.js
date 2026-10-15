'use strict';

/* The Article Desk's HTML and CSS.
 *
 *   card(parts)      the styled summary block inside the published letter (kicker, key takeaways, stat tiles, the path ladder).
 *                    Loop Letters render it in a sandboxed frame, so it is a visual companion; the article's indexable text
 *                    lives in the letter's own heading and paragraph blocks.
 *   document(a)      the whole article as one self-contained, standards-clean page: semantic markup, embedded CSS (light and
 *                    dark), schema.org NewsArticle microdata and JSON-LD, Open Graph and Twitter tags. Used for the owner's
 *                    review copy and anywhere the piece is syndicated.
 * Both escape every value; neither carries script. */

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const plain = (s) => String(s == null ? '' : s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const accentOf = (lean) => (lean === 'bearish' ? '#ff6b6b' : '#00c47d');
const px = (v) => (v >= 1 ? '$' + Number(v).toFixed(2) : '$' + Number(v).toFixed(4));
const pct = (v) => (v >= 0 ? '+' : '') + Number(v).toFixed(1) + '%';

const CARD_CSS = [
  ':root{--acc:#00c47d;--ink:#eaf2f7;--mut:#8da3b2;--bg:#07101a;--line:rgba(255,255,255,.10)}',
  '*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--ink);font:500 15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
  '.ad{border:1px solid var(--line);border-radius:18px;background:linear-gradient(160deg,#0b1826 0%,#07101a 60%);padding:20px;position:relative;overflow:hidden}',
  '.ad:before{content:"";position:absolute;inset:0 0 auto 0;height:3px;background:linear-gradient(90deg,var(--acc),transparent)}',
  '.ad-k{font:800 11px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.16em;color:var(--acc)}',
  '.ad-h{margin:8px 0 4px;font:800 21px/1.18 system-ui,sans-serif;letter-spacing:-.01em;color:#fff}',
  '.ad-d{margin:0 0 14px;color:var(--mut);font-size:14px}',
  '.ad-s{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px;margin:0 0 14px}',
  '.ad-s div{padding:9px 11px;border-radius:12px;background:rgba(255,255,255,.04);border:1px solid var(--line)}',
  '.ad-s span{display:block;font:800 10px/1 ui-monospace,monospace;letter-spacing:.12em;color:var(--mut)}',
  '.ad-s b{display:block;margin-top:5px;font:800 18px/1 system-ui,sans-serif;color:#fff}.ad-s b.up{color:#52e6ad}.ad-s b.dn{color:#ff8a8a}',
  '.ad-t{margin:0;padding:0;list-style:none;counter-reset:t;display:grid;gap:8px}',
  '.ad-t li{counter-increment:t;position:relative;padding:8px 10px 8px 40px;border-radius:12px;background:rgba(255,255,255,.035)}',
  '.ad-t li:before{content:counter(t);position:absolute;left:10px;top:8px;width:20px;height:20px;border-radius:50%;background:var(--acc);color:#04140d;font:800 12px/20px system-ui;text-align:center}',
  '.ad-p{margin:14px 0 0;padding:0;list-style:none;display:grid;gap:0;border-left:2px solid var(--acc);margin-left:6px}',
  '.ad-p li{position:relative;padding:6px 0 6px 18px;font-size:14px}.ad-p li b{color:#fff}',
  '.ad-p li:before{content:"";position:absolute;left:-7px;top:12px;width:12px;height:12px;border-radius:50%;background:#07101a;border:2px solid var(--acc)}',
  '.ad-f{margin:14px 0 0;color:var(--mut);font-size:12px}',
  '@media(max-width:520px){.ad{padding:14px}.ad-h{font-size:18px}}'
].join('\n');

function stats(parts) {
  const rows = [['PRICE', px(parts.price)]];
  if (Number.isFinite(parts.changePct)) rows.push(['TODAY', pct(parts.changePct), parts.changePct >= 0 ? 'up' : 'dn']);
  if (Number.isFinite(parts.relVol)) rows.push(['REL VOLUME', parts.relVol.toFixed(1) + 'x']);
  rows.push(['SCENARIO TARGET', px(parts.pt) + ' (' + pct(parts.ptPct) + ')', parts.ptPct >= 0 ? 'up' : 'dn']);
  if (Number.isFinite(parts.stop)) rows.push(['INVALIDATION', px(parts.stop)]);
  if (parts.keyStat) rows.push([parts.keyStat.label, parts.keyStat.value]);
  return rows;
}

function card(parts) {
  const acc = accentOf(parts.lean);
  const html = '<section class="ad" style="--acc:' + acc + '" aria-label="Key takeaways">'
    + '<div class="ad-k">' + esc(parts.kicker) + ' · ' + esc(String(parts.lean || '').toUpperCase()) + ' LEAN</div>'
    + '<h2 class="ad-h">' + esc(parts.symbolLine) + '</h2>'
    + '<p class="ad-d">' + esc(parts.dek) + '</p>'
    + '<div class="ad-s">' + stats(parts).map(([l, v, cls]) => '<div><span>' + esc(l) + '</span><b' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(v) + '</b></div>').join('') + '</div>'
    + '<ol class="ad-t">' + parts.takeaways.map((t) => '<li>' + esc(t) + '</li>').join('') + '</ol>'
    + '<ol class="ad-p" aria-label="The path">' + parts.ladder.map((s) => '<li><b>' + esc(s.label) + ':</b> ' + esc(s.text) + '</li>').join('') + '</ol>'
    + '<p class="ad-f">Educational scenario as of ' + esc(parts.when) + '. Not financial advice.</p></section>';
  const lines = parts.takeaways.length + parts.ladder.length;
  return { html, css: CARD_CSS, height: Math.min(900, Math.max(420, 260 + lines * 34)) };
}

const DOC_CSS = [
  ':root{--bg:#fbfbf8;--ink:#14181d;--mut:#5b6773;--line:#e4e6e0;--card:#ffffff;--acc:#00a56a;--hl:#d8f7e8}',
  '@media(prefers-color-scheme:dark){:root{--bg:#0a1016;--ink:#e9eff3;--mut:#93a4b0;--line:#1b2733;--card:#0e1721;--acc:#35d49a;--hl:#0f3b2a}}',
  '*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--ink);font:400 18px/1.7 "Iowan Old Style","Charter",Georgia,serif}',
  '.wrap{max-width:720px;margin:0 auto;padding:28px 18px 80px}',
  '.kick{font:800 12px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.16em;color:var(--acc);text-transform:uppercase}',
  'h1{margin:10px 0 10px;font:800 clamp(28px,5.4vw,44px)/1.08 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.025em}',
  '.dek{margin:0 0 16px;font:500 clamp(18px,2.6vw,22px)/1.4 system-ui,sans-serif;color:var(--mut)}',
  '.by{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;padding:12px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);font:600 14px/1.3 system-ui,sans-serif;color:var(--mut)}.by b{color:var(--ink)}',
  'figure{margin:22px 0}figure img{display:block;width:100%;height:auto;border-radius:14px;border:1px solid var(--line)}figcaption{margin-top:8px;font:500 13px/1.4 system-ui,sans-serif;color:var(--mut)}',
  'h2{margin:34px 0 10px;font:800 24px/1.2 system-ui,sans-serif;letter-spacing:-.01em}h2:after{content:"";display:block;width:44px;height:4px;margin-top:8px;border-radius:2px;background:var(--acc)}',
  'p{margin:0 0 16px}strong{font-weight:700}em{font-style:italic}',
  'ul,ol{margin:0 0 18px;padding-left:22px}li{margin:6px 0}',
  '.board{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin:18px 0 6px;font-family:system-ui,sans-serif}',
  '.board div{padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--card)}.board span{display:block;font:800 11px/1 ui-monospace,monospace;letter-spacing:.12em;color:var(--mut)}.board b{display:block;margin-top:7px;font:800 21px/1 system-ui,sans-serif}',
  '.take{margin:20px 0;padding:16px 18px;border-left:5px solid var(--acc);background:var(--hl);border-radius:0 14px 14px 0;font-family:system-ui,sans-serif}.take h2{margin:0 0 8px;font-size:15px;letter-spacing:.1em;text-transform:uppercase}.take h2:after{display:none}.take ul{margin:0;padding-left:20px}',
  '.pull{margin:26px 0;padding:6px 0 6px 18px;border-left:4px solid var(--acc);font:700 clamp(20px,3vw,26px)/1.3 system-ui,sans-serif;letter-spacing:-.01em}',
  '.disclosure{margin-top:34px;padding:14px 16px;border:1px solid var(--line);border-radius:12px;background:var(--card);font:400 14px/1.55 system-ui,sans-serif;color:var(--mut)}',
  'a{color:var(--acc)}',
  '@media print{body{background:#fff;color:#000}.board div,.disclosure{border-color:#999}}'
].join('\n');

/* article: { headline, dek, kicker, bodyHtml, parts, byline, publication, url, imageUrl, gifUrl, datePublished, dateModified, tags, keyword, description, section, siteUrl, authorUrl, logoUrl } */
function document(a) {
  const p = a.parts || {};
  const title = esc(a.headline), desc = esc(a.description || plain(a.dek).slice(0, 155));
  const ld = {
    '@context': 'https://schema.org', '@type': 'NewsArticle', headline: String(a.headline).slice(0, 110), description: plain(a.description || a.dek).slice(0, 200),
    mainEntityOfPage: { '@type': 'WebPage', '@id': a.url || '' }, url: a.url || undefined, image: a.imageUrl ? [a.imageUrl] : undefined,
    datePublished: a.datePublished, dateModified: a.dateModified || a.datePublished, articleSection: a.section || 'Markets', keywords: (a.tags || []).join(', '), inLanguage: 'en-US', isAccessibleForFree: true,
    author: { '@type': 'Person', name: a.byline, url: a.authorUrl || undefined },
    publisher: { '@type': 'Organization', name: a.publication, url: a.siteUrl || undefined, logo: a.logoUrl ? { '@type': 'ImageObject', url: a.logoUrl } : undefined }
  };
  const board = stats(p).map(([l, v]) => '<div><span>' + esc(l) + '</span><b>' + esc(v) + '</b></div>').join('');
  const taken = (p.takeaways || []).map((t) => '<li>' + esc(t) + '</li>').join('');
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(a.metaTitle || a.headline) + '</title><meta name="description" content="' + desc + '">'
    + (a.url ? '<link rel="canonical" href="' + esc(a.url) + '">' : '')
    + '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">'
    + '<meta name="author" content="' + esc(a.byline) + '"><meta name="news_keywords" content="' + esc((a.tags || []).join(', ')) + '">'
    + '<meta property="og:type" content="article"><meta property="og:site_name" content="' + esc(a.publication) + '"><meta property="og:title" content="' + title + '"><meta property="og:description" content="' + desc + '">'
    + (a.url ? '<meta property="og:url" content="' + esc(a.url) + '">' : '') + (a.imageUrl ? '<meta property="og:image" content="' + esc(a.imageUrl) + '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="675">' : '')
    + '<meta property="article:published_time" content="' + esc(a.datePublished) + '"><meta property="article:modified_time" content="' + esc(a.dateModified || a.datePublished) + '"><meta property="article:author" content="' + esc(a.byline) + '"><meta property="article:section" content="' + esc(a.section || 'Markets') + '">'
    + (a.tags || []).slice(0, 8).map((t) => '<meta property="article:tag" content="' + esc(t) + '">').join('')
    + '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + title + '"><meta name="twitter:description" content="' + desc + '">' + (a.imageUrl ? '<meta name="twitter:image" content="' + esc(a.imageUrl) + '">' : '')
    + '<script type="application/ld+json">' + JSON.stringify(ld).replace(/</g, '\\u003c') + '</script>'
    + '<style>' + DOC_CSS + '</style></head><body><div class="wrap"><article itemscope itemtype="https://schema.org/NewsArticle">'
    + '<header><div class="kick">' + esc(a.kicker) + '</div><h1 itemprop="headline">' + title + '</h1><p class="dek" itemprop="description">' + esc(a.dek) + '</p>'
    + '<div class="by"><span>By <b itemprop="author">' + esc(a.byline) + '</b></span><span>' + esc(a.publication) + '</span><time itemprop="datePublished" datetime="' + esc(a.datePublished) + '">' + esc(p.when || '') + '</time></div></header>'
    + (a.gifUrl ? '<figure><img src="' + esc(a.gifUrl) + '" alt="' + esc(p.symbolLine || a.headline) + ' scenario: real candles, then the path to the target" width="960" height="540" loading="eager"><figcaption>Speculative scenario animation: real candles, then the path the setup needs. Not a forecast.</figcaption></figure>' : '')
    + '<div class="board" aria-label="Key figures">' + board + '</div>'
    + '<aside class="take"><h2>Key takeaways</h2><ul>' + taken + '</ul></aside>'
    + '<div itemprop="articleBody">' + a.bodyHtml + '</div>'
    + '</article></div></body></html>';
}

module.exports = { card, document, CARD_CSS, DOC_CSS, stats };
