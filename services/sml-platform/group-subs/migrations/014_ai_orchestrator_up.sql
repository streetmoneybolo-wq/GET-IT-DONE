BEGIN;

CREATE TABLE ai_orchestrator_tasks (
  id BIGSERIAL PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  goal TEXT NOT NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','processing','in_progress','retry','done','needs_human','failed_max_hops','failed_budget')),
  next_model TEXT CHECK (next_model IN ('claude','codex')),
  max_hops_remaining INTEGER NOT NULL DEFAULT 4 CHECK (max_hops_remaining BETWEEN 0 AND 20),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 20),
  max_retries INTEGER NOT NULL DEFAULT 2 CHECK (max_retries BETWEEN 0 AND 10),
  budget_microusd BIGINT NOT NULL DEFAULT 1000000 CHECK (budget_microusd >= 0),
  spent_microusd BIGINT NOT NULL DEFAULT 0 CHECK (spent_microusd >= 0),
  invocation_id UUID,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  verification JSONB,
  verification_note TEXT,
  last_error_code TEXT,
  last_error_detail TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX ai_orchestrator_tasks_runnable_idx
  ON ai_orchestrator_tasks (run_after, created_at, id)
  WHERE status IN ('queued','in_progress','retry');

CREATE INDEX ai_orchestrator_tasks_lease_idx
  ON ai_orchestrator_tasks (lease_expires_at)
  WHERE status = 'processing';

CREATE TABLE ai_orchestrator_hops (
  id BIGSERIAL PRIMARY KEY,
  task_id BIGINT NOT NULL REFERENCES ai_orchestrator_tasks(id) ON DELETE CASCADE,
  invocation_id UUID NOT NULL,
  model TEXT NOT NULL CHECK (model IN ('claude','codex')),
  provider_run_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  handoff_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  verification JSONB,
  input_tokens INTEGER NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens INTEGER NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  estimated_cost_microusd BIGINT NOT NULL DEFAULT 0 CHECK (estimated_cost_microusd >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, invocation_id)
);

COMMENT ON TABLE ai_orchestrator_tasks IS
  'Fail-closed Claude/Codex task queue. A model cannot complete a task without an independent verification pass.';
COMMENT ON COLUMN ai_orchestrator_tasks.invocation_id IS
  'Persisted before an API call. An expired lease with this value is parked, never replayed automatically.';
COMMENT ON COLUMN ai_orchestrator_tasks.budget_microusd IS
  'Hard estimated model-spend ceiling in millionths of one US dollar.';

COMMIT;
