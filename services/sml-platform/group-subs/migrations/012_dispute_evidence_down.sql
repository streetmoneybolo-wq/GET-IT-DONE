-- Rollback destroys the dispute & evidence ledgers: identity graph, billing
-- registries, consent/usage/notification records, dispute cases, evidence
-- items, packets, submissions, and the hash-chained audit log. Do not use it
-- after dispute collection begins unless there is a confirmed recovery plan —
-- destroyed chains cannot be re-derived and past disputes lose their evidence.

BEGIN;

ALTER TABLE wordpress_gateway_events
  DROP CONSTRAINT wordpress_gateway_event_type_known;
ALTER TABLE wordpress_gateway_events
  ADD CONSTRAINT wordpress_gateway_event_type_known CHECK (event_type IN (
    'system.integration.ping',
    'creator.channel.updated',
    'creator.letter.published',
    'group.member.changed',
    'news.article.published'
  ));

DROP TABLE IF EXISTS dispute_access_policies;
DROP TABLE IF EXISTS dispute_review_tokens;
DROP TABLE IF EXISTS upgrade_chat_records;
DROP TABLE IF EXISTS paypal_events;
DROP TABLE IF EXISTS dispute_audit_log;
DROP TABLE IF EXISTS dispute_submissions;
DROP TABLE IF EXISTS dispute_packets;
DROP TABLE IF EXISTS dispute_evidence_items;
DROP TABLE IF EXISTS dispute_cases;
DROP TABLE IF EXISTS refund_events;
DROP TABLE IF EXISTS cancellation_requests;
DROP TABLE IF EXISTS notification_delivery_events;
DROP TABLE IF EXISTS service_usage_events;
DROP TABLE IF EXISTS entitlement_events;
DROP TABLE IF EXISTS customer_consents;
DROP TABLE IF EXISTS terms_versions;
DROP TABLE IF EXISTS billing_events;
DROP TABLE IF EXISTS billing_transactions;
DROP TABLE IF EXISTS billing_subscriptions;
DROP TABLE IF EXISTS billing_identity_refs;
DROP TABLE IF EXISTS billing_identities;

COMMIT;
