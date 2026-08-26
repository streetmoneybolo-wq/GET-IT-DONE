#!/usr/bin/env node
/* Guard for wpcode/*.php — run: node scripts/check-wpcode.js
 *
 * Every Run-Everywhere WPCode snippet on stockmarketloop.com is merged into ONE
 * eval. That makes two ordinary-looking things catastrophic rather than local:
 *
 *   1. A leading <?php is a PARSE ERROR inside that eval, so it does not break
 *      the snippet being installed — it breaks ALL of them, site-wide, silently.
 *
 *   2. A top-level `return` ABORTS the merged eval at that point, so every
 *      snippet ordered after it stops running. Use `exit` for ABSPATH guards.
 *
 * Files carrying a `Plugin Name:` header are real plugins and are skipped —
 * they are supposed to open with <?php.
 *
 * Exits non-zero on a violation so it can gate a commit or CI.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'wpcode');
const problems = [];

if (!fs.existsSync(DIR)) {
  console.log('no wpcode/ directory — nothing to check');
  process.exit(0);
}

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.php')).sort()) {
  const full = path.join(DIR, file);
  const src = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
  const lines = src.split('\n');
  const head = lines.slice(0, 15).join('\n');

  // Real plugins legitimately open with <?php.
  if (/Plugin Name:/i.test(head)) continue;

  if (lines[0] && lines[0].trim() === '<?php') {
    problems.push(`${file}:1  opening <?php — parse error inside the merged eval, kills every snippet`);
  }

  /* Only column-0 returns matter: anything indented is inside a function and is
     perfectly normal. */
  lines.forEach((line, i) => {
    if (/^return\b/.test(line)) {
      problems.push(`${file}:${i + 1}  top-level return — aborts the merged eval; use exit`);
    }
  });

  for (const fn of ['base64_decode', 'ini_set', 'error_reporting']) {
    const n = (src.match(new RegExp('\\b' + fn + '\\s*\\(', 'g')) || []).length;
    if (n) {
      problems.push(`${file}  uses ${fn}() x${n} — the site sits at the 5/5 threshold that disables all snippets`);
    }
  }
  if (/\beval\s*\(/.test(src)) {
    problems.push(`${file}  uses eval() — same 5/5 threshold`);
  }
}

if (problems.length) {
  console.error('WPCode guard FAILED:\n');
  problems.forEach((p) => console.error('  ' + p));
  console.error('\nSee the merged-eval notes in the repo before overriding.');
  process.exit(1);
}

console.log('WPCode guard passed — no snippet in wpcode/ can take the site down on install.');
