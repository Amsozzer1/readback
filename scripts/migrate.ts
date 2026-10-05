import { connect } from "../src/lib/db";
import { migrate } from "../src/db/migrate";

const client = await connect();
try {
  const applied = await migrate(client);
  console.log(applied.length ? `applied: ${applied.join(", ")}` : "up to date");
} finally {
  await client.end();
}
