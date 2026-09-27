# MEM Academy billing: launch checklist

Merging this branch changes nothing a member can see. Every switch is off
until you set it in Render. The one automatic change is the database:
the API's pre-deploy step (`npm run db:release`, `SML_MIGRATION_MODE=apply`)
applies migration **028**, which only adds eleven new `academy_billing_*`
tables (the last one, `academy_billing_trials`, is the one-free-trial ledger)
and one helper function (`academy_billing_ids_distinct`, used by a CHECK).

`README.md` next to this file explains how the engine works, the full env
table, the routes and the CLI. This page is only what you do, in order.

What you decided (2026-09-26) and what it means here:
- Everyone pays the same price (no introductory price, no member discount). Prices are
  Stripe prices plus `SML_ACADEMY_BILLING_PRICES_JSON`, never code.
- Every package gives the Academy AND the same length of paid Making Easy
  Money Discord access. Both ride on the one engine role `Academy Student`,
  which you give Premium-level channel access.
- Lifetime also grants the existing **Monarch** role (`1260433215189946420`)
  and ONLY Monarch: it does NOT grant **Elite Member**
  (`1192450618485395466`) (your correction of 2026-09-26). Elite comes with
  Elite Lifetime Access and the Elite memberships below. So buying Lifetime
  never cancels a member's renewing Elite Yearly / Monthly / Week plan, and a
  Lifetime buyer can still buy Elite Lifetime Access. There is no separate
  MEM Lifetime role: leave `SML_ACADEMY_BILLING_LIFETIME_ROLE_ID` unset
  everywhere.
- (2026-09-26) The Making Easy Money products of the Upgrade.Chat store are
  sold here too, through Stripe, WITHOUT the Academy: Elite Lifetime Access
  ($7,490.90 once, Monarch + Elite, as Upgrade.Chat sells it), Elite Yearly
  Access ($849.90 / year),
  Elite Monthly Access ($89.90 / month) and Elite Week Seat ($34.90 / week),
  each with a 7-day free trial, and Free Trial Access ($7.90 / day; owner
  decision 2026-09-26, "3 DAY": a plain 3-day free trial without a card that
  stops by itself: three free days, never charged). One free trial per
  Discord account, across every product.
  Upgrade.Chat keeps selling too.
- Upgrade.Chat also manages Monarch (about 58 members), Elite and Premium, and
  about 29 Upgrade.Chat products exist (most hidden; many hidden ones still
  have paying members), so the engine only ever adds those roles, and removes
  one only when it gave it to someone who did not have it AND Upgrade.Chat
  shows no active upgrade at all for that Discord account, on any product
  (hidden and one-time lifetime orders included). A role kept because some
  Upgrade.Chat upgrade was active is checked again once a day and removed
  when Upgrade.Chat shows nothing active any more. If that check cannot run,
  the role stays and is listed for you (`external-review`).
- Buyers who are not in the server can pay; the plans page and the thank-you
  page show the invite and an "Add me to the server" button, and the roles
  land when they join.
- More Upgrade.Chat memberships (Premium Member, for example) can be added
  later by config only (see "The Making Easy Money memberships" below).

Placeholders below: `<STUDENT>` is the `Academy Student` role id,
`https://ACADEMY` is `https://making-easy-money-academy.onrender.com`.

## 0. After the merge deploys (no env changes)

- [ ] `schema_migrations` contains `028`. The academy service picks it up
      within 5 minutes; it stays idle until `SML_ACADEMY_BILLING_ENABLED=1`.
- [ ] The API log line `academy_gate_runtime` shows guild
      `938894329076940820`, every flag `false`, and `handoff:false`.
- [ ] Nothing else changed: the Activity still admits exactly Monarch and the
      manager role, lessons are unchanged, the hub behaves as before, and every
      `https://ACADEMY/v1/academy/billing/*` URL returns 404.

## 1. Owner checklist

### Discord (MEM guild `938894329076940820`, Academy app `1551336038713139370`)
- [ ] Create ONE plain role, `Academy Student`: no role permissions, not
      hoisted, **below** the `Making Easy Money Academy` bot role. Do not
      create a `MEM Lifetime` role. Never reuse Premium, Elite or Monarch as
      the Academy role.
- [ ] Give `Academy Student` **Premium-level channel access**: the same
      category and channel permissions Premium has (channel settings, not
      role permissions), plus the Academy category `1551448153276944405`.
      **Never** run `scripts/setup-academy-channels.js --apply`.
- [ ] Drag the Academy bot role **above Monarch (position 17 today), Elite and
      Premium**. The engine grants Monarch with Lifetime, Monarch and Elite
      with Elite Lifetime Access, and Elite with the Elite memberships; a role
      above the bot is refused with 403.
      Preflight warns `external_role_not_below_bot:<id>` until this is done.
- [ ] Give the Academy bot role **Manage Roles**, **Create Instant
      Invite** (needed for "Add me to the server") and **Ban Members**
      (read-only use: buyers who are not in the server can pay, so checkout
      refuses an account that is banned from it and could never get in;
      preflight warns without it). Optional: View Audit Log.
- [ ] Keep `Academy Student` out of the WordPress group-7 role map.
- [ ] Developer Portal (Academy app), OAuth2: add the redirect URI
      `https://ACADEMY/v1/academy/billing/oauth/callback`. The sign-in asks
      Discord for `identify`, and for `identify guilds.join` only when a buyer
      clicks "Add me to the server".
