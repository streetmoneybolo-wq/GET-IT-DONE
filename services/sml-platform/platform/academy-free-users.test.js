'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { OWNER_IDS, freeUserIds, withFreeUsers } = require('./academy-free-users.js');

const OWNER = '1087769175453339648', OTHER = '300000000000000001';

test('the owner is free by default and more ids can be added from the environment', () => {
  assert.deepEqual(OWNER_IDS, [OWNER]);
  const ids = freeUserIds({ SML_ACADEMY_FREE_USER_IDS: OTHER + ', nope ,' });
  assert.ok(ids.has(OWNER) && ids.has(OTHER) && ids.size === 2);
});

test('a free user gets in at the member tier, in or out of the server; everyone else keeps the normal result', async () => {
  const free = freeUserIds({});
  const refusal = (userId) => ({ ok: false, status: 403, code: 'academy_role_required', ...(userId ? { userId } : {}) });
  assert.deepEqual(await withFreeUsers({ verify: async () => refusal(OWNER) }, free).verify('Bearer x'), { ok: true, userId: OWNER, tier: 'member' });
  assert.deepEqual(await withFreeUsers({ verify: async () => refusal() }, free, { verify: async () => ({ ok: true, userId: OWNER }) }).verify('Bearer x'), { ok: true, userId: OWNER, tier: 'member' }, 'not in the server: identity proves who it is');
  assert.deepEqual(await withFreeUsers({ verify: async () => ({ ok: true, userId: OWNER, tier: 'academy' }) }, free).verify('x'), { ok: true, userId: OWNER, tier: 'member' }, 'upgraded');
  assert.deepEqual(await withFreeUsers({ verify: async () => refusal(OTHER) }, free).verify('x'), refusal(OTHER));
  assert.deepEqual(await withFreeUsers({ verify: async () => refusal() }, free, { verify: async () => ({ ok: true, userId: OTHER }) }).verify('x'), refusal());
  assert.deepEqual(await withFreeUsers({ verify: async () => ({ ok: false, status: 401, code: 'authorization_required' }) }, free, { verify: async () => ({ ok: false }) }).verify('x'), { ok: false, status: 401, code: 'authorization_required' });
});
