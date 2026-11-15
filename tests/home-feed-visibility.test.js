import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const homeFeed = fs.readFileSync(path.join(__dirname, '..', 'js', 'home-feed.js'), 'utf8');
const gate = fs.readFileSync(path.join(__dirname, '..', 'mu-plugins', 'sml-home-feed-visibility-gates.php'), 'utf8');

assert.match(homeFeed, /#sml-optimized-home>\.sml-research-nav[^']*#sml-optimized-home>#sml-primary-public-nav\{display:none!important;\}/);
assert.match(homeFeed, /\.sml-hf-mmc-view\{grid-column:2;justify-self:center;\}/);
assert.match(homeFeed, /\.sml-hf-mmc-terminal\{grid-column:3;justify-self:end;\}/);
assert.match(homeFeed, /\.sml-hf-mmc \.sml-sth-actions a\{[^}]*margin-left:0!important;margin-right:0!important/);
assert.match(homeFeed, /@media\(max-width:620px\)\{\.sml-hf-mmc \.sml-sth-actions\{display:flex!important;flex-direction:column;align-items:center;justify-content:center\}/);
assert.match(homeFeed, /class="sml-hf-mmc-view"[^>]*>View on moomoo/);
assert.match(homeFeed, /class="sml-hf-mmc-terminal"/);
assert.match(homeFeed, /recommendedUploadsReady = Number\.isFinite\(channelCount\) && channelCount >= 15;/);
assert.doesNotMatch(homeFeed, /videoCount >= 200/);

assert.match(gate, /'channel_count'\] = count\( \$channels \)/);
assert.match(gate, /sml_vus_visible_videos\( \$exclude_id \)/);

console.log('home feed visibility tests passed');
