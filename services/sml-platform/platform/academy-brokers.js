'use strict';

/* Broker quote links for the Academy's Buy buttons. Every link lands on the stock's QUOTE page in the
   member's own app or site — never an order ticket; the member reviews and places any order there. */

const SYMBOL_RE = /^[A-Z][A-Z0-9.\-]{0,9}$/;
/* Massive primary-exchange MIC → Webull's quote-URL prefix (webull.com/quote/<prefix>-<symbol>). */
const WEBULL_PREFIX = Object.freeze({ XNAS: 'nasdaq', XNYS: 'nyse', ARCX: 'nysearca', XASE: 'nyseamerican', BATS: 'cboe', XNMS: 'nasdaq', XNGS: 'nasdaq', XNCM: 'nasdaq' });

function cleanSymbol(value) {
  const symbol = String(value || '').toUpperCase().replace(/[^A-Z0-9.\-]/g, '').slice(0, 10);
  return SYMBOL_RE.test(symbol) ? symbol : '';
}

function robinhoodUrl(symbol) { return 'https://robinhood.com/stocks/' + encodeURIComponent(symbol); }
function webullUrl(symbol, mic) { return 'https://www.webull.com/quote/' + (WEBULL_PREFIX[mic] || 'nasdaq') + '-' + encodeURIComponent(symbol.toLowerCase().replace(/\./g, '')); }

function createBrokerLinks({ apiKey = '', fetchImpl = fetch, now = Date.now } = {}) {
  const exchanges = new Map();
  async function exchangeOf(symbol) {
    const hit = exchanges.get(symbol);
    if (hit && hit.until > now()) return hit.mic;
    let mic = '';
    if (apiKey) {
      try {
        const response = await fetchImpl('https://api.massive.com/v3/reference/tickers/' + encodeURIComponent(symbol), { headers: { accept: 'application/json', authorization: 'Bearer ' + apiKey }, signal: AbortSignal.timeout(2500) });
        if (response.ok) mic = String(((await response.json()) || {}).results?.primary_exchange || '').toUpperCase();
      } catch (_) { /* the fallback prefix still reaches Webull, which corrects a wrong exchange itself on most listings */ }
    }
    exchanges.set(symbol, { mic, until: now() + (mic ? 7 * 86_400_000 : 600_000) });
    if (exchanges.size > 2000) exchanges.delete(exchanges.keys().next().value);
    return mic;
  }
  async function urlFor(broker, rawSymbol) {
    const symbol = cleanSymbol(rawSymbol);
    if (!symbol) throw new TypeError('invalid_symbol');
    if (broker === 'robinhood') return robinhoodUrl(symbol);
    if (broker === 'webull') return webullUrl(symbol, await exchangeOf(symbol));
    throw new TypeError('invalid_broker');
  }
  return { urlFor, exchangeOf };
}

module.exports = { createBrokerLinks, cleanSymbol, robinhoodUrl, webullUrl, WEBULL_PREFIX };
