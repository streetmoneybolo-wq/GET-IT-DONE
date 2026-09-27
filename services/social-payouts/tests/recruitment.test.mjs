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

test('posts follow the owner example, open Reddit fully filled in, and vary from click to click', () => {
  const texts = new Set(), titles = new Set();
  for (let v = 1; v <= 40; v++) {
    for (const sub of posts.approvedRecruitmentSubreddits) {
      const p = posts.generateRecruitmentPost(sub, v);
      assert.ok(p.title.length <= 256);
      if (/^(hiring|forhire)$/i.test(sub)) assert.match(p.title, /^\[HIRING\] /);
      if (sub === 'sidehustle') assert.doesNotMatch(p.title, /\[HIRING\]/);
      assert.match(p.body, /https:\/\/stockmarketloop\.com\/go\/dsp-jmuy\//);
      assert.match(p.body, /72 hours/); assert.match(p.body, /PayPal/);
      assert.doesNotMatch(p.body, /guaranteed income|unlimited|passive income|\$\d/i, 'no dollar promises');
      const url = new URL(p.composerUrl);
      assert.equal(url.pathname, `/r/${sub}/submit`);
      assert.equal(url.searchParams.get('title'), p.title); assert.equal(url.searchParams.get('text'), p.body);
      const reply = panel.postReply(p, v);
      assert.ok(reply.content.length <= 2000 && reply.content.includes(p.composerUrl), 'the full-prefill link fits in the reply');
      assert.ok(panel.copyReply(p).content.length <= 2000);
      texts.add(p.title + p.body); titles.add(p.title);
    }
  }
  assert.ok(texts.size > 1000, `distinct posts (${texts.size})`);
  assert.ok(titles.size >= 16);
  assert.match(posts.generateRecruitmentPost('HiringPH', 3).body, /Philippines/);
});

test('subreddits rotate: a member never gets one twice in a week, and the team spreads across the list', async () => {
  const cfg = panel.recruitmentConfig({ recruitmentPosts: { approvedSubreddits: ['a_one', 'b_two', 'c_three'] } });
  assert.equal(cfg.channelId, '1551968149132279908');
  const now = Date.parse('2026-09-27T12:00:00Z');
  const got = [];
  const fingerprints = new Set();
  for (let i = 0; i < 3; i++) { const c = await panel.claimSubreddit(cfg, '111111111111111111', now + i); got.push(c.sub); fingerprints.add(posts.postFingerprint(c.post)); }
  assert.equal(fingerprints.size, 3);
  assert.deepEqual(got.slice().sort(), ['a_one', 'b_two', 'c_three']);
  const done = await panel.claimSubreddit(cfg, '111111111111111111', now + 10);
  assert.equal(done.sub, null); assert.equal(done.retryAt, now + 7 * 86_400_000);
  const other = await panel.claimSubreddit(cfg, '222222222222222222', now + 20);
  assert.equal(other.sub, got[0], 'a second member gets the subreddit the team used longest ago');
  const nextWeek = await panel.claimSubreddit(cfg, '111111111111111111', now + 7 * 86_400_000 + 5);
  assert.ok(nextWeek.sub, 'open again after a week');
  // many members on the same subreddit never get identical text
  const one = panel.recruitmentConfig({ recruitmentPosts: { approvedSubreddits: ['solo'] } });
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const c = await panel.claimSubreddit(one, '3' + String(i).padStart(17, '0'), now + 100 + i); seen.add(posts.postFingerprint(c.post)); }
  assert.equal(seen.size, 200, 'every post handed out is different');
});
