/* =============================================================================
 * StockMarketLoop — dispute packet generator (PURE, deterministic)
 *
 * generatePacket({ model, caseRow, version, generatedAt }) renders the packet
 * model from evidence-engine into:
 *   - a manifest JSON object serialized with lexicographically sorted keys,
 *   - a self-contained, hand-rolled PDF 1.4 (Helvetica text pages, escaped
 *     strings, multi-page — no dependencies),
 *   - sha256 hashes of each and of the combined packet.
 *
 * Byte-identical output for identical input: no clock reads, no randomness —
 * `generatedAt` is a parameter, object numbering and xref offsets are
 * computed, and the manifest serialization is canonical.
 * ========================================================================== */

'use strict';

const crypto = require('node:crypto');

const GENERATOR_VERSION = 'sml-packet-generator/1.0.0';

/* Packet size cap: the summary PDF must stay reviewable and well under
 * provider upload limits (Stripe's combined evidence cap is 4.5MB). */
const PACKET_PDF_MAX_BYTES = 4 * 1024 * 1024;

/* PDF page geometry: US Letter, 10pt Helvetica, 14pt leading. */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const FONT_SIZE = 10;
const LEADING = 14;
const LINES_PER_PAGE = Math.floor((PAGE_HEIGHT - 2 * MARGIN) / LEADING); // 49
const WRAP_COLUMNS = 95;

/* -------------------------------------------------------------------------- */
/* Canonical JSON (sorted keys, recursive) — local on purpose: sibling         */
/* modules are injected elsewhere, never required from module code.            */
/* -------------------------------------------------------------------------- */

function sortedStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => sortedStringify(entry === undefined ? null : entry)).join(',')}]`;
  }
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${sortedStringify(value[key])}`).join(',')}}`;
}

function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/* -------------------------------------------------------------------------- */
/* PDF text handling                                                           */
/* -------------------------------------------------------------------------- */

/** Escape a line for a PDF literal string: backslash, parens, and anything
 * outside printable ASCII as \ddd octal (Latin-1) or '?' beyond that. */
function escapePdfText(line) {
  let out = '';
  for (const ch of String(line)) {
    const code = ch.codePointAt(0);
    if (ch === '\\') out += '\\\\';
    else if (ch === '(') out += '\\(';
    else if (ch === ')') out += '\\)';
    else if (code >= 32 && code <= 126) out += ch;
    else if (code < 256) out += `\\${code.toString(8).padStart(3, '0')}`;
    else out += '?';
  }
  return out;
}

function wrapLine(line, columns) {
  const text = String(line);
  if (text.length <= columns) return [text];
  const out = [];
  let rest = text;
  while (rest.length > columns) {
    let cut = rest.lastIndexOf(' ', columns);
    if (cut <= 0) cut = columns;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^ /, '');
  }
  if (rest.length) out.push(rest);
  return out;
}

/** Assemble a complete PDF 1.4 from an array of text lines. */
function buildPdf(lines) {
  const wrapped = [];
  for (const line of lines) {
    for (const piece of wrapLine(line, WRAP_COLUMNS)) wrapped.push(piece);
  }
  const pages = [];
  for (let i = 0; i < wrapped.length; i += LINES_PER_PAGE) {
    pages.push(wrapped.slice(i, i + LINES_PER_PAGE));
  }
  if (pages.length === 0) pages.push(['']);

  /* Object numbering: 1 catalog, 2 pages, 3 font, then per page i:
   * (4 + 2i) page object, (5 + 2i) its content stream. */
  const objects = [];
  const pageObjectNumbers = pages.map((_, i) => 4 + 2 * i);
  objects.push({ num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' });
  objects.push({
    num: 2,
    body: `<< /Type /Pages /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`
  });
  objects.push({ num: 3, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' });

  pages.forEach((pageLines, i) => {
    const pageNum = 4 + 2 * i;
    const contentNum = pageNum + 1;
    objects.push({
      num: pageNum,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`
    });
    const ops = [
      'BT',
      `/F1 ${FONT_SIZE} Tf`,
      `${LEADING} TL`,
      `${MARGIN} ${PAGE_HEIGHT - MARGIN} Td`
    ];
    for (const line of pageLines) {
      ops.push('T*');
      ops.push(`(${escapePdfText(line)}) Tj`);
    }
    ops.push('ET');
    const stream = ops.join('\n');
    objects.push({
      num: contentNum,
      body: `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`
    });
  });

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (const object of objects) {
    offsets[object.num] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${object.num} 0 obj\n${object.body}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  const size = objects.length + 1;
  pdf += `xref\n0 ${size}\n`;
  pdf += '0000000000 65535 f \n';
  for (let num = 1; num < size; num += 1) {
    pdf += `${String(offsets[num]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

/* -------------------------------------------------------------------------- */
/* Rendering the model to text lines                                           */
/* -------------------------------------------------------------------------- */

function citesLabel(records) {
  return (records || []).map((rec) => `${rec.table}#${rec.id}`).join(', ');
}

function renderLines(model, caseRow, version, generatedAtIso) {
  const lines = [];
  lines.push('SML Connect dispute evidence packet');
  lines.push(`Case: ${caseRow.provider} ${caseRow.provider_dispute_id}` +
    `${caseRow.reason ? ` (reason: ${caseRow.reason})` : ''}`);
  lines.push(`Packet version: ${version}  Generated: ${generatedAtIso}  ${GENERATOR_VERSION}`);
  lines.push('');

  lines.push(`WARNINGS (${model.warnings.length})`);
  for (const warning of model.warnings) {
    lines.push(`- ${warning.code}: ${warning.detail || ''}`);
  }
  if (model.warnings.length === 0) lines.push('- none');
  lines.push('');

  lines.push(`ASSERTIONS (${model.assertions.length})`);
  if (model.assertions.length === 0) {
    lines.push('- none: no assertion had at least one supporting evidence item.');
  }
  for (const assertion of model.assertions) {
    lines.push(`- [${assertion.kind}] ${assertion.text}`);
    lines.push(`    evidence items: ${assertion.evidenceItemIds.join(', ')}; ` +
      `cites: ${citesLabel(assertion.citedRecords)}`);
  }
  lines.push('');

  lines.push(`CONTRADICTIONS (${model.contradictions.length})`);
  for (const contradiction of model.contradictions) {
    lines.push(`- ${contradiction.code}: ${contradiction.detail || ''}` +
      `${contradiction.citedIds ? ` [${citesLabel(contradiction.citedIds)}]` : ''}`);
  }
  if (model.contradictions.length === 0) lines.push('- none');
  lines.push('');

  lines.push(`CHECKLIST (${model.checklist.length})`);
  for (const entry of model.checklist) {
    lines.push(`- ${entry.kind}: ${entry.state}`);
  }
  lines.push('');

  lines.push(`TIMELINE (${model.timeline.length})`);
  for (const entry of model.timeline) {
    lines.push(`- ${entry.at}  ${entry.label}  [${citesLabel(entry.citedIds)}]`);
  }
  return lines;
}

/* -------------------------------------------------------------------------- */
/* generatePacket                                                              */
/* -------------------------------------------------------------------------- */

function generatePacket(input) {
  if (input == null || typeof input !== 'object') {
    throw new TypeError('generatePacket requires an input object');
  }
  const { model, caseRow, version, generatedAt } = input;
  if (model == null || typeof model !== 'object') throw new TypeError('model is required');
  for (const key of ['timeline', 'checklist', 'contradictions', 'warnings', 'assertions']) {
    if (!Array.isArray(model[key])) throw new TypeError(`model.${key} must be an array`);
  }
  if (caseRow == null || typeof caseRow !== 'object') throw new TypeError('caseRow is required');
  if (!Number.isInteger(version) || version < 1) {
    throw new TypeError('version must be a positive integer');
  }
  const generatedMs = typeof generatedAt === 'number' ? generatedAt : Date.parse(generatedAt);
  if (!Number.isFinite(generatedMs)) {
    throw new TypeError('generatedAt must be epoch milliseconds or an ISO timestamp');
  }
  const maxPdfBytes = input.maxPdfBytes == null ? PACKET_PDF_MAX_BYTES : input.maxPdfBytes;
  if (!Number.isFinite(maxPdfBytes) || maxPdfBytes <= 0) {
    throw new TypeError('maxPdfBytes must be a positive number');
  }
  const generatedAtIso = new Date(generatedMs).toISOString();

  const manifest = {
    assertions: model.assertions.map((assertion) => ({
      cited_records: assertion.citedRecords,
      evidence_item_ids: assertion.evidenceItemIds,
      id: assertion.id,
      kind: assertion.kind,
      text: assertion.text
    })),
    case: {
      id: caseRow.id == null ? null : caseRow.id,
      provider: caseRow.provider,
      provider_dispute_id: caseRow.provider_dispute_id,
      reason: caseRow.reason == null ? null : caseRow.reason
    },
    checklist: model.checklist,
    contradictions: model.contradictions,
    generated_at: generatedAtIso,
    generator_version: GENERATOR_VERSION,
    /* The provider mapping is part of the hashed manifest so the admin's
     * approval (bound to packet_sha256) covers exactly the fields and file
     * plan that will be transmitted. */
    paypal_evidence: model.paypalEvidence || null,
    stripe_evidence: model.stripeEvidence || null,
    timeline: model.timeline,
    version,
    warnings: model.warnings
  };

  const manifestJson = sortedStringify(manifest);
  const manifestSha256 = sha256Hex(manifestJson);

  const pdfBuffer = buildPdf(renderLines(model, caseRow, version, generatedAtIso));
  if (pdfBuffer.length > maxPdfBytes) {
    throw new Error(`packet PDF exceeds size cap (${pdfBuffer.length} > ${maxPdfBytes} bytes)`);
  }
  const pdfSha256 = sha256Hex(pdfBuffer);
  const packetSha256 = sha256Hex(Buffer.concat([Buffer.from(manifestJson, 'utf8'), pdfBuffer]));

  return { manifest, manifestJson, pdfBuffer, pdfSha256, manifestSha256, packetSha256 };
}

module.exports = {
  GENERATOR_VERSION,
  PACKET_PDF_MAX_BYTES,
  generatePacket,
  sortedStringify
};
