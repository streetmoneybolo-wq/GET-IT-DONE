# SML App Identity

Signs a member into the StockMarketLoop phone app with their stockmarketloop.com account, for `sml-platform-api` (the app API at `/v1/app`). The phone never calls this plugin. The platform calls it server to server, signed.

## Routes (all `POST`, all HMAC-signed, none reachable from a browser)

| Route | Body | Answer |
|---|---|---|
| `/wp-json/sml-platform/v1/app/login` | `{login, password, code?, device, ip}` | `200 {ok, user, groups, wallet, extras}` or `401 invalid_credentials`, `403 two_step_required {method, hint}`, `403 two_step_invalid`, `403 account_blocked`, `429 rate_limited` |
| `/wp-json/sml-platform/v1/app/me` | `{userId}` | the same member payload |
| `/wp-json/sml-platform/v1/app/proxy` | `{userId, method, route, query, body}` | `{ok, siteStatus, body}`: one allow-listed site REST route run as that member |

Signature: `x-sml-lk-timestamp` / `x-sml-lk-signature: sha256=HMAC(secret, "{ts}.{/wp-json/path}.{sha256(body)}")`, 60-second window, every signature burned once. This is exactly the LOOP-KICK bridge channel (`mu-plugins/sml-loop-kick-discord.php`), so the secret is the one already in Render as `SML_LOOP_KICK_BRIDGE_SECRET`. Nothing new to provision.

## Two-step sign-in

A member with two-step on must give a code. The plugin asks, in order: the site's `sml_app_two_step_*` filters, the Two Factor plugin (authenticator app, emailed token, backup codes), then its own emailed six-digit code (10 minutes, 5 attempts, one send a minute). "Two-step on" is decided the way the Academy wallet decides it: `sml_academy_user_two_step` filter, then `Two_Factor_Core`, then the `sml_two_step_enabled` user meta.

## Pushing to members' phones (1.1.0)

From any plugin or snippet on the site:

```php
sml_app_push( array( $user_id, $other_user_id ), array(
	'title'      => '$NVDA alert',
	'body'       => 'Entry 180, price target 200',
	'url'        => 'https://stockmarketloop.com/groups/making-easy-money/',
	'collapseId' => 'alert-' . $alert_id,   // optional: replaces an earlier push about the same thing
	'data'       => array( 'symbol' => 'NVDA', 'alertId' => $alert_id ),
) );
// or: do_action( 'sml_app_push', $user_ids, $message );
```

It posts to the platform's `/v1/app/push/send`, signed with the billing API secret (the same constant the alert router uses), non-blocking. The platform fans the message out to every registered iPhone, Android phone and PWA of those members. Pass `true` as the third argument to wait for the counts.

## What it never does

- Never fires `wp_login` (that is the browser flow with Two Factor's own page and redirects). It fires `sml_app_login` instead.
- Never proxies sign-in, registration, password reset, webhooks, checkout, uploads or admin routes, whatever the allow list says.
- Never stores the password. It goes to `wp_authenticate` and nowhere else. Failed attempts count per account (10 in 15 minutes) and fire `wp_login_failed` for security plugins.

## Install

Zip the folder and install through Plugins → Add New → Upload, then activate. Requires `mu-plugins/sml-loop-kick-discord.php` (already on the site). Verify with the platform's `GET /v1/app` (should say `ready: true`) and a real sign-in from the app or:

```
curl -s -X POST https://sml-platform-api.onrender.com/v1/app/auth/login \
  -H 'content-type: application/json' \
  -d '{"login":"<username>","password":"<password>","device":{"platform":"ios","name":"test"}}'
```
