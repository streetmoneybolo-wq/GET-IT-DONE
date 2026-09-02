'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_COMBINED_BYTES,
  STRIPE_FILES_HOST,
  createStripeFilesClient,
  validateEvidenceFiles
} = require('./stripe-files');

function pdf(size = 10) { return Buffer.alloc(size, 0x25); }

function file(overrides = {}) {
  return {
    field: 'receipt',
    fileName: 'receipt.pdf',
    contentType: 'application/pdf',
    bytes: pdf(),
    ...overrides
  };
}

function fakeRequest(options = {}) {
  const calls = [];
  return {
    calls,
    request: async (args) => {
      calls.push(args);
      if (options.statusCode && options.statusCode !== 200) {
        return { statusCode: options.statusCode, body: JSON.stringify({ error: { code: 'processing_error' } }) };
      }
      return { statusCode: 200, body: JSON.stringify({ id: `file_${calls.length}` }) };
    }
  };
}

test('validateEvidenceFiles accepts PDF, JPEG and PNG under the combined cap', () => {
  const result = validateEvidenceFiles([
    file(),
    file({ field: 'customer_communication', fileName: 'thread.png', contentType: 'image/png' }),
    file({ field: 'refund_policy', fileName: 'policy.jpg', contentType: 'image/jpeg' })
  ]);
  assert.equal(result.combinedBytes, 30);
});

test('a disallowed content type is refused with a TypeError', () => {
  assert.throws(
    () => validateEvidenceFiles([file({ contentType: 'text/plain' })]),
    (error) => error instanceof TypeError && /unsupported evidence file type/.test(error.message)
  );
  assert.throws(
    () => validateEvidenceFiles([file({ contentType: 'image/gif' })]),
    TypeError
  );
});

test('the 4.5MB combined cap is enforced across files', () => {
  const three = 3 * 1024 * 1024;
  assert.throws(
    () => validateEvidenceFiles([
      file({ bytes: pdf(three) }),
      file({ field: 'duplicate_charge_documentation', bytes: pdf(three) })
    ]),
    (error) => error instanceof TypeError && /combined/.test(error.message)
  );
  assert.throws(
    () => validateEvidenceFiles([file({ bytes: pdf(MAX_COMBINED_BYTES + 1) })]),
    TypeError
  );
});

test('one file per evidence field, empty bytes and bad names are refused', () => {
  assert.throws(
    () => validateEvidenceFiles([file(), file()]),
    (error) => error instanceof TypeError && /one file/.test(error.message)
  );
  assert.throws(() => validateEvidenceFiles([file({ bytes: Buffer.alloc(0) })]), TypeError);
  assert.throws(() => validateEvidenceFiles([file({ fileName: '../etc/passwd' })]), TypeError);
  assert.throws(() => validateEvidenceFiles([file({ field: '' })]), TypeError);
});

test('the client is unconfigured without an API key', () => {
  assert.throws(() => createStripeFilesClient({}), /unconfigured/);
});

test('upload posts multipart purpose=dispute_evidence to the fixed files host', async () => {
  const fake = fakeRequest();
  const client = createStripeFilesClient({ apiKey: 'sk_test_abc', request: fake.request });
  const result = await client.upload({
    fileName: 'packet.pdf',
    contentType: 'application/pdf',
    bytes: pdf(),
    idempotencyKey: 'dispute-submit:1:1:2:file:receipt'
  });

  assert.equal(result.fileId, 'file_1');
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.hostname, STRIPE_FILES_HOST);
  assert.equal(call.path, '/v1/files');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers.authorization, 'Bearer sk_test_abc');
  assert.equal(call.headers['idempotency-key'], 'dispute-submit:1:1:2:file:receipt');
  const body = call.body.toString('utf8');
  assert.match(body, /name="purpose"\r\n\r\ndispute_evidence/);
  assert.match(body, /filename="packet\.pdf"/);
  assert.match(body, /Content-Type: application\/pdf/);
});

test('upload refuses a bad file before any network call', async () => {
  const fake = fakeRequest();
  const client = createStripeFilesClient({ apiKey: 'sk_test_abc', request: fake.request });
  await assert.rejects(
    () => client.upload({ fileName: 'a.txt', contentType: 'text/plain', bytes: pdf() }),
    TypeError
  );
  assert.equal(fake.calls.length, 0);
});

test('a provider error surfaces the status code but never the API key', async () => {
  const fake = fakeRequest({ statusCode: 402 });
  const client = createStripeFilesClient({ apiKey: 'sk_live_supersecret', request: fake.request });
  await assert.rejects(
    () => client.upload(file()),
    (error) => !(error instanceof TypeError) &&
      /HTTP 402/.test(error.message) &&
      !error.message.includes('sk_live_supersecret')
  );
});

test('uploadAll validates the whole batch first, then maps fields to file ids', async () => {
  const fake = fakeRequest();
  const client = createStripeFilesClient({ apiKey: 'sk_test_abc', request: fake.request });
  const result = await client.uploadAll([
    file(),
    file({ field: 'cancellation_policy', fileName: 'policy.png', contentType: 'image/png' })
  ], { idempotencyKeyBase: 'dispute-submit:9:1:3' });

  assert.deepEqual(result.fieldFileIds, { receipt: 'file_1', cancellation_policy: 'file_2' });
  assert.equal(fake.calls[0].headers['idempotency-key'], 'dispute-submit:9:1:3:file:receipt');
  assert.equal(fake.calls[1].headers['idempotency-key'], 'dispute-submit:9:1:3:file:cancellation_policy');
});

test('uploadAll refuses an oversized batch without uploading anything', async () => {
  const fake = fakeRequest();
  const client = createStripeFilesClient({ apiKey: 'sk_test_abc', request: fake.request });
  await assert.rejects(
    () => client.uploadAll([
      file({ bytes: pdf(3 * 1024 * 1024) }),
      file({ field: 'other', bytes: pdf(3 * 1024 * 1024) })
    ]),
    TypeError
  );
  assert.equal(fake.calls.length, 0);
});
