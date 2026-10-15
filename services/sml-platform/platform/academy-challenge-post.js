'use strict';

/* Challenge trade posts: the words and the small order card for every buy and sell in the challenge account.
 *
 * The words follow one rule so a reader never has to work it out: say what just happened (how many shares, at what price,
 * for how much), then where the position stands now (total bought, still holding, average), then the plan (stop, target)
 * or the result (profit or loss, why it was sold). Bold and emojis go where the eye should land first; the SIMULATED line
 * is always there. The order card is the picture of the same four numbers — logo, shares, price, total — rendered by the
 * same resvg + DejaVu setup as the scenario charts (DejaVu has no colour emoji, so the card uses shapes and colour and the
 * emojis live in the message text, where Discord draws them). */

const images = require('./academy-scenario-image');

const FAMILY = 'DejaVu Sans';
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = null) => { if (v == null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };
const r2 = (v) => Math.round(v * 100) / 100;
const usd = (v, d = 2) => (num(v) == null ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(Number(v)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v) => (num(v) == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%');
const shares = (q) => { const n = num(q, 0); return (Number.isInteger(n) ? String(n) : n.toFixed(Math.min(4, (String(n).split('.')[1] || '').length))) + (n === 1 ? ' share' : ' shares'); };

/* What kind of trade this was, from the position before and after. */
function kindOf(ev) {
  const before = num(ev.before, 0), after = num(ev.after, 0);
  if (ev.side === 'buy') return before > 0 ? 'add' : 'entry';
  return after > 0 ? 'trim' : 'exit';
}

/* The Discord text for one trade. */
function composeTrade(ev) {
  const kind = kindOf(ev), t = ev.trade, qty = num(t.qty, 0), price = num(t.price, 0), total = r2(qty * price), after = num(ev.after, 0), before = num(ev.before, 0);
  // a sell is judged against what the shares cost (the average before); a buy reports the new average
  const avg = ev.side === 'sell' ? (num(ev.avgBefore) ?? num(ev.avgAfter)) : (num(ev.avgAfter) ?? num(ev.avgBefore)), bought = num(ev.totalBought, qty), boughtCost = num(ev.totalBoughtCost);
  const lines = [];
  if (kind === 'entry') {
    lines.push(`🟢 **BOUGHT ${ev.symbol}** — opened a new position`);
    lines.push(`📦 **${shares(qty)}** × **${usd(price)}** = **${usd(total)}**`);
    lines.push(`📊 Now holding: **${shares(after)}** (average ${usd(avg)})`);
  } else if (kind === 'add') {
    lines.push(`🟢 **ADDED TO ${ev.symbol}** — bought more`);
    lines.push(`📦 This buy: **${shares(qty)}** × **${usd(price)}** = **${usd(total)}**`);
    lines.push(`🧮 Total bought so far: **${shares(bought)}**${boughtCost != null ? ` for ${usd(boughtCost)}` : ''}`);
    lines.push(`📊 Now holding: **${shares(after)}** (average ${usd(avg)})`);
  } else if (kind === 'trim') {
    lines.push(`🟡 **SOLD PART OF ${ev.symbol}** — took some off`);
    lines.push(`📦 Sold **${shares(qty)}** of ${shares(before)} × **${usd(price)}** = **${usd(total)}**`);
    if (num(ev.realized) != null) lines.push(`${ev.realized >= 0 ? '✅ Profit' : '❌ Loss'} on this piece: **${usd(ev.realized)}**${avg ? ` (${pct((price / avg - 1) * 100)})` : ''}`);
    lines.push(`📊 Still holding: **${shares(after)}** (average ${usd(avg)})`);
  } else {
    lines.push(`🔴 **SOLD ALL ${ev.symbol}** — position closed`);
    lines.push(`📦 Sold **${shares(qty)}** × **${usd(price)}** = **${usd(total)}**`);
    if (num(ev.realized) != null) lines.push(`${ev.realized >= 0 ? '✅ PROFIT' : '❌ LOSS'}: **${usd(ev.realized)}**${avg ? ` (${pct((price / avg - 1) * 100)})` : ''}${bought ? ` on ${shares(bought)} bought` : ''}`);
    lines.push('📊 Now holding: **0** — out.');
  }
  if (ev.reason) lines.push(`${kind === 'exit' || kind === 'trim' ? '🧭 Why sold' : '🧭 Why'}: ${ev.reason}`);
  if ((kind === 'entry' || kind === 'add') && (num(ev.stop) || num(ev.target))) lines.push(`${num(ev.stop) ? `🛑 Stop **${usd(ev.stop)}**` : ''}${num(ev.stop) && num(ev.target) ? ' · ' : ''}${num(ev.target) ? `🎯 Target **${usd(ev.target)}**` : ''}${ev.grade ? ` · grade **${ev.grade} ${ev.score}**` : ''}`);
  if (num(ev.equity) != null) lines.push(`💼 Account now **${usd(ev.equity)}**${num(ev.cash) != null ? ` (cash ${usd(ev.cash)})` : ''}`);
  lines.push('_SIMULATED account on real prices · not real money · not advice_');
  return lines.join('\n');
}

/* The DM / pop-up text for an idea: the same four numbers before anything is bought. */
function composeIdea(idea) {
  const total = r2(num(idea.qty, 0) * num(idea.entry, 0));
  return [
    `💡 **1K→100K IDEA #${idea.id}: BUY ${idea.symbol}** (${idea.mode}, grade **${idea.grade} ${idea.score}**)`,
    `📦 **${shares(idea.qty)}** × about **${usd(idea.entry)}** = **${usd(total)}**`,
    `🛑 Stop **${usd(idea.stop)}** (risking ${usd(idea.riskDollars)})${idea.target ? ` · 🎯 Target **${usd(idea.target)}**` : ''}`,
    idea.reason ? `🧭 Why: ${idea.reason}` : '',
    `👉 Open the Academy → **CHALLENGE** → **TAKE IT**${idea.expiresAt ? ` (expires ${new Date(idea.expiresAt).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} ET)` : ''}`,
    '_Simulated account · not advice_'
  ].filter(Boolean).join('\n');
}

/* The order card: logo (or a monogram tile), shares, price per share, total — and where the position stands. */
function orderCardSvg(ev, { logo = null, company = '', now = Date.now() } = {}) {
  const kind = kindOf(ev), t = ev.trade, qty = num(t.qty, 0), price = num(t.price, 0), total = r2(qty * price);
  const W = 1200, H = 520, buy = ev.side === 'buy';
  const accent = buy ? '#52e6ad' : (kind === 'trim' ? '#ffd66b' : '#ff778b'), badge = kind === 'entry' ? 'BOUGHT' : kind === 'add' ? 'ADDED MORE' : kind === 'trim' ? 'SOLD PART' : 'SOLD ALL';
  const mono = String(ev.symbol || '').slice(0, 4);
  const tile = logo ? `<image x="60" y="120" width="220" height="220" href="${logo}" preserveAspectRatio="xMidYMid meet"/>` : `<rect x="60" y="120" width="220" height="220" rx="28" fill="#0b1a25" stroke="#163542" stroke-width="3"/><text x="170" y="${mono.length > 3 ? 250 : 258}" font-size="${mono.length > 3 ? 64 : 84}" font-weight="bold" text-anchor="middle" fill="#e8f6fb">${esc(mono)}</text>`;
  const after = num(ev.after, 0), avg = buy ? (num(ev.avgAfter) ?? num(ev.avgBefore)) : (num(ev.avgBefore) ?? num(ev.avgAfter)), realized = num(ev.realized);
  const standing = buy
    ? `<text x="330" y="372" font-size="26" fill="#9ad7ea">NOW HOLDING <tspan font-weight="bold" fill="#e8f6fb">${esc(shares(after).toUpperCase())}</tspan>${avg ? `  ·  AVERAGE <tspan font-weight="bold" fill="#e8f6fb">${esc(usd(avg))}</tspan>` : ''}${kind === 'add' && num(ev.totalBought) ? `  ·  TOTAL BOUGHT <tspan font-weight="bold" fill="#e8f6fb">${esc(shares(ev.totalBought).toUpperCase())}</tspan>` : ''}</text>`
    : `<text x="330" y="372" font-size="26" fill="#9ad7ea">${realized != null ? `${realized >= 0 ? 'PROFIT' : 'LOSS'} <tspan font-weight="bold" fill="${realized >= 0 ? '#52e6ad' : '#ff778b'}">${esc(usd(realized))}</tspan>${avg ? ` (${esc(pct((price / avg - 1) * 100))})` : ''}  ·  ` : ''}${after > 0 ? `STILL HOLDING <tspan font-weight="bold" fill="#e8f6fb">${esc(shares(after).toUpperCase())}</tspan>` : 'POSITION CLOSED'}</text>`;
  const plan = buy && (num(ev.stop) || num(ev.target)) ? `<text x="330" y="412" font-size="24" fill="#9ad7ea">${num(ev.stop) ? `STOP <tspan font-weight="bold" fill="#ff778b">${esc(usd(ev.stop))}</tspan>` : ''}${num(ev.stop) && num(ev.target) ? '   ' : ''}${num(ev.target) ? `TARGET <tspan font-weight="bold" fill="#52e6ad">${esc(usd(ev.target))}</tspan>` : ''}${ev.grade ? `   GRADE <tspan font-weight="bold" fill="#e8f6fb">${esc(ev.grade + ' ' + ev.score)}</tspan>` : ''}</text>` : (ev.reason ? `<text x="330" y="412" font-size="22" fill="#9ad7ea">WHY: ${esc(String(ev.reason).slice(0, 60).toUpperCase())}</text>` : '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FAMILY}">
<rect width="${W}" height="${H}" fill="#07111a"/><rect x="0" y="0" width="${W}" height="10" fill="${accent}"/>
<rect x="60" y="40" width="${badge.length * 22 + 40}" height="48" rx="10" fill="${accent}"/><text x="${80 + (badge.length * 22) / 2}" y="73" font-size="30" font-weight="bold" text-anchor="middle" fill="#07111a">${badge}</text>
<text x="${W - 60}" y="72" font-size="20" fill="#7fa3b3" text-anchor="end">${esc(new Date(now).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }))} ET · 1K → 100K CHALLENGE</text>
${tile}
<text x="330" y="190" font-size="76" font-weight="bold" fill="#e8f6fb">${esc(ev.symbol)}</text>${company ? `<text x="${340 + String(ev.symbol).length * 50}" y="190" font-size="28" fill="#7fa3b3">${esc(String(company).slice(0, 38))}</text>` : ''}
<text x="330" y="270" font-size="44" font-weight="bold" fill="${accent}">${esc(shares(qty).toUpperCase())}</text><text x="${330 + shares(qty).length * 27 + 20}" y="270" font-size="40" fill="#9ad7ea">×</text><text x="${330 + shares(qty).length * 27 + 60}" y="270" font-size="44" font-weight="bold" fill="#e8f6fb">${esc(usd(price))}</text><text x="${330 + shares(qty).length * 27 + 60 + usd(price).length * 27 + 20}" y="270" font-size="30" fill="#9ad7ea">PER SHARE</text>
<text x="330" y="330" font-size="30" fill="#9ad7ea">TOTAL ${buy ? 'COST' : 'PROCEEDS'}</text><text x="${330 + 30 * 10.5}" y="332" font-size="46" font-weight="bold" fill="#e8f6fb">${esc(usd(total))}</text>
${standing}
${plan}
<rect x="0" y="${H - 54}" width="${W}" height="54" fill="#0b1a25"/><rect x="60" y="${H - 42}" width="330" height="30" rx="6" fill="#5a1d1d"/><text x="225" y="${H - 20}" font-size="17" font-weight="bold" fill="#ffb3b3" text-anchor="middle">SIMULATED · NOT REAL MONEY · NOT ADVICE</text><text x="${W - 60}" y="${H - 20}" font-size="16" fill="#7fa3b3" text-anchor="end">Paper account on real prices · stockmarketloop Academy</text>
</svg>`;
}

/* Company name and a logo as a data URI from the market-data provider's reference branding, cached a day; null when unknown. */
function createLogoLookup({ apiKey = '', fetchImpl = fetch, now = Date.now, ttlMs = 24 * 3_600_000, logger = () => {} } = {}) {
  const cache = new Map();
  async function lookup(symbol) {
    const sym = String(symbol || '').toUpperCase(); if (!apiKey || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(sym)) return null;
    const hit = cache.get(sym); if (hit && hit.until > now()) return hit.value;
    let value = null;
    try {
      const r = await fetchImpl(`https://api.massive.com/v3/reference/tickers/${encodeURIComponent(sym)}?apiKey=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(8_000) });
      if (r.ok) {
        const j = await r.json(), res = j && j.results ? j.results : null;
        const name = res && res.name ? String(res.name) : '';
        const icon = res && res.branding && res.branding.icon_url ? String(res.branding.icon_url) : '';
        let logo = null;
        if (/^https:\/\//.test(icon)) {
          const ir = await fetchImpl(icon + (icon.includes('?') ? '&' : '?') + 'apiKey=' + encodeURIComponent(apiKey), { signal: AbortSignal.timeout(8_000) });
          if (ir.ok) { const type = String(ir.headers.get('content-type') || 'image/png').split(';')[0]; const buf = Buffer.from(await ir.arrayBuffer()); if (/^image\/(png|jpeg|jpg|webp)$/.test(type) && buf.length < 2_000_000) logo = `data:${type};base64,${buf.toString('base64')}`; }
        }
        value = { name, logo };
      }
    } catch (error) { logger('warn', 'logo_lookup_failed', { symbol: sym, error: String(error && error.message || error) }); }
    cache.set(sym, { until: now() + (value ? ttlMs : 10 * 60_000), value }); if (cache.size > 500) cache.delete(cache.keys().next().value);
    return value;
  }
  return { lookup };
}

function renderOrderCard(ev, opts = {}) { const svg = orderCardSvg(ev, opts); return { svg, png: images.png(svg), name: `${String(ev.symbol).toLowerCase()}-${kindOf(ev)}-${new Date(opts.now || Date.now()).toISOString().slice(0, 10)}.png`, alt: `${kindOf(ev)} ${ev.symbol}: ${ev.trade.qty} shares at ${ev.trade.price}` }; }

module.exports = { kindOf, composeTrade, composeIdea, orderCardSvg, renderOrderCard, createLogoLookup };
