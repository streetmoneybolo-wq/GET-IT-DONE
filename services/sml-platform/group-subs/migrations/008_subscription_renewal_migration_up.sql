BEGIN;

-- The external provider sync writes these fields. Checkout may consume the
-- date but may never accept a member-supplied renewal timestamp.
ALTER TABLE subscriptions
  ADD COLUMN external_renewal_source TEXT,
  ADD COLUMN external_renewal_verified_at TIMESTAMPTZ,
  ADD COLUMN migration_from_subscription_id BIGINT REFERENCES subscriptions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX subscriptions_one_migration_per_source
  ON subscriptions (migration_from_subscription_id)
  WHERE migration_from_subscription_id IS NOT NULL AND status <> 'incomplete_expired';

COMMENT ON COLUMN subscriptions.external_renewal_source IS
  'Provider/API that verified current_period_end. A Discord role alone is never a billing-date source.';
COMMENT ON COLUMN subscriptions.external_renewal_verified_at IS
  'When the external renewal date was last verified server-to-server. Migration checkout refuses stale or unverified dates.';
COMMENT ON COLUMN subscriptions.migration_from_subscription_id IS
  'Imported subscription whose already-paid access is being moved to this native SML subscription.';

COMMIT;
