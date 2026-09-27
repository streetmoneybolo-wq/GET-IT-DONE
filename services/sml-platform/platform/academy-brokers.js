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

/* The owner's referral sign-up links: where a Buy button sends a member who does not have that broker's app yet. */
const SIGNUP = Object.freeze({ moomoo: 'https://j.moomoo.com/00isCK', webull: 'https://a.webull.com/gsHkJGq3lyekBxLcvC' });
const NAMES = Object.freeze({ moomoo: 'moomoo', webull: 'Webull', robinhood: 'Robinhood' });

function moomooQuoteUrl(symbol) { return 'https://www.moomoo.com/stock/' + encodeURIComponent(symbol) + '-US'; }
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

const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* The page a Buy button opens in the phone's own browser (Discord only hands https links out).
   Phones: moomoo's app is tried straight away on its own ftmm:// scheme. If the app opens, this page is hidden and nothing
   else happens; if it is still on screen ~2.5 s later the app is not installed, so the member goes to the sign-up link.
   Webull has no public app scheme this page can try, so it offers the two choices side by side (open the stock / sign up).
   Desktop has no way to tell whether an app is installed, so it also offers both. Only quote pages — never an order ticket. */
function brokerLaunchHtml(broker, symbol, quoteUrl) {
  const name = NAMES[broker], signup = SIGNUP[broker];
  const appUrl = broker === 'moomoo' ? 'ftmm://url/' + encodeURIComponent(quoteUrl) : '';
  const cfg = JSON.stringify({ appUrl, signup, quoteUrl }).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(symbol)} on ${esc(name)}</title><meta name="referrer" content="no-referrer">
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#070b10;color:#eef4f7;font-family:system-ui,-apple-system,Segoe UI,sans-serif}.card{width:min(420px,calc(100vw - 32px));padding:24px;border:1px solid #1f3942;border-radius:14px;background:#0d1720;text-align:center}h1{margin:0 0 6px;font-size:1.1rem}h1 b{color:#79efbd;font-family:ui-monospace,monospace}p{margin:0 0 16px;color:#9fb3be;font-size:.85rem;line-height:1.45}a{display:block;margin:10px 0;padding:13px;border-radius:10px;font-weight:800;text-decoration:none}.open{background:#00c47d;color:#042217}.join{border:1px dashed #e0b43a;color:#ffd86b;background:#1a1606}small{display:block;margin-top:14px;color:#6f8794;font-size:.7rem;line-height:1.4}</style></head>
<body><main class="card"><h1><b>${esc(symbol)}</b> on ${esc(name)}</h1><p id="lead">${appUrl ? 'Opening the ' + esc(name) + ' app…' : 'Choose where to go.'}</p>
<a class="open" id="open" href="${esc(quoteUrl)}">I have ${esc(name)} — open ${esc(symbol)}</a>
<a class="join" id="join" href="${esc(signup)}">New to ${esc(name)}? Open an account</a>
<small>The account link is a referral link: Making Easy Money may earn a reward if you sign up. Orders are only ever placed by you inside ${esc(name)}.</small></main>
<script>(()=>{const c=${cfg},phone=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);if(!phone||!c.appUrl)return;
let left=false;const away=()=>{left=true};document.addEventListener('visibilitychange',()=>{if(document.hidden)away()});window.addEventListener('pagehide',away);window.addEventListener('blur',away);
document.getElementById('open').setAttribute('href',c.appUrl);location.href=c.appUrl;
setTimeout(()=>{if(!left&&!document.hidden){document.getElementById('lead').textContent='No app found — taking you to sign up…';location.href=c.signup}},2500)})();</script></body></html>`;
}

module.exports = { createBrokerLinks, cleanSymbol, robinhoodUrl, webullUrl, moomooQuoteUrl, brokerLaunchHtml, SIGNUP, WEBULL_PREFIX };
