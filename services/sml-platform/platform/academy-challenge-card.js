'use strict';

/* The challenge card: one picture of the challenge account for the Discord channel, drawn as SVG from the challenge
 * snapshot and rendered to PNG by the same resvg + DejaVu setup the scenario charts use. Says SIMULATED on its face. */

const images = require('./academy-scenario-image');

const W = 1200, H = 675, FAMILY = 'DejaVu Sans';
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const usd = (v, d = 2) => (num(v) == null ? '—' : (v < 0 ? '-' : '') + '$' + Math.abs(Number(v)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (v) => (num(v) == null ? '—' : (v >= 0 ? '+' : '') + Number(v).toFixed(2) + '%');
const tone = (v) => (v > 0 ? '#52e6ad' : v < 0 ? '#ff778b' : '#d8ecf4');
const etStamp = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';

function curvePath(points, x0, y0, w, h) {
  const pts = (points || []).filter((p) => num(p.value) != null); if (pts.length < 2) return '';
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t || t0 + 1, vals = pts.map((p) => p.value), lo = Math.min(...vals) * 0.995, hi = Math.max(...vals) * 1.005;
  const x = (t) => x0 + w * ((t - t0) / Math.max(1, t1 - t0)), y = (v) => y0 + h - h * ((v - lo) / Math.max(1e-9, hi - lo));
  return pts.map((p, i) => (i ? 'L' : 'M') + x(p.t).toFixed(1) + ' ' + y(p.value).toFixed(1)).join(' ');
}

function svgFor(snap, { title = "GRANDMASTER-OBI'S 1K → 100K CHALLENGE", now = Date.now() } = {}) {
  const s = snap.paper.summary, pos = (s.positions || []).slice(0, 6), r = snap.rules || {};
  const kpis = [['ACCOUNT', usd(s.equity), '#e8f6fb'], ['PUT IN', usd(s.deposited, 0), '#d8ecf4'], ['RESULT', usd(s.pnl), tone(s.pnl)], ['RETURN', pct(s.returnPct), tone(s.returnPct)], ['TODAY', s.today && s.today.change != null ? usd(s.today.change) : '—', tone(s.today ? s.today.change : 0)], ['PROGRESS', (snap.progressPct || 0) + '%', '#6be6ff']];
  const lastIdea = (snap.ideas || []).find((i) => i.status === 'taken' || i.status === 'closed');
  const curve = curvePath(snap.paper.equity, 640, 150, 520, 150);
  const rows = pos.map((p, i) => `<text x="60" y="${330 + i * 34}" font-size="22" font-weight="bold" fill="#e8f6fb">${esc(p.symbol)}</text><text x="190" y="${330 + i * 34}" font-size="20" fill="#9ad7ea">${p.qty} @ ${usd(p.avg)}</text><text x="420" y="${330 + i * 34}" font-size="20" fill="#9ad7ea">${usd(p.mark)}</text><text x="600" y="${330 + i * 34}" font-size="22" font-weight="bold" text-anchor="end" fill="${tone(p.pnl)}">${usd(p.pnl)} (${pct(p.pnlPct)})</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FAMILY}">
<rect width="${W}" height="${H}" fill="#07111a"/><rect x="0" y="0" width="${W}" height="6" fill="#6be6ff"/>
<text x="60" y="64" font-size="30" font-weight="bold" fill="#6be6ff">${esc(title)}</text>
<rect x="60" y="80" width="330" height="30" rx="6" fill="#5a1d1d"/><text x="225" y="102" font-size="17" font-weight="bold" fill="#ffb3b3" text-anchor="middle">SIMULATED · NOT REAL MONEY · NOT ADVICE</text>
<text x="${W - 60}" y="64" font-size="20" fill="#7fa3b3" text-anchor="end">${esc(etStamp(now))}</text>
${kpis.map(([k, v, c], i) => `<rect x="${60 + i * 185}" y="130" width="170" height="90" rx="10" fill="#0b1a25" stroke="#163542"/><text x="${75 + i * 185}" y="158" font-size="15" font-weight="bold" fill="#7fa3b3">${k}</text><text x="${75 + i * 185}" y="200" font-size="30" font-weight="bold" fill="${c}">${esc(v)}</text>`).join('')}
<rect x="60" y="250" width="${W - 120}" height="8" rx="4" fill="#0e2633"/><rect x="60" y="250" width="${Math.max(6, (W - 120) * Math.min(1, (snap.progressPct || 0) / 100))}" height="8" rx="4" fill="#6be6ff"/>
<text x="60" y="290" font-size="18" font-weight="bold" fill="#9ad7ea">OPEN POSITIONS${pos.length ? '' : ' · FLAT'}</text>
${rows || `<text x="60" y="330" font-size="20" fill="#7fa3b3">Waiting for the next grade-${esc(String(r.minScore || 70))}+ idea.</text>`}
<rect x="640" y="130" width="520" height="190" rx="10" fill="#0b1a25" stroke="#163542"/><text x="655" y="155" font-size="15" font-weight="bold" fill="#7fa3b3">ACCOUNT CURVE</text>
${curve ? `<path d="${curve}" fill="none" stroke="#6be6ff" stroke-width="3"/>` : `<text x="655" y="240" font-size="18" fill="#7fa3b3">The curve starts with the first trade.</text>`}
<text x="640" y="360" font-size="18" font-weight="bold" fill="#9ad7ea">LATEST</text>
<text x="640" y="392" font-size="20" fill="#d8ecf4">${lastIdea ? esc(`${lastIdea.status === 'closed' ? 'Closed' : 'Took'} ${lastIdea.symbol} (${lastIdea.mode}, grade ${lastIdea.grade} ${lastIdea.score})${lastIdea.status === 'closed' && lastIdea.realized != null ? ' ' + usd(lastIdea.realized) + ' · ' + lastIdea.exitReason : ' @ ' + usd(lastIdea.fill)}`) : 'No ideas taken yet.'}</text>
<text x="640" y="424" font-size="18" fill="#7fa3b3">${esc(`${s.closedTrades || 0} closed trades${s.winRate != null ? ' · ' + s.winRate + '% won' : ''} · max drawdown ${s.maxDrawdownPct || 0}%`)}</text>
<text x="640" y="470" font-size="16" fill="#7fa3b3">${esc(`Rules: MEM ALGO ideas scoring ${r.minScore || 70}+ only · ${Math.round((r.riskPerTrade ? r.riskPerTrade.swing : 0.03) * 100)}% risk to the stop · ${usd(r.weeklyDeposit || 250, 0)}/week added`)}</text>
<rect x="0" y="${H - 54}" width="${W}" height="54" fill="#0b1a25"/><text x="60" y="${H - 20}" font-size="16" fill="#7fa3b3">Paper account on real market prices. No real money, no advice, no guarantee. Educational only. stockmarketloop Academy</text>
</svg>`;
}

function render(snap, opts = {}) { const svg = svgFor(snap, opts); return { svg, png: images.png(svg), name: 'challenge-' + new Date(opts.now || Date.now()).toISOString().slice(0, 10) + '.png' }; }

module.exports = { svgFor, render, W, H };
