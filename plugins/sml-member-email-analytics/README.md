# SML Member Email Analytics

Private, owner-only WordPress administration for encrypted billing-contact analytics.

## Requirements

- `SML Platform Runtime Config` must be active so `SML_PLATFORM_API_URL` and
  `SML_PLATFORM_BILLING_API_SECRET` are available.
- The matching Render API/worker services must enable the member-email runtime
  and share the same encryption and lookup keys.

## Privacy and delivery rules

- Email addresses are decrypted only inside the signed owner request and are
  never sent to Google Analytics, Discord, URLs, or browser tracking.
- Renewal messages are transactional service notices.
- Special offers are queued only for contacts with affirmative marketing
  consent, are deduplicated by email, and require a physical business address.
- Missing secrets, provider configuration, or consent fail closed.
