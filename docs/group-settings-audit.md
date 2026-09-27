# Group settings audit and cut-over plan

Scope: stockmarketloop.com groups (`/groups/{slug}/`). Written from the sources in
this repo (`wpcode/`, `plugins/`, the `add/live-plugin-source-for-review` branch)
and the site inventory notes. Anything marked **confirm** could not be read from a
repo and must be checked against the export produced by *Tools → SML Export*
once `sml-group-settings-hub` is installed.

## 1. Where every group setting lives today

| Setting | Surface the owner sees today | Code that owns it | Storage |
|---|---|---|---|
| Name, description, category, banner, watermark | "Edit" button in the shell header (`.sml-gshell__edit` / `[data-smlgs-edit]`) | Group Owner Editor plugin (site-only, **confirm**) + `wpcode/group-visuals-api.php` | engine `sml_groups`; option `sml_group_visuals_{id}` |
| Channels: create, delete | Sidebar "+" (shell) | groups engine (WPCode, `sml/v1/group/channel/create`) | `sml_group_channels` |
| Channels: rename, reorder, categories | ⚙ gear in the sidebar (`#sml-gcat-gear`) | `wpcode/group-categories.php` + `js/group-categories.js` | `order_index` column; option `sml_gcat_{id}` |
| Channel Admin 0.1 / 0.2 / "0.2 Safe Switch" | (two inactive, one active "safe switch") | site-only plugins (**confirm** which is load-bearing) | unknown |
| Member roles (member / premium / analyst / mod / admin) | Roster in the shell (**confirm** where roles are edited) | groups engine | `sml_group_members.role` |
| Onboarding (welcome, featured channels, unlock) | ⋮ menu → "Onboarding" (`[data-sml-ob-open]`) | mu-plugin `sml-group-onboarding.php` 2.0.0 (`sml-onboard/v1`) + `js/group-onboarding.js` | **confirm** |
| Membership billing (Stripe payout setup) | "⚙ Membership Billing · 6%" in the owner menu (`.sml-billing-setup`) | `plugins/sml-platform-billing-bridge` + platform `/v1/billing/*` | platform Postgres |
| Membership products | "🛍 Membership products" (`[data-sml-products]`) and inside the Discord panel | same | platform `group_plans` |
| Discord pairing + role mappings | "Discord Access" in the header (`[data-sml-dgc-owner]`), removed once paired | `wpcode/discord-role-group-connect.php` | `sml_discord_group_connectors`, `sml_discord_group_role_maps` |
| Discord channel sync (also carries role mappings) | "Discord Server Channel Sync" in `.sml-manage-mini` (`[data-sml-dgc-channel-sync]`) | same | `sml_discord_group_channel_maps` |
| Private channel minimum role | set during channel sync | same (`rest_pre_dispatch` guard) | `channel_maps.minimum_role` |
| Role settings table `sml_group_role_settings` | none known | WPCode snippet 5750 "Group Live + Personal Inbox" | **confirm** what it holds |

Duplicates seen by the owner today: membership products reachable from two
places; role mappings reachable from two places (pairing panel and channel
sync); "Discord Access" and "Channel Sync" living in different corners of the
page; onboarding hidden in a ⋮ menu; channel layout hidden behind a sidebar gear.

## 2. What the hub changes

`plugins/sml-group-settings-hub` adds one window ("⚙ Settings" in the header
and "Group settings" in the ⋮ menu) with eight sections. It is a companion
layer: nothing above is rewritten, every existing tool is opened from the hub.

| Section | Backed by |
|---|---|
| Overview | counts, group editor, channel layout, hide-old-buttons switch, change log |
| Roles | new: custom roles with colour, permissions and a base level (`sml_hub_roles`) |
| Members | new: roster with engine level + custom roles, remove member (`sml_hub_member_roles`) |
| Channels | new: per-channel View/Post overrides per level/role, enforced on the engine's chat routes (`sml_hub_chan_{id}` option); layout via the categories gear |
| Memberships | products modal + Stripe setup from the billing bridge |
| Discord | pairing panel or channel sync from Discord Connect; mappings shown read-only |
| Socials | new: follow-to-unlock (`sml_hub_social_*`) |
| Onboarding | onboarding editor from the mu-plugin |

