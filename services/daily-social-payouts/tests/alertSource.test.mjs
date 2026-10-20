import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptsAlertAuthor } from '../utils/alertSource.js';

const id = '1559212065112064105';
const webhook = { author: { id, bot: true, username: 'GRANDMASTER-OBI' }, webhookId: id };

test('Grandmaster-OBI webhook is accepted only by its configured source', () => {
  assert.equal(acceptsAlertAuthor({ webhookIds: [id] }, webhook), true);
  assert.equal(acceptsAlertAuthor({}, webhook), false);
  assert.equal(acceptsAlertAuthor(undefined, webhook), false);
  assert.equal(acceptsAlertAuthor({ webhookIds: ['other'] }, webhook), false);
  assert.equal(acceptsAlertAuthor({ webhookIds: [id] }, { ...webhook, author: { id: 'other', bot: true } }), false);
});

test('bot names and bot author exceptions cannot authorize a webhook', () => {
  assert.equal(acceptsAlertAuthor({ botAuthorIds: [id] }, webhook), false);
  assert.equal(acceptsAlertAuthor({}, { author: webhook.author }), false);
  assert.equal(acceptsAlertAuthor({ botAuthorIds: [id] }, { author: webhook.author }), true);
});

test('author filters still apply to approved webhooks and human authors', () => {
  assert.equal(acceptsAlertAuthor({ webhookIds: [id], authorIds: ['other'] }, webhook), false);
  assert.equal(acceptsAlertAuthor({ webhookIds: [id], authorIds: [id] }, webhook), true);
  const human = { author: { id: 'human', bot: false } };
  assert.equal(acceptsAlertAuthor(undefined, human), true);
  assert.equal(acceptsAlertAuthor({ authorIds: ['other'] }, human), false);
  assert.equal(acceptsAlertAuthor({ authorIds: ['human'] }, human), true);
});
