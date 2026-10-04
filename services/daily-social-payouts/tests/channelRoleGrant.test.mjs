import test from 'node:test';
import assert from 'node:assert/strict';
import { planChannelRoleGrants, cleanIds } from '../utils/channelRoleGrant.js';

const A = '1553704513070960651', B = '1553281948527362100';

test('cleanIds keeps valid unique ids only', () => {
  assert.deepEqual(cleanIds([A, ' ' + A, 'abc', '', B]), [A, B]);
  assert.deepEqual(cleanIds(null), []);
});

test('only people who can see the channel and lack a role are planned, with just the roles they lack', () => {
  const plan = planChannelRoleGrants([
    { id: '1', bot: false, roleIds: [], canView: true },
    { id: '2', bot: false, roleIds: [A], canView: true },
    { id: '3', bot: false, roleIds: [A, B], canView: true },
    { id: '4', bot: true, roleIds: [], canView: true },
    { id: '5', bot: false, roleIds: [], canView: false }
  ], [A, B]);
  assert.deepEqual(plan.grants, [{ id: '1', missing: [A, B] }, { id: '2', missing: [B] }]);
  assert.deepEqual([plan.skippedBots, plan.cannotView, plan.alreadyComplete], [1, 1, 1]);
});
