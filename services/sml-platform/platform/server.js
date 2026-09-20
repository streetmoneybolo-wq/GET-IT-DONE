'use strict';

const http = require('node:http');
const { getConfig } = require('./config');
const { createDatabase } = require('./database');
const { log } = require('./logger');
const { parseEvent, readRequestBody, verifySignature } = require('./wordpress-gateway');
const stripeWebhook = require('./stripe-webhook');
const Stripe = require('stripe');
const billingService = require('./billing-service');
const { createUpgradeChatClient } = require('./upgrade-chat');
const newsWebhook = require('./news-webhook');
const paypalWebhookModule = require('./paypal-webhook');
const discordInteractionsModule = require('./discord-interactions');
const connectMigration = require('./connect-migration');

/* Dispute-evidence admin actions behind POST /v1/billing/disputes/{action}.
   Every action is HMAC-gated with SML_BILLING_API_SECRET (same scheme as the
   billing routes) and 503s while the dispute service is not enabled. */
const DISPUTE_ACTIONS = Object.freeze({
  list: 'listCases',
  detail: 'caseDetail',
  'build-packet': 'buildPacket',
  'issue-review-token': 'issueReviewToken',
  'redeem-review-token': 'redeemReviewToken',
  'approve-submit': 'approveAndSubmit',
  'record-policy': 'recordPolicy',
  'record-terms-version': 'recordTermsVersion',
  'record-consent': 'recordConsent',
  'link-admin': 'linkMerchantAdmin',
  admins: 'listMerchantAdmins',
  health: 'webhookHealth'
});

/*
 * Public, read-only adapter for the Reddit HUB.  Devvit cannot fetch the
 * StockMarketLoop personal domain directly, so the HUB calls this Render
 * service instead.  Nothing here accepts user input, exposes credentials, or
 * shares billing/dispute data.  A small process cache protects WordPress from
 * refresh bursts when a Reddit post is opened by multiple readers.
 */
const REDDIT_HUB_ORIGIN = 'https://stockmarketloop.com';
const REDDIT_HUB_CACHE_MS = 15_000;
let redditHubCache = { expiresAt: 0, payload: null };

function asHubObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asHubArray(value) {
  return Array.isArray(value) ? value : [];
}

function asHubText(value) {
  return typeof value === 'string' ? value : '';
}

function asHubNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

