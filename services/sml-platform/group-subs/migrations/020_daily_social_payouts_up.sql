BEGIN;

CREATE TABLE IF NOT EXISTS dsp_tasks (
  id BIGSERIAL PRIMARY KEY,
  task_key CHAR(64) NOT NULL UNIQUE,
  task_date DATE NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('reddit','stocktwits','x')),
  task_type TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  article_url TEXT NOT NULL,
  article_title TEXT NOT NULL,
  article_summary TEXT NOT NULL,
  tickers JSONB NOT NULL DEFAULT '[]'::jsonb,
  draft TEXT NOT NULL,
  reward_cents INTEGER NOT NULL CHECK (reward_cents BETWEEN 25 AND 10000),
  created_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dsp_claims (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES dsp_tasks(id) ON DELETE RESTRICT,
  discord_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('claimed','submitted','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, discord_user_id)
);

CREATE TABLE IF NOT EXISTS dsp_submissions (
  id BIGSERIAL PRIMARY KEY,
  claim_id BIGINT NOT NULL UNIQUE REFERENCES dsp_claims(id) ON DELETE RESTRICT,
  discord_user_id TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('reddit','stocktwits','x')),
  account_url TEXT NOT NULL,
  proof_url TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('submitted','approved','rejected')),
  reviewed_by TEXT,
  review_reason TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dsp_earnings_ledger (
  id BIGSERIAL PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  submission_id BIGINT UNIQUE REFERENCES dsp_submissions(id) ON DELETE RESTRICT,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  kind TEXT NOT NULL CHECK (kind IN ('task','referral','adjustment')),
  status TEXT NOT NULL CHECK (status IN ('available','held','paid','void')),
  reference TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dsp_payout_requests (
  id BIGSERIAL PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  destination_reference TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('requested','approved','rejected','sent','failed')),
  reviewed_by TEXT,
  provider_payout_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS dsp_tasks_daily_open_idx ON dsp_tasks (task_date, status, platform);
CREATE INDEX IF NOT EXISTS dsp_submissions_review_idx ON dsp_submissions (status, created_at);
CREATE INDEX IF NOT EXISTS dsp_earnings_user_idx ON dsp_earnings_ledger (discord_user_id, status, created_at);

COMMIT;

