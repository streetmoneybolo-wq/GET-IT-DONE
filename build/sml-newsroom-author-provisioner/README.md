# SML Newsroom Author Provisioner

Activation creates fifteen WordPress users with the `author` role and stores the desk-to-user-ID map in `sml_newsroom_author_ids`.

- Accounts use branded desk identities and clearly disclose automation.
- Random 64-character passwords are generated and never displayed.
- Existing non-newsroom usernames are never overwritten; activation stops safely.
- Deactivation does not delete authors or published content.
- Copy the admin notice's `SML_NEWSROOM_AUTHORS_JSON` value into the newsroom service environment before enabling specialist publishing.