async function fetchRedditHubJson(path) {
  const response = await fetch(`${REDDIT_HUB_ORIGIN}${path}`, {
    headers: { Accept: 'application/json', 'User-Agent': 'StockMarketLoop-Reddit-HUB/1.0' },
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`upstream_${response.status}`);
  return response.json();
}

function sanitizeHubQuotes(value) {
  return asHubArray(asHubObject(value).rows).slice(0, 12).map((item) => {
    const row = asHubObject(item);
    return {
      symbol: asHubText(row.symbol || row.sym).toUpperCase().slice(0, 10),
      price: asHubNumber(row.price || row.last),
      change: asHubNumber(row.change || row.chg),
      changePct: asHubNumber(row.change_pct || row.chgPct),
      volume: asHubNumber(row.volume || row.v),
      bid: asHubNumber(row.bid) || undefined,
      ask: asHubNumber(row.ask) || undefined
    };
  }).filter((row) => /^[A-Z0-9.-]{1,10}$/.test(row.symbol));
}

function sanitizeHubScanner(value) {
  return asHubArray(asHubObject(value).rows).slice(0, 20).map((item) => {
    const row = asHubObject(item);
    return {
      symbol: asHubText(row.symbol || row.sym).toUpperCase().slice(0, 10),
      price: asHubNumber(row.price || row.last),
      changePct: asHubNumber(row.change_pct || row.chgPct),
      volume: asHubNumber(row.volume || row.v),
      postMarketPct: asHubNumber(row.postPct),
      quality: asHubText(row.quality).slice(0, 80)
    };
  }).filter((row) => /^[A-Z0-9.-]{1,10}$/.test(row.symbol));
}

function sanitizeHubNews(value) {
  return asHubArray(asHubObject(value).articles).slice(0, 24).map((item, index) => {
    const row = asHubObject(item);
    const author = asHubObject(row.author);
    return {
      id: asHubNumber(row.id) || index + 1,
      title: asHubText(row.title).slice(0, 240),
      excerpt: asHubText(row.excerpt).replace(/<[^>]*>/g, '').slice(0, 500),
      url: asHubText(row.url || row.link),
      image: asHubText(row.image || row.featured_image),
      author: asHubText(row.author_name || author.name || 'StockMarketLoop').slice(0, 120),
      publishedAt: asHubText(row.date || row.published_at)
    };
  }).filter((row) => row.title && row.url.startsWith('https://stockmarketloop.com/'));
}

async function getRedditHubBootstrap() {
  if (redditHubCache.payload && Date.now() < redditHubCache.expiresAt) return redditHubCache.payload;
  const symbols = 'SPY,QQQ,IWM,AAPL,NVDA,TSLA';
  const [quotes, movers, news] = await Promise.allSettled([
    fetchRedditHubJson(`/wp-json/sml-scanner/v1/quotes?symbols=${symbols}`),
    fetchRedditHubJson('/wp-json/sml-scanner/v1/live'),
    fetchRedditHubJson('/wp-json/sml-members/v1/news-feed')
  ]);
  const payload = {
    asOf: new Date().toISOString(),
    quotes: quotes.status === 'fulfilled' ? sanitizeHubQuotes(quotes.value) : [],
    movers: movers.status === 'fulfilled' ? sanitizeHubScanner(movers.value) : [],
    news: news.status === 'fulfilled' ? sanitizeHubNews(news.value) : [],
    sources: { authors: 19, brand: 'StockMarketLoop' }
  };
  redditHubCache = { expiresAt: Date.now() + REDDIT_HUB_CACHE_MS, payload };
  return payload;
}

async function handleDisputeRequest(request, response, options, methodName) {
  if (!contentTypeIsJson(request)) return sendJson(response, 415, { ok: false, error: 'content_type_required' });
  const body = await readRequestBody(request);
  if (!body.ok) return sendJson(response, body.status, { ok: false, error: body.error });
  const verified = verifySignature({
    secret: options.billingApiSecret,
    timestamp: request.headers['x-sml-timestamp'],
    signature: request.headers['x-sml-signature'],
    rawBody: body.rawBody,
    now: options.now()
  });
  if (!verified.ok) return sendJson(response, verified.status, { ok: false, error: verified.error });
  const service = options.disputeService;
  if (!service || typeof service[methodName] !== 'function') {
    return sendJson(response, 503, { ok: false, error: 'integration_unconfigured' });
  }
  let input;
  try {
    input = JSON.parse(body.rawBody);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid');
  } catch (_) {
    return sendJson(response, 400, { ok: false, error: 'invalid_json' });
  }
  try {
    const result = await service[methodName](input);
    sendJson(response, 200, { ok: true, ...(result && typeof result === 'object' ? result : { result }) });
  } catch (error) {
    const invalid = error instanceof TypeError;
    /* Only the action name and error class reach the log: inputs may carry
       review tokens and the service's own messages are neutral and PII-free. */
    options.logger(invalid ? 'warn' : 'error', 'dispute_request_failed', { action: methodName, error });
    sendJson(response, invalid ? 400 : 503, {
      ok: false,
      error: invalid ? 'invalid_request' : 'temporary_unavailable',
      ...(invalid ? { message: String(error.message).slice(0, 240) } : {})
    });
  }
}

/* Corporate-accounts admin actions behind POST /v1/corporate/{action}. Same
   HMAC scheme as billing; 503 until the corporate runtime is enabled. Refusals
   the operator must act on (cap reached, price moved, payment already used)
   are 409 with their code, distinct from malfunctions (503). */
async function handleCorporateRequest(request, response, options, action) {
  if (!contentTypeIsJson(request)) return sendJson(response, 415, { ok: false, error: 'content_type_required' });
  const body = await readRequestBody(request);
  if (!body.ok) return sendJson(response, body.status, { ok: false, error: body.error });
  const verified = verifySignature({
    secret: options.billingApiSecret,
    timestamp: request.headers['x-sml-timestamp'],
    signature: request.headers['x-sml-signature'],
    rawBody: body.rawBody,
    now: options.now()
  });
  if (!verified.ok) return sendJson(response, verified.status, { ok: false, error: verified.error });
  const runtime = options.corporate;
  if (!runtime || !runtime.enabled || !runtime.actions) {
    return sendJson(response, 503, { ok: false, error: 'integration_unconfigured' });
  }
  /* Own properties only: `actions` is a plain object, so a bare lookup would
     resolve /v1/corporate/constructor or /toString to Object.prototype methods. */
  const handler = Object.prototype.hasOwnProperty.call(runtime.actions, action) ? runtime.actions[action] : null;
  if (typeof handler !== 'function') return sendJson(response, 404, { ok: false, error: 'not_found' });
  let input;
  try {
    input = JSON.parse(body.rawBody);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid');
  } catch (_) {
    return sendJson(response, 400, { ok: false, error: 'invalid_json' });
  }
  try {
    const result = await handler(input);
    sendJson(response, 200, { ok: true, ...(result && typeof result === 'object' && !Array.isArray(result) ? result : { result }) });
  } catch (error) {
    const code = error && error.code;
    if (code === 'stripe_unconfigured') {
      return sendJson(response, 503, { ok: false, error: 'stripe_unconfigured' });
    }
    if (code && options.conflictCodes && options.conflictCodes.has(code)) {
      options.logger('warn', 'corporate_request_refused', { action, code });
      const extra = {};
      for (const key of ['remainingCents', 'netCents', 'alreadyRefunded']) {
        if (error[key] !== undefined) extra[key] = error[key];
      }
      return sendJson(response, 409, { ok: false, error: code, message: String(error.message).slice(0, 240), ...extra });
    }
    const invalid = error instanceof TypeError;
    options.logger(invalid ? 'warn' : 'error', 'corporate_request_failed', { action, error });
    sendJson(response, invalid ? 400 : 503, {
      ok: false,
      error: invalid ? 'invalid_request' : 'temporary_unavailable',
      ...(invalid ? { message: String(error.message).slice(0, 240) } : {})
    });
  }
}

async function handleAlertRequest(request, response, options, action) {
  if (!contentTypeIsJson(request)) return sendJson(response, 415, { ok: false, error: 'content_type_required' });
  const body = await readRequestBody(request);
  if (!body.ok) return sendJson(response, body.status, { ok: false, error: body.error });
  const verified = verifySignature({
    secret: options.alertRouterSecret,
    timestamp: request.headers['x-sml-timestamp'],
    signature: request.headers['x-sml-signature'],
    rawBody: body.rawBody,
    now: options.now()
  });
  if (!verified.ok) return sendJson(response, verified.status, { ok: false, error: verified.error });
  let input;
  try { input = JSON.parse(body.rawBody); } catch (_) { return sendJson(response, 400, { ok: false, error: 'invalid_json' }); }
  try {
    const result = await action(input);
    sendJson(response, result && result.status === 'duplicate' ? 200 : 202, { ok: true, ...result });
  } catch (error) {
    const invalid = error instanceof TypeError;
    options.logger(invalid ? 'warn' : 'error', 'alert_router_request_failed', { error });
    sendJson(response, invalid ? 422 : 503, { ok: false, error: invalid ? 'invalid_request' : 'temporary_unavailable',
      ...(invalid ? { message: String(error.message).slice(0, 240) } : {}) });
  }
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  });
  response.end(payload);
}

