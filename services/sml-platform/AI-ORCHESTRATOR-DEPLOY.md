# SML bounded Claude/Codex orchestrator

This subsystem is a fail-closed planning and review queue inside the existing Render worker. It does not give either model shell, browser, payment, publishing, or deployment access. A model cannot mark work complete unless a separate HTTPS check succeeds against an explicitly allowed public host.

## Safety contract

- Postgres owns the queue and uses `FOR UPDATE SKIP LOCKED` for one-worker claims.
- Every provider call has a persisted invocation UUID.
- An expired in-flight lease is parked as `needs_human`; it is never replayed automatically because the original provider call may have completed and charged.
- Hop, retry, token-output, task-per-tick, and estimated-cost budgets are bounded.
- Only HTTP 429 is automatically retried. Other provider errors require review.
- Completion requires HTTPS 200 from an exact hostname in `SML_AI_VERIFY_HOSTS`; redirects and private-network destinations are rejected.
- The worker is disabled unless `SML_AI_ORCHESTRATOR_ENABLED=1`.

## Deploy order

1. Deploy the code with `SML_AI_ORCHESTRATOR_ENABLED=0`. The release command applies additive migration `014_ai_orchestrator_up.sql`.
2. On the **worker only**, configure `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` in Render's secret environment settings. Never paste either into logs, tasks, Git, or WordPress.
3. Set the current provider models and prices. Prices are USD per one million tokens and are converted to integer millionths of a dollar. Do not enable production with all four price fields at zero if monetary budget enforcement matters.
4. Keep `SML_AI_MAX_TASKS_PER_TICK=1` for the canary. Set a narrow `SML_AI_VERIFY_HOSTS` list.
5. Set `SML_AI_ORCHESTRATOR_ENABLED=1`, deploy the worker, enqueue one canary, and inspect status.
6. Disable the flag immediately if claims accumulate, provider errors appear, or verification behaves unexpectedly. Queued records remain intact.

## Required worker variables

```text
SML_AI_ORCHESTRATOR_ENABLED=1
OPENAI_API_KEY=<Render secret>
ANTHROPIC_API_KEY=<Render secret>
SML_AI_OPENAI_MODEL=gpt-5.4-mini
SML_AI_ANTHROPIC_MODEL=claude-sonnet-5
SML_AI_MAX_OUTPUT_TOKENS=3000
SML_AI_MAX_TASKS_PER_TICK=1
SML_AI_VERIFY_HOSTS=sml-platform-api.onrender.com,stockmarketloop.com
SML_AI_OPENAI_INPUT_USD_PER_MILLION=<current price>
SML_AI_OPENAI_OUTPUT_USD_PER_MILLION=<current price>
SML_AI_ANTHROPIC_INPUT_USD_PER_MILLION=<current price>
SML_AI_ANTHROPIC_OUTPUT_USD_PER_MILLION=<current price>
```

## Enqueue a bounded task

The command reads JSON from standard input so goals do not become shell arguments or process-list data.

```powershell
@'
{
  "idempotencyKey": "canary-2026-09-02-001",
  "goal": "Review the deployed health endpoint and produce a bounded handoff without claiming external changes.",
  "context": {"environment":"production-canary"},
  "payload": {},
  "nextModel": "claude",
  "maxHops": 2,
  "maxRetries": 1,
  "budgetMicrousd": 100000
}
'@ | npm run ai:enqueue
```

List sanitized task state (no goals, payloads, histories, or provider secrets):

```powershell
npm run ai:status -- 50
```

## Canary acceptance gates

- Only one queue row exists for a repeated idempotency key.
- A task claiming completion without HTTP verification becomes `needs_human`.
- A valid approved-host HTTP verification can become `done`.
- Invalid JSON consumes a hop/cost and retries only within its explicit limit.
- A stale processing lease becomes `needs_human`, not `retry`.
- A missing provider configuration becomes `needs_human`.
- Logs contain task IDs, statuses, and token-cost estimates, but no prompt body or key.

## Rollback

Set `SML_AI_ORCHESTRATOR_ENABLED=0` and redeploy the worker. This stops new claims without deleting queue or audit history. The down migration is for controlled rollback only and deletes the orchestrator tables, so do not run it during a routine disable.
