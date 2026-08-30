'use strict';

const { fetchPublicBuffer } = require('./safe-fetch');

function decodeEntities(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(Number.parseInt(n, 16)));
}

function attrs(tag) {
  const result = {};
  for (const match of tag.matchAll(/([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

function metaMap(html) {
  const out = new Map();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = attrs(match[0]);
    const key = String(a.property || a.name || '').toLowerCase();
    if (key && a.content && !out.has(key)) out.set(key, a.content.trim());
  }
  return out;
}

function visibleText(html) {
  const article = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  return decodeEntities(article ? article[1] : html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchSourceArticle(sourceUrl, fetcher = fetchPublicBuffer) {
  const response = await fetcher(sourceUrl, { maxBytes: 2 * 1024 * 1024, timeoutMs: 15_000 });
  if (!/^(text\/html|application\/xhtml\+xml)$/.test(response.contentType)) {
    const error = new Error('source is not an HTML article');
    error.code = 'source_not_html';
    throw error;
  }
  const html = response.body.toString('utf8');
  const meta = metaMap(html);
  const titleMatch = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = meta.get('og:title') || meta.get('twitter:title') || decodeEntities(titleMatch && titleMatch[1]);
  const description = meta.get('description') || meta.get('og:description') || meta.get('twitter:description') || '';
  const imageUrl = meta.get('og:image:secure_url') || meta.get('og:image') || meta.get('twitter:image') || null;
  const text = visibleText(html).slice(0, 40_000);
  if (!title || text.length < 300) {
    const error = new Error('source does not contain enough article text');
    error.code = 'source_content_too_thin';
    throw error;
  }
  return {
    sourceUrl: response.finalUrl,
    title: title.replace(/\s+/g, ' ').trim().slice(0, 300),
    description: description.replace(/\s+/g, ' ').trim().slice(0, 1000),
    imageUrl: imageUrl ? new URL(imageUrl, response.finalUrl).toString() : null,
    text
  };
}

module.exports = { attrs, decodeEntities, fetchSourceArticle, metaMap, visibleText };
