'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const video = require('./discord-fix-channel-video');
const GUILD = '111111111111111111'; const USER = '222222222222222222'; const ROLE = '333333333333333333'; const { PERMISSIONS } = video;
const bit = (value) => value.toString();
const roles = [{ id: GUILD, name: '@everyone', permissions: bit(PERMISSIONS.VIEW_CHANNEL | PERMISSIONS.CONNECT | PERMISSIONS.SPEAK), position: 0 }, { id: ROLE, name: 'Member', permissions: '0', position: 1 }];
test('member-level STREAM allow overrides a role-level STREAM deny', () => {
  const result = video.effectivePermissions({ guildId: GUILD, userId: USER, roles, memberRoleIds: [ROLE], ownerId: '999999999999999999', source: 'channel', overwrites: [{ id: ROLE, type: 0, allow: '0', deny: bit(PERMISSIONS.STREAM) }, { id: USER, type: 1, allow: bit(PERMISSIONS.STREAM), deny: '0' }] });
  assert.ok((result.permissions & PERMISSIONS.STREAM) !== 0n);
  assert.deepEqual(result.denySources, [{ permission: 'STREAM', overwrite: `channel role "Member" (${ROLE})` }]);
});
test('category synchronization requires equal overwrite sets regardless of order', () => {
  const category = [{ id: GUILD, type: 0, allow: '0', deny: bit(PERMISSIONS.VIEW_CHANNEL) }, { id: ROLE, type: 0, allow: bit(PERMISSIONS.VIEW_CHANNEL), deny: '0' }];
  assert.equal(video.syncedWithCategory({ permission_overwrites: [...category].reverse() }, { permission_overwrites: category }), true);
  assert.equal(video.syncedWithCategory({ permission_overwrites: [{ ...category[1], deny: bit(PERMISSIONS.CONNECT) }, category[0]] }, { permission_overwrites: category }), false);
});
test('voice and Stage channels support video, while a Stage requires a speaker and text does not', () => {
  assert.deepEqual(video.channelKind(2), { label: 'voice', canStream: true, needsSpeaker: false }); assert.deepEqual(video.channelKind(13), { label: 'stage', canStream: true, needsSpeaker: true }); assert.deepEqual(video.channelKind(0), { label: 'text', canStream: false, needsSpeaker: false });
});
