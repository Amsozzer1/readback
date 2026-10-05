import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type pg from "pg";
import { connect } from "@/lib/db";
import { migrate } from "@/db/migrate";
import { eventCount, ingest, readStates, rebuild, reset } from "@/db/projection";
import { fold, FULL, view } from "@/domain/fold";
import { simulate, VISIT_CLOSE_MS } from "@/domain/sim";

const SEEDS = 20;
let client: pg.Client;

beforeAll(async () => {
  client = await connect();
  await migrate(client);
});

afterAll(async () => {
  await client?.end();
});

async function linesFromDb(t: number) {
  const states = await readStates(client);
  return new Map([...states].map(([id, s]) => [id, view(s, t, FULL.rules)]));
}

describe("Postgres ingest and projection", () => {
  test(`rx_status matches the pure fold at visit close and at end of run, over ${SEEDS} seeds with duplicates`, { timeout: 120_000 }, async () => {
    for (let seed = 0; seed < SEEDS; seed++) {
      const { events } = simulate({ seed, fault: 0.2 });
      expect(events.some((e) => e.copy === 1), `seed ${seed} has duplicates`).toBe(true);
      await reset(client);

      const upToClose = events.filter((e) => e.arrivedMs <= VISIT_CLOSE_MS);
      for (const e of upToClose) await ingest(client, e);
      expect(await linesFromDb(VISIT_CLOSE_MS), `seed ${seed} at close`).toEqual(fold(events, VISIT_CLOSE_MS, FULL));

      for (const e of events.slice(upToClose.length)) await ingest(client, e);
      const end = events.at(-1)!.arrivedMs;
      expect(await linesFromDb(end), `seed ${seed} at end`).toEqual(fold(events, end, FULL));
      expect(await eventCount(client)).toBe(new Set(events.map((e) => e.key)).size);

      const incremental = await readStates(client);
      await rebuild(client);
      expect(await readStates(client), `seed ${seed} rebuild`).toEqual(incremental);
    }
  });

  test("a repeated delivery is a no-op in both tables", async () => {
    const { events } = simulate({ seed: 1, fault: 0 });
    await reset(client);
    for (const e of events) await ingest(client, e);
    const before = { count: await eventCount(client), states: await readStates(client) };
    const error = events.find((e) => e.type === "VendorEvent");
    expect(await ingest(client, { ...error!, arrivedMs: error!.arrivedMs + 60_000, copy: 1 })).toBe(false);
    expect(await eventCount(client)).toBe(before.count);
    expect(await readStates(client)).toEqual(before.states);
  });
});
