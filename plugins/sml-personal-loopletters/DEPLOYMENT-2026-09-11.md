# Deployment record — 2026-09-11

WordPress plugin installed and active; personal automation enabled. Existing Render worker deployed commits 2819024 and a3464ba. No new credentials or paid hosting services created.

## Live checks

- Fixed owner 258456581 resolves to Vaughn McNair / Making Easy Money / vaughn-mcnair.
- Existing service identity 258456587 authenticated successfully with its existing credentials.
- Anonymous, other-author and personal-owner requests to service-only endpoints denied.
- Existing Letters SEO endpoint registered; no separate SEO storage invented.
- Real database unique day/slot constraint tested inside a rolled-back transaction. No test article published.
- One real, authorized attempt consumed today's first slot and published letter **63**, author **258456581** at **2026-09-11 10:44:45 UTC**.
- Article: https://stockmarketloop.com/n/vaughn-mcnair/oracle-orcl-drops-5-4-on-2026-09-10-intraday-range-hits-152-52-159-24/
- Cover PNG returned 200.
- Public metadata initially exposed an existing duplicate generic Rank Math canonical/social image. Version 0.1.2 suppresses generic emitters only for this writer's published letters. Clean public URL verified one canonical after the 60-second cache expired. Cache-busted page also has one title, one OG image, one OG title and one Twitter card.
- Today's remaining automatic slot opens at 16:00 America/Chicago; no replacement 08:00 attempt after the run-now test consumed slot 1.

## Tests

12 new personal-writer tests pass. Combined personal/newsroom-draft/news-flow suite: **32/32 pass**. PHP lint clean. Live access/identity/database checks pass.

Full existing platform suite: **592/593 pass**. Unchanged Discord interactions test at platform/discord-interactions.test.js:252 expects the older "map Upgrade.Chat products" copy. This task did not modify Discord implementation or test files. Existing worker logs also show unrelated Discord 401 and dispute usage-consumer text/UUID errors; neither was changed as part of the personal writer.

## Honest scope

This is a working **market-commentary pilot**, not the whole source-intelligence specification. See README for unimplemented Trends, SEC/company IR, earnings/options, internal-link selection and timing-backtest adapters. Market timestamps are retained; returned historical closes may be older and use a different adjustment basis, explicitly labelled. Model verification passed for letter 63 but does not guarantee factual perfection.

Control panel: https://stockmarketloop.com/wp-admin/tools.php?page=sml-personal-letters

Rollback/pause: set option sml_pl26_enabled to 0, or deactivate sml-personal-loopletters. Neither changes any sitewide author schedule. Generated letters remain intact.
