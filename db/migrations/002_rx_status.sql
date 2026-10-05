-- Read model state per prescription: what `step` folds events into. Never a computed status:
-- what a screen shows depends on the time it is read, so `view` derives it at read time.
create table rx_status (
  order_id text primary key,
  visit_id text not null,
  pharmacy_id text not null,
  signed_ms bigint not null,
  max_kind text not null,
  max_category text,
  last_kind text not null,
  last_category text,
  last_arrived_ms bigint not null,
  first_error_arrived_ms bigint,
  visit_closed_ms bigint
);

create index rx_status_visit_id on rx_status (visit_id);
