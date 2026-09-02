# SML Connect Dispute Admin (0.2.0)

Narrowly scoped WordPress console for the dispute-evidence system held by the
SML platform service (Render). Nothing here decides anything in browser
JavaScript: every action is a nonce-checked, capability-checked, server-side
signed call to the platform.

## Configuration

The plugin reuses the SML Platform Runtime Config values already used by the
billing bridge: `SML_PLATFORM_API_URL` and `SML_PLATFORM_BILLING_API_SECRET`.
Optional overrides: `SML_CONNECT_ADMIN_API_URL`, `SML_CONNECT_ADMIN_API_SECRET`.

The platform answers 503 `integration_unconfigured` until
`SML_DISPUTE_EVIDENCE_ENABLED=1` and `SML_EVIDENCE_ENCRYPTION_KEY` are set in
Render; the console shows that state on its health panel.

## Surfaces

- **Disputes** admin menu (`manage_options`): connectivity health (platform
  `/health` with schema version, signed API ping, webhook last-seen/failures),
  disputed-access policy form, merchant-admin linking, open cases with
  deadline/state/completeness, case review (facts, checklist, warnings,
  contradictions, assertions with cited records, timeline, exact transmit
  fields/files), packet build, and approval bound to the reviewed
  `packet_sha256` with the confirmation checkbox text verified server-side.
- **`/connect-review/`** front-end page for the single-use link issued by the
  Connect bot's `/dispute-open-dashboard`. Requires login; the platform consumes
  the token and authorizes only administrators or verified merchant admins of
  the case's scope. Approval from this page also carries the platform's
  15-minute review reference.
- **`sml_platform_dispute_notify` adapter**: the bridge (0.4.0+) dispatches the
  worker's `dispute_notify` intent here; it stores a capped admin-notice
  transient and emails `admin_email` with neutral, identifier-only wording.

## DOM / delivery

All injected ids use the `smlcda-` prefix (never `sml-`). No global CSS or
JavaScript is enqueued.
