// pnpm sim --seed 42 [--fault 0.1] [--visits 20] [--json]
// Prints one seed's webhook arrival stream, as the read models would receive it.
import { parseArgs } from "node:util";
import { simulate } from "../src/domain/sim";
import { clock } from "../src/domain/types";

const { values } = parseArgs({
  options: {
    seed: { type: "string", default: "42" },
    fault: { type: "string", default: "0.1" },
    visits: { type: "string", default: "20" },
    json: { type: "boolean", default: false },
  },
});

const run = simulate({ seed: Number(values.seed), fault: Number(values.fault), visits: Number(values.visits) });

if (values.json) {
  console.log(JSON.stringify(run, null, 2));
} else {
  const ms = (t: number) => `${clock(t)}.${String(t % 1000).padStart(3, "0")}`;
  for (const e of run.events) {
    const what =
      e.type === "Signed" ? `signed ${e.med} ${e.dose}`
      : e.type === "VisitClosed" ? `visit ${e.visitId} closed`
      : `${e.kind}${e.category ? ` (${e.category})` : ""}`;
    const id = e.type === "VisitClosed" ? "" : e.orderId;
    const late = e.arrivedMs > e.emittedMs && e.copy === 0 ? " late" : "";
    const dup = e.copy === 1 ? " duplicate" : "";
    console.log(`${ms(e.arrivedMs)}  ${id.padEnd(8)} ${what}${late}${dup}`);
  }
  const t = run.trace;
  console.log(
    `\nseed ${run.config.seed}, fault ${run.config.fault}: ${run.real.length} prescriptions, ` +
      `${run.real.filter((r) => r.outcome === "failed").length} failed; ${t.length} webhooks emitted, ` +
      `${t.filter((x) => x.dropped).length} dropped, ${t.filter((x) => x.late).length} late, ` +
      `${t.filter((x) => x.duplicated).length} duplicated`,
  );
}
