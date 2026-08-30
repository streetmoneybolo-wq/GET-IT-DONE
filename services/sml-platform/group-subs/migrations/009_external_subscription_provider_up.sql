BEGIN;

CREATE UNIQUE INDEX subscriptions_external_import_unique
  ON subscriptions (external_platform, external_reference)
  WHERE origin = 'discord_imported';

COMMENT ON INDEX subscriptions_external_import_unique IS
  'One provider subscription can be imported only once; webhook/API replays update the same audited row.';

COMMIT;
