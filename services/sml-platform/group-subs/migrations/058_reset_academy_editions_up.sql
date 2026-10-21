BEGIN;
-- Editions (Trader / Analyst) were a free, self-selected choice until the Analyst SKU existed, so
-- anyone could put themselves on Analyst at no cost. From 2026-10-21 the Analyst level is what the
-- Analyst subscription buys, and the publishing routes check the live tier. Start everyone on
-- Trader so the stored choice cannot imply access nobody paid for.
--
-- academy-editions.js reads a member with no row as 'trader', so emptying the map is the reset.
-- The old map is copied aside first, under its own key, so the choices are recoverable.
-- ON CONFLICT DO NOTHING keeps a re-run from overwriting that copy with the already-reset value.

INSERT INTO academy_state_kv (key, value, updated_at)
SELECT 'academy-editions-before-reset-2026-10-21', value, now()
  FROM academy_state_kv
 WHERE key = 'academy-editions'
ON CONFLICT (key) DO NOTHING;

UPDATE academy_state_kv
   SET value = '{"users":{}}'::jsonb, updated_at = now()
 WHERE key = 'academy-editions';

COMMIT;
