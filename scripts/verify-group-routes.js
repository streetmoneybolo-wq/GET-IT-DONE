#!/usr/bin/env node
'use strict';

/*
 * Group-route regression check: a /groups/{slug} URL must never be swallowed
 * by WordPress's 404 canonical guess (redirect_guess_404_permalink) into a
 * similarly-slugged ARTICLE, and the article must keep its own URL.
 *
 * Root cause this guards (2026-09-02 outage): the groups engine lives in a
 * WPCode Run-Everywhere snippet; WPCode blanks the ENTIRE merged snippet blob
 * when it counts >5 of base64_decode/eval/ini_set/error_reporting ANYWHERE in
 * the merged code — comments included. When that happens every /groups/{slug}
 * 404s, and the slug that shares a prefix with a published article 301s to the
 * article. See work/…/wpcode-merged-eval-trap memory and scripts/check-wpcode.js.
 *
 * Usage: node scripts/verify-group-routes.js [baseUrl]
 * Exit 0 = healthy. Exit 1 = regression (with a line per failure).
 */

const BASE = (process.argv[2] || 'https://stockmarketloop.com').replace(/\/$/, '');
const UA = 'sml-group-route-check/1.0 (Mozilla/5.0 compatible)';

/* slug pairs under guard: [group slug, similarly-named article path] */
const GROUP_ARTICLE_COLLISIONS = [
  ['making-easy-money', '/making-easy-money-discord-closing-june-29/']
];
/* groups that must resolve (200 render or the engine's own 302 to /groups/ —
   never a 301 to an article/home, never a 404) */
const GROUPS = ['making-easy-money', 'smart-money-trades', 'spy-spy-highflyers', 'the-options-plug'];

async function probe(path) {
  const response = await fetch(`${BASE}${path}?rtcheck=${Date.now()}`, {
    method: 'GET',
    redirect: 'manual',
    headers: { 'user-agent': UA, 'cache-control': 'no-cache' }
  });
  return { status: response.status, location: response.headers.get('location') || '' };
}

async function main() {
  const failures = [];

  for (const slug of GROUPS) {
    const { status, location } = await probe(`/groups/${slug}/`);
    const okRender = status === 200;
    const okAccessRedirect = status === 302 && /\/groups\/?(\?|$)/.test(location);
    if (!okRender && !okAccessRedirect) {
      failures.push(`/groups/${slug}/ -> ${status} ${location} (expected 200 or engine 302 to /groups/)`);
    }
    if (status === 301) {
      failures.push(`/groups/${slug}/ 301s to ${location} — canonical-guess swallowed the group route (groups engine down?)`);
    }
  }

  for (const [slug, articlePath] of GROUP_ARTICLE_COLLISIONS) {
    const group = await probe(`/groups/${slug}/`);
    if (group.location && group.location.includes(articlePath.replace(/\/$/, ''))) {
      failures.push(`/groups/${slug}/ redirects into the article ${articlePath} — slug collision regression`);
    }
    const article = await probe(articlePath);
    if (article.status !== 200) {
      failures.push(`${articlePath} -> ${article.status} (the article must keep its own URL)`);
    }
  }

  if (failures.length) {
    for (const failure of failures) console.error('FAIL ' + failure);
    process.exit(1);
  }
  console.log(`OK — ${GROUPS.length} group routes + ${GROUP_ARTICLE_COLLISIONS.length} collision pair(s) healthy on ${BASE}`);
}

main().catch((error) => { console.error('FAIL probe error: ' + error.message); process.exit(1); });
