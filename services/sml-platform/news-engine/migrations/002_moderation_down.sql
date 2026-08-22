-- =============================================================================
-- StockMarketLoop News Engine — Module 2 (moderation) ROLLBACK
-- Apply with:  node db/migrate.js down 002 --yes
--
-- DESTRUCTIVE. Drops the moderation audit trail: every flag, every human
-- review decision, and the duplicate-detection fingerprints. The review history
-- is the record of WHY content was allowed or removed — keep a dump if there is
-- any chance of a dispute:
--   pg_dump -t 'moderation_*' -t content_fingerprints -Fc yourdb > moderation_backup.dump
--
-- Order: children before parents, types after the columns that use them.
-- Every DROP is IF EXISTS so a partially-applied forward migration still undoes.
-- =============================================================================

BEGIN;

-- moderation_reviews.flag_id references moderation_flags, so reviews go first.
DROP TABLE IF EXISTS moderation_reviews  CASCADE;
DROP TABLE IF EXISTS moderation_actions  CASCADE;
DROP TABLE IF EXISTS moderation_flags    CASCADE;

-- Standalone: simhash bands for near-duplicate detection. Dropping this loses
-- the corpus the duplicate checker compares against, so the first run after a
-- rebuild will not detect repeats until it refills.
DROP TABLE IF EXISTS content_fingerprints CASCADE;

-- Types last — a type cannot be dropped while a column still uses it.
DROP TYPE IF EXISTS moderation_decision;
DROP TYPE IF EXISTS moderation_action_type;
DROP TYPE IF EXISTS moderation_flag_type;
DROP TYPE IF EXISTS moderation_entity_type;
DROP TYPE IF EXISTS moderation_status;

COMMIT;
