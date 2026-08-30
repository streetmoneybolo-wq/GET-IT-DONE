# SML Platform Billing Bridge

Install as a normal WordPress plugin. Configure secrets in `wp-config.php`; do
not paste them into WPCode or commit them:

```php
define( 'SML_PLATFORM_API_URL', 'https://YOUR-RENDER-SERVICE.onrender.com' );
define( 'SML_PLATFORM_BILLING_API_SECRET', 'same incoming API secret as Render' );
define( 'SML_PLATFORM_BILLING_BRIDGE_SECRET', 'same outbox secret as Render' );
// WordPress group 7 uses native Postgres plan 12 (example IDs only).
define( 'SML_PLATFORM_GROUP_PLAN_MAP', '{"7":12}' );
```

Render variables:

- `STRIPE_SECRET_KEY`
- `SML_STRIPE_WEBHOOK_SECRET`
- `SML_BILLING_API_SECRET`
- `SML_WORDPRESS_BILLING_BRIDGE_URL=https://stockmarketloop.com/wp-json/sml-platform/v1/billing-outbox`
- `SML_WORDPRESS_BILLING_BRIDGE_SECRET`
- `UPGRADE_CHAT_CLIENT_ID`
- `UPGRADE_CHAT_CLIENT_SECRET`
- `UPGRADE_CHAT_PLAN_MAP_JSON={"7:12":"123e4567-e89b-12d3-a456-426614174000"}`
- `DISCORD_BOT_TOKEN` (worker only; keep it secret)

Stripe Billing must use a custom retry policy with two retries after the initial
attempt: retry two at +24 hours and retry three by +72 hours. The worker revokes
only after both the third failed attempt and the 72-hour deadline.

The bridge applies native website membership access itself and restores any
pre-existing manual role when billing access ends. The existing Discord
connector remains the identity/server authority; it is not replaced.

The Upgrade.Chat adapter verifies the connected Discord ID, product, last
successful charge and renewal date through Upgrade.Chat's server API. Because
Upgrade.Chat's public API has no cancellation endpoint, the old renewal must be
canceled first. The member keeps already-paid access; Stripe collects a payment
method now and schedules the first SML charge for that verified paid-through
date. A browser-entered date is never accepted.
