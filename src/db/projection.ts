// Postgres path: append-only `events` with a unique idempotency key, and `rx_status`
// holding the fold's state. One writer applies events in arrival order. An event is
// folded into `rx_status` only if its insert actually happened, in the same transaction,
// so a repeated delivery is a no-op end to end.

import type pg from "pg";
import { step, type OrderState } from "../domain/fold";
import type { RxEvent } from "../domain/types";

type Row = {
  order_id: string;
  visit_id: string;
  pharmacy_id: string;
  signed_ms: number;
  max_kind: OrderState["maxKind"];
  max_category: OrderState["maxCategory"];
  last_kind: OrderState["lastKind"];
  last_category: OrderState["lastCategory"];
  last_arrived_ms: number;
  first_error_arrived_ms: number | null;
  visit_closed_ms: number | null;
};

const COLUMNS = [
  "order_id", "visit_id", "pharmacy_id", "signed_ms", "max_kind", "max_category", "last_kind",
  "last_category", "last_arrived_ms", "first_error_arrived_ms", "visit_closed_ms",
] as const;

function fromRow(r: Row): OrderState {
  return {
    orderId: r.order_id,
    visitId: r.visit_id,
    pharmacyId: r.pharmacy_id,
    signedMs: r.signed_ms,
    maxKind: r.max_kind,
    maxCategory: r.max_category,
    lastKind: r.last_kind,
    lastCategory: r.last_category,
    lastArrivedMs: r.last_arrived_ms,
    firstErrorArrivedMs: r.first_error_arrived_ms,
    visitClosedMs: r.visit_closed_ms,
  };
}

function toValues(s: OrderState): unknown[] {
  return [
    s.orderId, s.visitId, s.pharmacyId, s.signedMs, s.maxKind, s.maxCategory, s.lastKind,
    s.lastCategory, s.lastArrivedMs, s.firstErrorArrivedMs, s.visitClosedMs,
  ];
}

const INSERT = `insert into rx_status (${COLUMNS.join(", ")})
  values (${COLUMNS.map((_, i) => `$${i + 1}`).join(", ")})`;
const UPSERT = `${INSERT}
  on conflict (order_id) do update set ${COLUMNS.slice(1).map((c) => `${c} = excluded.${c}`).join(", ")}`;

async function save(client: pg.Client, state: OrderState): Promise<void> {
  await client.query(UPSERT, toValues(state));
}

async function apply(client: pg.Client, e: RxEvent, lock: boolean): Promise<void> {
  const forUpdate = lock ? " for update" : "";
  if (e.type === "Signed") {
    const next = step(undefined, e);
    if (next) await client.query(`${INSERT} on conflict (order_id) do nothing`, toValues(next));
    return;
  }
  const rows =
    e.type === "VisitClosed"
      ? (await client.query<Row>(`select * from rx_status where visit_id = $1 order by order_id${forUpdate}`, [e.visitId])).rows
      : (await client.query<Row>(`select * from rx_status where order_id = $1${forUpdate}`, [e.orderId])).rows;
  for (const row of rows) {
    const next = step(fromRow(row), e);
    if (next) await save(client, next);
  }
}

/** Appends one event and folds it into rx_status, both or neither. Returns false for a repeat. */
export async function ingest(client: pg.Client, e: RxEvent): Promise<boolean> {
  await client.query("begin");
  try {
    const inserted = await client.query(
      `insert into events (kind, payload, sim_emitted_ms, sim_arrived_ms, idempotency_key)
       values ($1, $2, $3, $4, $5) on conflict (idempotency_key) do nothing returning id`,
      [e.type === "VendorEvent" ? e.kind : e.type, JSON.stringify(e), e.emittedMs, e.arrivedMs, e.key],
    );
    const isNew = inserted.rowCount === 1;
    if (isNew) await apply(client, e, true);
    await client.query("commit");
    return isNew;
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}

/** Throws away rx_status and folds every stored event again, in arrival order. */
export async function rebuild(client: pg.Client): Promise<void> {
  await client.query("begin");
  try {
    await client.query("truncate rx_status");
    const { rows } = await client.query<{ payload: RxEvent }>(
      `select payload from events
       order by sim_arrived_ms, (payload->>'emitIndex')::int, (payload->>'copy')::int, id`,
    );
    for (const { payload } of rows) await apply(client, payload, false);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  }
}

export async function readStates(client: pg.Client): Promise<Map<string, OrderState>> {
  const { rows } = await client.query<Row>("select * from rx_status order by order_id");
  return new Map(rows.map((r) => [r.order_id, fromRow(r)]));
}

export async function eventCount(client: pg.Client): Promise<number> {
  const { rows } = await client.query<{ n: number }>("select count(*)::bigint as n from events");
  return rows[0]?.n ?? 0;
}

/** Empties both tables and restarts ids, so every seed starts from the same state. */
export async function reset(client: pg.Client): Promise<void> {
  await client.query("truncate events, rx_status restart identity");
}
