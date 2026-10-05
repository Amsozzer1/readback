import pg from "pg";

// node-postgres returns int8 (bigint) columns as strings by default, which makes
// arithmetic like `atMs - signed_ms` silently concatenate. Sim times fit in a double.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new Error(`int8 value out of safe range: ${value}`);
  return n;
});

export const DEFAULT_DATABASE_URL = "postgres://readback:readback@localhost:54329/readback";

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
}

/** A single connection: the projection has exactly one writer. */
export async function connect(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: databaseUrl() });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(
      `Can't reach Postgres at ${databaseUrl()}. Start it with \`pnpm db:up\` (needs Docker running). ${String(err)}`,
    );
  }
  return client;
}