- [ ] Create a server invite that does not expire, for
      `SML_ACADEMY_BILLING_INVITE_URL` (shown to every buyer who is not in the
      server).
- [ ] Premium Apps parity (read-only): in Monetization > Create SKU, open the
      price list without publishing, and record whether $120.00 and $9,200.00
      exist. Get written answers from Discord Developer Support on the
      exemptions for the Stripe-only daily, weekly, 3/6/12-month plans and for
      a lifetime priced above the list.

### Upgrade.Chat (for the Monarch / Elite / Premium check)
- [ ] On the ACADEMY service set `UPGRADE_CHAT_CLIENT_ID` and
      `UPGRADE_CHAT_CLIENT_SECRET` (the same API credentials the platform API
      already uses).
- [ ] Leave `SML_ACADEMY_BILLING_UC_MATCH` unset (= `any`): a member with ANY
      active Upgrade.Chat upgrade (any product, hidden ones and one-time
      lifetime orders included) keeps a Monarch/Elite/Premium the engine gave
      them when their Stripe purchase ends, and the engine asks Upgrade.Chat
      again once a day: the role goes when no upgrade is active any more (the
      kept upgrade may be for another role, which Upgrade.Chat would never
      remove it for). No product list is needed, so
      `SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON` stays unset. A staff keep
      (`external-review --keep`) is never re-checked.
  - Only if you ever want the older per-product rule, set
    `SML_ACADEMY_BILLING_UC_MATCH=mapped` and list, for each role, every
    Upgrade.Chat product id (uuid) that grants it, including one-time
    products. Example shape:
    `{"1260433215189946420":["cf67da72-e309-4db5-bbf8-13e7f42ba02e"],"1192450618485395466":["cf67da72-e309-4db5-bbf8-13e7f42ba02e","bf0eb1e8-c034-4eaa-b8f7-3633bdbff989","5afb4ebb-fb6c-428a-982e-b38b06b2363a","a5749691-20f6-4cda-8554-d1e94a1ff80c","43012a04-dbf2-4919-af73-b265eb04cb7a"]}`
    (the visible store products only; every hidden product that grants the
    role must be added too). A role mapped to `[]` means no Upgrade.Chat
    product grants it.
- Without the credentials, nothing breaks: the engine still grants Monarch
  and Elite, but never removes one it gave (refund, lost dispute, a plan or
  trial that ended); `node scripts/academy-billing.js external-review` lists
  those members for you. A buyer refunded (or disputed) before the role ever
  reached them never receives it.
- A one-time Upgrade.Chat order (a lifetime) counts for good unless
  Upgrade.Chat has ended it: its API has no refund field, and a refunded or
  charged-back order is one Upgrade.Chat expired.
- An Upgrade.Chat subscription whose renewal is still being charged (up to 7
  days after its paid-through date, not cancelled) counts as "not sure": the
  role stays and the member is listed until Upgrade.Chat answers clearly.

### Stripe (MEM `acct_1ND1yGBpqyUyWsXe`; do every step in live AND test mode)
- [ ] Create six products, each with metadata `sml_kind` = `mem_academy`,
      named exactly as below (the membership names are shown on `/buy`; no
      emoji): `MEM Academy`, `Elite Lifetime Access`, `Elite Yearly Access`,
      `Elite Monthly Access`, `Elite Week Seat`, `Free Trial Access`.
- [ ] Create the twelve prices: USD, "Include tax in price: No"
      (`tax_behavior=exclusive`), standard per-unit, and NO trial on the
      price (the engine adds the trials). Note each price id next to its
      placeholder:

  | product | Stripe price | your price | includes | trial / stop | buyers pay by | placeholder |
  | --- | --- | --- | --- | --- | --- | --- |
  | MEM Academy | recurring day x1 | $11.00 | Academy + Discord paid access for the day | stops after 3 charges | card, Link | `price_DAY` |
  | MEM Academy | recurring week x1 | $40.00 | Academy + Discord paid access for the week | | card, Link | `price_WEEK` |
  | MEM Academy | recurring month x1 | $120.00 | Academy + Discord paid access for the month | | card, Link | `price_MONTH` |
  | MEM Academy | recurring month x3 | $300.00 | Academy + Discord paid access for 3 months | | card, Link | `price_3M` |
  | MEM Academy | recurring month x6 | $540.00 | Academy + Discord paid access for 6 months | | card, Link | `price_6M` |
  | MEM Academy | recurring year x1 | $960.00 | Academy + Discord paid access for the year | | card, Link | `price_YEAR` |
  | MEM Academy | one-time | $9,200.00 | Academy + Discord paid access + Monarch, for good (not Elite) | | card or US bank account (ACH) | `price_LIFETIME` |
  | Elite Lifetime Access | one-time | $7,490.90 | Monarch + Elite, for good (no Academy) | | card, Link | `price_ELITELIFE` |
  | Elite Yearly Access | recurring year x1 | $849.90 | Elite (no Academy) | 7-day free trial | card, Link | `price_ELITEYEAR` |
  | Elite Monthly Access | recurring month x1 | $89.90 | Elite (no Academy) | 7-day free trial | card, Link | `price_ELITEMONTH` |
  | Elite Week Seat | recurring week x1 | $34.90 | Elite (no Academy) | 7-day free trial | card, Link | `price_ELITEWEEK` |
  | Free Trial Access | recurring day x1 | $7.90 | Elite (no Academy) | 3-day free trial without a card; stops by itself before any charge (never charged) | none needed | `price_FREETRIAL` |

