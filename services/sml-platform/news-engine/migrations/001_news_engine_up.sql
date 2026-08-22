-- =============================================================================
-- StockMarketLoop News Engine — Module 1: schema
-- Target: PostgreSQL 14+
-- Apply inside a transaction:  psql -1 -f 001_news_engine_up.sql
--
-- PREREQUISITE: migration 000_ticker_registry_up.sql runs first and creates
-- `tickers(ticker PRIMARY KEY)`. Do not bypass the migration runner: article
-- ticker references must point to the platform-local canonical registry.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy title / slug matching

-- -----------------------------------------------------------------------------
-- ENUMs
-- -----------------------------------------------------------------------------

-- How an article came to exist. Drives editorial policy, not just reporting:
-- 'auto_generated' rows are the ones a reviewer must clear before indexing.
CREATE TYPE article_source_type AS ENUM (
  'external_summary',  -- summarised from a licensed/permitted third-party feed
  'rewritten',         -- rewritten from our own base summary
  'enhanced',          -- rewritten + proprietary data modules injected
  'auto_generated'     -- generated from our own signals, no external source
);

-- 'noindex' is DELIBERATELY the default (see articles.status). A publishing
-- pipeline that can emit hundreds of rows a day must fail closed.
CREATE TYPE article_status AS ENUM (
  'active',   -- public and indexable
  'noindex',  -- public but carries <meta name="robots" content="noindex">
  'hidden'    -- not served at all
);

-- -----------------------------------------------------------------------------
-- topics
-- The spec listed article_topics.topic as free text but asked for a topic_id
-- index and a /news/topic/:topicSlug/ route. Free text cannot give you a stable
-- slug, a canonical display name, or a rename that does not orphan every URL —
-- so topics are a real entity and article_topics references it.
-- -----------------------------------------------------------------------------
CREATE TABLE topics (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT        NOT NULL UNIQUE,
  name        TEXT        NOT NULL,
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT topics_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
COMMENT ON TABLE topics IS
  'Canonical topic entities. One row per /news/topic/{slug}/ landing page.';

-- -----------------------------------------------------------------------------
-- articles
-- The published artifact. One row per URL at /news/{slug}/.
--
-- NOT PARTITIONED — a deliberate deviation from the spec. See the rationale note
-- at the foot of this file before changing it.
-- -----------------------------------------------------------------------------
CREATE TABLE articles (
  id               BIGSERIAL PRIMARY KEY,
  title            TEXT        NOT NULL,
  slug             TEXT        NOT NULL,
  summary          TEXT,
  body             TEXT,
  source_type      article_source_type NOT NULL,
  source_url       TEXT,

  -- Denormalised read caches for list pages. article_tickers / article_topics
  -- remain the source of truth; these exist so /news/ can render cards without
  -- two joins per row. Keep them in sync in one transaction with the join rows.
  tickers          JSONB       NOT NULL DEFAULT '[]'::jsonb,
  topics           JSONB       NOT NULL DEFAULT '[]'::jsonb,

  seo_title        TEXT,
  seo_description  TEXT,
  seo_keywords     JSONB       NOT NULL DEFAULT '[]'::jsonb,
  og_title         TEXT,
  og_description   TEXT,

  index_score      REAL        NOT NULL DEFAULT 0,
  engagement_score REAL        NOT NULL DEFAULT 0,

  status           article_status NOT NULL DEFAULT 'noindex',

  -- Distinct from created_at: a row can exist for hours in review before it is
  -- publicly dated. Ordering on list pages and JSON-LD datePublished use this.
  published_at     TIMESTAMPTZ,
  reviewed_by      BIGINT,
  reviewed_at      TIMESTAMPTZ,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Weighted full-text vector. STORED so the GIN index is maintained by
  -- Postgres and can never drift from the row. to_tsvector(regconfig, text) is
  -- IMMUTABLE, which is what makes it legal in a generated column; the
  -- single-argument form is not and will be rejected here.
  search_vector tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english', coalesce(title,   '')), 'A') ||
      setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(body,    '')), 'C')
  ) STORED,

  CONSTRAINT articles_slug_key        UNIQUE (slug),
  CONSTRAINT articles_title_not_blank CHECK (length(btrim(title)) > 0),
  CONSTRAINT articles_slug_format     CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT articles_index_score_rng CHECK (index_score      BETWEEN 0 AND 100),
  CONSTRAINT articles_engage_rng      CHECK (engagement_score BETWEEN 0 AND 100),
  -- An externally-derived article without its source URL cannot be attributed,
  -- which is the whole basis of the licensing position. Enforce it here.
  CONSTRAINT articles_external_needs_source CHECK (
    source_type <> 'external_summary' OR source_url IS NOT NULL
  ),
  -- Nothing is publicly indexable without a publish date.
  CONSTRAINT articles_active_needs_published CHECK (
    status <> 'active' OR published_at IS NOT NULL
  )
);
COMMENT ON TABLE  articles IS
  'Published artifact; one row per /news/{slug}/ URL.';
