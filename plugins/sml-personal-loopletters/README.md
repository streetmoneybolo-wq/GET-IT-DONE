# Personal Loop Letters 0.1.2

Isolated pilot for owner **258456581 / vaughn-mcnair / Making Easy Money**.
Service identity is pinned to **258456587**, using its existing Render-to-WordPress credential. It cannot choose a different author through these endpoints.

## Included

- Independent ledger, two attempt slots per America/Chicago calendar day.
- One attempt in 08:00–15:59; one in 16:00–23:59. No catch-up and no AI retries.
- Five-minute worker polling, gated by WordPress pause control.
- Owner-only "Use next daily slot now" consumes an existing daily slot; it never adds attempts. Requests expire at local midnight.
- Existing authenticated market bridge: provider-ranked candidates, snapshot and historical closes.
- Snapshot dates separate from fetch dates. Unknown values stay unknown.
- Fresh evidence, input bounds, original structured writing, distinct evidence-verifier call.
- Existing Letters create/save/publish and SEO APIs, owner checks and readback checks.
- On this writer's published letters only, suppress Rank Math's competing generic `/n/` canonical/social metadata. The existing Letters SEO renderer remains the sole owner. Uses documented Rank Math filters: https://rankmath.com/docs/filters-and-hooks/frontend/open-graph/ and https://rankmath.com/docs/filters-and-hooks/frontend/meta-data/.
- Branded PNG featuring actual observed closes, publication metadata and AI-assistance disclosure.
- Draft ID persisted before publish; uncertain publish results never automatically retried.
- Tools → Personal Loop Letters; administrator toolbar → Personal Letters AI.

## Not yet included (do not claim connected)

Google/Bing Trends, SEC full-text and company IR enrichment, validated earnings/options/technical-pattern adapters, relevant internal-article selection, and analytics/backtesting-based timing. This pilot generates evidence-bound market commentary only. The provider heat ranking is NOT Google search popularity. AI verification reduces risk but cannot guarantee accuracy, SEO placement or AdSense acceptance.

## Costs and kill switch

Reuses the existing Render OPENAI_API_KEY and SML_NEWS_OPENAI_MODEL. Each attempt is at most one 4,000-output-token writer call and one 1,500-output-token verifier call, with evidence capped at 25 KB. At most two attempts/day, including failures. Input and output tokens incur normal provider billing; there is no claim of a dollar-level billing cap.

Pause in the private control panel or `wp option update sml_pl26_enabled 0`. Plugin deactivation removes only these endpoints. It does not alter any other author's configuration, delete letters, or stop the existing newsroom worker. Restore only the personal worker import/start code to remove Node polling.

## Verification

`node --test platform/personal-letters.test.js` from services/sml-platform.
`php -l plugins/sml-personal-loopletters/sml-personal-loopletters.php` from repo root.
Install paused; confirm identity, SEO endpoint, unauthorized access denial and database unique constraints before enabling.
