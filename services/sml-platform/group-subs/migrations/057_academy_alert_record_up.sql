-- The alert record (platform/academy-alert-record.js): every Click-to-Alert post and every alert in the owner's desk
-- channels, kept once by Discord message id and scored against the bars since it was sent (peak, win / stopped /
-- missed, where price is now). The 90-day win rate and the top ten peaks are public on the member's Academy profile.
-- The platform also creates this on start (CREATE IF NOT EXISTS), so this migration is idempotent.
BEGIN;

CREATE TABLE IF NOT EXISTS academy_alert_record (
  id         BIGSERIAL PRIMARY KEY,
  discord_id TEXT NOT NULL,
  source     TEXT NOT NULL,
  ref        TEXT NOT NULL,
  symbol     TEXT NOT NULL,
  side       TEXT NOT NULL,
  entry      NUMERIC(18,6) NOT NULL,
  target     NUMERIC(18,6),
  stop       NUMERIC(18,6),
  horizon    TEXT NOT NULL DEFAULT 'swing',
  alerted_at TIMESTAMPTZ NOT NULL,
  status     TEXT NOT NULL DEFAULT 'open',
  result     TEXT,
  peak_pct   NUMERIC(10,4),
  peak_at    TIMESTAMPTZ,
  last_price NUMERIC(18,6),
  last_pct   NUMERIC(10,4),
  last_at    TIMESTAMPTZ,
  closed_at  TIMESTAMPTZ,
  close_pct  NUMERIC(10,4),
  checked_at TIMESTAMPTZ,
  UNIQUE (source, ref)
);
CREATE INDEX IF NOT EXISTS academy_alert_record_user_idx ON academy_alert_record (discord_id, alerted_at DESC);
CREATE INDEX IF NOT EXISTS academy_alert_record_open_idx ON academy_alert_record (status, checked_at) WHERE status = 'open';

COMMIT;
