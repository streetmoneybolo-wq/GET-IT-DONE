-- Roll back 028 (node db/migrate.js down 028 --yes). Destructive: bindings and
-- lifetime rows can be rebuilt from Stripe metadata with
-- `node scripts/academy-billing.js rebuild-from-stripe --apply --actor <label>`;
-- comps, consent intents and the audit trail can NOT (restore from backup).

BEGIN;

DROP TABLE IF EXISTS academy_billing_trials;
DROP TABLE IF EXISTS academy_billing_external_grants;
DROP TABLE IF EXISTS academy_billing_handoffs;
DROP TABLE IF EXISTS academy_billing_reconcile_runs;
DROP TRIGGER IF EXISTS academy_billing_audit_no_truncate ON academy_billing_audit;
DROP TRIGGER IF EXISTS academy_billing_audit_no_update ON academy_billing_audit;
DROP TABLE IF EXISTS academy_billing_audit;
DROP FUNCTION IF EXISTS academy_billing_audit_immutable();
DROP TABLE IF EXISTS academy_billing_role_state;
DROP TABLE IF EXISTS academy_billing_events;
DROP TABLE IF EXISTS academy_billing_comps;
DROP FUNCTION IF EXISTS academy_billing_ids_distinct(TEXT[]);
DROP TABLE IF EXISTS academy_billing_lifetime;
DROP TABLE IF EXISTS academy_billing_checkout_intents;
DROP TABLE IF EXISTS academy_billing_members;

COMMIT;