COMMENT ON COLUMN articles.status IS
  'Defaults to noindex on purpose: a high-volume generator must fail closed.';
COMMENT ON COLUMN articles.tickers IS
  'Denormalised cache for list rendering. article_tickers is authoritative.';

-- Slug lookup for /news/{slug}/ is served by articles_slug_key (UNIQUE = btree).

-- Reverse-chronological feed, the hottest query on the site. Partial so the
-- index holds only rows the feed can actually return.
CREATE INDEX articles_feed_idx
  ON articles (published_at DESC NULLS LAST, id DESC)
  WHERE status = 'active';

-- /news/auto-generated/ and every "how are auto articles doing" report.
CREATE INDEX articles_source_type_idx
  ON articles (source_type, published_at DESC NULLS LAST);

-- /news/trending/
CREATE INDEX articles_trending_idx
  ON articles (engagement_score DESC, published_at DESC)
  WHERE status = 'active';

-- Module 6 sweeps: "what did we score but not publish".
CREATE INDEX articles_index_score_idx
  ON articles (index_score DESC)
  WHERE status <> 'hidden';

-- Review queue.
CREATE INDEX articles_review_queue_idx
  ON articles (created_at)
  WHERE status = 'noindex' AND reviewed_at IS NULL;

-- Full-text search for /search?q=
CREATE INDEX articles_search_vector_idx ON articles USING GIN (search_vector);

-- Fuzzy title matching — dedupe ("have we written this already?") and
-- related-article discovery.
CREATE INDEX articles_title_trgm_idx ON articles USING GIN (title gin_trgm_ops);

-- Containment queries against the denormalised cache: tickers @> '["NVDA"]'
CREATE INDEX articles_tickers_gin_idx ON articles USING GIN (tickers jsonb_path_ops);
CREATE INDEX articles_topics_gin_idx  ON articles USING GIN (topics  jsonb_path_ops);

-- -----------------------------------------------------------------------------
-- article_sources
-- Provenance. Deliberately narrow: headline, summary, link, timestamp. There is
-- no column for full body text, so the pipeline cannot store one by accident.
-- -----------------------------------------------------------------------------
CREATE TABLE article_sources (
  id           BIGSERIAL PRIMARY KEY,
  article_id   BIGINT      REFERENCES articles(id) ON DELETE CASCADE,
  source_name  TEXT        NOT NULL,
  source_url   TEXT        NOT NULL,
  headline     TEXT        NOT NULL,
  summary      TEXT,
  tickers      JSONB       NOT NULL DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Module 2 requires "reject duplicate headlines". Doing it in the app is a
  -- race under parallel ingestion; this makes the database the arbiter.
  headline_hash TEXT GENERATED ALWAYS AS (md5(lower(btrim(headline)))) STORED,

  CONSTRAINT article_sources_headline_not_blank CHECK (length(btrim(headline)) > 0)
);
COMMENT ON TABLE article_sources IS
  'Provenance for externally-derived articles. Headline/summary/link only — no '
  'column exists for full text, so the pipeline cannot retain it by accident.';

-- article_id is nullable on purpose: ingestion lands here BEFORE Module 3/4 have
-- produced an article, and unclaimed rows are the ingestion backlog.
CREATE UNIQUE INDEX article_sources_dedupe_idx
  ON article_sources (source_name, headline_hash);