The old buttons are hidden with a CSS class (`body.sml-hub-dedupe`) but stay in
the DOM so the hub can click them. Overview → "Hide the old scattered buttons"
turns this off instantly per group.

### Roles model

* A custom role = name, colour, permissions, **base level**. Assigning it writes
  the base level to `sml_group_members.role`, so the engine (chat, alert
  channels, moderation) behaves exactly as before. The engine never sees the
  role name.
* Removing a custom role lowers the engine level only when that role was what
  gave it and no other role still implies it, and never touches mod/admin.
* Deleting a role never changes anyone's engine level (a human may rely on it);
  the audit row lists who held it.
* Moderators (engine `mod`, or a role with *Manage members*) can only touch
  people below mod level and cannot grant mod/admin. Only owners and admins can
  create roles at mod level or above.

### Channel permissions

Resolution order is Discord's: `@everyone` → role denies → role allows. Owners,
admins and site admins always pass. Enforced with `rest_pre_dispatch` on
`/sml/v1/group/channel/messages` and `/channel/message/send`, and by filtering
`/sml/v1/group/channels` — the same points Discord Connect uses, so both layers
stack (a channel must pass both).

### Socials (follow-to-unlock)

Enabled only for `making-easy-money` (Settings → SML Group Hub to change).

| Platform | How it is verified | Needs |
|---|---|---|
| Loop Channel | native follow table, auto-detected (`SHOW TABLES LIKE sml_%follow%`); filter `sml_hub_loop_follow_source` overrides | nothing, if a follow table exists |
| Bluesky | public AT Protocol API; ownership proven by a one-time code in the bio; follow via `app.bsky.graph.getRelationships` | nothing |
| YouTube | Google OAuth `youtube.readonly`, `subscriptions.list?mine=true&forChannelId=` | Google OAuth client (Settings page shows the redirect URI) |
| Reddit | OAuth `mysubreddits`, `/subreddits/mine/subscriber` | Reddit app (Settings page shows the redirect URI) |
| X | not offered: follow lookups need a paid API tier | — |
| Facebook page, Threads, LinkedIn | cannot be verified by any API; not offered | — |

Grants are recorded in `sml_hub_social_grants` and only what was recorded is
removed. A daily cron re-checks every grant; the owner can "Re-check everyone
now". If a human changed the member's role after the grant, the membership is
left alone and only the grant row is dropped (same rule as Discord sync and
billing reconcile).

## 3. Cut-over plan

Each step is reversible on its own.

1. **Install** `sml-group-settings-hub` (upload ZIP, activate). Nothing changes
   for members; owners get "⚙ Settings". Old buttons are hidden for owners.
   *Rollback:* Overview → untick "Hide the old scattered buttons", or deactivate.
2. **Export** the site: Tools → SML Export → download ZIP → attach it here.
   This closes every **confirm** above and lets the next steps be exact.
3. **Roles**: owner creates the roles they want, assigns them from Members.
   No engine change. *Rollback:* delete the role; engine levels stay.
4. **Channel overrides**: set per channel. *Rollback:* "Clear all" + Save on
   that channel, or delete option `sml_hub_chan_{id}`.
5. **Socials** (making-easy-money only): Settings → SML Group Hub → add Google
   and Reddit apps if wanted; owner adds targets, switches the feature on.
   *Rollback:* switch off; "Re-check everyone now" revokes what it granted.
6. **Retire duplicates** (only after the export confirms nothing else uses them):
   the inactive Channel Admin 0.1/0.2 plugins and the dead plugin copies listed
   in the site inventory. Never before step 2.

## 4. Verification done

* `php -l` on every PHP file; `node --check` on `assets/hub.js`.
* Chromium harness (`plugins/sml-group-settings-hub/tests/hub-harness.js`, run with `NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/hub-harness.js`) against stubbed REST at
  1280×900 and 390×844: every section renders without horizontal overflow;
  role create/edit/delete; engine level change; custom role add/remove;
  channel override save; socials config, target add, re-check; delegation to
  the group editor, categories gear, products modal, Stripe setup, Discord sync
  and onboarding editor; hide-old-buttons toggle; member card → connect
  Bluesky → verify → granted.
* Not verified (no site access from this container): the real engine routes,
  the real DOM of Group Shell v11, and the live follow-table detection.
