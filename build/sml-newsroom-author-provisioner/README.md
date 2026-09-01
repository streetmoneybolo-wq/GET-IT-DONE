# SML Newsroom Author Provisioner

Activation creates fifteen WordPress users with the `author` role and stores the desk-to-user-ID map in `sml_newsroom_author_ids`.

- Accounts use branded desk identities and clearly disclose automation.
- Random 64-character passwords are generated and never displayed.
- Existing non-newsroom usernames are never overwritten; activation stops safely.
- Deactivation does not delete authors or published content.
- Version 1.1 ships a unique SML Bull portrait for every desk and serves it through WordPress's normal avatar API, covering author archives, article bylines, feeds and comments.
- Copy the admin notice's `SML_NEWSROOM_AUTHORS_JSON` value into the newsroom service environment before enabling specialist publishing.
