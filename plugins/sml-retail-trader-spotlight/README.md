# SML Retail Trader Spotlight 1.4.0

Retail Trader Spotlight is a paid creator tool for StockMarketLoop group owners and administrators who have connected a Discord server they own or manage.

## Product contract

- Retail Trader Spotlight remains a separate WordPress author and newsroom desk.
- A StockMarketLoop group owner/admin chooses 1–25 verified Discord text or announcement channels and 1–25 traders to monitor.
- Every connected StockMarketLoop group can subscribe for 4,000 Loop Bucks per month.
- At 1,000 verified StockMarketLoop group members, the price is recalculated automatically at 50% off (2,000 Loop Bucks) for activation and every renewal.
- Falling below 1,000 members returns the next renewal to the base price; it does not disable the tool.
- The base price can be changed safely with the `sml_rts_base_monthly_price` filter; the 50% rule is always derived from that price.

## Discord DM notifications

- Members are never enrolled automatically.
- A member must belong to the group, link a Discord identity to StockMarketLoop, and explicitly opt in.
- A member can revoke consent at any time from the group page.
- Deliveries are queued, idempotent per alert/member, retried at most three times, and stop when the group subscription is inactive.
- Discord and device settings control whether a delivered DM makes a sound or vibration.

## Compatibility

The legacy single `channel_id` is retained as the first selected channel. Existing integrations continue receiving one configuration row per monitored channel from `/bot/configured-groups`.

## Missed-alert recovery and observability

- The one-minute Discord poll records a bounded health summary: completion time, configured channel count, messages fetched, accepted alerts, duplicates, ignored messages, errors, and a safe last-error string.
- Manager diagnostics fail visibly when polling has not completed within five minutes.
- Each monitored human message that is skipped for no ticker, multiple tickers, or intake rejection receives a reason-coded audit row keyed to its Discord message ID.
- Group owners/admins can trace an exact Discord message ID through poll cursor, event, newsroom handoff, and WordPress publication state.
- Exact-message recovery re-reads only selected channels, revalidates the author and single `$TICKER` contract, and passes through the existing message-ID and ticker-cooldown protections, so retries remain idempotent.
