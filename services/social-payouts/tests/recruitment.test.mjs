import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'dsp-recruit-'));
const posts = await import('../utils/recruitmentPosts.js');
const panel = await import('../utils/recruitmentPanel.js');

test('the owner list: 27 subreddits, no duplicates, links cleaned', () => {
  assert.equal(posts.approvedRecruitmentSubreddits.length, 27);
  assert.equal(new Set(posts.approvedRecruitmentSubreddits.map((s) => s.toLowerCase())).size, 27);
  assert.equal(posts.cleanSubreddit('https://www.reddit.com/r/sidehustle/'), 'sidehustle');
  assert.equal(posts.cleanSubreddit('r/forhire'), 'forhire');
});

test('a hiring post is honest, fits one Discord message, and varies from click to click', () => {
  const bodies = new Set(), titles = new Set();
  for (let v = 1; v <= 40; v++) {
    for (const sub of posts.approvedRecruitmentSubreddits) {
      const p = posts.generateRecruitmentPost(sub, v, { maxDailyUsd: 50 });
      assert.match(p.title, /^\[HIRING\]/); assert.match(p.title, /\$50\/day/); assert.ok(p.title.length <= 300);
      assert.match(p.body, /not guaranteed|No guaranteed income/);
      assert.match(p.body, /#ad/, 'paid posts must be labelled');
      assert.doesNotMatch(p.body, /unlimited|passive income|no cap/i);
      assert.ok(p.composerUrl.length <= 512 && p.composerUrl.startsWith(`https://www.reddit.com/r/${sub}/submit`));
      assert.ok(panel.postReply(p).content.length <= 2000, 'fits in one Discord reply');
      bodies.add(p.body); titles.add(p.title);
    }
  }
  assert.ok(bodies.size > 500, `many distinct bodies (${bodies.size})`);
  assert.equal(titles.size, 6);
  assert.match(posts.generateRecruitmentPost('HiringPH', 3).body, /Philippines/);
});

test('subreddits rotate: a member never gets one twice in a week, and the team spreads across the list', async () => {
  const cfg = panel.recruitmentConfig({ recruitmentPosts: { approvedSubreddits: ['a_one', 'b_two', 'c_three'] } });
  assert.equal(cfg.channelId, '1551968149132279908');
  const now = Date.parse('2026-09-27T12:00:00Z');
  const got = [];
  for (let i = 0; i < 3; i++) got.push((await panel.claimSubreddit(cfg, '111111111111111111', now + i)).sub);
  assert.deepEqual(got.slice().sort(), ['a_one', 'b_two', 'c_three']);
  const done = await panel.claimSubreddit(cfg, '111111111111111111', now + 10);
  assert.equal(done.sub, null); assert.equal(done.retryAt, now + 7 * 86_400_000);
  const other = await panel.claimSubreddit(cfg, '222222222222222222', now + 20);
  assert.equal(other.sub, got[0], 'a second member gets the subreddit the team used longest ago');
  const nextWeek = await panel.claimSubreddit(cfg, '111111111111111111', now + 7 * 86_400_000 + 5);
  assert.ok(nextWeek.sub, 'open again after a week');
});
