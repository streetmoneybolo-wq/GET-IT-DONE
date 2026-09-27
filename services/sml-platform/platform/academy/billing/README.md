# MEM Academy billing engine

Sells MEM Academy packages through **Stripe on the Making Easy Money account**
(`acct_1ND1yGBpqyUyWsXe`) and turns each purchase into Discord roles in the MEM
guild (`938894329076940820`). It runs inside the `making-easy-money-academy`
Render service (`platform/academy/server.js`), next to the Academy bot.

Every package gives the Academy **and** the same length of paid Making Easy
Money Discord access: both ride on the engine-owned `Academy Student` role,
which the owner gives Premium-level channel access. Lifetime also grants the
existing **Monarch** role, and only Monarch: never **Elite Member** (owner
correction 2026-09-26). Next to the Academy it sells
the Making Easy Money memberships of the Upgrade.Chat store **without** the
Academy (owner request 2026-09-26): Elite Lifetime Access, Elite Yearly
Access, Elite Monthly Access, Elite Week Seat and Free Trial Access, with
their free trials (one free trial per Discord account). Upgrade.Chat keeps
selling too. See "Stripe products and prices (owner list)", "Free trials and
auto-stop" and "Per-price roles and memberships".

Every switch defaults OFF. Merging this code changes nothing in production
until the owner sets the env below.

## How it decides

* **Stripe is the source of truth.** A webhook event, the success page, the
  60-second due-scan, the 15-minute reconciler and the CLI all do the same
  thing: `resync(discordId)`. That call reads a fresh Stripe snapshot of the
  member's engine-created Customer (subscriptions, payment intents and charges
  paged to the end, the newest paid invoice of each live plan, disputes on any
  disputed charge), adds comps, and runs the pure `computeAccess()`.
* **Access is a union.** A role is removed only when no source grants it
  (a plan, a lifetime purchase, a comp, later a Discord SKU).
* **Engine roles vs external roles.** The engine OWNS `Academy Student`
  (`academy`) and, only if `SML_ACADEMY_BILLING_LIFETIME_ROLE_ID` is set (the
  owner decided to leave it unset), a lifetime role (`mem_lifetime`): those
  follow strict desired state (granted while a source entitles them, removed
  when none does). Monarch `1260433215189946420`, Elite
  `1192450618485395466` and Premium `939031140679970867` can never be an
  engine role; a price may grant them only as **external roles**
  (`SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS`), which are
  GRANT-ONLY-UNLESS-SAFE (see "External roles"). Free Trial
  `1542090070553526362`, FREE MEMBER `1553281948527362100`, the manager role
  and `SML_ACADEMY_BILLING_PROTECTED_ROLE_IDS` can never be granted at all.
  The applier throws before any request if a row ever names another role.
* **Fail closed for revokes.** Any Stripe error or truncated list, a binding
  conflict, or a Stripe account that preflight has not confirmed means grants
  may proceed but no revoke is written; the member is re-checked in 5 minutes.
  The applier also refuses to send a revoke while preflight has not confirmed
  the Stripe account (a key on the wrong account makes every Customer 404,
  which reads as "no purchases"): only grants are claimed until it passes.
* **Stripe rules never wait on Discord.** A Discord member lookup that is not
  `200` or `404 Unknown Member` skips only the role part: the access cache
  and the Stripe rules (daily cap, lifetime supersede, refund / lost-dispute
  cancel) still run, then the error is rethrown and the role part retried.
* **Unconfigured prices still entitle.** A subscription on a price missing
  from `SML_ACADEMY_BILLING_PRICES_JSON` whose Stripe **product** has metadata
  `sml_kind=mem_academy` entitles (package inferred from the interval,
  one-time -> lifetime), is audited `config_unmapped_price`, and can never cause
  a revoke.
* **Race-free outbox.** `academy_billing_role_state.generation` is bumped on
  every desired change; the applier finishes with a compare-and-set on the
  generation it claimed, so a newer desired state is never overwritten. The
  resync's Discord read happens before its transaction and may predate an
  in-flight call, so a queued row (`pending` / `awaiting_member`) is never
  marked `synced` from it: a flip of a queued row queues an idempotent
  PUT/DELETE that repairs whatever the superseded call did.

| Rule | Behaviour |
| --- | --- |
| active / trialing | the price's roles (a free trial entitles like a paid period) |
| free trial | offered only to a Discord account that never had one, on any product (see "Free trials and auto-stop"); a trial that ends without payment (cancelled for a missing payment method, `incomplete_expired`, or `past_due` while no invoice of it was ever paid, in any period) ends access at once, with no grace |
| cancel at period end | kept until the period ends (+2 h check) |
| past_due | kept until period start + grace: daily 2 h, weekly 12 h, others 72 h (per-price `graceHours` 0-168) |
| unpaid, paused, incomplete, incomplete_expired, canceled | no access |
| charge that paid the CURRENT period fully refunded | that plan stops counting (partial refunds only with `PARTIAL_REFUND_REVOKES=1`) |
| open dispute on ANY charge of the customer | every Stripe source suspended (comps still grant); won -> restored; lost -> that source void, and a plan it voided that still renews is cancelled (`CANCEL_ON_REFUND=1`) or flagged `stripe_cancel_required` once |
| lifetime paid | `Academy Student` plus the lifetime price's `roles` (the Academy Lifetime: Monarch only; Elite Lifetime Access: Monarch and Elite, without `Academy Student`), for good; removed only by a full refund or a lost dispute (Monarch and Elite only under the external-role rule) |
| lifetime paid by bank debit (ACH) | nothing while the PaymentIntent is `processing` (up to four business days) or waiting for microdeposit verification; its roles once it is `succeeded`; a debit that fails grants nothing; a debit returned after it cleared arrives as a dispute and removes them (see "Payment methods per price") |
| external role (Monarch / Elite / Premium) | granted while any source lists it; removed only if the engine granted it to a member who did not hold it before AND Upgrade.Chat has no active membership for it (see "External roles") |
| auto-stop (`cancelAfterDays`) | the engine sets `cancel_at = subscription start + N days`, idempotently (an Academy-line daily price: 3 by default, so the Day plan makes at most 3 charges; a membership daily price has no default); for a trial price the start is the trial start; a free-only trial (its trial is at least N days: Free Trial Access) is set to end 10 minutes before its trial end, so Stripe never invoices it, even with a saved card; a trial first seen after its stop time (but before its trial end) is cancelled at once; one Stripe already converted (the engine missed the whole trial) is cancelled before its first invoice is collected, or, once charged, set to end and flagged for a refund |
| lifetime bought while a plan renews | the engine sets `cancel_at_period_end=true` on every live plan the lifetime fully covers (no refund): every Academy plan for the Academy Lifetime, and every membership plan whose roles the lifetime also gives. Elite Lifetime Access covers the Elite plans; the Academy Lifetime gives Monarch only, so it covers no Elite plan: a member's Elite Yearly / Monthly / Week plan keeps renewing. `/buy` and the consent text say so before checkout |
| comp | until `expires_at` (CLI only) |
| buying a second plan | a plan of the same line that is active, trialing, past_due, unpaid, paused or incomplete sends the buyer to Manage billing; one that gives no access (refunded period, lost dispute) and is already set to end does not block, and neither does a free trial set to stop before its trial ends (Free Trial Access: it can never charge). `/buy` says "Access active" only while access is granted, otherwise "Your plan needs attention" |

## Packages and prices

Prices live **only** in Stripe and in `SML_ACADEMY_BILLING_PRICES_JSON`; there
are no amounts in code. Owner prices (decided 2026-09-26; everyone pays the
same price: no introductory price, no member discount).

**The Academy line** (every package includes MEM Academy):

| package | Stripe price shape | owner price | grants | payment methods |
| --- | --- | --- | --- | --- |
| `daily` | recurring day x1 | $11.00 (3-charge cap) | Academy + Discord paid access, 1 day | card, Link |
| `weekly` | recurring week x1 | $40.00 | Academy + Discord paid access, 1 week | card, Link |
| `monthly` | recurring month x1 | $120.00 | Academy + Discord paid access, 1 month | card, Link |
| `quarterly` | recurring month x3 | $300.00 | Academy + Discord paid access, 3 months | card, Link |
| `semiannual` | recurring month x6 | $540.00 | Academy + Discord paid access, 6 months | card, Link |
| `yearly` | recurring year x1 | $960.00 | Academy + Discord paid access, 1 year | card, Link |
| `lifetime` | one-time | $9,200.00 | Academy + Discord paid access + **Monarch**, for good (not Elite Member) | card or US bank account (ACH Direct Debit) |

**The Making Easy Money memberships** (`academy:false`, the Upgrade.Chat store
products of 2026-09-26, without MEM Academy; `/buy` shows them under
"Memberships (without MEM Academy)" with the Stripe product name, which
mirrors the Upgrade.Chat name without emoji):