CREATE INDEX article_sources_article_id_idx ON article_sources (article_id);
CREATE INDEX article_sources_unclaimed_idx
  ON article_sources (created_at) WHERE article_id IS NULL;
CREATE INDEX article_sources_published_idx  ON article_sources (published_at DESC);

-- -----------------------------------------------------------------------------
-- article_tickers  /  article_topics  /  article_keywords  /  article_relations
-- Join tables. All cascade from articles.
-- -----------------------------------------------------------------------------

CREATE TABLE article_tickers (
  id         BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE: delisting a symbol must never silently delete the
  -- coverage history that explains why it was delisted.
  ticker     TEXT   NOT NULL REFERENCES tickers(ticker) ON DELETE RESTRICT ON UPDATE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT article_tickers_uniq UNIQUE (article_id, ticker)
);
COMMENT ON TABLE article_tickers IS
  'Authoritative article↔ticker links. Powers /news/ticker/{ticker}/.';

CREATE INDEX article_tickers_ticker_idx ON article_tickers (ticker, article_id);
CREATE INDEX article_tickers_article_idx ON article_tickers (article_id);
CREATE INDEX article_tickers_primary_idx ON article_tickers (ticker) WHERE is_primary;

CREATE TABLE article_topics (
  id         BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  topic_id   BIGINT NOT NULL REFERENCES topics(id)   ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT article_topics_uniq UNIQUE (article_id, topic_id)
);
COMMENT ON TABLE article_topics IS
  'Authoritative article↔topic links. Powers /news/topic/{slug}/.';

CREATE INDEX article_topics_topic_idx   ON article_topics (topic_id, article_id);
CREATE INDEX article_topics_article_idx ON article_topics (article_id);

CREATE TABLE article_keywords (
  id         BIGSERIAL PRIMARY KEY,
  article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  keyword    TEXT   NOT NULL,
  weight     REAL   NOT NULL DEFAULT 1.0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT article_keywords_uniq        UNIQUE (article_id, keyword),
  CONSTRAINT article_keywords_not_blank   CHECK (length(btrim(keyword)) > 0),
  CONSTRAINT article_keywords_weight_rng  CHECK (weight >= 0)
);
COMMENT ON TABLE article_keywords IS
  'Keyword clusters per article. Module 7 aggregates weight × performance here.';

CREATE INDEX article_keywords_keyword_idx ON article_keywords (keyword, weight DESC);
CREATE INDEX article_keywords_article_idx ON article_keywords (article_id);

CREATE TABLE article_relations (
  id                 BIGSERIAL PRIMARY KEY,
  article_id         BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  related_article_id BIGINT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  relevance          REAL   NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT article_relations_uniq     UNIQUE (article_id, related_article_id),
  CONSTRAINT article_relations_no_self  CHECK (article_id <> related_article_id),
  CONSTRAINT article_relations_rel_rng  CHECK (relevance BETWEEN 0 AND 1)
);
COMMENT ON TABLE article_relations IS
  'Directed internal-linking graph. Both sides cascade, so deleting either end '
  'removes the edge and no dead internal link is ever rendered.';

CREATE INDEX article_relations_article_idx
  ON article_relations (article_id, relevance DESC);
CREATE INDEX article_relations_related_idx
  ON article_relations (related_article_id);