- [ ] Settings > Billing > Subscriptions and emails > "Manage free trial
      messaging": turn on the reminder email before a trial ends
      (account-wide; Stripe asks sellers to follow the card networks' trial
      rules). Stripe sends it 7 days before the trial end, and as soon as
      a shorter trial begins, so for every trial here it goes out at
      sign-up. For Free Trial Access that email (and Checkout's own order
      summary, "3 days free, then $7.90 per day") names the $7.90/day price
      after the 3-day trial, while the page, the button text and the
      consent say 3 free days, never charged (the engine cancels it 10
      minutes before the trial ends, so Stripe never creates an invoice).
      Show both Stripe texts to legal (see "Legal and copy").

- [ ] Turn on **ACH Direct Debit ONLY in a Lifetime-specific payment method
      configuration** (Settings > Payment methods > create a configuration,
      live and test) and keep it OFF in the Default configuration. The
      Lifetime checkout offers card or US bank account because a $9,200 card
      payment costs about $267 in fees and is often declined.
  - Why: the Default configuration is what the store, Creator Tiers,
    subdomains, Payment Links and hosted invoice pages of every MEM
    subscription use; with ACH on there they would start offering bank debits
    and may deliver before the money clears. The engine lists its own methods
    on every checkout (bank debit on the Lifetime price only), so it only
    needs the ACH capability active on the account. Preflight logs
    `us_bank_account_ach_payments_capability_<status>` when it is not active.
  - Stripe sets ACH per-payment and weekly volume limits for each account.
    Confirm with Stripe that one $9,200 debit fits. A debit over the limit
    fails (test account `000777777771`) and grants nothing.
  - Bank payments take up to four business days to clear. The buyer gets no
    role until the payment clears; `/buy` and the success page say so.
  - The engine asks Checkout for `verification_method=automatic`: the buyer
    links the bank instantly through Stripe Financial Connections, or types
    the account number and confirms two small deposits from Stripe's email
    (10 days to do it).
  - A bank payment returned later (insufficient funds, or disputed by the
    buyer up to 60 days) arrives as a dispute and removes the Academy role
    (and Monarch, if the engine gave it and Upgrade.Chat has none).
  - Preflight logs two warnings while a Lifetime price accepts bank payments
    (`us_bank_account_needs_ach_direct_debit_enabled_on_the_stripe_account`,
    `us_bank_account_checkout_sends_verification_method_automatic`). They are
    reminders, not failures. If ACH is off, the Lifetime checkout cannot
    start.
- [ ] Create a restricted key (`rk_live_` and a `rk_test_` twin).
  - Write: Customers, Checkout Sessions, Customer portal, **Subscriptions**
    (needed for the daily 3-charge cap, the 3-day stop of Free Trial Access
    and for cancelling a plan when Lifetime is bought), PaymentIntents.
  - Read: Invoices, Charges, Disputes, Prices, Products.
  - Optional read: Account, Webhook Endpoints.
  - Test key only: Test clocks write.
- [ ] Create a **new** webhook endpoint `https://ACADEMY/v1/academy/billing/stripe/webhook`.
  - API version: 2022-11-15.
  - Leave the existing platform endpoints and their version pin alone.
  - Subscribe exactly these events:
    `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
    `checkout.session.async_payment_failed`, `checkout.session.expired`,
    `customer.subscription.created`, `customer.subscription.updated`,
    `customer.subscription.deleted`, `customer.subscription.paused`,
    `customer.subscription.resumed`, `invoice.paid`, `invoice.payment_failed`,
    `charge.refunded`, `charge.refund.updated`, `charge.failed`,
    `payment_intent.payment_failed`, `charge.dispute.created`,
    `charge.dispute.updated`, `charge.dispute.closed`,
    `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`.
  - `charge.failed` and `payment_intent.payment_failed` are for the bank-paid
    Lifetime: they make the engine re-check the buyer as soon as a bank
    payment fails. They also fire for failed card payments of other MEM
    products; the engine ignores those without calling Stripe.
  - **Never** add `invoice.created`, `invoice.upcoming` or "all events". A
    slow listener on `invoice.created` holds renewals of every MEM
    subscription for up to 72 h.
- [ ] Create a dedicated Customer Portal configuration.
  - Cancel at period end, no proration, cancellation reasons on, plan switching off.
  - Terms and privacy links; return URL `https://ACADEMY/v1/academy/billing/buy`.
  - Never edit the shared default configuration (`bpc_1R7qIy...`).
