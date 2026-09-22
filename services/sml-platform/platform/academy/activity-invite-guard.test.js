'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { isAcademyActivityInvite, enforceAcademyActivityInvites } = require('./activity-invite-guard');

const GUILD = '938894329076940820';
const CATEGORY = '1551448153276944405';
const APP = '1551336038713139370';
const BRIEFING = '1551147441993285692';
const LESSONS = '1551459038405992488';

test('only the Academy type-23 Activity card is treated as an invitation', () => {
  assert.equal(isAcademyActivityInvite({ type: 23, application: { id: APP } }, APP), true);
  assert.equal(isAcademyActivityInvite({ type: 0, application: { id: APP } }, APP), false);
  assert.equal(isAcademyActivityInvite({ type: 23, application: { id: '999999999999999999' } }, APP), false);
});

test('guard removes invitations outside briefing and keeps one newest briefing card', async () => {
  const deleted = [];
  const responses = new Map([
    [`/api/v10/guilds/${GUILD}/channels`, [
      { id: BRIEFING, parent_id: CATEGORY, type: 0 },
      { id: LESSONS, parent_id: CATEGORY, type: 0 },
      { id: '1551459038405992999', parent_id: '111111111111111111', type: 0 }
    ]],
    [`/api/v10/channels/${BRIEFING}/messages?limit=100`, [
      { id: '1552000000000000002', type: 23, application: { id: APP } },
      { id: '1552000000000000001', type: 23, application: { id: APP } }
    ]],
    [`/api/v10/channels/${LESSONS}/messages?limit=100`, [
      { id: '1552000000000000003', type: 23, application: { id: APP } },
      { id: '1552000000000000004', type: 0, author: { bot: true } }
    ]]
  ]);
  const fetchImpl = async (url, options = {}) => {
    const path = new URL(url).pathname + new URL(url).search;
    if (options.method === 'DELETE') {
      deleted.push(path);
      return { ok: true, status: 204, text: async () => '' };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(responses.get(path) || []) };
  };

  const result = await enforceAcademyActivityInvites({
    token: 'token', guildId: GUILD, categoryId: CATEGORY, applicationId: APP,
    allowedChannelId: BRIEFING, fetchImpl
  });

  assert.deepEqual(result.kept, [{ channelId: BRIEFING, messageId: '1552000000000000002' }]);
  assert.equal(result.deletions.length, 2);
  assert.deepEqual(deleted.sort(), [
    `/api/v10/channels/${BRIEFING}/messages/1552000000000000001`,
    `/api/v10/channels/${LESSONS}/messages/1552000000000000003`
  ].sort());
});
