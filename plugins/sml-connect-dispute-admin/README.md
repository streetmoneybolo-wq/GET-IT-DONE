# SML Connect Dispute Admin

WordPress console for the SML platform dispute-evidence service. Provides:

- an admin menu page (`SML Disputes`, capability `manage_options`) listing open
  dispute cases (id, provider, reason, amount, response deadline, state,
  completeness) from the platform's signed `/v1/billing/disputes/list` endpoint;
- a case detail / packet review view showing every assertion with its cited
  evidence item ids, packet warnings, and the exact fields and files that would
  be transmitted to the provider;
- a human approval flow: a confirmation checkbox whose exact label text is
  posted back with the approval to `/v1/billing/disputes/approve-submit`
  together with the approving WordPress user id — the platform re-verifies the
  user and scope before anything is sent to a provider;
- a connectivity health panel (`/health` plus a signed `disputes/list` ping,
  including any webhook last-seen fields the API reports);
- a per-merchant dispute access policy setting (`keep_access` /
  `suspend_access`) recorded via `/v1/billing/disputes/record-policy`;
- a `/connect-review/` front-end endpoint that redeems single-use review
  tokens (issued through the Discord `/dispute-open-dashboard` command) via
  `/v1/billing/disputes/redeem-review-token`. The page requires login and
  either `manage_options` or platform-confirmed group-owner capability;
  possession of the token alone renders nothing;
- the `sml_platform_dispute_notify` adapter for the billing bridge's
  `dispute_notify` intent: stores a dashboard admin notice and emails the site
  admin address with neutral, factual wording.

## Configuration

Define both constants in `wp-config.php`. Never paste secret values into
WPCode, options, or commits:

```php
define( 'SML_CONNECT_ADMIN_API_URL', 'https://YOUR-RENDER-SERVICE.onrender.com' );
define( 'SML_CONNECT_ADMIN_API_SECRET', 'same value as SML_BILLING_API_SECRET on Render' );
```

Outbound calls are signed exactly like the billing bridge: HMAC-SHA256 over
`"{timestamp}.{body}"`, sent as `x-sml-signature: sha256=<hex>` with
`x-sml-timestamp`, JSON body, 10 second timeout.

## Install order

Deploy this plugin (and billing bridge 0.4.0, which adds the `dispute_notify`
intent) **before** enabling the platform worker's `dispute_notify` outbox
handler; the bridge returns 503 for that intent until this adapter is active.

After activation, visit Settings → Permalinks once (or rely on the activation
hook) so the `/connect-review/` rewrite rule is registered.

## Security notes

- Every state-changing action requires a nonce and is authorized server-side;
  no approval decision lives in browser JS.
- All injected DOM ids use the `smlcda-` prefix (never `sml-`).
- All output is escaped with `esc_html` / `esc_attr` / `esc_url`.
- The plugin never logs or renders the API secret or raw review tokens.
