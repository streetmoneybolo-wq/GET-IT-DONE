# Loop Channel WPCode snippets

Both files are the editor body for a WPCode **PHP Snippet** (there is no
opening `<?php`, matching WPCode's editor format).

Activation order:

1. Add and activate `loop-channel-data-api.php` as **Auto Insert / Run Everywhere**.
2. Verify `GET /wp-json/sml-channel/v1/channel/grandmasterobi` returns `200`,
   contains only `visibility: public` videos, and has creator-scoped posts.
3. Add and activate `loop-channel-loader.php` as **Auto Insert / Run Everywhere**.
4. Verify `/channel/grandmasterobi/?ch=1` while signed in as an administrator.
5. Verify `/channel/grandmasterobi/` logged out, then check `?ch=0` restores the
   original WordPress page.

Do not activate the loader before the API verification. Deactivate the loader
to roll back the page shell; deactivate the API separately only after the
loader is off.
