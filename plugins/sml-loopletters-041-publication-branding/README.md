# SML Loop Letters 0.3.0

Publication settings, subscriber lifecycle, and public publication pages for
StockMarketLoop.

## Ownership

- SML Video Upload Studio owns letter records in its `sml_letters_table()`
  custom tables and exposes them through `sml-letters/v1`.
- SML Loop Letters owns publication settings, handle routing, subscriber
  records, and public `/n/{handle}` pages through `sml-loopletters/v1`.
- This plugin does not register a second letter post type or taxonomy.

## Public surfaces

- `/n/` lists publications.
- `/n/{handle}/` renders a server-side publication home.
- `/n/{handle}/{letter}/` renders one Studio letter.
- `/n/{handle}/?topic={topic}` filters that creator's issues.
- `/n/{handle}/?feed=rss` returns that creator's RSS feed.

The unfiltered home uses the newest issue as its hero and starts list
pagination at offset 1. A filtered view has no hero and starts at offset 0.

## Companion REST namespace

The namespace is `sml-loopletters/v1`. Do not change it to
`sml-letters/v1`; that namespace belongs to SML Video Upload Studio.

Core routes:

- `GET|POST /settings`
- `GET /handle-available`
- `POST /subscribe`
- `GET /subscribers`
- `GET /subscribers/export`
- `GET /issues`

## Subscriber rules

Subscriptions use double opt-in. Unsubscribed rows are retained as suppression
records. Sending code must use `SML_LoopLetters_Subscriptions_V031::mailable()`
and attach `SML_LoopLetters_Subscriptions_V031::mail_headers()`.

## Routing and safety

- No global helper functions are declared.
- No rewrite rule is added or flushed.
- Dynamic publication paths are resolved by the request filter.
- Public letter HTML is server-rendered for indexing and no-JavaScript access.

## Open work

- Delivery remains a separate system; do not loop over `wp_mail()` here.
- Publication visibility is stored but still requires enforcement in the
  reader and distribution layers.
- Featured issue IDs are read from `smll_featured_letter_ids`; the Studio
  editor needs an owner-facing control wired to that field before creators can
  manage it in the UI.