- [ ] Review the account-wide settings, which also affect the store, Creator
      Tiers and subdomains:
  - "If all retries fail" -> cancel;
  - disputed payments -> cancel immediately;
  - receipts on;
  - the upcoming-renewal emails (the engine's own renewal reminders are phase 2).
- [ ] Before the first live checkout, close (or reprice) the lifetime offers
      that undercut both lifetimes here: the direct $2,990 link
      `plink_1T5S0T...` and the old $1,999.99 product. Upgrade.Chat keeps
      selling (your 2026-09-26 decision); its Elite Lifetime Access
      ($7,490.90, Monarch + Elite, no Academy) is sold here at the same price,
      and MEM Lifetime ($9,200) is the Academy with Monarch (not Elite).
      Whop and Telegram products
      must never grant the Academy role.

### Legal and copy (before the first live checkout)
- [ ] Add a billing section to `/academy-terms/`. It must cover:
  - auto-renewal for each package;
  - every package includes the Academy and paid Discord access for the same period;
  - the daily plan ends by itself after 3 charges;
  - the memberships (Elite Lifetime Access, Elite Yearly Access, Elite Monthly
    Access, Elite Week Seat, Free Trial Access) include the Elite role (and
    Monarch on Elite Lifetime Access) but NOT the Academy;
  - free trials: 7 days on Elite Yearly, Monthly and Week Seat, then the plan
    renews at its price until cancelled (cancel before the trial ends and
    nothing is charged); Free Trial Access is 3 free days without a card and
    stops by itself; one free trial per Discord account across every product
    (an account that used its trial pays from day one on the Elite plans and
    is not offered Free Trial Access again);
  - cancel online at any time, keeping access to the end of the period (about 15 minutes of lag in the Activity);
  - refunds and chargebacks remove access;
  - buying Lifetime sets any active Academy plan to cancel at period end, with no refund of that plan; it does NOT touch a renewing Elite membership plan (Elite Yearly, Monthly, Week Seat), which keeps renewing; buying Elite Lifetime Access sets a renewing Elite membership plan to cancel at period end, with no refund of that plan;
  - Lifetime includes the Monarch role (not the Elite Member role); Elite Lifetime Access includes the Monarch and Elite Member roles;
  - Lifetime paid by US bank account: access starts when the payment clears (a few business days), and a failed or returned bank payment removes it.
- [ ] Add the Lifetime definition to `/academy-terms/`:
  - "as long as Making Easy Money LLC operates the Academy and the official server";
  - one Discord account, non-transferable;
  - final sale, with the 24-month minimum-service guarantee.
- [ ] `/academy-privacy/` exists (or set `SML_ACADEMY_BILLING_PRIVACY_URL`).
- [ ] Approve the checkout disclosure text and pick its version string for
      `SML_ACADEMY_BILLING_CONSENT_VERSION` (for example `2026-10-01`).
      Changing the text means a new version. The text names what each package
      grants (the Academy Student role with the paid Discord access, and
      Monarch on Lifetime; the names come from each price's `roles`); a
      membership's text says it does not include the Academy. A trial
      offer's text also states the trial, what it costs after the trial and
      "One free trial per Discord account"; Free Trial Access says it is never
      charged. The Lifetime text says: "It gives this Discord account the
      Academy Student role (MEM Academy and paid access to the Making Easy
      Money Discord server) and the Monarch role." and "If you have an Academy
      plan, or a membership plan that gives no role other than the Monarch
      role, that renews, buying Lifetime sets that plan to cancel at the end
      of its current paid period." (changed on 2026-09-26 after your
      correction: Lifetime gives Monarch only, so it never mentions Elite and
      never ends a renewing Elite plan). The Elite Lifetime Access text says:
      "If you have a membership plan that gives no role other than the
      Monarch or Elite Member role and renews, buying this sets that plan to
      cancel at the end of its current paid period."
- [ ] Remove any earnings or performance claims from the Academy copy. Keep the
      education-only disclaimer. Do not show a struck-through "was" price.
- [ ] Legal review of the auto-renewal flow, including the free-trial-to-paid
      conversion of the Elite trials: ROSCA, California AB 2863, New York
      and NYC (from 2026-10-01). Proof of consent is stored in
      `academy_billing_checkout_intents` and must be kept 3 years.
- [ ] Legal review of Free Trial Access as Stripe shows it: the trial
      length now matches (a plain 3-day Stripe trial), but Checkout's order
      summary says "3 days free, then $7.90 per day" and Stripe's trial
      reminder email (sent at sign-up for a trial this short) can describe
      the $7.90/day renewal, while our consent and button text say 3 free
      days that end by themselves and are never charged. The engine cancels
      the subscription 10 minutes before the trial ends, so Stripe never
      creates the first invoice, even for a member with a saved card.
      (Checkout itself cannot carry that stop: its `subscription_data` has
      no `cancel_at`.)
- [ ] Alert on the log events `academy_billing_free_trial_stop_missed`,
      `academy_billing_free_trial_charged`, `academy_billing_free_trial_stop_failed`
      (errors) and `academy_billing_auto_stop_pending` (warn). Each means a
      Free Trial Access subscription was not stopped in time (the engine
      was down or blocked, or Stripe refused the write). A missed one is
      cancelled at once, before its first invoice is collected when the
      engine is back within about an hour; a `free_trial_charged` one
      (audit reason `refund_review`) was charged $7.90 and needs a refund
      in the Dashboard.
      Decide whether the "then $7.90 per day" wording is acceptable. Stripe
      sends no reminder emails in test mode, so check the live wording.
- [ ] Sales tax decision. `SML_ACADEMY_BILLING_AUTOMATIC_TAX` stays `0` until
      there are registrations.

### Decisions to write down before stage C
- [ ] Discord parity: the answers above, and whether Monthly and Lifetime also
      go on Discord at the same price (phase 2).
- [ ] Premium and Elite: include the Academy with their membership? If yes, set
      `SML_ACADEMY_MEMBER_ROLE_IDS=939031140679970867,1192450618485395466`. This
      admits everyone holding those roles, paying or not, until the phase-2
      roster exists.
- [ ] Monarch stays admitted (`SML_ACADEMY_MONARCH_ACCESS` unset = `1`). Lifetime
      buyers reach the Activity as members through Monarch, so keep it `1`.
- [ ] When to turn on the content gate (stage E). Until then all lessons stay
      public, and the paid role unlocks the signed-in Activity (progress, Live
      Desk, MEM ALGO, alerts desk).
- [ ] Existing lifetime buyers who are not Monarch yet: from stage C on, give
      them the Academy and Monarch with
      `comp grant --discord <id> --role 1260433215189946420 --reason "legacy lifetime" --apply --actor owner`.
      Comps are the only sanctioned manual grant of `Academy Student`; that
      role added by hand is removed once revokes are on. A member who already
      holds Monarch keeps it whatever happens (the engine records it as
      `held`).

## 2. Staged enable

Set values in the Render dashboard of the named service. Each change restarts
that service. **API** = `sml-platform-api`, **ACADEMY** =
`making-easy-money-academy`, **WORKER** = `sml-platform-worker`. Run CLI
commands in the ACADEMY service shell. A config error keeps the engine off:
look for `academy_billing_config_invalid` in the logs.

### Stage 0: platform noise fix (required before any checkout)
Run the two baseline counts in `BILLING-DEPLOY.md` first, then set:

| service | variable | value |
| --- | --- | --- |
| API | `SML_LIFECYCLE_SKIP_ROWLESS` | `1` |
| WORKER | `SML_BILLING_OUTBOX_MAX_ATTEMPTS` | `20` |

Expect one burst of `billing_outbox_dead` warnings as the existing unroutable backlog is parked.

### Stage A: test-mode rehearsal (your own Discord account, a short window)
ACADEMY:

| variable | value |
| --- | --- |
| `SML_ACADEMY_BILLING_GUILD_ID` | `938894329076940820` |
| `SML_ACADEMY_BILLING_ACADEMY_ROLE_ID` | `<STUDENT>` |
| `SML_ACADEMY_BILLING_LIFETIME_ROLE_ID` | leave unset |
| `SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS` | leave unset (Monarch, Elite, Premium) |
| `UPGRADE_CHAT_CLIENT_ID` / `UPGRADE_CHAT_CLIENT_SECRET` | the platform's Upgrade.Chat credentials |
| `SML_ACADEMY_BILLING_UC_MATCH` | leave unset (`any`); `SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON` stays unset too |
| `SML_ACADEMY_BILLING_PUBLIC_URL` | `https://ACADEMY` |
| `SML_ACADEMY_BILLING_INVITE_URL` | the server invite |
| `SML_ACADEMY_BILLING_ALLOW_NON_MEMBER` | `1` (buyers not in the server can pay; roles land when they join) |
| `SML_ACADEMY_BILLING_AUTO_JOIN` | `1` ("Add me to the server"; needs Create Instant Invite) |
| `SML_ACADEMY_BILLING_STRIPE_ACCOUNT_ID` | `acct_1ND1yGBpqyUyWsXe` |
| `SML_ACADEMY_BILLING_LIVEMODE` | `0` |
| `SML_ACADEMY_BILLING_STRIPE_KEY` | `rk_test_...` |
| `SML_ACADEMY_BILLING_WEBHOOK_SECRET` | the TEST endpoint's `whsec_...` |
| `SML_ACADEMY_BILLING_PORTAL_CONFIG_ID` | the test `bpc_...` |
| `SML_ACADEMY_BILLING_PRICES_JSON` | the test price ids (format below) |
| `SML_ACADEMY_BILLING_CONSENT_VERSION` | the approved version |
| `SML_ACADEMY_BILLING_TEST_CLOCK` | `1` |
| `SML_ACADEMY_BILLING_ROLE_MODE` | `enforce` |
| `SML_ACADEMY_BILLING_REVOKES_ENABLED` | `1` |
| `SML_ACADEMY_BILLING_RECONCILE_MODE` | `dry_run` |
| `SML_ACADEMY_BILLING_CHECKOUT_ENABLED` | `1` |
| `SML_ACADEMY_BILLING_ENABLED` | `1` (set last) |

`PRICES_JSON` format. Exactly one `sell:true` per package in each line (the
Academy line, Elite Lifetime Access, and the Elite line of the yearly,
monthly, weekly and daily memberships; `sell` defaults to `true`); never
delete an entry, set `sell:false` instead. The Lifetime entry lists Monarch
ONLY in `roles` (never Elite) and its own `paymentMethods`; Elite Lifetime
Access lists Monarch and Elite (every other price uses
`card,link`); `us_bank_account` on any other package stops the engine with
`academy_billing_config_invalid`, and so does any key other than `package`,
`sell`, `graceHours`, `paymentMethods`, `roles`, `academy`, `trialDays`,
`trialNoCard` and `cancelAfterDays` (a typo such as `payment_methods` would
otherwise drop the bank option without a sound). Paste this and replace each
placeholder with the price id you noted (test ids in stage A, live ids in
stage B):
`{"price_DAY":{"package":"daily","cancelAfterDays":3},"price_WEEK":{"package":"weekly"},"price_MONTH":{"package":"monthly"},"price_3M":{"package":"quarterly"},"price_6M":{"package":"semiannual"},"price_YEAR":{"package":"yearly"},"price_LIFETIME":{"package":"lifetime","roles":["1260433215189946420"],"paymentMethods":["card","us_bank_account"]},"price_ELITELIFE":{"package":"lifetime","academy":false,"roles":["1260433215189946420","1192450618485395466"]},"price_ELITEYEAR":{"package":"yearly","academy":false,"roles":["1192450618485395466"],"trialDays":7},"price_ELITEMONTH":{"package":"monthly","academy":false,"roles":["1192450618485395466"],"trialDays":7},"price_ELITEWEEK":{"package":"weekly","academy":false,"roles":["1192450618485395466"],"trialDays":7},"price_FREETRIAL":{"package":"daily","academy":false,"roles":["1192450618485395466"],"trialDays":3,"trialNoCard":true,"cancelAfterDays":3}}`

- [ ] `node scripts/academy-billing.js preflight` shows `ok:true` (guild, Manage
      Roles, role positions, Stripe account, every price) and no
      `external_role_not_below_bot` warning.
- [ ] Rehearse at `https://ACADEMY/v1/academy/billing/buy`:
  - buy: role within 10 s, plus an audit row;
  - renew (advance the test clock);
  - cancel at period end (role kept until the period ends);
  - failed daily card (role gone after 2 h);
  - full refund (role removed);
  - dispute with card `4000000000000259` (access suspended; winning it restores access);
  - Lifetime (Academy Student + Monarch, NOT Elite; a live Academy plan is set to cancel at period end; with a live Elite Monthly Access plan on the same account, that plan keeps renewing and Elite stays);
  - Monarch rules, with a test account that does NOT hold Monarch and has
    no Upgrade.Chat upgrade: Lifetime grants Monarch, a full refund removes
    it; with an account that already holds Monarch: Lifetime adds Academy
    Student only, and the refund leaves Monarch alone. With an account that
    pays Upgrade.Chat for any product (even a hidden one), the refund leaves
    Monarch alone (`kept_external`). Cancel that Upgrade.Chat purchase, wait
    until it has run out (or use
    `external-review --state kept_external --recheck --apply --actor owner`):
    the Monarch the engine gave is removed once Upgrade.Chat shows nothing
    active. The same rules hold for Monarch and Elite on Elite Lifetime
    Access. `external-review --state all` shows the rows;
  - the memberships, each with a fresh test account:
    - Free Trial Access: `/buy` says "3 days free, no card needed, stops by
      itself"; Checkout asks for no card (screenshot Checkout's order
      summary for the legal review: it shows "3 days free, then $7.90 per
      day"); Elite within 10 s; the subscription shows "Cancels" 10 minutes
      before its 3-day trial ends. Advance the test clock 3 days: it is
      cancelled without an invoice and Elite goes. Repeat on a fresh test
      account whose test Customer gets a default card in the Dashboard
      right after checkout: still cancelled, never invoiced;
    - the same account then sees Elite Monthly Access WITHOUT a trial ("This
      Discord account already used its free trial...") and Checkout charges
      $89.90 at once; Free Trial Access shows "Free" and "...This offer is
      only a free trial, so it is not available again." with no button;
    - the safety net: a fresh test account with a default card, the engine
      stopped (or preflight blocked) for the whole trial; advance the test
      clock just past the 3 days, start the engine within the hour: the
      subscription is cancelled and its draft $7.90 invoice is never
      collected (audit `free_trial_stop_missed`);
    - another account: Elite Monthly Access shows "7-day free trial, then
      $89.90/month; one free trial per Discord account"; Elite during the
      trial; advance the clock past 7 days: $89.90 is charged and Elite
      stays. With the card `4000000000000341` the charge at the trial end
      fails and Elite goes at once;
    - Elite Lifetime Access: Monarch + Elite, no Academy Student; a live
      Elite Monthly Access plan on the same account is set to cancel at
      period end;
  - Lifetime by bank (test routing `110000000`, enter the account number by
    hand, confirm with the descriptor code `SM11AA`):
    - `000000000009` stays processing: no role, `/buy` says the bank payment
      is processing and sells nothing;
    - `000123456789` succeeds: Academy Student + Monarch (no Elite);
    - `000222222227` fails: no role, the intent is `failed` in the audit;
    - `000555555559` succeeds, then is disputed: roles removed;
  - a Discord account that is NOT in the server: `/buy` shows the invite and
    "Add me to the server"; after paying, the thank-you page shows the invite
    and says the roles wait; "Add me" (or joining by the invite) adds the
    role within a minute;
  - leave the server with a paid test account and rejoin: a click on `/buy`
    (or a hub button) gives the roles back within a minute;
  - a test account banned from the server (unban it afterwards): `/buy` says
    "This Discord account cannot join the server" and sells nothing;
  - the daily plan stops after 3 charges.
- [ ] Check `SML_ACADEMY_BILLING_PROXY_HOPS`. The right-most `X-Forwarded-For`
      entry of your own request must be your own address; if it is not, raise
      the value.
- [ ] `node scripts/academy-billing.js audit verify` and `status` are clean.
- [ ] Test purchases grant REAL roles in the live guild. Before leaving
      stage A:
  - end every test purchase (refund it or cancel it);
  - confirm that nobody but you holds `Academy Student`, and that
    `external-review --state all` shows no test member still `engine_granted`;
  - after switching to live values, run
    `node scripts/academy-billing.js purge-test --apply --actor owner`.

### Stage B: live dry run (24-48 h)
ACADEMY: switch all test values to live at the same time. Change these:

| variable | value |
| --- | --- |
| `SML_ACADEMY_BILLING_STRIPE_KEY` | `rk_live_...` |
| `SML_ACADEMY_BILLING_WEBHOOK_SECRET` | the LIVE endpoint's `whsec_...` |
| `SML_ACADEMY_BILLING_PORTAL_CONFIG_ID` | the live `bpc_...` |
| `SML_ACADEMY_BILLING_PRICES_JSON` | the live price ids |
| `SML_ACADEMY_BILLING_LIVEMODE` | `1` |
| `SML_ACADEMY_BILLING_TEST_CLOCK` | `0` (it must be 0 with LIVEMODE=1, or the engine stays off) |
| `SML_ACADEMY_BILLING_CHECKOUT_ENABLED` | `0` |
| `SML_ACADEMY_BILLING_ROLE_MODE` | `dry_run` |
| `SML_ACADEMY_BILLING_REVOKES_ENABLED` | `0` |
| `SML_ACADEMY_BILLING_RECONCILE_MODE` | `dry_run` |

- [ ] Disable the test-mode webhook endpoint (its events no longer verify).
- [ ] `status` and the reconcile runs show 0 planned revokes and no errors.

**Gate before stage C.** All of these must be done:
- stage 0 is set;
- stage A passed;
- the terms are live and the consent version is set;
- the parity answer is recorded;
- competing lifetime offers are closed or repriced;
- the bot role sits above Monarch, Elite and Premium.

### Stage C: sell and grant, no removals

| service | variable | value |
| --- | --- | --- |
| ACADEMY | `SML_ACADEMY_BILLING_ROLE_MODE` | `enforce` |
| ACADEMY | `SML_ACADEMY_BILLING_CHECKOUT_ENABLED` | `1` (works only while ROLE_MODE=enforce) |
| ACADEMY | `SML_ACADEMY_BILLING_REVOKES_ENABLED` | `0` |
| ACADEMY | `SML_ACADEMY_BILLING_RECONCILE_MODE` | `dry_run` |
| ACADEMY | `SML_ACADEMY_ACCESS_ROLE_IDS` | `<STUDENT>` (hub slash commands) |
| API | `SML_ACADEMY_ALERTS_TIERING` | `1` (set FIRST: Academy plans see closed-alert case studies only) |
| API | `SML_ACADEMY_BILLING_LIFETIME_ROLE_ID` | leave unset (Lifetime = Monarch = member tier, live alerts) |
| API | `SML_ACADEMY_ACCESS_ROLE_IDS` | `<STUDENT>` (Activity sign-in) |
| API + ACADEMY | `SML_ACADEMY_MONARCH_ACCESS` | leave unset (`1`): Lifetime buyers are admitted through Monarch |
| API + ACADEMY | `SML_ACADEMY_MEMBER_ROLE_IDS` | only if you chose to include Premium/Elite |

- [ ] Buy the cheapest package yourself. You should get the role within 10 s,
      an audit row, and sign-in to the Activity as `academy` tier.

### Stage D: removals on
After one clean reconcile run with 0 unexpected revoke candidates, tell staff
that `Academy Student` added by hand without a comp will be removed (Monarch,
Elite and Premium never are, unless the engine itself gave them). Then set:

| service | variable | value |
| --- | --- | --- |
| ACADEMY | `SML_ACADEMY_BILLING_REVOKES_ENABLED` | `1` |
| ACADEMY | `SML_ACADEMY_BILLING_RECONCILE_MODE` | `apply` |

- [ ] Once a week: `node scripts/academy-billing.js external-review`.
  - A `needs_review` row is an engine-given Monarch/Elite/Premium the engine
    did NOT remove (Upgrade.Chat unreachable, not configured or still
    charging a renewal, or the member had the role before). Check the member
    in Upgrade.Chat. If the role should go, remove it by hand (the row then
    settles as `revoked`, or `released` for a role the member had before).
    If it should stay, run `external-review --keep --discord <id> --role <id>
    --reason "..." --apply --actor owner`. If Upgrade.Chat was the problem, fix
    it and run `external-review --recheck --apply --actor owner`.
  - A row with `revokeUnfinished: true` is a removal whose DELETE did not
    land (the bot role was below Monarch, or revokes were off for a while).
    Fix the cause; the engine retries it by itself, and `--recheck --apply
    --actor owner` does it now.

### Stage E: free tier, content gate and in-Discord buy links
Do this only after the parity question is settled. If Discord SKUs are
required, phase-2 item 2 must be built first.

| service | variable | value |
| --- | --- | --- |
| API | `SML_ACADEMY_FREE_SESSIONS` | `1` (roleless guild members get a free session) |
| API | `SML_ACADEMY_CONTENT_GATE_ENABLED` | `1` (free preview `M0,M29:1-10`, symbols `SPY,QQQ`, MEM ALGO Day teaser) |
| API | `SML_ACADEMY_BILLING_PUBLIC_URL` | `https://ACADEMY` |
| API | `SML_ACADEMY_BILLING_IN_DISCORD_LINKS` | `1` |
| ACADEMY | `SML_ACADEMY_BILLING_IN_DISCORD_LINKS` | `1` |
| ACADEMY | `SML_ACADEMY_HUB_ROLE_GATE` | `1` |

- [ ] `SML_ACADEMY_GUILD_ID` must be the same on the API and ACADEMY, otherwise
      `/start` refuses the hand-off codes.
- [ ] Keep `SML_ACADEMY_BILLING_SEEN_NOTIFY` at `0`. Its API side is not built.

### The Making Easy Money memberships (Upgrade.Chat mirrors)
The five store products are in the Stripe list and the PRICES_JSON above,
sold WITHOUT the Academy. `/buy` shows them under "Memberships (without MEM
Academy)" with their Stripe product names:
- Elite Lifetime Access: "$7,490.90 once".
- Elite Yearly Access, Elite Monthly Access, Elite Week Seat: the price, and
  "7-day free trial, then $849.90/year" ("$89.90/month", "$34.90/week")
  "; one free trial per Discord account".
- Free Trial Access: "Free" and "3 days free, no card needed, stops by itself".
- An account that already used its free trial (on any product, the Academy
  included) sees the plain price and this note:
  "This Discord account already used its free trial, so this plan starts with a charge today."
  Checkout then has no trial. Free Trial Access is not offered to that
  account at all: its card says "This Discord account already used its free
  trial. This offer is only a free trial, so it is not available again."
  with no button (it is never sold as the $7.90 daily plan).
- A member who already holds Elite or Monarch (from Upgrade.Chat or staff)
  keeps it whatever happens here: the engine records it as `held` and never
  removes it. One whose purchase here ends keeps the Elite/Monarch the
  engine gave while Upgrade.Chat shows any active upgrade for them (checked
  again once a day; removed when nothing is active any more).
- To add another membership later (Premium Member `939031140679970867`, for
  example): a Stripe product with metadata `sml_kind` = `mem_academy` and
  its prices, then one entry per price, for example
  `"price_PREMIUMMONTH":{"package":"monthly","academy":false,"roles":["939031140679970867"]}`
  (add `"trialDays":7` for a free trial). Each line may have one `sell:true`
  price per package.

### Kill switches (ACADEMY unless noted)
- Stop new sales: `SML_ACADEMY_BILLING_CHECKOUT_ENABLED=0`.
- Stop every Discord write: `SML_ACADEMY_BILLING_ROLE_MODE=dry_run`. This also
  closes checkout. When `enforce` returns, every member who was resynced in the
  meantime is re-checked, 25 per minute.
- Stop removals: `SML_ACADEMY_BILLING_REVOKES_ENABLED=0`. A Monarch/Elite/
  Premium removal it held back is asked again (Upgrade.Chat) and sent once
  you set it back to `1`.
- Stop the sweep: `SML_ACADEMY_BILLING_RECONCILE_MODE=off`.
- Stop the engine: `SML_ACADEMY_BILLING_ENABLED=0`. Webhooks are then stored as
  `deferred`; replay them later with
  `node scripts/academy-billing.js replay-deferred --apply --actor owner`.
- Back to today's Activity gate: on the API, unset
  `SML_ACADEMY_ACCESS_ROLE_IDS`, `SML_ACADEMY_MEMBER_ROLE_IDS`,
  `SML_ACADEMY_BILLING_LIFETIME_ROLE_ID` and every `SML_ACADEMY_*` gate flag.
  Monarch and the manager role are then the only ones admitted.
- Code rollback: revert the merge. The 028 tables can stay.
  `node db/migrate.js down 028 --yes` destroys the comps, consent proof,
  audit trail and the Monarch/Elite/Premium ledger, so use it only with a
  backup.

## 3. Phase 2 (not built)
1. **Legacy verified-payer roster.**
   - Import the paying members from Upgrade.Chat (including PayPal),
     Substack, manual Stripe and "MEM MEMBERSHIP", matched to Discord ids.
     Count only paid invoices in the current period; Whop and Telegram never
     count.
   - Add an "Already paying? Verify" flow.
   - Once it exists, `SML_ACADEMY_MONARCH_ACCESS=0` can drop the bare Monarch
     role safely. Lifetime buyers would then need their own Activity access
     (an access role or a comp).
2. **Discord Premium Apps SKUs.**
   - An "Academy Monthly" user subscription and a Lifetime durable at
     prices identical to Stripe.
   - The engine adapter: `SML_ACADEMY_BILLING_DISCORD_SKUS_*` are parsed
     today but have no effect.
   - A nightly List Entitlements re-check, because a Durable chargeback does
     not fire an entitlement delete.
3. **Reminders.**
   - Yearly renewal notice 15-45 days before renewal (California), plus an
     annual reminder.
   - 7 days before 3- and 6-month renewals; 24 h before weekly renewals
     (email, or a Discord DM only with recorded opt-in).
   - 7-30 days before any price change.
   - A post-purchase acknowledgement email.
   - Until these exist, use Stripe's upcoming-renewal emails (account-wide) or
     send them by hand.
4. **Smaller follow-ups.**
   - The API `pg_notify('mem_academy_seen')` on an Activity role miss.
   - Server-side grading of free-preview quizzes (their answers are still sent
     to free callers).
   - A stream ticket so paid users get `/stream` on every symbol.
   - Exclude dead-lettered rows from the Connect role-status queue count
     (`connect-adapter.js`), and add a `billingDead` counter in `worker.js`.
   - Deliver the Lifetime roles in the new server `1547568823920623658` if the
     terms name it.