| name on /buy | package | Stripe price shape | price | free trial | grants | Upgrade.Chat product |
| --- | --- | --- | --- | --- | --- | --- |
| Elite Lifetime Access | `lifetime` | one-time | $7,490.90 | none | Monarch + Elite Member, for good | `cf67da72-e309-4db5-bbf8-13e7f42ba02e` |
| Elite Yearly Access | `yearly` | recurring year x1 | $849.90 / year | 7 days (card) | Elite Member | `bf0eb1e8-c034-4eaa-b8f7-3633bdbff989` |
| Elite Monthly Access | `monthly` | recurring month x1 | $89.90 / month | 7 days (card) | Elite Member | `5afb4ebb-fb6c-428a-982e-b38b06b2363a` |
| Elite Week Seat | `weekly` | recurring week x1 | $34.90 / week | 7 days (card) | Elite Member | `a5749691-20f6-4cda-8554-d1e94a1ff80c` |
| Free Trial Access | `daily` | recurring day x1 | $7.90 / day | 3 days, no card; stops by itself, never charged | Elite Member | `43012a04-dbf2-4919-af73-b265eb04cb7a` |

Monarch is `1260433215189946420`, Elite Member `1192450618485395466`. The
Upgrade.Chat product ids are for reference (and for
`SML_ACADEMY_BILLING_UC_MATCH=mapped`); the default `any` rule needs none of
them. Free Trial Access mirrors the Upgrade.Chat copy ("auto-cancels after 3
days") and is a plain 3-day free trial (owner decision 2026-09-26, "3 DAY"):
`trialDays` 3 with `trialNoCard` and `cancelAfterDays` 3 is three free days
without a card that stop by themselves and are never charged. The engine
ends it 10 minutes before its trial end (see "Free trials and auto-stop").

The Discord paid access of every Academy package is the `Academy Student`
role (the owner gives it Premium-level channel access), so it lasts exactly
as long as the plan. Lifetime's Monarch comes from its `roles` (Monarch
only; Elite Member comes with Elite Lifetime Access and the Elite
memberships, never with the Academy Lifetime). The complete, ready-to-fill `SML_ACADEMY_BILLING_PRICES_JSON` (replace each
`price_...` placeholder with the Stripe price id; one line per entry is fine,
it is one JSON object):

```json
{"price_DAY":{"package":"daily","cancelAfterDays":3},
 "price_WEEK":{"package":"weekly"},
 "price_MONTH":{"package":"monthly"},
 "price_3M":{"package":"quarterly"},
 "price_6M":{"package":"semiannual"},
 "price_YEAR":{"package":"yearly"},
 "price_LIFETIME":{"package":"lifetime","roles":["1260433215189946420"],"paymentMethods":["card","us_bank_account"]},
 "price_ELITELIFE":{"package":"lifetime","academy":false,"roles":["1260433215189946420","1192450618485395466"]},
 "price_ELITEYEAR":{"package":"yearly","academy":false,"roles":["1192450618485395466"],"trialDays":7},
 "price_ELITEMONTH":{"package":"monthly","academy":false,"roles":["1192450618485395466"],"trialDays":7},
 "price_ELITEWEEK":{"package":"weekly","academy":false,"roles":["1192450618485395466"],"trialDays":7},
 "price_FREETRIAL":{"package":"daily","academy":false,"roles":["1192450618485395466"],"trialDays":3,"trialNoCard":true,"cancelAfterDays":3}}
```

(`"cancelAfterDays":3` on the Day plan is also its default; it is spelled out
so the cap is visible.) Elite Lifetime Access uses card and Link like every
price without its own `paymentMethods`; to offer the US bank debit on it too
(a $7,490.90 card payment also costs about $217 in fees), add
`"paymentMethods":["card","us_bank_account"]` to its entry.

Only one `sell:true` price per package in the Academy line (`sell` defaults
to `true`; each membership has its own line, see "Per-price roles and
memberships"). Never
delete an entry; retire it with `"sell": false` (its buyers and subscribers
stay recognised). To change a price, create a new Stripe price, add it with
`sell:true` and set the old entry to `sell:false` in the same edit.

### Payment methods per price

Each entry may carry `"paymentMethods"`, the Checkout `payment_method_types`
for that price. Allowed values: `card`, `link`, `us_bank_account` (anything
else, an empty list or a repeat stops the engine at config load with
`academy_billing_config_invalid`). An entry without it uses
`SML_ACADEMY_BILLING_PAYMENT_METHODS` (default `card,link`, instant methods
only; a value that lists nothing, such as `,`, or repeats a method is refused
too). An entry may carry only `package`, `sell`, `graceHours`,
`paymentMethods`, `roles`, `academy`, `trialDays`, `trialNoCard` and
`cancelAfterDays`: any other key is refused, so a typo
such as `payment_methods` cannot silently drop the bank option. The engine always
sends an explicit, non-empty `payment_method_types`, never Stripe's dynamic
payment methods, and `buildCheckoutParams` throws
(`delayed_method_on_subscription`) if a bank debit ever reaches a recurring
package, before anything in Stripe is touched.

`us_bank_account` (ACH Direct Debit) is accepted **only on a `lifetime`
price**. At $9,200 a card payment costs about $267 in fees and is often
declined, so the owner decided that Lifetime also offers a US bank debit (see
Stripe pricing for the ACH fee). A bank debit is a *delayed* method, and
Stripe turns a subscription `active` before its first bank debit clears, so
the plans (especially daily and weekly) stay card and Link only; config
refuses the bank on them.

How a bank-paid Lifetime runs:

* Checkout sends `payment_method_options[us_bank_account][verification_method]=automatic`:
  the buyer links the bank instantly through Stripe Financial Connections, or
  types the account number and confirms it with microdeposits (Stripe emails
  them; they have 10 days). `instant` was not chosen because it turns away
  every buyer whose bank Financial Connections cannot reach.
* The Checkout Session completes with `payment_status: unpaid` and the
  PaymentIntent is `processing` for up to four business days (or
  `requires_action` / `verify_with_microdeposits` until the account is
  confirmed). **No role is granted in that time.** `/buy` says so before
  checkout ("Bank payments (ACH) take a few business days to clear. Your
  access starts when the payment clears."), the success page says the same,
  and `/buy` sells nothing more to that member until the debit settles, so a
  second debit is never started next to the first.
* Access starts when the PaymentIntent is `succeeded`: on
  `checkout.session.async_payment_succeeded` (the intent becomes `completed`,
  audited `intent_completed`), or, if that webhook is late, on the member's
  hourly re-check while the debit is pending (due-scan), a success-page
  reload, or the reconciler in `apply` mode (it finds succeeded lifetime
  PaymentIntents by search).
* A debit that fails before clearing: `checkout.session.async_payment_failed`
  marks the intent `failed` (audited `intent_failed` with the event id);
  `charge.failed` / `payment_intent.payment_failed` trigger a resync, which
  grants nothing because the PaymentIntent is not `succeeded`.
* A debit returned **after** it cleared (insufficient funds, wrong account
  details, a bank that cannot process it, or the customer disputing it as
  unauthorized, generally up to 60 days on a personal account) is reported by
  Stripe as a **dispute** on the charge (Stripe sends `charge.dispute.closed`
  for a customer's ACH dispute; `charge.dispute.created` is subscribed too).
  The normal dispute rule removes its roles through resync (open ->
  suspended, lost -> void). A lifetime charge that ever reads `failed` after
  its PaymentIntent succeeded is also treated as unpaid.
* Preflight **warns** (never fails) for every `sell:true` price that lists
  `us_bank_account`: `us_bank_account_needs_ach_direct_debit_enabled_on_the_stripe_account`
  and `us_bank_account_checkout_sends_verification_method_automatic`, plus
  `us_bank_account_ach_payments_capability_<status>` when the account read
  shows that capability not `active`. Without ACH Direct Debit turned on,
  Stripe refuses to create the Lifetime Checkout Session (the buyer sees
  "We could not start checkout").
* Turning ACH on in the Dashboard's **Default** payment method configuration
  is account-wide: every MEM checkout, Payment Link or hosted invoice page
  that relies on dynamic payment methods (store, Creator Tiers, subdomains)
  starts offering bank debits too, and may deliver before the money clears.
  Turn it on in a separate configuration (keeping the Default one off), or
  limit it with a payment method rule, or confirm those integrations first
  (see `LAUNCH.md`). Stripe also sets per-payment and weekly ACH limits on
  the account; confirm a $9,200 debit fits.
* While an open dispute (for a bank debit also a return or an authorization
  inquiry) suspends a paid Lifetime, `/buy` says it is paused instead of
  "Access active" and still sells nothing.

### Per-price roles and memberships

Two more optional keys per `SML_ACADEMY_BILLING_PRICES_JSON` entry:

* `"roles"`: EXTERNAL role snowflakes the price grants while it entitles the
  member (the Academy Lifetime: `["1260433215189946420"]`, Monarch only;
  Elite Lifetime Access: `["1260433215189946420","1192450618485395466"]`,
  Monarch and Elite Member). Every id must be in
  `SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS` (default Monarch, Elite, Premium);
  Free Trial, FREE MEMBER, the manager role, `PROTECTED_ROLE_IDS` and the
  engine's own roles are refused at config load. At most 10, no repeats.
* `"academy"` (default `true`): also grant `Academy Student` (and on a
  lifetime price the optional lifetime role). A pure membership product sets
  `false` and must list at least one role.

Each price sells in a **line**: the Academy line (`academy:true`), or one line
per role set of the memberships. At most one `sell:true` price per package
**per line**, so the Academy Monthly and the Elite Monthly Access can both be
on sale. The store memberships make two lines: Elite Lifetime Access (Monarch
+ Elite) and the Elite line (yearly, monthly, weekly and the daily Free Trial
Access). `/buy` shows the Academy packages first, then "Memberships (without
MEM Academy)"; a membership card posts its price id. The duplicate guard is
per line (an active Elite plan never blocks the Academy, and vice versa), a
lifetime covers only what it grants (Elite Lifetime Access, Monarch + Elite,
makes itself and every Elite plan "owned", not a Premium one; the Academy
Lifetime, Monarch only, makes no Elite membership "owned", so its buyer can
still buy Elite Lifetime Access or an Elite plan), and "lifetime supersedes
plans" only cancels plans whose grants the lifetime fully covers (Elite
Lifetime Access sets a renewing Elite plan to end at its period end; the
Academy Lifetime ends Academy plans only and leaves a renewing Elite plan
alone). All of this follows from each price's `roles`; nothing in the engine
names Monarch or Elite for a price. The consent
text names what each offer grants; a membership says it does not include MEM
Academy. The membership's Stripe product needs the same metadata
`sml_kind` = `mem_academy`, and its product name is the label on `/buy`.

Each store membership is one entry (see the complete example above). A later
product works the same way, for example a Premium monthly (Premium Member
`939031140679970867`):
`"price_PREMIUMMONTH":{"package":"monthly","academy":false,"roles":["939031140679970867"]}`.
Never delete an entry: a lifetime keeps the roles of the price it was bought
on.

### Free trials and auto-stop

Three more optional keys per entry, recurring prices only (a lifetime entry
with any of them is refused at config load):

* `"trialDays"` (integer 1-30): the free trial the price offers.
* `"trialNoCard"` (`true`/`false`, default `false`, needs `trialDays`): start
  the trial without collecting a payment method.
* `"cancelAfterDays"` (integer 1-365): the engine stops the subscription N
  days after it starts. Unset on an Academy-line daily price (`academy`
  true) means 3 (the Day plan's 3-charge cap, as before); unset elsewhere,
  a membership daily price included, means no auto-stop. An Academy daily
  price whose default 3 would fall inside its own trial (`trialDays` 3 or
  more without `cancelAfterDays`) is refused at config load: a free-only
  offer must say `cancelAfterDays` itself, like Free Trial Access. A price
  whose `trialDays` is at least its `cancelAfterDays` is a free-only offer:
  it never charges (see the auto-stop below).

**One free trial per Discord account, across every product and package.**
Checkout offers a price's trial only when the account has no row in
`academy_billing_trials` AND no subscription on its Stripe Customer ever had
a trial (the fresh snapshot every checkout reads). A member with no bound
Customer (a first purchase, or a database restore or rollback that lost the
binding and the ledger) is also looked up in Stripe: every Academy Customer
of that Discord id that Stripe Search finds (the one checkout would adopt)
is read for past trials. That lookup fails closed: if Search or a
subscription list errors or is cut short, no trial is offered, the card on
`/buy` says "We could not check this Discord account's free trial right
now. Reload this page in a minute to buy this plan." with its button off,
and checkout of a trial price answers 503 (a price without a trial still
sells). Otherwise it sells the
same price without a trial: the consent text then has no trial either, and
the card on `/buy` says "This Discord account already used its free trial,
so this plan starts with a charge today." The trial is recorded (audit
`trial_recorded`) the first time a resync sees a subscription with a trial
on the member's Customer (the `customer.subscription.created` webhook, the
success page, the due-scan or the reconciler), never at checkout, so an
abandoned checkout does not use it up. The ledger is kept for good (test-mode
rows only are purged) and is per livemode. Upgrade.Chat has the same rule for
its own trials ("one free trial per user per server"); the two are not
cross-checked.

