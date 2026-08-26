'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ownerPlugin = fs.readFileSync(path.join(__dirname, '..', 'plugins', 'sml-home-owner-controls', 'sml-home-owner-controls.php'), 'utf8');
const homePhp = fs.readFileSync(path.join(__dirname, '..', 'wpcode', 'optimized-home-recovery-7387.php'), 'utf8');

// SML News is the stockmarketloop member identity with the gold news artwork.
assert.match(ownerPlugin, /sml-news-avatar-gold-v1\.png/, 'SML News must use the gold SML News avatar');
assert.match(ownerPlugin, /sml_display_handle', 'SML News'/, 'SML News must keep its own display name');

// Stock Market Loop Signal News is a different author identity. Signal cards
// must continue to render their own author data (including the bull avatar)
// and must never be reassigned to the SML News member id.
const signalBlock = homePhp.match(/\$is_signal\s*=\s*\$post_id[\s\S]{0,900}/);
assert.ok(signalBlock, 'Signal News renderer must remain present');
assert.doesNotMatch(signalBlock[0], /258456543|sml-news-avatar-gold/, 'Signal News must never be mapped to SML News');
assert.match(homePhp, /\$author_avatar\s*=\s*esc_url_raw\(\(string\) \(\$author\['avatar'\]/, 'Signal News must retain its own feed author avatar');

console.log('PASS  SML News and Stock Market Loop Signal News identities remain separate');
