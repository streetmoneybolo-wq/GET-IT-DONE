'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const G = require('./packet-generator');

const GENERATED_AT = Date.parse('2026-06-01T12:00:00.000Z');

function sampleModel(overrides = {}) {
  return Object.assign({
    timeline: [
      { at: '2026-01-05T00:00:00.000Z', label: 'Subscription record (stripe sub_1)', citedIds: [{ table: 'billing_subscriptions', id: 3 }] },
      { at: '2026-05-15T00:00:00.000Z', label: 'Transaction charge of 19.99 USD (ch_5)', citedIds: [{ table: 'billing_transactions', id: 5 }] }
    ],
    checklist: [
      { kind: 'cancellation_rebuttal', state: 'present' },
      { kind: 'customer_name', state: 'missing' }
    ],
    contradictions: [],
    warnings: [{ code: 'policy_not_provable', detail: 'no consent references version v9' }],
    assertions: [{
      id: 'origin', kind: 'billing',
      text: 'The subscription was purchased on 2026-01-05.',
      evidenceItemIds: [11],
      citedRecords: [{ table: 'billing_subscriptions', id: 3 }]
    }]
  }, overrides);
}

function sampleCase() {
  return { id: 900, provider: 'stripe', provider_dispute_id: 'dp_1', reason: 'subscription_canceled' };
}

function generate(overrides = {}) {
  return G.generatePacket(Object.assign({
    model: sampleModel(), caseRow: sampleCase(), version: 1, generatedAt: GENERATED_AT
  }, overrides));
}

/* ---------------------------------------------------------------------------
 * Determinism
 * ------------------------------------------------------------------------- */

test('byte-identical output for identical input', () => {
  const a = generate();
  const b = generate();
  assert.ok(Buffer.isBuffer(a.pdfBuffer));
  assert.ok(a.pdfBuffer.equals(b.pdfBuffer), 'PDF bytes differ between identical runs');
  assert.equal(a.manifestJson, b.manifestJson);
  assert.equal(a.pdfSha256, b.pdfSha256);
  assert.equal(a.manifestSha256, b.manifestSha256);
  assert.equal(a.packetSha256, b.packetSha256);
});

test('hashes are real sha256 digests of the produced bytes', () => {
  const result = generate();
  assert.equal(result.pdfSha256,
    crypto.createHash('sha256').update(result.pdfBuffer).digest('hex'));
  assert.equal(result.manifestSha256,
    crypto.createHash('sha256').update(result.manifestJson).digest('hex'));
  assert.equal(result.packetSha256,
    crypto.createHash('sha256')
      .update(Buffer.concat([Buffer.from(result.manifestJson, 'utf8'), result.pdfBuffer]))
      .digest('hex'));
});

/* ---------------------------------------------------------------------------
 * Manifest
 * ------------------------------------------------------------------------- */

test('manifest JSON is serialized with lexicographically sorted keys at every depth', () => {
  const result = generate();
  const walk = (value) => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(walk); return; }
    const keys = Object.keys(value);
    assert.deepEqual(keys, [...keys].sort(), `unsorted keys: ${keys.join(',')}`);
    Object.values(value).forEach(walk);
  };
  walk(JSON.parse(result.manifestJson));
  assert.equal(G.sortedStringify({ b: 1, a: { d: 2, c: [3] } }), '{"a":{"c":[3],"d":2},"b":1}');
});

test('manifest carries assertions as {text, kind, evidence_item_ids} with case ref, version, and generator version', () => {
  const result = generate();
  assert.equal(result.manifest.version, 1);
  assert.equal(result.manifest.generator_version, G.GENERATOR_VERSION);
  assert.equal(result.manifest.generated_at, '2026-06-01T12:00:00.000Z');
  assert.deepEqual(result.manifest.case, {
    id: 900, provider: 'stripe', provider_dispute_id: 'dp_1', reason: 'subscription_canceled'
  });
  assert.deepEqual(result.manifest.assertions[0].evidence_item_ids, [11]);
  assert.equal(result.manifest.assertions[0].kind, 'billing');
});

/* ---------------------------------------------------------------------------
 * PDF structure
 * ------------------------------------------------------------------------- */

test('PDF is a self-contained 1.4 document using Helvetica', () => {
  const pdf = generate().pdfBuffer.toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.4\n'));
  assert.ok(pdf.endsWith('%%EOF\n'));
  assert.ok(pdf.includes('/BaseFont /Helvetica'));
  assert.ok(pdf.includes('/Type /Catalog'));
  assert.ok(pdf.includes('xref'));
  assert.ok(pdf.includes('trailer'));
});

test('text lines are escaped for PDF literal strings', () => {
  const model = sampleModel({
    warnings: [{ code: 'policy_not_provable', detail: 'label (with) parens and back\\slash' }]
  });
  const pdf = G.generatePacket({
    model, caseRow: sampleCase(), version: 1, generatedAt: GENERATED_AT
  }).pdfBuffer.toString('latin1');
  assert.ok(pdf.includes('\\(with\\) parens and back\\\\slash'));
});

test('page overflow: a long timeline spills onto additional pages with a correct page count', () => {
  const timeline = [];
  for (let i = 0; i < 200; i += 1) {
    timeline.push({
      at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}.000Z`,
      label: `Service event: entry ${i}`,
      citedIds: [{ table: 'service_usage_events', id: i }]
    });
  }
  const result = generate({ model: sampleModel({ timeline }) });
  const pdf = result.pdfBuffer.toString('latin1');
  const pageCount = (pdf.match(/\/Type \/Page\b(?!s)/g) || []).length;
  assert.ok(pageCount >= 4, `expected multiple pages, got ${pageCount}`);
  assert.match(pdf, new RegExp(`/Count ${pageCount}\\b`));

  const single = generate();
  const singlePages = (single.pdfBuffer.toString('latin1').match(/\/Type \/Page\b(?!s)/g) || []).length;
  assert.equal(singlePages, 1);
});

test('empty-evidence packet refuses to assert anything', () => {
  const result = generate({
    model: sampleModel({ assertions: [], warnings: [], checklist: [], timeline: [] })
  });
  assert.deepEqual(result.manifest.assertions, []);
  const pdf = result.pdfBuffer.toString('latin1');
  assert.ok(pdf.includes('ASSERTIONS \\(0\\)'));
  assert.ok(pdf.includes('none: no assertion had at least one supporting evidence item.'));
});

/* ---------------------------------------------------------------------------
 * Caps + input validation
 * ------------------------------------------------------------------------- */

test('size cap: a packet PDF over the byte cap is refused', () => {
  assert.throws(() => generate({ maxPdfBytes: 128 }), /size cap/);
  assert.equal(G.PACKET_PDF_MAX_BYTES, 4 * 1024 * 1024);
});

test('malformed input throws TypeError (service maps it to 400)', () => {
  assert.throws(() => G.generatePacket(null), TypeError);
  assert.throws(() => G.generatePacket({ caseRow: sampleCase(), version: 1, generatedAt: GENERATED_AT }), TypeError);
  assert.throws(() => generate({ model: sampleModel({ assertions: 'nope' }) }), TypeError);
  assert.throws(() => generate({ caseRow: null }), TypeError);
  assert.throws(() => generate({ version: 0 }), TypeError);
  assert.throws(() => generate({ version: 1.5 }), TypeError);
  assert.throws(() => generate({ generatedAt: 'not a timestamp' }), TypeError);
  assert.throws(() => generate({ maxPdfBytes: -1 }), TypeError);
});