What checkout sends for a trial: `subscription_data.trial_period_days`; with
`trialNoCard` also `payment_method_collection=if_required` (Checkout asks for
no payment method while nothing is due) and
`subscription_data.trial_settings.end_behavior.missing_payment_method=cancel`
(at the trial end Stripe cancels the subscription only when neither the
subscription nor the Customer has a default payment method; a member whose
engine Customer has a saved default card, for example from an earlier plan
and a card update in Manage billing, would convert and be charged: Stripe
invoices the first period when the trial ends and charges it about an hour
later). So for a free-only offer (Free Trial Access) the engine's auto-stop
is what keeps the "never charged" promise: it ends the subscription 10
minutes before the trial does (below). `payment_method_types` stays the
explicit list. The Session metadata
and the checkout intent carry the trial (`mem_academy_trial_days`,
`trial_days`). Do not set a trial on the Stripe price itself: trials come
only from this config.

While it lasts, a trial entitles like a paid period (`trialing`). A trial
that ends without payment ends access: cancelled for a missing payment
method, `incomplete_expired`, or `past_due` while none of its invoices was
ever paid with money (`trial_ended_unpaid`, no grace hours, in the first
period after the trial AND in every later one: Stripe keeps opening periods
while its retries run). Once one invoice was paid, a later failed renewal
keeps the usual grace. When the paid-invoice read fails, only the first
period after the trial counts as unpaid (and the snapshot is incomplete, so
nothing is removed on it).

The auto-stop sets `cancel_at = subscription start + N days` (with
`proration_behavior=none`) once, after the subscription is created (audit
`auto_stop_set`); a subscription already set to end by then is left alone,
so it is idempotent, and an earlier `cancel_at` is never moved later. For a
trial price "start" is the trial start.

