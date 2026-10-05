import { afterAll, beforeAll, expect, test } from "vitest";
import type pg from "pg";
import { connect } from "@/lib/db";
import { migrate } from "@/db/migrate";

let client: pg.Client;

beforeAll(async () => {
  client = await connect();
  await migrate(client);
});

afterAll(async () => {
  await client?.end();
});

test("migrations create the events table", async () => {
  const { rows } = await client.query<{ t: string | null }>("select to_regclass('events')::text as t");
  expect(rows[0]?.t).toBe("events");
});

test("int8 columns come back as numbers, not strings", async () => {
  const { rows } = await client.query<{ n: number }>("select 1200000::bigint as n");
  expect(rows[0]?.n).toBe(1_200_000);
});
