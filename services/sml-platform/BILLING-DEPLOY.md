# SML marketplace billing deployment

## What is implemented

- Stripe Connect Express seller onboarding.
- Native group subscription Checkout with a fixed 6% application fee.
- Loop Bucks Checkout using database-owned package prices, Stripe Tax, and a
  separate 2% StockMarketLoop service-fee line.
- Signed, idempotent webhook fulfillment. Browser-supplied LB or dollar amounts
  are never trusted.
- Three-attempt/72-hour grace enforcement. The worker requires both conditions
  before revoking access.
- Provider-verified subscription migration: Discord identifies the member, the
  provider supplies the renewal timestamp, Stripe collects a payment method
  immediately, and the first 6%-fee charge waits until that existing renewal
  date. The imported membership remains active until the first SML payment.
- Website/Discord access reconciliation through the existing role system.
- Seller dispute accounting. Principal is recovered when a dispute opens. The
  separate 12.5% seller fee is finalized only when the dispute is lost. A won
  dispute restores principal and never charges that fee.
- Failed seller debits become retry-safe seller debt; later Stripe balance
  availability lets the same idempotent account debit recover it.

## Required Render environment

Set these as secret environment variables; never commit their values:

- `STRIPE_SECRET_KEY`
- `SML_STRIPE_WEBHOOK_SECRET`
- `SML_BILLING_API_SECRET`
- `SML_WORDPRESS_BILLING_BRIDGE_URL`
- `SML_WORDPRESS_BILLING_BRIDGE_SECRET`
- `UPGRADE_CHAT_CLIENT_ID`
- `UPGRADE_CHAT_CLIENT_SECRET`
- `UPGRADE_CHAT_PLAN_MAP_JSON` (for example `{"7:12":"123e4567-e89b-12d3-a456-426614174000"}`)
- `DISCORD_BOT_TOKEN` on the worker, for rate-limited role grants/revokes

The API and worker must share `STRIPE_SECRET_KEY`. The API gets
`SML_BILLING_API_SECRET`; the worker gets the two bridge variables.

## Stripe setup

1. Enable Connect and use Express connected accounts.
2. Register `POST /v1/stripe/webhook` for platform and connected-account events:
   `account.updated`, `customer.subscription.*`, `invoice.paid`,
   `invoice.payment_succeeded`, `invoice.payment_failed`,
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   and `charge.dispute.*`.
3. In Billing retry rules, configure two retries after the initial attempt:
   retry at +24 hours and the final retry by +72 hours. This is three total
   attempts. The service does not fake extra charge attempts.
4. Enable only Stripe-approved payment methods. Checkout uses dynamic payment
   methods, so eligible PayPal, Klarna, Affirm, Afterpay, cards, and wallets can
   appear without separate code. Buy-now-pay-later methods and PayPal are not
   forced onto recurring subscriptions or Loop Bucks when Stripe marks them
   ineligible.
5. Configure the correct Stripe Tax product tax code for stored-value virtual
   credits after tax review. Set `loop_buck_packages.stripe_tax_code`; do not
   guess. Automatic Tax is already enabled and tax is recorded once.

## WordPress

Install `plugins/sml-platform-billing-bridge`. Add its three constants to
`wp-config.php` as documented in the plugin README. The bridge intentionally
is not a WPCode snippet.

Connect the existing native group-role engine to the
`sml_platform_subscription_access_reconcile` action. Discord role operations
continue through the existing `plan_role_grants` reconciler and rate-limited
Discord client; the bot needs Manage Roles and its role above every managed
membership role.

Also set `SML_PLATFORM_GROUP_PLAN_MAP` in WordPress (for example `{"7":12}`).
The group and plan identifiers must match the Render product map.

Upgrade.Chat migration is now concrete: the platform fetches the order by the
linked Discord ID, checks the mapped product and last successful charge, and
derives the paid-through date. Upgrade.Chat's documented public API is read-only
for orders, so the member must cancel the old renewal before migration. Access
continues until that verified date and Stripe's first 6%-fee charge is scheduled
for the same date. Dates under 48 hours away, stale orders, mismatched accounts,
and uncanceled renewals all fail closed.

## Release order

1. Back up Postgres.
2. Deploy the API; Render applies pending migrations through 009 in its pre-deploy transaction.
3. Install/activate the WordPress bridge and configure matching secrets.
4. Set the worker variables and deploy the worker.
5. Use Stripe test mode for one Loop Bucks purchase, one membership recovery,
   one failed-payment sequence, one lost dispute, and one won dispute.
6. Confirm all related outbox rows are `processed` before enabling live mode.

## Deliberate launch gates

- Account Debits require eligible Express/Custom accounts, sufficient seller
  Stripe balance, supported regions, and legally binding seller consent.
- Stripe must approve the platform's stored-value/virtual-credit use case and
  the payment methods offered for it.
- Tax classification and registrations must be approved before live sales.
