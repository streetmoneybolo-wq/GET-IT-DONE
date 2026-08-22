-- =============================================================================
-- StockMarketLoop News Engine — Module 10: moderation schema
-- Requires 001_news_engine_up.sql
-- Apply:  psql -1 -f 002_moderation_up.sql
-- =============================================================================

BEGIN;

CREATE TYPE moderation_status AS ENUM (
  'clean',
  'flagged',
  'needs_review',
  'auto_hidden',
  'auto_noindex',
  'restricted',
  'banned'
);

CREATE TYPE moderation_entity_type AS ENUM ('article','question','answer','comment','user');

CREATE TYPE moderation_flag_type AS ENUM (
  'spam','duplicate','toxicity','misinformation','manipulation','low_quality','bot'
);

CREATE TYPE moderation_action_type AS ENUM ('hide','noindex','restrict','ban','warn','throttle','unhide','unrestrict');

CREATE TYPE moderation_decision AS ENUM ('approve','reject','escalate');

-- -----------------------------------------------------------------------------
-- moderation_flags — every signal raised, one row per finding.
-- Deliberately append-only: a flag is never edited, only resolved. The history
-- of what the system thought and when is the audit trail.
-- -----------------------------------------------------------------------------
CREATE TABLE moderation_flags (
  id          BIGSERIAL PRIMARY KEY,
  entity_type moderation_entity_type NOT NULL,
  entity_id   BIGINT      NOT NULL,
  flag_type   moderation_flag_type   NOT NULL,
  severity    SMALLINT    NOT NULL,
  reason      TEXT        NOT NULL,
  -- The evidence behind the flag (matched phrase, similarity score, offending
  -- URL). Without it a reviewer cannot tell a true positive from a false one.
  evidence    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  detector    TEXT        NOT NULL,
  -- Which detector build produced this. Thresholds move; without a version the
  -- flag history becomes uninterpretable after the first tuning pass.
  detector_version TEXT   NOT NULL DEFAULT 'v1',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by BIGINT,
  CONSTRAINT moderation_flags_severity_rng CHECK (severity BETWEEN 1 AND 5),
  CONSTRAINT moderation_flags_resolved_pair CHECK (
    (resolved_at IS NULL AND resolved_by IS NULL) OR (resolved_at IS NOT NULL)
  )
);
COMMENT ON TABLE moderation_flags IS
  'Append-only record of every moderation signal. Never edited, only resolved.';

CREATE INDEX moderation_flags_entity_idx  ON moderation_flags (entity_type, entity_id, created_at DESC);
CREATE INDEX moderation_flags_open_idx    ON moderation_flags (severity DESC, created_at)
  WHERE resolved_at IS NULL;
CREATE INDEX moderation_flags_type_idx    ON moderation_flags (flag_type, created_at DESC);

-- -----------------------------------------------------------------------------
-- moderation_actions — what was DONE, as opposed to what was noticed.
-- Every action is reversible: the reversal is a new row (unhide/unrestrict)
-- rather than a delete, so the timeline stays intact.
-- -----------------------------------------------------------------------------
CREATE TABLE moderation_actions (
  id          BIGSERIAL PRIMARY KEY,
  entity_type moderation_entity_type NOT NULL,
  entity_id   BIGINT      NOT NULL,
  action_type moderation_action_type NOT NULL,
  reason      TEXT,
  flag_id     BIGINT REFERENCES moderation_flags(id) ON DELETE SET NULL,
  -- NULL created_by = the system acted automatically. Non-null = a named human.
  created_by  BIGINT,
  reverted_at TIMESTAMPTZ,
  reverted_by BIGINT,
  expires_at  TIMESTAMPTZ,   -- for throttle/restrict with a defined duration
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE moderation_actions IS
  'Actions taken. All reversible — a reversal is a new row, never a delete.';
COMMENT ON COLUMN moderation_actions.created_by IS
  'NULL means the system acted automatically; non-null is a named human.';

CREATE INDEX moderation_actions_entity_idx ON moderation_actions (entity_type, entity_id, created_at DESC);
CREATE INDEX moderation_actions_active_idx ON moderation_actions (entity_type, entity_id)
  WHERE reverted_at IS NULL;

-- -----------------------------------------------------------------------------
-- moderation_reviews — human decisions.
-- -----------------------------------------------------------------------------
CREATE TABLE moderation_reviews (
  id          BIGSERIAL PRIMARY KEY,
  entity_type moderation_entity_type NOT NULL,
  entity_id   BIGINT      NOT NULL,
  reviewer_id BIGINT      NOT NULL,
  decision    moderation_decision NOT NULL,
  notes       TEXT,
  -- Time from flag to decision, for staffing the queue.
  flagged_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE moderation_reviews IS
  'Human review decisions. Drives reviewer throughput and false-positive rates.';

CREATE INDEX moderation_reviews_entity_idx   ON moderation_reviews (entity_type, entity_id, created_at DESC);
CREATE INDEX moderation_reviews_reviewer_idx ON moderation_reviews (reviewer_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Content fingerprints — near-duplicate detection.
--
-- A plain hash only catches byte-identical text, which templated generation
-- never produces: swap the ticker and the hash changes while the article stays
-- the same article. SimHash over shingles gives a value whose Hamming distance
-- tracks semantic similarity, so near-duplicates are findable with an index.
-- -----------------------------------------------------------------------------
CREATE TABLE content_fingerprints (
  id          BIGSERIAL PRIMARY KEY,
  entity_type moderation_entity_type NOT NULL,
  entity_id   BIGINT      NOT NULL,
  -- 64-bit simhash stored signed; BIGINT is exact where double precision is not.
  simhash     BIGINT      NOT NULL,
  -- Banded prefixes for candidate lookup without scanning the table.
  band_0      INTEGER     NOT NULL,
  band_1      INTEGER     NOT NULL,
  band_2      INTEGER     NOT NULL,
  band_3      INTEGER     NOT NULL,
  token_count INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT content_fingerprints_uniq UNIQUE (entity_type, entity_id)
);
COMMENT ON TABLE content_fingerprints IS
  'SimHash fingerprints for near-duplicate detection. Bands make candidate '
  'lookup indexable — exact Hamming distance is then computed on the shortlist.';

CREATE INDEX content_fingerprints_b0_idx ON content_fingerprints (band_0);
CREATE INDEX content_fingerprints_b1_idx ON content_fingerprints (band_1);
CREATE INDEX content_fingerprints_b2_idx ON content_fingerprints (band_2);
CREATE INDEX content_fingerprints_b3_idx ON content_fingerprints (band_3);

-- -----------------------------------------------------------------------------
-- Module 10 writes quality_score alongside Module 6's predictions.
-- -----------------------------------------------------------------------------
ALTER TABLE article_scores
  ADD COLUMN quality_score REAL NOT NULL DEFAULT 0,
  ADD COLUMN moderation_status moderation_status NOT NULL DEFAULT 'clean',
  ADD CONSTRAINT article_scores_quality_rng CHECK (quality_score BETWEEN 0 AND 100);

CREATE INDEX article_scores_moderation_idx ON article_scores (moderation_status)
  WHERE moderation_status <> 'clean';

COMMIT;
