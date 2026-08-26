'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const home = fs.readFileSync(path.join(__dirname, '..', 'js', 'home-feed.js'), 'utf8');
const articleCss = fs.readFileSync(path.join(__dirname, '..', 'css', 'article-styles.css'), 'utf8');

assert.match(home, /function\s+attachRh\(\)\{\s*return;\s*\}/, 'homepage side-button attachment must remain a hard no-op');
assert.doesNotMatch(home, /function\s+attachRh\([^)]*\)\s*\{[^}]*createElement\(['"]button/, 'homepage cards must never create a side button');
assert.match(home, /\.sml-rh-btn,\.sml-rh-panel\{display:none!important;\}/, 'cached homepage side controls must remain hidden');
assert.match(articleCss, /\.sml-alert-article-page \.post-navigation[\s\S]*?display:\s*none\s*!important/, 'article pages must suppress floating post-navigation controls');

console.log('PASS  homepage cards and articles contain no side buttons');