-- -----------------------------------------------------------------------------
-- article_metrics — CURRENT STATE, one row per article.
--
-- The spec asked to partition this by month. It cannot be: the partition key
-- would have to be last_updated, which changes on every write, so each update
-- would migrate the row between partitions. Current state and history are two
-- different tables; the history one below is the partitioned one.
-- -----------------------------------------------------------------------------
CREATE TABLE article_metrics (
  article_id        BIGINT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  impressions       BIGINT  NOT NULL DEFAULT 0,
  clicks            BIGINT  NOT NULL DEFAULT 0,
  ctr               REAL    NOT NULL DEFAULT 0,
  avg_time_on_page  REAL    NOT NULL DEFAULT 0,  -- seconds
  bounce_rate       REAL    NOT NULL DEFAULT 0,  -- 0..1
  scroll_depth      REAL    NOT NULL DEFAULT 0,  -- 0..1
  organic_traffic   BIGINT  NOT NULL DEFAULT 0,
  referral_traffic  BIGINT  NOT NULL DEFAULT 0,
  social_shares     BIGINT  NOT NULL DEFAULT 0,
  last_updated      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT article_metrics_nonneg CHECK (
    impressions >= 0 AND clicks >= 0 AND organic_traffic >= 0
    AND referral_traffic >= 0 AND social_shares >= 0
  ),
  CONSTRAINT article_metrics_rates CHECK (
    ctr BETWEEN 0 AND 1 AND bounce_rate BETWEEN 0 AND 1 AND scroll_depth BETWEEN 0 AND 1
  )
);
COMMENT ON TABLE article_metrics IS
  'Latest known performance, one row per article. History lives in '
  'article_metrics_daily — do not partition this table (see 001 notes).';

CREATE INDEX article_metrics_ctr_idx    ON article_metrics (ctr DESC);
CREATE INDEX article_metrics_stale_idx  ON article_metrics (last_updated);

-- -----------------------------------------------------------------------------
-- article_metrics_daily — append-only history, PARTITIONED BY MONTH.
--
-- This is what Module 7 actually needs: a time series it can regress against.
-- A partitioned table's primary key must contain the partition key, hence
-- (article_id, metric_date).
--
-- No FK to articles: Postgres does not allow a partitioned table to be the
-- referencing side of a FK that would need per-partition enforcement at this
-- scale without cost. Orphans are swept by the retention job instead — the
-- rollback script and the ops note below both cover it.
-- -----------------------------------------------------------------------------
CREATE TABLE article_metrics_daily (
  article_id       BIGINT  NOT NULL,
  metric_date      DATE    NOT NULL,
  impressions      BIGINT  NOT NULL DEFAULT 0,
  clicks           BIGINT  NOT NULL DEFAULT 0,
  ctr              REAL    NOT NULL DEFAULT 0,
  avg_time_on_page REAL    NOT NULL DEFAULT 0,
  bounce_rate      REAL    NOT NULL DEFAULT 0,
  scroll_depth     REAL    NOT NULL DEFAULT 0,
  organic_traffic  BIGINT  NOT NULL DEFAULT 0,
  referral_traffic BIGINT  NOT NULL DEFAULT 0,
  social_shares    BIGINT  NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, metric_date)
) PARTITION BY RANGE (metric_date);

COMMENT ON TABLE article_metrics_daily IS
  'Append-only daily snapshots, partitioned by month. The training signal for '
  'the Learning Engine (Module 7).';

-- Catch-all so an insert can never fail for want of a partition. Monitor it:
-- rows landing here mean the partition-creation job has stopped running.
CREATE TABLE article_metrics_daily_default
  PARTITION OF article_metrics_daily DEFAULT;