**Free-only trials never reach an invoice (money safety).** A trialing
subscription whose trial covers its whole auto-stop (the trial it has, or
the one its price offers, is at least `cancelAfterDays` days: Free Trial
Access, `trialDays` 3, `trialNoCard`, `cancelAfterDays` 3) gets `cancel_at`
= the earlier of that stop and its `trial_end`, minus a fixed safety margin
of 10 minutes (`TRIAL_STOP_MARGIN_SEC` in `resync.js`). Stripe therefore
cancels it while it is still `trialing` and never creates the first $7.90
invoice, even when the member has a saved default card (the case Checkout's
`missing_payment_method=cancel` does not cover). A `cancel_at` at or after
the trial end (set by anyone) is pulled in to that time; an earlier one is
kept. Stripe's classic billing mode (what the engine's pinned API version
creates) moves `trial_end` onto a `cancel_at` set before it; the engine
treats its own write as final and never chases the moved `trial_end`. A
free-only trial first seen after its stop time but before its trial end
(the engine was off) is cancelled at once (`DELETE`, no proration); any
other late plan is set to end at the end of its paid period. A paid trial
plan (its stop comes after the trial, for example a 2-day trial with the
Day plan's 3-day stop) keeps the exact stop and is charged as its consent
text says. Sources: Stripe docs
`docs.stripe.com/billing/subscriptions/trials/free-trials` (the trial-end
invoice, charged about an hour later; the payment-method check),
`docs.stripe.com/billing/subscriptions/cancel` (a cancelled subscription
generates no invoices; `cancel_at`) and
`docs.stripe.com/billing/subscriptions/billing-mode/compare` (classic moves
`trial_end` to an earlier `cancel_at`).

**Why the engine, and what backs it up.** Checkout cannot set the stop
itself: a Checkout Session's `subscription_data` takes `trial_period_days`,
`trial_end`, `trial_settings`, `billing_cycle_anchor` and `billing_mode`,
but no `cancel_at` (Stripe API reference, checked 2026-09-26). On its own,
Stripe ends a trial only when no payment method exists
(`missing_payment_method=cancel`). The engine sets the stop within seconds
of checkout (the webhook and the success page; with `RECONCILE_MODE=apply`
also the 15-minute reconciler, which lists every trialing subscription of
each configured price). The due scan also re-checks every free-only trial
just before its stop time while the stop is not set, and 5 minutes after
its trial end (`FREE_TRIAL_RECHECK_SEC`), without waiting for any webhook.
So only an engine that is down, or blocked by preflight, for the whole
3 days can miss it. For that case there is a safety net: a free-only trial Stripe
already converted (`active` or `past_due` after its trial end) is cancelled
at once (`DELETE`, no proration) while its first invoice is unpaid. Stripe
then sets `auto_advance=false` on the subscription's draft and open
invoices, so the invoice it drafted at the trial end is never collected
(audit `free_trial_stop_missed`; log `academy_billing_free_trial_stop_missed`,
error). One whose first invoice was already paid (the engine came back more
than about an hour late) is cancelled at once too, so access ends and it is
never charged again, and flagged for a refund (audit `free_trial_charged`,
reason `refund_review`; log `academy_billing_free_trial_charged`, error):
refund the $7.90 in the Dashboard. A failed stop write is logged as
`academy_billing_free_trial_stop_failed` (error, with the seconds left
before the trial end) and retried every 5 minutes; if it still fails in the
last 11 minutes of the trial, the engine cancels the subscription instead.
Alert on these log events.

**Free Trial Access is only ever a free trial.** An account that already
used its free trial (on any product) is not offered Free Trial Access at
all: the card shows "Free" and "This Discord account already used its free
trial. This offer is only a free trial, so it is not available again." with
no checkout button, and a posted form is refused (`free_trial_used`, 409)
before anything reaches Stripe. It is never sold as the $7.90 daily plan.
This holds for every free-only offer (`trialOnly` in `pages.offerTerms`:
the price's own trial covers its `cancelAfterDays`).

The auto-stop runs only while preflight lets the Stripe rules run, and
never on a dry-run pass (the `RECONCILE_MODE=dry_run` sweep of rollout
stages B and C writes nothing to Stripe: there the stop is set by the
webhook, the success page or the due scan). While it cannot run, every
resync of a never-charging trial not yet set to end in time
logs `academy_billing_auto_stop_pending` (warn) for staff, and one Stripe
already converted logs `academy_billing_free_trial_stop_missed` with
`blocked: true` (error). A free trial that stops
before its trial ends can never charge, so it does not block buying a paid
plan of its line (Free Trial Access, then Elite Monthly Access at once,
without a second trial).

What `/buy` shows on a membership card:

| offer | card |
| --- | --- |
| Elite Monthly Access (trial unused) | "$89.90 / month" and "7-day free trial, then $89.90/month; one free trial per Discord account" |
| Elite Yearly Access / Elite Week Seat | the same with "$849.90/year" / "$34.90/week" |
| Free Trial Access (trial unused) | "Free" and "3 days free, no card needed, stops by itself" |
| any other trial price, trial already used | the price and "This Discord account already used its free trial, so this plan starts with a charge today." |
| Free Trial Access, trial already used | "Free" and "This Discord account already used its free trial. This offer is only a free trial, so it is not available again.", with no checkout button |

The consent text (hashed with the consent version) says the same: a trial
that converts is an auto-renewal consent ("Free trial, then automatic
renewal: ... starts with a 7-day free trial. When the trial ends it costs
$89.90 ... One free trial per Discord account."); a trial that stops before
any charge is a `free_trial` consent ("... is free for 3 days and needs no
payment method. It ends by itself after 3 days, does not renew and is never
charged."); an auto-stop names the most charges it allows. Free Trial Access
is never sold to an account whose trial is used (see "Free Trial Access is
only ever a free trial").

What Stripe itself shows for Free Trial Access now has the same length as
that text: the Stripe trial is a plain 3-day trial (owner decision
2026-09-26), so Checkout's order summary says "3 days free, then $7.90 per
day". Stripe does not know about the engine's stop, so it still names the
$7.90 daily price after the trial; the engine stops the subscription 10
minutes before the trial end, before any charge, so access ends about 10
minutes before the 72-hour mark and every text of ours says "3 days". The
engine's own `custom_text` under the pay button and the consent text say
"Free for 3 days ... never charged". Stripe's trial reminder email (when
turned on) goes out as soon as a trial shorter than 7 days begins, before
the engine has set its `cancel_at`, so it can describe the $7.90/day
renewal. Check both Stripe texts in the rehearsal and with legal
(`LAUNCH.md`).

### External roles (Monarch, Elite, Premium)

Upgrade.Chat also manages these roles (Monarch for about 58 members; about 29
Upgrade.Chat products exist, most of them hidden, and many hidden ones still
have paying members that hold Elite, Premium or Monarch), so the engine never
treats them as its own. They are **grant-only-unless-safe**, with
a ledger (`academy_billing_external_grants`) written at the engine's FIRST
grant decision from a live read of the guild member:

| situation | ledger | Discord |
| --- | --- | --- |
| entitled, role missing, no ledger row | `engine_granted`, `had_role_before=false` | PUT |
| entitled, role present, no ledger row | `held`, `had_role_before=true` | nothing; the engine never removes it |
| entitled again after an earlier entitlement ended (`revoked` with its DELETE landed, `kept_external`, `released`) | recorded again from the live read: role present -> `held` (`had_role_before=true`), missing -> `engine_granted` (`had_role_before=false`); a row kept under `UC_MATCH=any` (below) with the role present goes back to `engine_granted` (`had_role_before=false`: the role is still the engine's own) | PUT only when missing |
| no engine source entitles it (union of every price, lifetime and comp), ledger `engine_granted` + `had_role_before=false`, Upgrade.Chat: no active membership (`UC_MATCH=any`: no active upgrade AT ALL) | `revoked` | DELETE |
| same, Upgrade.Chat: an active membership (`any`: any product, hidden ones included; a subscription within its paid period or free trial, or a one-time lifetime order Upgrade.Chat has not ended) | `kept_external` (`mapped`: final; `any`: asked again once a day, see below) | nothing |
| `any` only: a `kept_external` row the engine granted (`had_role_before=false`, last answer `active`, not a staff keep), the member still holds the role, its last Upgrade.Chat answer is 24 h old | Upgrade.Chat asked again: still active -> `kept_external`; no active upgrade at all -> `revoked`; inconclusive -> `needs_review` | DELETE only on `revoked` |
| same, Upgrade.Chat not configured, erroring, too slow or inconclusive (truncated order list, `mapped`: an unmapped role, a subscription whose renewal is still being charged) | `needs_review` + audit + warn log | nothing (fail safe: keep access) |
| same, but the grant is still queued and never reached the member (a buyer refunded or disputed before joining) | follows the Upgrade.Chat answer | the PUT is withdrawn, never delivered (whatever Upgrade.Chat says) |
| same, but the role is already gone (removed by hand) | `revoked` (`released` for a role the member held before) | nothing |
| no ledger row at all | none | never touched (Upgrade.Chat's own holders are invisible) |

* **`SML_ACADEMY_BILLING_UC_MATCH`** picks what "an active Upgrade.Chat
  membership" means:
  * `any` (the default): ANY active Upgrade.Chat upgrade of that Discord
    account keeps the role, whatever the product: hidden products (many still
    have paying members) and one-time lifetime orders included. A revoke is
    allowed only when Upgrade.Chat shows no active upgrade at all; an
    inconclusive answer is `needs_review`, never a revoke. The upgrade
    that keeps a role may grant ANOTHER role (a hidden Premium product
    keeping an engine-granted Elite), so Upgrade.Chat's own bot would never
    remove the kept one: such a `kept_external` row is not final. While the
    member holds the role it is asked again every 24 hours
    (`UC_KEPT_RECHECK_MS`; the due-scan comes back then) and revoked as soon
    as Upgrade.Chat shows no active upgrade at all. A staff keep
    (`external-review --keep`) stays final. Switching to `mapped` makes
    rows kept under `any` final too: review them first with
    `external-review --state kept_external`.
    `SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON` is not needed (a set map is
    ignored, with a config warning). One order list per member and pass,
    whatever number of roles it decides.
  * `mapped`: only the Upgrade.Chat products
    `SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON` lists for that role count (a
    role mapped to `[]` is one no Upgrade.Chat product grants; an unmapped
    role is inconclusive). This was the only rule before 2026-09-26.
* What counts as active: a subscription until its paid-through date (the last
  succeeded charge plus one interval; with no charge yet, at least until its
  free trial ends, in calendar days); a one-time order for good unless
  Upgrade.Chat has ended it. Upgrade.Chat's API has no refund field: a
  refunded or charged-back purchase is one Upgrade.Chat expired (`deleted`
  set), and only that ends a lifetime order (a cancel mark on a one-time order
  does not: fail safe). A time-limited one-time order counts until its
  interval has passed.
* The Upgrade.Chat check reuses `platform/upgrade-chat.js`
  (`createUpgradeChatClient`: `listOrders`, every UPGRADE order of the
  account paged to the end, and in `mapped` mode `findMembership` first) with
  the platform's existing `UPGRADE_CHAT_CLIENT_ID` /
  `UPGRADE_CHAT_CLIENT_SECRET`. It runs
  before the resync transaction, never under a lock; the transaction acts on it
  only if the ledger generation did not change meanwhile (compare-and-set).
  Every Upgrade.Chat request gives up after 8 seconds and the whole check after
  10 (`uc_timeout`, inconclusive), so a hung Upgrade.Chat never holds one of
  the engine's two resync slots. A subscription that is neither cancelled nor
  deleted counts as still renewing for 7 days after its paid-through date
  (`uc_renewal_pending`, inconclusive): a member whose Upgrade.Chat renewal is
  being charged is never read as "no membership".
* A `needs_review` row is re-checked against Upgrade.Chat every 6 hours (the
  member is due then), and under `UC_MATCH=any` a `kept_external` row the
  engine granted every 24 hours (above); `--recheck` forces both. `node scripts/academy-billing.js external-review` lists
  it; `external-review --recheck --apply --actor <label>` re-checks now.
  Removing the role by hand in Discord settles it (the next resync records
  `revoked`, or `released` for a role the member held before); to keep it,
  `external-review --keep --discord <id> --role <id> --reason "..." --apply
  --actor <label>` records `kept_external` (never removed, no more re-checks).
* A role the engine PUT into a member who had held it before (it went missing
  while entitled) keeps `had_role_before=true` and is never removed
  automatically: when the entitlement ends it becomes `kept_external` if
  Upgrade.Chat shows an active membership for it, `released` if it is gone
  anyway, and `needs_review` otherwise.
* Refunds, lost disputes and OPEN disputes of a lifetime or plan follow the same
  rule; a won dispute or a new purchase grants the role again.
* A price missing from the config (or a lifetime bought on one) holds every
  external revoke of that member; `REVOKES_ENABLED=0` suppresses them like any
  other revoke; every fail-closed revoke rule applies too.
* A decided revoke whose DELETE did not land (`failed` after 20 attempts, or
  `suppressed` by `REVOKES_ENABLED=0` between the decision and the applier)
  is an **unfinished revoke**: the reconciler re-checks the member,
  `external-review` lists it (`revokeUnfinished`), and the next resync asks
  Upgrade.Chat again and re-queues the DELETE (or settles it when the role is
  gone). A DELETE that landed and a role that came back from elsewhere
  afterwards are never touched.
* The applier re-reads the ledger right before an external DELETE and refuses it
  (`external_revoke_refused`) unless the row says `revoked` with
  `had_role_before=false`, and it never sends one on an Upgrade.Chat answer
  older than 10 minutes: such a DELETE (one that waited on a 403, a latch, the
  revoke hold or a backoff) waits 5 more minutes while the member is made due,
  and the resync asks Upgrade.Chat again first (a member who paid Upgrade.Chat
  for the role meanwhile keeps it: `kept_external`, the DELETE is cancelled).
  A 403 or Unknown Role on an external role (Monarch above the bot) holds that
  row only (retried every 30 minutes, `role_blocked` audited once); Academy
  Student grants keep flowing.
* The resync reads the outbox before its Discord read; if a row changed by the
  time of its transaction (an applier call finished in between, for example
  during the Upgrade.Chat check), no revoke and no external-role decision is
  taken from that read: the member is looked at again in 5 minutes.
* The reconciler never discovers external-role holders from Discord: it only
  re-checks members whose ledger row says `engine_granted`, or who have an
  unfinished revoke.
* Comps can list external roles too: `comp grant --role <id>[,<id>]`
  (`--no-academy` for a membership-only comp).

### Buyers who are not in the server yet

With `SML_ACADEMY_BILLING_ALLOW_NON_MEMBER=1` a buyer who is not in the MEM
guild can pay; with `SML_ACADEMY_BILLING_AUTO_JOIN=1` `/buy` also offers "Add
me to the server with Discord" (Academy app OAuth with `guilds.join`; the bot
needs **Create Instant Invite**, preflight fails without it). `/buy`, the
success page and the bank-payment pending page always show
`SML_ACADEMY_BILLING_INVITE_URL` to anyone not in the guild. Their roles are
queued as `awaiting_member` and land as soon as they join: the "Add me" join,
a `/buy` visit ("I have joined, continue"), the success-page poll (a membership
re-check at most once a minute), a hub click and the reconciler all make the
waiting grants due at once; otherwise the applier retries after 10 min, 30 min,
2 h, then every 6 h for 90 days. A grant that gave up in that time
(`member_absent_90d`) is queued again by the same signals.

An account **banned** from the server could never get in (the invite and "Add
me" both fail), so `/buy` and `POST checkout` look up the ban of every buyer
who is not in the server and refuse a banned one ("This Discord account cannot
join the server"; nothing reaches Stripe). This needs **Ban Members** on the
bot: without it the lookup answers "unknown", the sale goes on, and preflight
warns `ban_members_missing_banned_non_members_are_not_refused_at_checkout`. A
lookup that fails refuses the checkout for now.

A member who leaves and rejoins loses every role in Discord. The same signals
(a hub click, a `/buy` visit, the "Add me" join) resync a member whose roles
were already delivered, at most once per 10 minutes, and every member with
access is re-read at least once a day (drift repair), so a lifetime buyer gets
Academy Student and Monarch (Elite Lifetime Access: Monarch and Elite) back even
while the reconciler runs in `dry_run`.

## Stripe products and prices (owner list)

Create these in the Making Easy Money account (`acct_1ND1yGBpqyUyWsXe`), in
live mode AND in test mode (the rehearsal). Every product carries metadata
**`sml_kind` = `mem_academy`** (without it the engine refuses to sell the
price: `product_not_academy`). Every price: currency **USD**, standard
per-unit pricing, **Include tax in price: No** (`tax_behavior=exclusive`: the
consent text says "plus any applicable tax"), **no trial on the price** (the
trial comes from `trialDays`), no metered usage. The product name is what
`/buy` shows for a membership, so type it exactly as below, without emoji.

| # | product | price | type | interval | interval_count | amount (cents) | placeholder in PRICES_JSON | engine keys |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | MEM Academy | Day plan | recurring | day | 1 | $11.00 (1100) | `price_DAY` | `cancelAfterDays` 3 |
| 2 | MEM Academy | Week plan | recurring | week | 1 | $40.00 (4000) | `price_WEEK` | |
| 3 | MEM Academy | Monthly | recurring | month | 1 | $120.00 (12000) | `price_MONTH` | |
| 4 | MEM Academy | 3-Month | recurring | month | 3 | $300.00 (30000) | `price_3M` | |
| 5 | MEM Academy | 6-Month | recurring | month | 6 | $540.00 (54000) | `price_6M` | |
| 6 | MEM Academy | 1-Year | recurring | year | 1 | $960.00 (96000) | `price_YEAR` | |
| 7 | MEM Academy | Lifetime | one_time | | | $9,200.00 (920000) | `price_LIFETIME` | `roles` Monarch only, `paymentMethods` card + `us_bank_account` |
| 8 | Elite Lifetime Access | Elite Lifetime Access | one_time | | | $7,490.90 (749090) | `price_ELITELIFE` | `academy:false`, `roles` Monarch + Elite |
| 9 | Elite Yearly Access | Elite Yearly Access | recurring | year | 1 | $849.90 (84990) | `price_ELITEYEAR` | `academy:false`, `roles` Elite, `trialDays` 7 |
| 10 | Elite Monthly Access | Elite Monthly Access | recurring | month | 1 | $89.90 (8990) | `price_ELITEMONTH` | `academy:false`, `roles` Elite, `trialDays` 7 |
| 11 | Elite Week Seat | Elite Week Seat | recurring | week | 1 | $34.90 (3490) | `price_ELITEWEEK` | `academy:false`, `roles` Elite, `trialDays` 7 |
| 12 | Free Trial Access | Free Trial Access | recurring | day | 1 | $7.90 (790) | `price_FREETRIAL` | `academy:false`, `roles` Elite, `trialDays` 3, `trialNoCard`, `cancelAfterDays` 3 |

The same by API, for example row 10: `POST /v1/products` with
`name=Elite Monthly Access` and `metadata[sml_kind]=mem_academy`, then
`POST /v1/prices` with `product=<that id>`, `currency=usd`,
`unit_amount=8990`, `recurring[interval]=month`,
`recurring[interval_count]=1`, `tax_behavior=exclusive`. Row 7 (and row 8
if the owner adds the bank debit to it) needs ACH Direct Debit active on the
account, turned on only in a Lifetime-specific payment method configuration
(owner step 3); the engine lists the payment methods on every checkout
itself. Then paste the twelve price ids over the placeholders of the
complete PRICES_JSON in "Packages and prices".

## Owner steps

1. **Discord roles** (MEM guild `938894329076940820`)
   * Create ONE plain role `Academy Student`: no role permissions, not
     hoisted, not managed, **below** the `Making Easy Money Academy` bot role.
     Do not create a `MEM Lifetime` role (Lifetime grants Monarch through its
     `roles`; leave `SML_ACADEMY_BILLING_LIFETIME_ROLE_ID` unset).
   * Give `Academy Student` **Premium-level channel access** (the same
     category/channel overwrites Premium has, plus the Academy category
     `1551448153276944405`): that is the paid Discord access every package
     includes. The role itself keeps no permissions. Never run
     `scripts/setup-academy-channels.js --apply`. Keep `Academy Student` out of
     the WordPress group-7 role map.
   * Drag the Academy bot role **above Monarch (position 17 today), Elite and
     Premium**: the engine grants Monarch with Lifetime, Monarch and Elite
     with Elite Lifetime Access, and Elite with the Elite memberships; a role
     above the bot answers 403. Preflight warns
     `external_role_not_below_bot:<id>` until it is fixed.
   * Turn on **Manage Roles**, **Create Instant Invite** (the "Add me to
     the server" join, `AUTO_JOIN`) and **Ban Members** (read-only: checkout
     refuses an account banned from the server, since buyers who are not in
     it can pay) for the Academy bot role. Optional: View Audit Log (finds
     hand-added engine roles).
   * Never make Premium, Elite or Monarch the Academy role: Upgrade.Chat
     manages them too, which is why they are only ever external roles.
2. **Discord Developer Portal** (Academy app `1551336038713139370`): add the
   OAuth2 redirect URI
   `https://making-easy-money-academy.onrender.com/v1/academy/billing/oauth/callback`.
   The web sign-in asks for `identify`, and `identify guilds.join` only when
   the buyer clicks "Add me to the server" (`AUTO_JOIN=1`; the Academy bot must
   be in the guild with Create Instant Invite). Optional: Server Members Intent
   (for `RECONCILE_SCAN=members`).
3. **Stripe products and prices** (MEM, Dashboard): the list below
   ("Stripe products and prices (owner list)"): six products, every one with
   metadata **`sml_kind` = `mem_academy`**, and twelve prices. Send the price
   ids (they go into the PRICES_JSON above). Make the same products and
   prices in **test mode** for the rehearsal. Turn on **ACH Direct Debit
   only in a Lifetime-specific payment method configuration** (Settings >
   Payment methods > create a configuration, live and test) and keep it OFF in
   the Default configuration, which the store, Creator Tiers, subdomains and
   Payment Links use. The engine always sends its own explicit
   `payment_method_types` (bank debit on the Lifetime price only), so it just
   needs the ACH capability active on the account. Financial Connections
   verification may carry its own Stripe fee (see Stripe pricing). No extra
   restricted-key permission is needed. Each membership is its own Stripe
   product with the same `sml_kind` metadata; its product name is its name on
   `/buy`. In Settings > Billing > Subscriptions and emails > "Manage free
   trial messaging", turn on the trial-ending reminder email (account-wide;
   Stripe asks sellers to follow the card networks' trial rules).
4. **Stripe restricted key** (MEM; make a live `rk_live_` and a test
   `rk_test_` twin):
   * Write: **Customers**, **Checkout Sessions**, **Customer portal**,
     **Subscriptions** (the auto-stop and daily 3-charge cap, a late free
     trial cancelled at once, lifetime supersede, rebind
     metadata, optional cancel-on-refund), **PaymentIntents** (rebind metadata
     only).
   * Read: Invoices, Charges, Disputes, Prices, Products.
   * Optional read: Account (lets preflight prove the account; without it the
     prices prove it), Webhook Endpoints (lets preflight refuse an endpoint
     subscribed to `invoice.created`).
   * Test key only: Test clocks write (for `SML_ACADEMY_BILLING_TEST_CLOCK=1`).
5. **NEW Stripe webhook endpoint** on MEM (leave `we_1UA6kC` / `we_1UA6uQ`
   and their 2022-11-15 pin untouched):
   * URL `https://making-easy-money-academy.onrender.com/v1/academy/billing/stripe/webhook`
   * API version: the account default **2022-11-15** (the engine re-fetches
     everything anyway).
   * Events, exactly: `checkout.session.completed`,
     `checkout.session.async_payment_succeeded`,
     `checkout.session.async_payment_failed`, `checkout.session.expired`,
     `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `customer.subscription.paused`,
     `customer.subscription.resumed`, `invoice.paid`,
     `invoice.payment_failed`, `charge.refunded`, `charge.refund.updated`,
     `charge.failed`, `payment_intent.payment_failed`,
     `charge.dispute.created`, `charge.dispute.updated`,
     `charge.dispute.closed`, `charge.dispute.funds_withdrawn`,
     `charge.dispute.funds_reinstated`.
   * Why the bank-debit events: the two `checkout.session.async_payment_*`
     events carry a bank-paid Lifetime from "processing" to paid or failed.
     `charge.failed` and `payment_intent.payment_failed` (added for ACH) make
     the engine re-read a member as soon as Stripe reports a failed debit,
     including one outside the Checkout events; a debit returned after it
     cleared arrives as `charge.dispute.*`. Both new types also fire for card
     declines of every other MEM product; those are ignored without a Stripe
     call (no Academy metadata, customer not bound).
   * **NEVER add `invoice.created` or `invoice.upcoming`** (or "all events").
     Stripe holds invoice finalization until every endpoint listening for
     `invoice.created` answers, for up to 72 h; this endpoint deliberately
     answers 503 while its secret or database is missing, which would delay
     renewals of EVERY MEM subscription (Upgrade.Chat, store, Creator Tiers).
   * The endpoint also receives every other MEM product's events; they are
     ignored with zero Stripe calls.
6. **Dedicated Customer Portal configuration**: cancel at period end, no
   proration, cancellation reasons on, plan switching off, terms and privacy
   URLs, return URL `.../v1/academy/billing/buy`. Send its `bpc_` id. Never use
   or edit the shared default configuration (`bpc_1R7qIy...`).
7. **Account-wide Stripe settings** (they also hit the store, Creator Tiers and
   subdomains): "if all retries fail -> cancel subscription"; "manage disputed
   payments -> cancel immediately"; receipts on; set the ToS URL in Public
   details if `TOS_CONSENT=1` will be used.
8. **Legal copy**: billing section on `/academy-terms/` (auto-renewal per
   package, online cancel with access to period end and ~15 min Activity lag,
   refunds/chargebacks remove access, lifetime definition, a lifetime sets
   the renewing plans it covers to cancel at period end (the Academy
   Lifetime: Academy plans only, a renewing Elite membership plan keeps
   renewing; Elite Lifetime Access: the Elite membership plans), Lifetime
   gives Monarch and not Elite, Lifetime paid by
   US bank account starts when the payment clears and a failed or returned
   bank payment removes it). Approve the
   disclosure text version (`SML_ACADEMY_BILLING_CONSENT_VERSION`). No
   earnings claims.
9. **Render env** on `making-easy-money-academy` (all `sync:false`; nothing on
   the API until step (c) of the runbook; the worker needs nothing):

| name | value / default |
| --- | --- |
| `SML_ACADEMY_BILLING_ENABLED` | `0` master switch |
| `SML_ACADEMY_BILLING_CHECKOUT_ENABLED` | `0` the only switch that can lead to a charge; takes effect only while `ROLE_MODE=enforce` |
| `SML_ACADEMY_BILLING_ROLE_MODE` | `off` \| `dry_run` \| `enforce` |
| `SML_ACADEMY_BILLING_REVOKES_ENABLED` | `0` no role is ever removed unless `1` |
| `SML_ACADEMY_BILLING_RECONCILE_MODE` | `off` \| `dry_run` \| `apply` |
| `SML_ACADEMY_BILLING_RECONCILE_INTERVAL_MS` | `900000` |
| `SML_ACADEMY_BILLING_RECONCILE_SCAN` | `known_ids` \| `members` (needs Server Members Intent) |
| `SML_ACADEMY_BILLING_MAX_REVOKES_PER_RUN` | `10` |
| `SML_ACADEMY_BILLING_PROXY_HOPS` | `1` appending proxies in front of the service; the rate-limit client address is that many entries from the RIGHT of `X-Forwarded-For` (left entries are client-controlled). Check once in the rehearsal: the right-most entry of a request you send must be your own address, else raise it |
| `SML_ACADEMY_BILLING_WEBHOOK_SECRET` | `whsec_` of the NEW endpoint (comma list for rotation; must differ from `SML_STRIPE_WEBHOOK_SECRET`) |
| `SML_ACADEMY_BILLING_STRIPE_KEY` | `rk_live_...` (`rk_test_...` for the rehearsal) |
| `SML_ACADEMY_BILLING_STRIPE_ACCOUNT_ID` | `acct_1ND1yGBpqyUyWsXe` |
| `SML_ACADEMY_BILLING_LIVEMODE` | `0` \| `1` (must match the key; set it together with the secret) |
| `SML_ACADEMY_BILLING_PRICES_JSON` | see above |
| `SML_ACADEMY_BILLING_ACADEMY_ROLE_ID` | the `Academy Student` role id (required) |
| `SML_ACADEMY_BILLING_LIFETIME_ROLE_ID` | optional; **leave unset** (Lifetime grants Monarch through its `roles`) |
| `SML_ACADEMY_BILLING_PROTECTED_ROLE_IDS` | optional extra ids the engine may never grant (the defaults are always protected) |
| `SML_ACADEMY_BILLING_EXTERNAL_ROLE_IDS` | unset = Monarch, Elite, Premium: the roles a price's `roles` may list (grant-only-unless-safe) |
| `SML_ACADEMY_BILLING_UC_MATCH` | `any` (default): any active Upgrade.Chat upgrade of the member (any product, hidden and one-time lifetime orders included) keeps an engine-granted external role; `mapped`: only the products of `UC_ROLE_PRODUCTS_JSON` count |
| `SML_ACADEMY_BILLING_UC_ROLE_PRODUCTS_JSON` | `UC_MATCH=mapped` only (optional and unused with `any`): `{"<role id>":["<Upgrade.Chat product uuid>", ...]}` for every external role a price grants (`[]` = no UC product grants it); in `mapped` mode a role missing here is never removed automatically |
| `UPGRADE_CHAT_CLIENT_ID` / `UPGRADE_CHAT_CLIENT_SECRET` | the platform's existing Upgrade.Chat API credentials, also set on this service; without them an engine-granted external role is never removed (it becomes `needs_review`) |
| `SML_ACADEMY_BILLING_GUILD_ID` | `938894329076940820` (must equal `SML_ACADEMY_GUILD_ID`, else the engine stays off) |
| `SML_ACADEMY_BILLING_PORTAL_CONFIG_ID` | the dedicated `bpc_` |
| `SML_ACADEMY_BILLING_PUBLIC_URL` | `https://making-easy-money-academy.onrender.com` |
| `SML_ACADEMY_BILLING_INVITE_URL` | server invite shown to non-members |
| `SML_ACADEMY_BILLING_TERMS_URL` / `_PRIVACY_URL` | default `https://stockmarketloop.com/academy-terms/` and `/academy-privacy/` |
| `SML_ACADEMY_BILLING_CONSENT_VERSION` | e.g. `2026-10-01` (required before checkout) |
| `SML_ACADEMY_BILLING_PAYMENT_METHODS` | `card,link`: the payment methods of every price without its own `"paymentMethods"` (instant methods only, at least one, no repeats; the Lifetime bank debit goes in its price entry, see "Payment methods per price") |
| `SML_ACADEMY_BILLING_TOS_CONSENT` | `0` |
| `SML_ACADEMY_BILLING_AUTOMATIC_TAX` | `0` (MEM has no tax registrations) |
| `SML_ACADEMY_BILLING_ALLOW_NON_MEMBER` | `0` strict: join the server before paying; `1` (owner decision): pay first, roles land on joining (the invite is shown) |
| `SML_ACADEMY_BILLING_AUTO_JOIN` | `0`; `1` (owner decision) offers "Add me to the server with Discord" (`guilds.join`, needs Create Instant Invite) |
| `SML_ACADEMY_BILLING_PARTIAL_REFUND_REVOKES` | `0` |
| `SML_ACADEMY_BILLING_CANCEL_ON_REFUND` | `0`: a live plan that gives no access but still renews (current period fully refunded, or voided by a lost dispute) is audited `stripe_cancel_required` once for staff; `1` cancels it (no proration). A plan already set to end is left alone |
| `SML_ACADEMY_BILLING_IN_DISCORD_LINKS` | `0` Activity/hub buy links (Premium Apps parity gate) |
| `SML_ACADEMY_BILLING_SEEN_NOTIFY` | `0` LISTEN for the API's `mem_academy_seen` re-kick |
| `SML_ACADEMY_BILLING_TEST_CLOCK` | `0` test mode only (refused when LIVEMODE=1) |
| `SML_ACADEMY_BILLING_DISCORD_SKUS_ENABLED` / `_JSON` | phase 2, no effect yet |

Reused unchanged: `SML_ACADEMY_BOT_TOKEN`, `SML_ACADEMY_GUILD_ID`,
`SML_ACADEMY_CLIENT_SECRET` (HKDF root for the billing tokens),
`SML_ACADEMY_APP_ID`, `SML_ACADEMY_MANAGER_ROLE_ID`, `DATABASE_URL`. The engine
never reads `STRIPE_SECRET_KEY` or any WordPress key.

Shared with the API (PR-B): `SML_ACADEMY_ACCESS_ROLE_IDS` (the `Academy
Student` role id) and `SML_ACADEMY_MONARCH_ACCESS` (default `1` keeps Monarch
admitted, unchanged behaviour; `0` removes it). Lifetime buyers now reach the
Activity as members through **Monarch**, so keep `SML_ACADEMY_MONARCH_ACCESS=1`
and leave `SML_ACADEMY_BILLING_LIFETIME_ROLE_ID` unset on the API too. The
legacy verified-payer roster that would let Monarch go to `0` without cutting
off genuine Monarch payers is **phase 2** and is not built here.

## Staged enable runbook

The owner checklist with the exact per-service values for every stage
(including the API and worker flags) is `LAUNCH.md`; this section is the
engine-side summary.

Migration **028** is applied by the API's pre-deploy `npm run db:release`. The
academy service keeps billing idle (`academy_billing_schema_missing`) until it
sees version `028` in `schema_migrations` (re-checked every 5 minutes).

**Launch gates before `CHECKOUT_ENABLED=1`:** PR-D (the platform lifecycle
fix: no `sync_roles`/`notify` outbox rows for subscriptions without a row, plus
the outbox dead-letter cap) is deployed; the content gate decision (PR-C) is
made; the terms and disclosure text are approved; the bot role sits above
Monarch, Elite and Premium; Discord Premium Apps parity
is settled.

**(a) Test-mode rehearsal** (owner's own Discord account)
1. Set the test values: `rk_test_` key, the test endpoint's `whsec_`,
   `LIVEMODE=0`, test price ids, `TEST_CLOCK=1`, then `ENABLED=1`,
   `CHECKOUT_ENABLED=1`, `ROLE_MODE=enforce`, `REVOKES_ENABLED=1`,
   `RECONCILE_MODE=dry_run`.
2. Check logs for `academy_billing_preflight` `ok:true` (guild, bot MANAGE_ROLES
   and hierarchy, Stripe account, prices) or run `node scripts/academy-billing.js preflight`.
3. Rehearse: buy (role in under 10 s + audit row), renew (advance the test
   clock), cancel at period end (role kept until the clock passes period end),
   failed daily card (revoked after 2 h), full refund (revoked), dispute with
   `4000000000000259` (suspended; win restores), lifetime (Academy Student +
   Monarch, never Elite; Monarch held when you already had it; a live
   Academy plan is set to cancel at period end, a live Elite membership plan
   keeps renewing; a refund removes an engine-granted Monarch only when
   Upgrade.Chat has no active upgrade at all), Elite Lifetime Access (Monarch
   + Elite, no Academy Student; a live Elite plan is set to cancel at period
   end), the memberships (Free Trial Access with no card: Elite at once, the
   subscription set to cancel 10 minutes before its 3-day trial ends;
   advance the clock 3 days: it is cancelled, never invoiced, and Elite goes;
   the same with a saved default card on the test Customer: still never
   invoiced;
   then Elite Monthly Access shows no trial on `/buy` and in Checkout, and a
   second test account gets its 7-day card trial, keeps Elite through the
   trial and pays $89.90 when the clock passes the trial end; a trial whose
   card fails at the trial end, `4000000000000341`, loses Elite at once), a
   non-member pays, sees the
   invite and gets the roles on joining (invite link and "Add me"), daily plan
   stops after 3 charges. Lifetime by bank, with
   Stripe's test bank (routing `110000000`, account entered by hand):
   `000000000009` stays processing (no role, `/buy` shows "bank payment
   processing" and sells nothing), `000123456789` succeeds (its roles),
   `000222222227` fails (no role, intent `failed`), `000555555559` succeeds
   and is then disputed (its roles removed; Monarch only if the engine
   granted it and Upgrade.Chat has none); confirm microdeposits with the
   descriptor code `SM11AA`.
4. `node scripts/academy-billing.js audit verify` and `status`.
5. Switch to live values, then `node scripts/academy-billing.js purge-test --apply --actor owner`.

**(b) Live dry run, 24-48 h**: live key/secret/prices, `LIVEMODE=1`,
`ENABLED=1`, `CHECKOUT_ENABLED=0`, `ROLE_MODE=dry_run`,
`RECONCILE_MODE=dry_run`. Review `status` and the reconcile runs (planned
revokes should be 0).

**(c) Enforce without revokes**: `ROLE_MODE=enforce`, `CHECKOUT_ENABLED=1`,
`REVOKES_ENABLED=0`. Put the `Academy Student` role id in `SML_ACADEMY_ACCESS_ROLE_IDS` on the
API **and** the academy service. The owner buys the cheapest package: role in
under 10 s and an audit row.

**(d) Revokes on**: after one clean reconcile with 0 unexpected revoke
candidates, `REVOKES_ENABLED=1`, `RECONCILE_MODE=apply`. Tell staff first:
engine roles added by hand without a comp are removed.

**(e) In-Discord links** (only after the SKUs exist): `IN_DISCORD_LINKS=1`,
and if chosen `HUB_ROLE_GATE=1`, `CONTENT_GATE_ENABLED=1`.

**Kill switches**: `CHECKOUT_ENABLED=0` stops new sales; `ROLE_MODE=dry_run`
stops all Discord writes AND closes checkout (checkout needs `enforce`, so
nobody can pay while no role would be queued); on the next start in
`enforce` every member resynced meanwhile is made due once (the due-scan
works through them 25 a minute), so their role changes do not wait for their
next renewal; `REVOKES_ENABLED=0` stops removals;
`RECONCILE_MODE=off` stops the sweep; `ENABLED=0` stops everything (the
webhook keeps storing events as `deferred`; replay them with
`replay-deferred --apply`).

## Routes (`/v1/academy/billing/...`, all 404 unless enabled)

| route | purpose |
| --- | --- |
| `POST stripe/webhook` | raw body <= 256 KiB, verified with the Academy secret, stored (ids only), 200 |
| `GET packages` | `{packages, memberships}`: sellable Academy packages and membership offers from Stripe (10 min cache), each with `trial_days`, `trial_no_card` (the trial offered to an account that never had one) and `cancel_after_days` |
| `GET start?purpose=buy\|manage\|join&package=` | Discord OAuth (identify; `join` asks `identify guilds.join` and only with `AUTO_JOIN=1`) with a signed state + nonce cookie |
| `GET start?h=<code>` | redeem a one-time hand-off code from the Activity/hub, set a buy-only cookie, 303 to /buy |
| `GET oauth/callback` | verifies the state, binds the Discord id in an HttpOnly cookie, discards the user token; for `join` first adds the buyer to the guild (`member_auto_joined`) and makes their waiting roles due |
| `GET buy` | "Buying for @name"; a non-member sees the invite first (strict mode) or, with `ALLOW_NON_MEMBER=1`, a join card (invite and "Add me") above the plans; Academy package cards, then "Memberships (without MEM Academy)", each with the disclosure and an unticked consent box; a bank-debit Lifetime card adds the clearing-time note, and while a Lifetime bank payment clears the page says so and sells nothing; a Lifetime paused by an open dispute is shown as paused, not "Access active". A member's visit makes their waiting roles due |
| `POST checkout` | guards (per line), one-free-trial check (ledger + fresh Stripe snapshot; with no bound Customer, the Academy Customers Stripe Search finds, failing closed: a trial price answers 503 while that lookup fails), Customer, consent intent (with the trial offered), expire older open sessions, Checkout Session with the price's payment methods (and its trial), 303. An Academy offer is posted by `package`, a membership by `price` |
| `GET success?session_id=` | idempotent settle from the session id only, then a polling status page. Anyone not known to be in the server sees the invite (and "Add me"); a member's waiting roles are made due. Reaches Stripe only for a session with a stored checkout intent (unknown ids -> 400 from the database); 60 per client address per 10 min |
| `GET status?session_id=` | `{entitled, intent, lifetimePending, lifetime, awaitingMember, roles:[{key,state}]}`, no PII; while a role awaits the member it re-checks their membership at most once a minute and lets the role land; 600 per client address per 10 min |
| `GET manage` | Billing Portal with the dedicated configuration; needs a fresh `purpose=manage` sign-in |

Bind tokens (`mab1`) live only in an HttpOnly Secure SameSite=Lax cookie on
`/v1/academy/billing`, 30 minutes, with a purpose claim. A bearer token never
travels in a URL: the Activity and the hub use one-time server-side codes
(`academy_billing_handoffs`, sha256 stored, 5 minutes, single use, buy only).

### Integration points for the API and hub (PR-B)

* Activity (sml-platform-api), on a role miss with `IN_DISCORD_LINKS=1`:
  `createBillingHandoff({ pool, publicUrl })` in `platform/academy-oauth.js`
  calls this module's
  `handoff.issueHandoff(pool, { discordUserId, guildId, source: 'activity', publicUrl })`
  over the shared database (no HTTP hop, no second secret) and hands out only
  the returned `PUBLIC_URL/v1/academy/billing/start?h=<code>`. `/start`
  refuses a code minted for any guild other than `SML_ACADEMY_BILLING_GUILD_ID`.
* Hub (academy service, in process): `main()` passes the engine to
  `createAcademyInteractions({ ..., billing })`, and `runtime.js` spreads
  `academyHubGateOptions(config, { pool, handoff: billing.handoff, onMemberSeen: billing.onMemberSeen })`
  into the hub. `academyBilling.handoff.mint({ discordUserId, guildId, source: 'hub' })`
  returns `{ ok, url }` like `createBillingHandoff().mint` (`ok:false` unless the
  engine runs with `IN_DISCORD_LINKS=1`), and every `academy:*` click calls
  `onMemberSeen(userId)` (a no-op unless the engine runs in enforce mode). There
  is no `academy:manage` button: Manage billing is always a fresh web OAuth at
  `PUBLIC_URL/v1/academy/billing/start?purpose=manage`, never a token.
* `SML_ACADEMY_BILLING_SEEN_NOTIFY=1` makes the engine LISTEN on
  `mem_academy_seen`, but the API side (a `pg_notify` on an Activity role miss)
  is not built, so keep it `0`.

## Jobs

| job | cadence | notes |
| --- | --- | --- |
| events | setImmediate kick + 5 s | coalesced per member; backoff 30 s x 2^n capped at 6 h; `dead` after 20 (`academy_billing_event_dead`) |
| applier | kick + 5 s, enforce only | revokes first; Unknown Member -> `awaiting_member` (10 m, 30 m, 2 h, then 6 h, 90 days max); Unknown Role/Guild, 403 and 401 latch globally with one probe per 30 min, EXCEPT on an external role (that row alone waits 30 min, `failed` after 20); an external DELETE needs the ledger to say `revoked` + `had_role_before=false` and an Upgrade.Chat answer at most 10 minutes old (else it waits 5 min and the member is made due); 429 inside discord-sync; other errors back off to 1 h, `failed` after 20 |
| due-scan | 60 s | grace ends, period ends (+2 h), comp expiry, incomplete snapshots, unreadable Discord members, revokes held for a binding conflict or an unconfirmed Stripe account, the 6-hour Upgrade.Chat re-check of a `needs_review` external role, the daily re-check of an external role kept under `UC_MATCH=any`, an external DELETE waiting for a fresh Upgrade.Chat answer, and every member with access once a day (drift repair: a member who left and rejoined, a role removed by someone); retries a failed preflight every 5 min; prunes old rows hourly. Never revisits revokes held back by a reconcile brake |
| reconcile | `RECONCILE_INTERVAL_MS` | candidates from Stripe plus every member with an engine-granted external role or an unfinished revoke of one, every decision via resync; brakes: Stripe incomplete (cannot be forced), more than `MAX_REVOKES_PER_RUN`, a candidate drop of max(5, 50%). A tripped brake stays tripped: the held revokes are not rescheduled; they wait for an unbraked run or `reconcile --force-breaker --apply` |
| preflight | start + hourly | must pass before any Stripe or Discord write |

The engine has its own pool (max 3) and runs at most two resyncs at once. No DB
client or lock is held across a network call.

## CLI (Render shell of the academy service)

Read-only: `status`, `preflight`, `validate-config`, `audit verify`,
`external-review` (the external roles the engine granted but did not remove:
`needs_review` rows and unfinished revokes by default,
`--state needs_review|revoke_unfinished|engine_granted|held|kept_external|revoked|released|all`).
Every mutation is a dry run unless given **both** `--apply` and
`--actor <label>`; each is audited as `cli:<label>`.

```
node scripts/academy-billing.js reconcile [--force-breaker] [--apply --actor ops]
node scripts/academy-billing.js resync <discordId> [--apply --actor ops]
node scripts/academy-billing.js rebuild-from-stripe [--apply --actor ops]
node scripts/academy-billing.js replay-event <evt_id> [--apply --actor ops]
node scripts/academy-billing.js replay-deferred [--apply --actor ops]
node scripts/academy-billing.js rebind <newDiscordId> <cus_id> --reason "..." [--apply --actor ops]
node scripts/academy-billing.js comp grant --discord <id> [--role <id>[,<id>]] [--no-academy] [--include-lifetime-role] [--expires 2026-12-31] --reason "..." [--apply --actor ops]
node scripts/academy-billing.js comp revoke --id <n> --reason "..." [--apply --actor ops]
node scripts/academy-billing.js purge-test [--force] [--apply --actor ops]
node scripts/academy-billing.js external-review [--state needs_review] [--recheck --apply --actor ops]
node scripts/academy-billing.js external-review --keep --discord <id> --role <id> --reason "..." [--apply --actor ops]
```

`comp grant --role` lists external roles (Monarch / Elite / Premium) the comp
entitles, under the same grant-only-unless-safe rule; `--no-academy` leaves
the Academy Student role out (a membership-only comp);
`--include-lifetime-role` needs the optional `SML_ACADEMY_BILLING_LIFETIME_ROLE_ID`
and is refused while it is unset. `external-review --recheck --apply` re-runs
the Upgrade.Chat check for every listed member now instead of waiting for the
6-hour re-check (and re-queues their unfinished revokes). `external-review
--keep` settles one `needs_review` row as `kept_external` when staff decide the
member keeps the role (audited with the reason).

`rebind` rewrites `mem_academy_discord_user` on the Customer, every Academy
subscription and every Academy PaymentIntent, moves the binding (the old id
keeps a `rebound_to` tombstone so a rebuild never restores it), then resyncs
the old id (roles removed) and the new id (roles granted). Comps are the ONLY
sanctioned way to hand out the Academy Student role by hand (existing lifetime
buyers from the old Payment Link: `comp grant --discord <id> --role
1260433215189946420` adds Monarch as an external role; a member who already
holds Monarch is recorded as `held` and never loses it).

## Data (migration 028)

`academy_billing_members` (binding, keyed by Discord id + livemode; mirrored in
Customer metadata), `_checkout_intents` (consent version + sha256, keep 3
years; `consent_kind` `auto_renewal`, `final_sale` or `free_trial`, and
`trial_days`, the free trial the checkout offered),
`_lifetime` (cache of Stripe), `_comps` (with `grants_academy` and
`external_role_ids`), `_events` (ids and a payload hash, no body),
`_role_state` (outbox with generation; `role_key` `academy`, `mem_lifetime` or
`external`), `_audit` (append-only, hash-chained; UPDATE/DELETE/TRUNCATE
raise), `_reconcile_runs`, `_handoffs`, `_external_grants` (the external-role
ledger: `had_role_before` from the grant decision that started the current
entitlement, `state` held/engine_granted/revoked/kept_external/needs_review/released,
`generation`, the last Upgrade.Chat answer; CHECKs make `held` imply
`had_role_before` and forbid `revoked` for a role held before). A comp's
`external_role_ids` may hold no NULL and no repeated id (CHECK through the
helper function `academy_billing_ids_distinct`, the one function 028 adds).
`_trials` is the one-free-trial ledger: one row per Discord account and
livemode (primary key), the first trial's price, subscription and dates,
written by resync and never by checkout.
Every row except the hand-off codes carries `livemode`. After a database rollback, `rebuild-from-stripe` restores bindings
and lifetime rows; comps, consent intents, the audit and the external-role
ledger cannot be rebuilt (restore from backup). Without the ledger, an
external role the member holds reads as `held` at the next grant decision and
is never removed: the loss fails toward keeping access. A lost trial ledger
fills itself again from Stripe: every checkout reads the member's
subscriptions (for a member whose binding was lost too, those of every
Academy Customer Stripe Search finds for the Discord id, failing closed) and
refuses a second trial to anyone who ever had one there, and the next resync
records it again. Down:
`node db/migrate.js down 028 --yes`.

## Not in this build

* Discord Premium Apps SKU adapter (phase 2; `DISCORD_SKUS_*` parsed but inert).
* Legacy verified-payer roster for Monarch (phase 2; see above).
* The yearly-plan renewal notice email (15-45 days before renewal, California)
  and a post-purchase acknowledgement email: until they exist, enable Stripe's
  upcoming-renewal emails (account-wide) or send them by hand.
