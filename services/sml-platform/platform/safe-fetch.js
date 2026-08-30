'use strict';

const dns = require('node:dns').promises;
const https = require('node:https');
const net = require('node:net');

function blockedIpv4(address) {
  const p = address.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 0) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 198 && (p[1] === 18 || p[1] === 19));
}

function blockedIp(address) {
  const family = net.isIP(address);
  if (family === 4) return blockedIpv4(address);
  if (family !== 6) return true;
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1' || lower.startsWith('fe8') || lower.startsWith('fe9') ||
      lower.startsWith('fea') || lower.startsWith('feb') || lower.startsWith('fc') || lower.startsWith('fd')) return true;
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? blockedIpv4(mapped[1]) : false;
}

async function publicAddress(hostname) {
  const answers = await dns.lookup(hostname, { all: true, verbatim: true });
  const answer = answers.find((item) => !blockedIp(item.address));
  if (!answer || answers.some((item) => blockedIp(item.address))) {
    const error = new Error('source host does not resolve exclusively to public addresses');
    error.code = 'unsafe_source_host';
    throw error;
  }
  return answer;
}

async function fetchPublicBuffer(input, options = {}, redirects = 0) {
  const url = input instanceof URL ? input : new URL(input);
  if (url.protocol !== 'https:' || url.username || url.password || !url.hostname) {
    const error = new Error('only public HTTPS URLs are allowed');
    error.code = 'unsafe_source_url';
    throw error;
  }
  if (redirects > (options.maxRedirects ?? 3)) {
    const error = new Error('too many redirects');
    error.code = 'too_many_redirects';
    throw error;
  }

  const resolved = await publicAddress(url.hostname);
  const maximum = options.maxBytes ?? 2 * 1024 * 1024;
  const timeoutMs = options.timeoutMs ?? 15_000;

  const response = await new Promise((resolve, reject) => {
    const request = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      port: url.port || 443,
      method: 'GET',
      path: `${url.pathname}${url.search}`,
      servername: url.hostname,
      headers: {
        accept: options.accept || 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
        'user-agent': 'StockMarketLoop-NewsBot/1.0 (+https://stockmarketloop.com/)'
      },
      lookup: (_host, lookupOptions, callback) => {
        if (lookupOptions && lookupOptions.all) callback(null, [{ address: resolved.address, family: resolved.family }]);
        else callback(null, resolved.address, resolved.family);
      }
    }, (incoming) => resolve(incoming));
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error('source request timed out'), { code: 'source_timeout' })));
    request.once('error', reject);
    request.end();
  });

  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    response.resume();
    return fetchPublicBuffer(new URL(response.headers.location, url), options, redirects + 1);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.resume();
    const error = new Error(`source returned HTTP ${response.statusCode}`);
    error.code = response.statusCode === 404 ? 'source_not_found' : 'source_http_error';
    error.statusCode = response.statusCode;
    throw error;
  }

  const declared = Number(response.headers['content-length']);
  if (Number.isFinite(declared) && declared > maximum) {
    response.destroy();
    const error = new Error('source response is too large');
    error.code = 'source_too_large';
    throw error;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of response) {
    size += chunk.length;
    if (size > maximum) {
      response.destroy();
      const error = new Error('source response is too large');
      error.code = 'source_too_large';
      throw error;
    }
    chunks.push(chunk);
  }
  return {
    body: Buffer.concat(chunks),
    contentType: String(response.headers['content-type'] || '').split(';')[0].trim().toLowerCase(),
    finalUrl: url.toString()
  };
}

module.exports = { blockedIp, fetchPublicBuffer, publicAddress };
