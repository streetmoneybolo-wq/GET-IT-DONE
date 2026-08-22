-- =============================================================================
-- StockMarketLoop — Group subscriptions ROLLBACK
-- Apply with:  node db/migrate.js down 003 --yes
--
-- DESTRUCTIVE, AND DIFFERENT IN KIND FROM THE OTHER ROLLBACKS.
--
-- This drops FINANCIAL RECORDS. platform_fee_ledger is the audit trail for
-- every fee charged, and it is the only place the platform's own revenue is
-- recorded against a Stripe invoice id. Losing it means the books cannot be
-- reconstructed from anything on this side of Stripe.
--
-- TAKE A DUMP FIRST. Not optional:
--   pg_dump -t platform_fee_ledger -t subscriptions -t stripe_events -Fc yourdb > subs_backup.dump
--
-- Dropping stripe_events also destroys the webhook idempotency ledger. If the
-- schema is rebuilt and Stripe replays historical events, every one of them
-- will look new — fees can be double-recorded. After any rebuild, either
-- re-import the processed event ids or set the webhook's replay cursor forward.
--
-- Order: children before parents, types after the columns that use them.
-- =============================================================================

BEGIN;

-- Trigger first (DROP TABLE would take it, but being explicit also cleans up
-- after a forward migration that failed midway).
DROP TRIGGER IF EXISTS subscriptions_touch ON subscriptions;

-- Leaves: both reference subscriptions.
DROP TABLE IF EXISTS platform_fee_ledger CASCADE;   -- financial audit trail
DROP TABLE IF EXISTS role_grants         CASCADE;

-- Webhook ledger. Standalone, but see the idempotency warning above.
DROP TABLE IF EXISTS stripe_events CASCADE;

-- subscriptions.plan_id -> group_plans, and superseded_by is a self-reference
-- that CASCADE resolves.
DROP TABLE IF EXISTS subscriptions CASCADE;

-- plan_role_grants.plan_id -> group_plans.
DROP TABLE IF EXISTS plan_role_grants CASCADE;
DROP TABLE IF EXISTS group_plans      CASCADE;

-- Discord linkage. Dropping discord_identities un-links every member, so after
-- a rebuild each one must complete the OAuth flow again before reconcile() can
-- grant them anything — it will correctly report "user has not linked Discord"
-- for the entire membership until they do.
DROP TABLE IF EXISTS discord_identities  CASCADE;
DROP TABLE IF EXISTS discord_guild_links CASCADE;

-- Function is specific to this migration (note the _subs suffix — the generic
-- set_updated_at() belongs to 001 and is deliberately left alone).
DROP FUNCTION IF EXISTS set_updated_at_subs();

-- Types last.
DROP TYPE IF EXISTS sub_origin;
DROP TYPE IF EXISTS grant_target;
DROP TYPE IF EXISTS grant_state;
DROP TYPE IF EXISTS sub_status;

COMMIT;
