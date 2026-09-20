import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { projectRoot } from './storage.js';

const WIDTH = 1200;
const HEIGHT = 675;

function xml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[char]));
}

function slug(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 64) || 'alert';
}

function wrapText(value, max = 48, maxLines = 4) {
  const words = String(value || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= max || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  const consumed = lines.join(' ').length;
  if (consumed < words.join(' ').length && lines.length) lines[lines.length - 1] = `${lines.at(-1).replace(/[.…]+$/, '')}…`;
  return lines;
}

function formattedTime(message, timeZone) {
  const value = message.createdAt || new Date(message.createdTimestamp || Date.now());
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'America/Chicago',
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(value);
}

async function avatarDataUrl(message) {
  const url = message.author?.displayAvatarURL?.({ extension: 'png', size: 128 });
  if (!url) return '';
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return '';
    const contentType = response.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) return '';
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 2_000_000) return '';
    return `data:${contentType};base64,${bytes.toString('base64')}`;
  } catch {
    return '';
  }
}

function visualMetadata(parsed, authorName, timestamp, messageId, filename) {
  const ticker = String(parsed.symbol || '').toUpperCase();
  const entry = Number(parsed.entryPrice);
  const detail = parsed.kind === 'option'
    ? `$${ticker} ${parsed.strike} ${parsed.contractType} expiring ${parsed.expiration || 'date pending review'}`
    : `$${ticker} alert with a reported ${Number.isFinite(entry) ? `$${entry}` : 'unavailable'} entry`;
  return {
    filename,
    title: `Grandmaster-OBI $${ticker} Discord alert record`,
    altText: `$${ticker} stock alert record posted by Grandmaster-OBI in the Making Easy Money Discord`,
    caption: `Rendered record of the ${detail} posted by ${authorName} in the Making Easy Money Discord at ${timestamp}.`,
    description: `Editorial evidence image rendered from Discord message ${messageId}. It preserves the alert author, timestamp and original message text for the associated StockMarketLoop report.`,
    seoKeywords: [`$${ticker} alert`, 'Grandmaster-OBI', 'Making Easy Money Discord', `$${ticker} stock news`],
  };
}

export async function createAlertVisual(message, parsed, settings) {
  const options = settings.articleAutomation?.alertVisuals || {};
  if (options.enabled === false) return null;
  const authorName = message.member?.displayName || message.author?.globalName || message.author?.username || 'Discord member';
  const timestamp = formattedTime(message, settings.alertMonitor?.marketTimezone || 'America/Chicago');
  const content = String(message.content || '').replace(/\s+/g, ' ').trim();
  const hash = createHash('sha256').update(JSON.stringify({ id: message.id, authorName, timestamp, content })).digest('hex').slice(0, 12);
  const filename = `${slug(parsed.symbol)}-grandmaster-obi-discord-alert-${message.id}-${hash}.png`;
  const directory = path.resolve(options.directory || path.join(projectRoot, 'data', 'alert-visuals'));
  await mkdir(directory, { recursive: true });
  const outputPath = path.join(directory, filename);
  const avatar = await avatarDataUrl(message);
  const lines = wrapText(content, 48, 4);
  const messageLines = lines.map((line, index) => `<text x="210" y="${298 + index * 62}" class="message">${xml(line)}</text>`).join('');
  const avatarMarkup = avatar
    ? `<defs><clipPath id="avatar"><circle cx="142" cy="190" r="64"/></clipPath></defs><image href="${avatar}" x="78" y="126" width="128" height="128" clip-path="url(#avatar)" preserveAspectRatio="xMidYMid slice"/>`
    : '<circle cx="142" cy="190" r="64" fill="#121a2a" stroke="#18e28a" stroke-width="4"/><text x="142" y="207" text-anchor="middle" class="initial">OBI</text>';
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#050912"/><stop offset="0.55" stop-color="#081522"/><stop offset="1" stop-color="#03100c"/></linearGradient>
      <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0"><stop stop-color="#16e58b"/><stop offset="0.5" stop-color="#27a8ff"/><stop offset="1" stop-color="#16e58b"/></linearGradient>
      <filter id="glow"><feGaussianBlur stdDeviation="8" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <style>
        text { font-family: Inter, Segoe UI, Arial, sans-serif; }
        .eyebrow { fill:#78f7c0; font-size:22px; font-weight:800; letter-spacing:4px; }
        .author { fill:#f4f8ff; font-size:40px; font-weight:800; }
        .time { fill:#8fa2b8; font-size:22px; }
        .message { fill:#eef5ff; font-size:40px; font-weight:600; }
        .ticker { fill:#20eba0; font-size:64px; font-weight:900; letter-spacing:3px; }
        .footer { fill:#8295aa; font-size:19px; }
        .initial { fill:#18e28a; font-size:30px; font-weight:900; }
      </style>
    </defs>
    <rect width="1200" height="675" fill="url(#bg)"/>
    <circle cx="1040" cy="60" r="270" fill="#0a7352" opacity="0.12"/>
    <circle cx="1100" cy="620" r="300" fill="#126ca0" opacity="0.10"/>
    <rect x="34" y="34" width="1132" height="607" rx="30" fill="#080e19" fill-opacity="0.92" stroke="url(#edge)" stroke-width="3"/>
    <rect x="70" y="72" width="250" height="44" rx="22" fill="#10261f" stroke="#18e28a"/>
    <text x="94" y="102" class="eyebrow">DISCORD ALERT RECORD</text>
    ${avatarMarkup}
    <text x="230" y="176" class="author">${xml(authorName)}</text>
    <text x="230" y="217" class="time">${xml(timestamp)} · Message ID ${xml(message.id)}</text>
    <text x="1040" y="178" text-anchor="middle" class="ticker" filter="url(#glow)">$${xml(parsed.symbol)}</text>
    <line x1="78" y1="266" x2="1122" y2="266" stroke="#213044" stroke-width="2"/>
    ${messageLines}
    <rect x="78" y="552" width="1044" height="1" fill="#26374d"/>
    <text x="78" y="591" class="footer">Rendered from the original Discord message record · StockMarketLoop editorial evidence</text>
    <text x="78" y="620" class="footer">No performance claim is shown in this image</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(outputPath);
  return {
    path: outputPath,
    hash,
    width: WIDTH,
    height: HEIGHT,
    generatedAt: new Date().toISOString(),
    ...visualMetadata(parsed, authorName, timestamp, message.id, filename),
  };
}