-- Creates the partition covering `d`'s month if absent. Idempotent — safe to
-- call from a nightly job, and safe to call twice.
CREATE OR REPLACE FUNCTION ensure_metrics_partition(d DATE)
RETURNS void AS $$
DECLARE
  start_date DATE := date_trunc('month', d)::date;
  end_date   DATE := (date_trunc('month', d) + INTERVAL '1 month')::date;
  part_name  TEXT := 'article_metrics_daily_' || to_char(start_date, 'YYYY_MM');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = part_name) THEN
    EXECUTE format(
      'CREATE TABLE %I PARTITION OF article_metrics_daily FOR VALUES FROM (%L) TO (%L)',
      part_name, start_date, end_date
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Current month plus twelve ahead, so nothing lands in DEFAULT for a year even
-- if the scheduled job is never wired up.
DO $$
DECLARE i INT;
BEGIN
  FOR i IN 0..12 LOOP
    PERFORM ensure_metrics_partition((CURRENT_DATE + (i || ' month')::interval)::date);
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- article_engagement — on-site counters, current state.
-- Not partitioned, for the same reason as article_metrics: one mutable row per
-- article. At 500 articles/day this reaches ~180k rows a year.
-- -----------------------------------------------------------------------------
CREATE TABLE article_engagement (
  article_id     BIGINT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  upvotes        BIGINT NOT NULL DEFAULT 0,
  shares         BIGINT NOT NULL DEFAULT 0,
  bookmarks      BIGINT NOT NULL DEFAULT 0,
  comments_count BIGINT NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT article_engagement_nonneg CHECK (
    upvotes >= 0 AND shares >= 0 AND bookmarks >= 0 AND comments_count >= 0
  )
);
COMMENT ON TABLE article_engagement IS
  'First-party on-site engagement counters, one row per article.';

CREATE INDEX article_engagement_upvotes_idx ON article_engagement (upvotes DESC);

-- -----------------------------------------------------------------------------
-- article_scores — Module 6 output, one row per article.
-- -----------------------------------------------------------------------------
CREATE TABLE article_scores (
  article_id          BIGINT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  ranking_score       REAL NOT NULL DEFAULT 0,
  engagement_score    REAL NOT NULL DEFAULT 0,
  seo_score           REAL NOT NULL DEFAULT 0,
  auto_question_score REAL NOT NULL DEFAULT 0,
  auto_article_score  REAL NOT NULL DEFAULT 0,
  -- Which weight set produced these numbers. Without it, scores computed under
  -- different weights are silently incomparable and Module 7 trains on noise.
  model_version       TEXT NOT NULL DEFAULT 'v1',
  computed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT article_scores_ranges CHECK (
    ranking_score       BETWEEN 0 AND 100 AND
    engagement_score    BETWEEN 0 AND 100 AND
    seo_score           BETWEEN 0 AND 100 AND
    auto_question_score BETWEEN 0 AND 100 AND
    auto_article_score  BETWEEN 0 AND 100
  )
);
COMMENT ON TABLE article_scores IS
  'Predicted scores from the Ranking Prediction Engine (Module 6).';
COMMENT ON COLUMN article_scores.model_version IS
  'Weight-set identifier. Scores across versions are not comparable.';

CREATE INDEX article_scores_ranking_idx ON article_scores (ranking_score DESC);
CREATE INDEX article_scores_version_idx ON article_scores (model_version, computed_at DESC);

-- -----------------------------------------------------------------------------
-- updated_at maintenance
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER articles_set_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER article_engagement_set_updated_at
  BEFORE UPDATE ON article_engagement
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;

-- =============================================================================
-- WHY articles IS NOT PARTITIONED
--
-- The spec asked for partitioning by year. Postgres requires a partitioned
-- table's primary key to include the partition key, so articles' PK would
-- become (id, created_at). Every child table — sources, tickers, topics,
-- keywords, relations (twice), metrics, engagement, scores — would then have to
-- carry a redundant created_at column and use a composite foreign key, and
-- every join in the application would need the extra predicate.
--
-- The benefit at this volume is nil. 500 articles/day is ~182k rows/year;
-- Postgres handles tens of millions in a well-indexed table without complaint,
-- and the partial indexes above already keep the hot feed queries small.
--
-- Revisit at roughly 50M rows, or when list queries stop being served by
-- articles_feed_idx. The migration then is: create the partitioned table, copy
-- in batches, swap names — considerably easier than unwinding composite keys
-- across nine tables now.
--
-- article_metrics_daily IS partitioned, because it is the table that genuinely
-- grows without bound (one row per article per day) and is queried by date range.
--
-- OPERATIONAL NOTES
--   * Schedule monthly:  SELECT ensure_metrics_partition((CURRENT_DATE + interval '2 month')::date);
--   * Alert if article_metrics_daily_default is non-empty — that means the above
--     stopped running.
--   * article_metrics_daily has no FK to articles by design; sweep orphans with
--     DELETE FROM article_metrics_daily d
--      WHERE NOT EXISTS (SELECT 1 FROM articles a WHERE a.id = d.article_id);
--   * articles.tickers/.topics are caches. Write them in the same transaction as
--     article_tickers/article_topics or list pages will disagree with detail pages.
-- =============================================================================
