# SML Platform Billing Bridge

Install as a normal WordPress plugin. Configure secrets in `wp-config.php`; do
not paste them into WPCode or commit them:

```php
define( 'SML_PLATFORM_API_URL', 'https://YOUR-RENDER-SERVICE.onrender.com' );
define( 'SML_PLATFORM_BILLING_API_SECRET', 'same incoming API secret as Render' );
define( 'SML_PLATFORM_BILLING_BRIDGE_SECRET', 'same outbox secret as Render' );
```

Render variables:

- `STRIPE_SECRET_KEY`
- `SML_STRIPE_WEBHOOK_SECRET`
- `SML_BILLING_API_SECRET`
- `SML_WORDPRESS_BILLING_BRIDGE_URL=https://stockmarketloop.com/wp-json/sml-platform/v1/billing-outbox`
- `SML_WORDPRESS_BILLING_BRIDGE_SECRET`

Stripe Billing must use a custom retry policy with two retries after the initial
attempt: retry two at +24 hours and retry three by +72 hours. The worker revokes
only after both the third failed attempt and the 72-hour deadline.

The site-specific group engine must attach a listener to
`sml_platform_subscription_access_reconcile`. The bridge deliberately fails and
retries instead of pretending access changed when no adapter is installed.
