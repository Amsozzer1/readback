-- Append-only log of everything the read models fold over.
-- Sim times are integer milliseconds; recorded_at is metadata only and never read by folds.
create table events (
  id bigserial primary key,
  kind text not null,
  payload jsonb not null,
  sim_emitted_ms bigint not null,
  sim_arrived_ms bigint not null,
  idempotency_key text not null unique,
  recorded_at timestamptz not null default now()
);