/*
 * The Discord Activity is deliberately a thin, non-authenticated host. Discord
 * itself controls who may launch the Activity; the embedded dashboard remains
 * read-only through its academy=1 mode. No Discord token, user identity, or
 * market credential is exposed to this page.
 */
function academyActivityHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Making Easy Money Academy — Live Chart Lab</title>
<style>
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;background:#070b10;color:#eef4f7;font-family:system-ui,-apple-system,Segoe UI,sans-serif}main{height:100%;display:grid;grid-template-rows:auto 1fr}.bar{display:flex;align-items:center;gap:.65rem;padding:.55rem .8rem;background:#0d1720;border-bottom:1px solid #1f3942;font-size:.84rem}.dot{width:.5rem;height:.5rem;border-radius:999px;background:#00d084;box-shadow:0 0 12px #00d084}.status{margin-left:auto;color:#7f98a6;font:700 .7rem ui-monospace,monospace}.shell{min-height:0;display:grid;grid-template-columns:minmax(0,1fr) 220px}.chart{position:relative;min-height:0;padding:14px}.toolbar{display:flex;gap:8px;align-items:center;margin-bottom:10px}.toolbar input{width:94px;background:#0d1720;border:1px solid #285061;border-radius:6px;color:#fff;padding:7px 9px;font-weight:800;text-transform:uppercase}.toolbar button{border:0;border-radius:6px;background:#00c47d;color:#042217;font-weight:800;padding:7px 11px;cursor:pointer}.toolbar small{color:#8295a3}canvas{display:block;width:100%;height:calc(100% - 45px);min-height:260px;border:1px solid #1b3540;border-radius:8px;background:linear-gradient(180deg,#0b141c,#070b10)}.side{border-left:1px solid #1b3540;background:#0a1118;padding:15px}.side h2{font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:#86a2b0;margin:0 0 12px}.quote{font:800 1.45rem ui-monospace,monospace}.change{font:700 .8rem ui-monospace,monospace;margin-top:3px}.meta{margin-top:18px;padding-top:14px;border-top:1px solid #1b3540;color:#8094a2;font-size:.75rem;line-height:1.55}@media(max-width:620px){.shell{grid-template-columns:1fr}.side{display:none}.chart{padding:9px}.bar span{display:none}}
</style>
</head><body><main><div class="bar"><i class="dot"></i><strong>Making Easy Money Academy</strong><span>Live Chart Lab · Educational use only</span><b class="status" id="status">CONNECTING</b></div><div class="shell"><section class="chart"><div class="toolbar"><input id="symbol" value="SPY" maxlength="10" aria-label="Ticker symbol"><button id="load">Load</button><small>Live 5-minute candles · Read-only</small></div><canvas id="chart" aria-label="Live interactive candlestick chart"></canvas></section><aside class="side"><h2 id="label">$SPY</h2><div class="quote" id="price">—</div><div class="change" id="change">Loading live market data</div><div class="meta">Drag across the chart to inspect a candle. Scroll to zoom. Data is for education only and is not a trading recommendation.</div></aside></div></main><script>
(()=>{const origin='https://stockmarketloop.com',canvas=document.getElementById('chart'),ctx=canvas.getContext('2d'),sym=document.getElementById('symbol'),status=document.getElementById('status'),label=document.getElementById('label'),price=document.getElementById('price'),change=document.getElementById('change');let bars=[],offset=0,scale=1,drag=null;const esc=s=>String(s||'SPY').toUpperCase().replace(/[^A-Z0-9.:-]/g,'').slice(0,10)||'SPY';function resize(){const r=canvas.getBoundingClientRect(),d=devicePixelRatio||1;canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);ctx.setTransform(d,0,0,d,0,0);draw()}function draw(){const w=canvas.clientWidth,h=canvas.clientHeight;if(!w||!h)return;ctx.clearRect(0,0,w,h);if(!bars.length){ctx.fillStyle='#7f98a6';ctx.font='13px system-ui';ctx.fillText('Loading live candles…',20,32);return}const pad={l:12,r:64,t:18,b:24},pw=w-pad.l-pad.r,ph=h-pad.t-pad.b,n=Math.max(12,Math.min(bars.length,Math.floor(105/scale))),end=Math.max(n,Math.min(bars.length,bars.length-offset)),view=bars.slice(end-n,end);let lo=Math.min(...view.map(b=>+b.l)),hi=Math.max(...view.map(b=>+b.h));if(hi===lo){hi+=1;lo-=1}const y=v=>pad.t+(hi-v)/(hi-lo)*ph;ctx.strokeStyle='rgba(116,153,170,.14)';ctx.lineWidth=1;for(let i=0;i<5;i++){const yy=pad.t+ph*i/4;ctx.beginPath();ctx.moveTo(pad.l,yy);ctx.lineTo(pad.l+pw,yy);ctx.stroke();ctx.fillStyle='#718694';ctx.font='10px ui-monospace';ctx.fillText((hi-(hi-lo)*i/4).toFixed(2),pad.l+pw+7,yy+3)}const step=pw/view.length;view.forEach((b,i)=>{const x=pad.l+(i+.5)*step,up=+b.c>=+b.o,color=up?'#00d084':'#ff5470';ctx.strokeStyle=color;ctx.fillStyle=color;ctx.beginPath();ctx.moveTo(x,y(+b.h));ctx.lineTo(x,y(+b.l));ctx.stroke();const top=y(Math.max(+b.o,+b.c)),bottom=y(Math.min(+b.o,+b.c));ctx.fillRect(x-step*.31,top,Math.max(1,step*.62),Math.max(1,bottom-top))});ctx.fillStyle='#90a5b3';ctx.font='10px ui-monospace';ctx.fillText('LIVE · 5M',pad.l,h-8)}async function load(){const s=esc(sym.value);sym.value=s;status.textContent='LOADING';try{const r=await fetch(origin+'/wp-json/sml/v1/history?symbol='+encodeURIComponent(s)+'&tf=5m',{cache:'no-store'});if(!r.ok)throw Error('market data unavailable');const j=await r.json();bars=Array.isArray(j.bars)?j.bars:[];if(!bars.length)throw Error('no candles returned');offset=0;const last=bars[bars.length-1],prev=bars[bars.length-2]||last,delta=+last.c-+prev.c,pct=prev.c?(delta/+prev.c)*100:0;label.textContent='$'+s;price.textContent='$'+Number(last.c).toFixed(2);change.textContent=(delta>=0?'▲ +':'▼ ')+delta.toFixed(2)+' ('+pct.toFixed(2)+'%)';change.style.color=delta>=0?'#00d084':'#ff5470';status.textContent='LIVE';draw()}catch(e){status.textContent='RETRY';change.textContent='Live data is temporarily unavailable';change.style.color='#ffb454';bars=[];draw()}}document.getElementById('load').onclick=load;sym.addEventListener('keydown',e=>{if(e.key==='Enter')load()});canvas.addEventListener('wheel',e=>{e.preventDefault();scale=Math.max(.7,Math.min(4,scale*(e.deltaY>0?.86:1.16)));draw()},{passive:false});canvas.addEventListener('pointerdown',e=>{drag=e.clientX;canvas.setPointerCapture(e.pointerId)});canvas.addEventListener('pointermove',e=>{if(drag===null)return;offset=Math.max(0,Math.min(Math.max(0,bars.length-12),offset+Math.round((e.clientX-drag)/8)));drag=e.clientX;draw()});canvas.addEventListener('pointerup',()=>drag=null);new ResizeObserver(resize).observe(canvas);load();setInterval(load,30000)})();
</script></body></html>`;
}

function sendHtml(response, status, body) {
  response.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src https://stockmarketloop.com; frame-ancestors https://discord.com https://*.discord.com https://*.discordapp.com; base-uri 'none'; form-action 'none'",
    'x-content-type-options': 'nosniff'
  });
  response.end(body);
}

function contentTypeIsJson(request) {
  return /^application\/json(?:\s*;|$)/i.test(String(request.headers['content-type'] || ''));
}

async function handleWordPressEvent(request, response, options) {
  if (!contentTypeIsJson(request)) {
    sendJson(response, 415, { ok: false, error: 'content_type_required' });
    return;
  }

  const body = await readRequestBody(request);
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error });
    return;
  }

  const verified = verifySignature({
    secret: options.wordpressWebhookSecret,
    timestamp: request.headers['x-sml-timestamp'],
    signature: request.headers['x-sml-signature'],
    rawBody: body.rawBody,
    now: options.now()
  });
  if (!verified.ok) {
    sendJson(response, verified.status, { ok: false, error: verified.error });
    return;
  }

  const parsed = parseEvent(body.rawBody);
  if (!parsed.ok) {
    sendJson(response, parsed.status, { ok: false, error: parsed.error });
    return;
  }

  try {
    const status = await options.acceptWordPressEvent(parsed.event);
    options.logger('info', 'wordpress_event_received', {
      eventId: parsed.event.eventId,
      eventType: parsed.event.eventType,
      status
    });
    sendJson(response, status === 'accepted' ? 202 : 200, {
      ok: true,
      eventId: parsed.event.eventId,
      status
    });
  } catch (error) {
    options.logger('error', 'wordpress_event_store_failed', {
      error,
      eventId: parsed.event.eventId,
      eventType: parsed.event.eventType
    });
    sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
  }
}

async function handleStripeWebhook(request, response, options) {
  /* The raw bytes are read and verified BEFORE anything parses them. There is
     no body-parser anywhere in this server, which is what keeps that true. */
  const body = await readRequestBody(request, stripeWebhook.MAX_BODY_BYTES);
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error });
    return;
  }

  const verified = stripeWebhook.verifySignature({
    secret: options.stripeWebhookSecret,
    header: request.headers['stripe-signature'],
    rawBody: body.rawBody,
    now: options.now()
  });
  if (!verified.ok) {
    options.logger('warn', 'stripe_signature_rejected', { error: verified.error });
    sendJson(response, verified.status, { ok: false, error: verified.error });
    return;
  }

  const parsed = stripeWebhook.parseEvent(body.rawBody);
  if (!parsed.ok) {
    sendJson(response, parsed.status, { ok: false, error: parsed.error });
    return;
  }

  try {
    const status = await options.acceptStripeEvent(parsed.event);
    options.logger('info', 'stripe_event_received', {
      eventId: parsed.event.id,
      eventType: parsed.event.type,
      account: parsed.event.account,
      status
    });
    /* 'duplicate' is a success: Stripe retries aggressively and the event store
       is unique on event id, so a replay is the system working, not an error. */
    sendJson(response, 200, { ok: true, eventId: parsed.event.id, status });
  } catch (error) {
    options.logger('error', 'stripe_event_store_failed', {
      error,
      eventId: parsed.event.id,
      eventType: parsed.event.type
    });
    /* 503 so Stripe retries. Swallowing this with a 200 would silently drop a
       payment event forever. */
    sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
  }
}

async function handleBillingRequest(request, response, options, action) {
  if (!contentTypeIsJson(request)) {
    sendJson(response, 415, { ok: false, error: 'content_type_required' });
    return;
  }
  const body = await readRequestBody(request);
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error });
    return;
  }
  const verified = verifySignature({
    secret: options.billingApiSecret,
    timestamp: request.headers['x-sml-timestamp'],
    signature: request.headers['x-sml-signature'],
    rawBody: body.rawBody,
    now: options.now()
  });
  if (!verified.ok) {
    sendJson(response, verified.status, { ok: false, error: verified.error });
    return;
  }
  if (!options.stripe) {
    sendJson(response, 503, { ok: false, error: 'stripe_unconfigured' });
    return;
  }
  let input;
  try {
    input = JSON.parse(body.rawBody);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid');
  } catch (_) {
    sendJson(response, 400, { ok: false, error: 'invalid_json' });
    return;
  }
  try {
    const result = await action(options.pool, options.stripe, input, options);
    sendJson(response, 201, { ok: true, ...result });
  } catch (error) {
    options.logger('error', 'billing_request_failed', { error });
    const inputError = error instanceof TypeError || /not found|not ready|consent|fee is not/.test(String(error.message));
    sendJson(response, inputError ? 400 : 503, {
      ok: false,
      error: inputError ? 'invalid_request' : 'temporary_unavailable',
      ...(inputError ? { message: String(error.message).slice(0, 240) } : {})
    });
  }
}

async function handleConnectRequest(request, response, options, action) {
  if (!contentTypeIsJson(request)) {
    sendJson(response, 415, { ok: false, error: 'content_type_required' });
    return;
  }
  const body = await readRequestBody(request);
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error });
    return;
  }
  const verified = verifySignature({
    secret: options.billingApiSecret,
    timestamp: request.headers['x-sml-timestamp'],
    signature: request.headers['x-sml-signature'],
    rawBody: body.rawBody,
    now: options.now()
  });
  if (!verified.ok) {
    sendJson(response, verified.status, { ok: false, error: verified.error });
    return;
  }
  if (!options.pool) {
    sendJson(response, 503, { ok: false, error: 'database_unconfigured' });
    return;
  }
  let input;
  try {
    input = JSON.parse(body.rawBody);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('invalid');
  } catch (_) {
    sendJson(response, 400, { ok: false, error: 'invalid_json' });
    return;
  }
  try {
    const result = await action(options.pool, input);
    sendJson(response, 200, { ok: true, ...result });
  } catch (error) {
    const inputError = error instanceof TypeError;
    options.logger(inputError ? 'warn' : 'error', 'connect_migration_request_failed', { error });
    sendJson(response, inputError ? 400 : 503, {
      ok: false,
      error: inputError ? 'invalid_request' : 'temporary_unavailable',
      ...(inputError ? { message: String(error.message).slice(0, 240) } : {})
    });
  }
}

async function handleNewsWebhook(request, response, options) {
  if (!contentTypeIsJson(request)) {
    sendJson(response, 415, { ok: false, error: 'content_type_required' });
    return;
  }
  const verified = newsWebhook.verifyBearer(options.newsIngestToken, request.headers.authorization);
  if (!verified.ok) {
    sendJson(response, verified.status, { ok: false, error: verified.error });
    return;
  }
  const body = await readRequestBody(request, newsWebhook.MAX_BODY_BYTES);
  if (!body.ok) {
    sendJson(response, body.status, { ok: false, error: body.error });
    return;
  }
  const parsed = newsWebhook.parseNewsRequest(body.rawBody);
  if (!parsed.ok) {
    sendJson(response, parsed.status, { ok: false, error: parsed.error });
    return;
  }
  try {
    const result = await options.enqueueNewsArticle(parsed.job);
    options.logger('info', 'news_article_enqueued', {
      jobId: result.id,
      status: result.status,
      sourceUrlHash: parsed.job.sourceUrlHash
    });
    sendJson(response, result.status === 'accepted' ? 202 : 200, {
      ok: true,
      jobId: result.id,
      status: result.status,
      jobStatus: result.status === 'duplicate' ? result.status : 'queued'
    });
  } catch (error) {
    options.logger('error', 'news_article_enqueue_failed', { error, sourceUrlHash: parsed.job.sourceUrlHash });
    sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
  }
}

function createServer({ checkDatabase, acceptWordPressEvent, wordpressWebhookSecret = '',
  acceptStripeEvent, stripeWebhookSecret = '', billingApiSecret = '', stripe = null,
  pool = null, upgradeChat = null, upgradeChatPlanMap = {},
  alertRouter = null, alertRouterSecret = '',
  enqueueNewsArticle = async () => { throw new Error('not configured'); },
  newsIngestToken = '',
  paypalWebhook = null, upgradeChatWebhook = null, discordInteractions = null,
  disputeService = null, schemaVersion = null, corporate = null, corporateConflictCodes = null,
  logger = log, now = Date.now }) {
  return http.createServer(async (request, response) => {
    const path = new URL(request.url || '/', 'http://localhost').pathname;
    const billingOptions = { billingApiSecret, stripe, pool, upgradeChat, upgradeChatPlanMap, logger, now };
    const connectOptions = { billingApiSecret, pool, logger, now };
    /* ---- dispute-evidence surfaces: every one 503s until configured ---- */
    if (request.method === 'POST' && path === '/v1/paypal/webhook') {
      if (!paypalWebhook) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const body = await readRequestBody(request, paypalWebhookModule.MAX_BODY_BYTES);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      await paypalWebhook.handle(request, response, body.rawBody);
      return;
    }
    if (request.method === 'POST' && path.startsWith('/v1/upgrade-chat/webhook/')) {
      if (!upgradeChatWebhook) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      await upgradeChatWebhook.handle(request, response);
      return;
    }
    if (request.method === 'POST' && path === '/v1/discord/interactions') {
      if (!discordInteractions) { sendJson(response, 503, { ok: false, error: 'integration_unconfigured' }); return; }
      const body = await readRequestBody(request, discordInteractionsModule.MAX_BODY_BYTES);
      if (!body.ok) { sendJson(response, body.status, { ok: false, error: body.error }); return; }
      await discordInteractions.handleRequest(request, response, body.rawBody);
      return;
    }
    if (request.method === 'POST' && path.startsWith('/v1/billing/disputes/')) {
      const methodName = DISPUTE_ACTIONS[path.slice('/v1/billing/disputes/'.length)];
      if (!methodName) { sendJson(response, 404, { ok: false, error: 'not_found' }); return; }
      await handleDisputeRequest(request, response, { billingApiSecret, disputeService, logger, now }, methodName);
      return;
    }
    if (request.method === 'POST' && path.startsWith('/v1/corporate/')) {
      const action = path.slice('/v1/corporate/'.length);
      await handleCorporateRequest(request, response,
        { billingApiSecret, corporate, conflictCodes: corporateConflictCodes, logger, now }, action);
      return;
    }
    const alertOptions = { alertRouterSecret, logger, now };
    const alertAction = (method) => (input) => {
      if (!alertRouter || typeof alertRouter[method] !== 'function') throw new Error('alert router is not configured');
      return alertRouter[method](...(method === 'listRoutes' ? [input.groupId, input.ownerUserId] : [input]));
    };
    if (request.method === 'POST' && path === '/v1/alerts/routes/list') {
      await handleAlertRequest(request, response, alertOptions, (input) => alertAction('listRoutes')(input).then((routes) => ({ routes })));
      return;
    }
    if (request.method === 'POST' && path === '/v1/alerts/routes/replace') {
      await handleAlertRequest(request, response, alertOptions, alertAction('replaceRoutes'));
      return;
    }
    if (request.method === 'POST' && path === '/v1/alerts/ingest') {
      await handleAlertRequest(request, response, alertOptions, alertAction('ingest'));
      return;
    }
    if (request.method === 'POST' && path === '/v1/billing/loop-bucks/checkout') {
      await handleBillingRequest(request, response, billingOptions, billingService.createLoopBuckCheckout);
      return;
    }
    if (request.method === 'POST' && path === '/v1/billing/memberships/checkout') {
      await handleBillingRequest(request, response, billingOptions, billingService.createMembershipCheckout);
      return;
    }
    if (request.method === 'POST' && path === '/v1/billing/sellers/onboard') {
      await handleBillingRequest(request, response, billingOptions, billingService.createSellerOnboarding);
      return;
    }
    if (request.method === 'POST' && path === '/v1/billing/migrations/verify-renewal') {
      await handleBillingRequest(request, response, billingOptions, billingService.verifyImportedRenewal);
      return;
    }
    if (request.method === 'POST' && path === '/v1/billing/migrations/upgrade-chat') {
      await handleBillingRequest(request, response, billingOptions, billingService.prepareUpgradeChatMigration);
      return;
    }
    if (request.method === 'POST' && path === '/v1/connect/migration/campaign') {
      await handleConnectRequest(request, response, connectOptions, connectMigration.upsertCampaign);
      return;
    }
    if (request.method === 'POST' && path === '/v1/connect/migration/mappings') {
      await handleConnectRequest(request, response, connectOptions, connectMigration.replacePlanMappings);
      return;
    }
    if (request.method === 'POST' && path === '/v1/connect/migration/memberships') {
      await handleConnectRequest(request, response, connectOptions, connectMigration.replaceMemberships);
      return;
    }
    if (request.method === 'POST' && path === '/v1/connect/migration/dashboard') {
      await handleConnectRequest(request, response, connectOptions, connectMigration.dashboard);
      return;
    }
    if (request.method === 'POST' && path === '/v1/connect/migration/event') {
      await handleConnectRequest(request, response, connectOptions, connectMigration.recordEvent);
      return;
    }
    if (request.method === 'GET' && path.startsWith('/v1/connect/public/')) {
      if (!pool) { sendJson(response, 503, { ok: false, error: 'database_unconfigured' }); return; }
      const slug = decodeURIComponent(path.slice('/v1/connect/public/'.length).replace(/\/$/, ''));
      try {
        const page = await connectMigration.publicHomepage(pool, slug, { recordView: true });
        if (!page) { sendJson(response, 404, { ok: false, error: 'not_found' }); return; }
        sendJson(response, 200, { ok: true, ...page });
      } catch (error) {
        const inputError = error instanceof TypeError;
        logger(inputError ? 'warn' : 'error', 'connect_public_request_failed', { error });
        sendJson(response, inputError ? 400 : 503, { ok: false, error: inputError ? 'invalid_request' : 'temporary_unavailable' });
      }
      return;
    }
    if (request.method === 'POST' && path === '/v1/stripe/webhook') {
      await handleStripeWebhook(request, response, { acceptStripeEvent, stripeWebhookSecret, logger, now });
      return;
    }

    if (request.method === 'POST' && path === '/v1/wordpress/events') {
      await handleWordPressEvent(request, response, { acceptWordPressEvent, wordpressWebhookSecret, logger, now });
      return;
    }

    if (request.method === 'POST' && path === '/v1/news/articles') {
      await handleNewsWebhook(request, response, { enqueueNewsArticle, newsIngestToken, logger });
      return;
    }

    if (request.method === 'GET' && path === '/v1/reddit-hub/bootstrap') {
      try {
        sendJson(response, 200, await getRedditHubBootstrap());
      } catch (error) {
        logger('warn', 'reddit_hub_bootstrap_failed', { error });
        sendJson(response, 503, { ok: false, error: 'temporary_unavailable' });
      }
      return;
    }

    if (request.method === 'GET' && path === '/academy-activity/') {
      sendHtml(response, 200, academyActivityHtml());
      return;
    }

    if (request.method !== 'GET' || path !== '/health') {
      sendJson(response, 404, { ok: false, error: 'not_found' });
      return;
    }

    try {
      await checkDatabase();
      /* The applied schema version is public metadata that lets a deploy be
         verified without dashboard access; it reveals no data or secret. */
      let schema;
      if (typeof schemaVersion === 'function') {
        try { schema = await schemaVersion(); } catch (_) { schema = null; }
      }
      sendJson(response, 200, {
        ok: true, service: 'sml-platform-api', database: 'connected',
        ...(schema !== undefined ? { schema } : {})
      });
    } catch (error) {
      logger('error', 'health_database_unavailable', { error });
      sendJson(response, 503, { ok: false, service: 'sml-platform-api', database: 'unavailable' });
    }
  });
}

async function main() {
  const config = getConfig();
  const database = createDatabase(config);
  const stripe = config.stripeSecretKey ? new Stripe(config.stripeSecretKey) : null;
  const upgradeChat = config.upgradeChatClientId && config.upgradeChatClientSecret
    ? createUpgradeChatClient({ clientId: config.upgradeChatClientId, clientSecret: config.upgradeChatClientSecret }) : null;
  const { createAlertRouter } = require('./alert-router');
  const alertRouter = createAlertRouter(database.pool);
  const { createDisputeRuntime } = require('./dispute-runtime');
  const disputes = createDisputeRuntime({ config, pool: database.pool, stripe, upgradeChat, logger: log });
  const { createAcademyInteractions } = require('./academy/runtime');
  const academyInteractions = disputes.discordInteractions || createAcademyInteractions({ config, pool: database.pool });
  log('info', 'dispute_evidence_runtime', { enabled: disputes.enabled, reason: disputes.reason,
    paypal: !!disputes.paypalClient, connectBot: !!academyInteractions });
  const { createCorporateRuntime, CONFLICT_CODES } = require('./corporate-runtime');
  const corporate = createCorporateRuntime({ config, pool: database.pool, stripe, logger: log });
  log('info', 'corporate_runtime', { enabled: corporate.enabled, reason: corporate.reason });
  const schemaVersion = async () => {
    const found = await database.pool.query('SELECT MAX(version) AS version FROM schema_migrations', []);
    return found.rows[0] && found.rows[0].version != null ? String(found.rows[0].version) : null;
  };
  const server = createServer({
    checkDatabase: database.health,
    acceptWordPressEvent: database.acceptWordPressEvent,
    wordpressWebhookSecret: config.wordpressWebhookSecret,
    acceptStripeEvent: disputes.wrapStripeAccept(database.acceptStripeEvent),
    paypalWebhook: disputes.paypalWebhook,
    upgradeChatWebhook: disputes.upgradeChatWebhook,
    discordInteractions: academyInteractions,
    disputeService: disputes.disputeService,
    schemaVersion,
    stripeWebhookSecret: config.stripeWebhookSecret,
    billingApiSecret: config.billingApiSecret,
    upgradeChat,
    upgradeChatPlanMap: config.upgradeChatPlanMap,
    stripe,
    pool: database.pool,
    enqueueNewsArticle: database.enqueueNewsArticle,
    newsIngestToken: config.newsIngestToken,
    alertRouter,
    alertRouterSecret: config.alertRouterSecret,
    corporate,
    corporateConflictCodes: CONFLICT_CODES
  });
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'shutdown_started', { signal });
    server.close(async () => {
      await database.close();
      log('info', 'shutdown_complete', { signal });
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  }

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  server.listen(config.port, () => log('info', 'api_started', { port: config.port }));
}

if (require.main === module) {
  main().catch((error) => {
    log('error', 'api_start_failed', { error });
    process.exit(1);
  });
}

module.exports = {
  createServer,
  sendJson,
  sendHtml,
  academyActivityHtml,
  handleBillingRequest,
  handleAlertRequest,
  handleDisputeRequest,
  handleConnectRequest,
  handleCorporateRequest,
  DISPUTE_ACTIONS
};
