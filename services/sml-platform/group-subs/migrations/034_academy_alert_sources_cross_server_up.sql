-- Lets a member follow a channel in a server they are not currently a member of, as long as an
-- Academy bot can read it there. A cross-server row is marked so the desk can label it, and so
-- viewFor() re-checks it against the bot's own read access instead of the member's own Discord
-- membership, which is the whole point: the member never has to be in that server.

BEGIN;

ALTER TABLE academy_alert_sources ADD COLUMN IF NOT EXISTS cross_server BOOLEAN NOT NULL DEFAULT false;

COMMIT;
