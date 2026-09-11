# Spotlight handoff repair — 2026-09-11

Production worker `a3464ba` had no Spotlight intake module or call. Its source loader rejected the Spotlight JSON contract and its publisher supported only SML NEWS. Existing WordPress credentials successfully read pending events and the editorial author map; no credentials were changed.

This repair polls pending events before each existing single-job news cycle, durably enqueues by unique source URL hash before acknowledgment, accepts only the exact first-party Spotlight source path/schema/identity, and uses the existing permission-checked newsroom publish route for the Spotlight desk. Billing, generic alert routing, and personal Loop Letters limits are unchanged.

The WordPress source endpoint was separately extended to expose only allowlisted public `reporting_context` fields from the existing event payload. Live file: `wp-content/plugins/sml-retail-trader-spotlight/sml-retail-trader-spotlight.php`. Pre-change backup and patched copy reside outside the web root under `/home/150846796/newsroom-safety-p1kCpiyp/spotlight-source-before.php` and `spotlight-source-after.php`.

Recovered TNON event: `b6b922ed-0e5c-4f26-af5e-cb6d3eac15a4`. Do not replay it as a new event. Original entry reference: $2.40 on September 9. Site owner reports $10.82 on September 11, mathematically +350.83%; the supplied high is explicitly labeled not independently verified. This is not an executed-trade return. The generator receives that attribution and must preserve it.

Verification: 40 focused tests passed across intake, source parsing, publisher, pipeline, generator, news flow and personal letters. Full existing suite: 595/596 passed; unrelated unchanged `discord-interactions.test.js:260` expects old Upgrade.Chat text (`map Upgrade.Chat products`) while the current handler returns `Click Migrate ...`. No payment/migration behavior changed to resolve this test.

Run focused tests: `node --test platform/spotlight-intake.test.js platform/source-article.test.js platform/wordpress-publisher.test.js platform/news-pipeline.test.js platform/article-generator.test.js platform/news-flow.test.js platform/personal-letters.test.js`.

Deployment acceptance: worker revision includes this repair; log `spotlight_intake_enqueued` links the event to a durable job; WordPress event becomes handed_off; a `news_article_published` log and actual post ID/URL are required before saying the article is published. Roll back only this commit if needed; retain event and job history to prevent duplicates.
