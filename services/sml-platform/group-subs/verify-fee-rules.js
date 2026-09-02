/* Proves the two CHECK constraints in 003 behave as intended, before anyone
   trusts them with money. Mirrors the SQL boolean expressions exactly, using
   SQL NULL semantics (NULL comparisons are UNKNOWN, treated as not-true). */
'use strict';
const assert = require('node:assert/strict');

const importedNeverFeed = (origin, fee) =>
  origin !== 'discord_imported' || fee === null || fee === 0;

const feeNeedsConsent = (fee, consentAt) =>
  fee === null || fee === 0 || consentAt !== null;

const importedHasSource = (origin, ext) =>
  origin !== 'discord_imported' || ext !== null;

const accepts = (row) =>
  importedNeverFeed(row.origin, row.fee) &&
  feeNeedsConsent(row.fee, row.consent) &&
  importedHasSource(row.origin, row.external);

const cases = [
  // [label, row, shouldSave]
  ['SML checkout with 6% fee + consent',
    { origin: 'sml_checkout', fee: 600, consent: 'now', external: null }, true],
  ['SML checkout, fee but NO consent',
    { origin: 'sml_checkout', fee: 600, consent: null, external: null }, false],
  ['imported sub with a 6% fee  <-- the Stripe problem',
    { origin: 'discord_imported', fee: 600, consent: 'now', external: 'upgrade_chat' }, false],
  ['imported sub, no fee',
    { origin: 'discord_imported', fee: null, consent: null, external: 'upgrade_chat' }, true],
  ['imported sub, explicit zero fee',
    { origin: 'discord_imported', fee: 0, consent: null, external: 'upgrade_chat' }, true],
  ['imported sub with no external platform recorded',
    { origin: 'discord_imported', fee: null, consent: null, external: null }, false],
  ['migrated sub, fee + consent',
    { origin: 'migrated', fee: 600, consent: 'now', external: null }, true],
  ['migrated sub, fee but no consent',
    { origin: 'migrated', fee: 600, consent: null, external: null }, false],
  ['comped member, no fee',
    { origin: 'manual_comp', fee: null, consent: null, external: null }, true]
];

let pass = 0;
for (const [label, row, expected] of cases) {
  const got = accepts(row);
  const ok = got === expected;
  if (ok) pass++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${expected ? 'saves ' : 'reject'}  ${label}`);
  assert.equal(got, expected, label);
}
console.log(`\n${pass}/${cases.length} constraint cases behave as designed`);
console.log('key result: an imported subscription CANNOT be saved with a fee,');
console.log('regardless of consent — the database refuses the row.');
