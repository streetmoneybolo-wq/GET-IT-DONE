# SML Newsroom Review Queue 0.2.0

WordPress review/draft component is installed on stockmarketloop.com. The separate
Node AI command is local/tested only; it is NOT connected to the live worker.
This is not the completed automated newsroom.

## Available now

- Tools → SML Newsroom Review (`/wp-admin/tools.php?page=sml-newsroom-review`).
- Admin-only evidence intake POST `/wp-json/sml-newsroom-review/v1/events`.
- Authenticated review list GET at the same endpoint.
- POST `/events/{id}/draft` accepts exactly `{payload_hash, article}`. It never
  accepts caller-supplied status, author, media, or publication parameters.
- Routing uses the existing `sml_nag_author_ids` Author Guard registry, not the
  older `sml_newsroom_author_ids` map. All 18 desks resolved live on 2026-09-11.
- Source authority + event ID uniquely identifies evidence. Same event/changed
  evidence returns 409; different events for a ticker are not suppressed.
- Freshness and current evidence hash checked before draft creation. Draft retries
  return the existing post; they never overwrite a published, trashed or edited post.
- Database named lock serializes draft insertion. Real concurrency stress test is
  still pending; sequential retry was verified against WordPress.
- SEO fields and source attribution saved. No remote image is copied; media rights
  and factual accuracy remain editorial checks. Do not claim drafts are fact-checked.
- No schedules, model calls, automatic publication, author creation or deletion.

Default permissions are administrators only. A service principal can be explicitly
authorized for list/draft operations with `sml_newsroom_review_service_user_id`;
it must already have `edit_posts`. That option has NOT been configured by this work.
No roles were elevated. Publishing via the normal editor remains subject to normal
WordPress capabilities and existing author-guard behavior. Publication integration,
including preserving desk assignments after later edits/repairs, is unfinished.

## Node command (not deployed)

Source: `services/sml-platform/platform/newsroom-draft.js` on the local review
worktree based on deployed commit 7d682056. Existing production worker/publisher
files are unchanged. No new provider key was created or copied.

From services/sml-platform, in a correctly configured environment:

```
npm run newsroom:draft -- --event-id ID
```

It loads one previously reviewed evidence event, requires a resolved desk, makes
at most one bounded OpenAI request (3,000 output tokens), and calls only the draft
endpoint. No automatic retry, polling or public publishing. Existing draft skips
AI generation. Concurrent independent CLI invocations could still duplicate AI
cost before the database serializes saving; do not run overlapping generators.
Uses existing OpenAI/WordPress credentials; never print them.

Do not run this against the integration fixtures: those are not market evidence.
No real AI generation or application-password end-to-end call has been tested yet.

## Verification

- PHP syntax clean; 14 event tests, 9 desk tests.
- 12 new Node tests pass; 12 existing generator/publisher/pipeline tests passed
  earlier in this change (24 combined after the new cashtag test).
- 15 live WordPress dispatcher assertions: anonymous denial, queue idempotency,
  evidence conflict, desk resolution, publish-override rejection, hash conflict,
  actual draft save/author, sanitized HTML, SEO and retry idempotency.
- Two unpublished test drafts 8285 and 8287 were moved recoverably to Trash.
  Test events 1 and 4 remain for audit and expire after ten minutes.
- Real unauthenticated HTTP GET returns 401. Admin page inspected in signed-in browser.
- All 18 current desk accounts resolved; no author accounts modified.
- Whole platform suite: 592/593 pass. Existing unchanged Discord Connect test
  `discord-interactions.test.js:252` expects "map Upgrade.Chat products" while
  current handler says "Click Migrate". No changes to those files; production
  deployment was not triggered.

Tests in this directory: run `php tests/events.php`, `php tests/desks.php`.
`live-integration.php` is NOT a read-only test: it creates one explicitly labeled
draft fixture and trashes that exact new draft. Run only with explicit diagnostic
authority, never on public articles.

## Remaining

Real AI draft smoke test, durable generation claims/budgets, source ingestion,
Google Trends access, event/market freshness verification, chart evidence, internal
link selection, licensed images, editorial approval and publication lifecycle,
timing backtests/continuous pacing, permissions and concurrency load tests.

Kill switch: deactivate only `sml-newsroom-queue`. The table and drafts remain.
There is no uninstall routine. The earlier coordinator 1.1.1 safety fix is separate
and should stay active; it replaces permanent deletion with review flags.
