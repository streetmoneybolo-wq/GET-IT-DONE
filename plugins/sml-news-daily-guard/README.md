# SML News Daily Guard

Prevents automated Markets news from creating more than one WordPress post for the same canonical source URL or ticker/topic on the same New York calendar day.

- SML News articles created by the Make WordPress connection are promoted from `draft`/`pending` to `publish` before ingestion.
- Those articles are always assigned to WordPress user `258456587` (`/stockmarketloop/`, display name `SML News`), even while Make authenticates through its existing service/editor connection.
- Exact canonical source URLs are the primary identity, with tracking parameters removed.

- New REST duplicates return HTTP 200 with the existing post ID and `sml_duplicate: true`.
- Exact concurrent requests are serialized by a database unique key.
- Similar-title comparison catches paraphrased repeats.
- Non-REST duplicate inserts are moved to draft as a fallback.
- WPCode snippet 4884 remains a secondary broad title guard.

The plugin deliberately does not merge or overwrite article content. Make should stop downstream creation when `sml_duplicate` is true and may route material updates into a separately reviewed update workflow.

