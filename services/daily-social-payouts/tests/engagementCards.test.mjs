import test from 'node:test';
import assert from 'node:assert/strict';
import { returnedPostShareComponents } from '../utils/discordPresentation.js';

const id = '8c0df2fb-0b0b-4f1c-9170-45e111aa2222';

test('returned post engagement card gives supported platforms a reply and share-your-take flow', () => {
  const rows = returnedPostShareComponents(id, id, 'x').map((row) => row.toJSON());
  const labels = rows.flatMap((row) => row.components.map((component) => component.label));
  assert.ok(labels.includes('Get reply to copy'));
  assert.ok(labels.includes('Share your take on X'));
  assert.ok(labels.includes('Submit Public Proof Link'));
});

test('Stocktwits card offers a manual, copy-first post preparation flow', () => {
  const rows = returnedPostShareComponents(id, id, 'stocktwits').map((row) => row.toJSON());
  const labels = rows.flatMap((row) => row.components.map((component) => component.label));
  assert.ok(labels.includes('Get reply to copy'));
  assert.ok(labels.includes('Prepare Stocktwits post'));
});
