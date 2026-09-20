# SML Academy Data Bridge

This plugin is a private Render-to-WordPress bridge for Academy Options Chain
and Earnings data. It has no public endpoint: every request requires a
short-lived HMAC signature produced by Render after Discord Academy-role
authorization.

Before activation, put these constants in `wp-config.php` or the host secret
manager. Never paste either into a post, WPCode, browser console, git commit,
or Discord message.

```php
define( 'SML_ACADEMY_BRIDGE_SECRET', 'the-same-32-plus-character-secret-as-Render' );
define( 'SML_ACADEMY_SERVICE_USER_ID', 123 ); // dedicated, least-privilege site user
```

Then set Render environment variables:

```
SML_ACADEMY_BRIDGE_URL=https://stockmarketloop.com
SML_ACADEMY_BRIDGE_SECRET=<same secret>
```

The service user must only have enough read capability for the existing
Options Intelligence and Earnings endpoints. Do not use an administrator.
