// Turns bench results into the committed files: results/raw/*.json, results/numbers.md and
// the two tables inside README.md. verify:numbers renders again and diffs, so everything
// here must be deterministic (no dates; metadata lines are excluded from the diff).

import { FULL, NAIVE, NAIVE_DEDUPE } from "../domain/fold";
import { STALE_AFTER_MS } from "../domain/fold";
import { BENCH, MODELS, type FaultResult } from "./run";

export interface Meta {
  command: string;
  commit: string;
  machine: string;
}

const LABEL: Record<string, string> = {
  naive: "Latest event wins",
  "naive + dedupe": "Latest event wins, duplicates dropped",
  full: "This read model",
  "naive + dedupe + rank": "Duplicates dropped + lifecycle rank",
  "naive + dedupe + greenOnly": "Duplicates dropped + green only on delivery",
  "naive + dedupe + staleness": "Duplicates dropped + \"Not confirmed\" after 90 s",
  "naive + dedupe + issues": "Duplicates dropped + next steps and clinic queue",
  "full - rank": "This read model without lifecycle rank",
  "full - greenOnly": "This read model without green only on delivery",
  "full - staleness": "This read model without \"Not confirmed\" after 90 s",
  "full - issues": "This read model without next steps and clinic queue",
};

const HEADLINE_ROWS = [NAIVE.name, NAIVE_DEDUPE.name, FULL.name];
const README_ABLATION_ROWS = [
  NAIVE.name, NAIVE_DEDUPE.name, FULL.name, "naive + dedupe + greenOnly",
  "full - rank", "full - greenOnly", "full - staleness", "full - issues",
];

const per1000 = (n: number, of: number) => ((n / of) * 1000).toFixed(1);
const minutesPer1000 = (ms: number, of: number) => ((ms / 60_000 / of) * 1000).toFixed(1);
const percent = (n: number, of: number) => `${((n / of) * 100).toFixed(1)}%`;
const fmtInt = (n: number) => n.toLocaleString("en-US");
const pct = (f: number) => `${Math.round(f * 100)}%`;

function headlineFault(results: FaultResult[]): FaultResult {
  const r = results.find((x) => x.fault === BENCH.headlineFault);
  if (!r) throw new Error("headline fault level missing from results");
  return r;
}

function scopeLine(r: FaultResult): string {
  const t = r.totals;
  return `Seeds ${r.seeds[0]}–${r.seeds[1]}, ${r.visits} visits each: ${fmtInt(t.prescriptions)} synthetic prescriptions, ${fmtInt(t.failed)} of which really failed. Fault level ${pct(r.fault)}. Pooled over all seeds.`;
}

function metricTable(r: FaultResult, rows: string[]): string {
  const t = r.totals;
  const head = [
    "| Read model | Silently wrong at visit close (per 1,000 prescriptions) | Known failure hidden (minutes per 1,000 prescriptions) | Failed with no owner 10 min after the visit |",
    "|---|---:|---:|---:|",
  ];
  const body = rows.map((name) => {
    const c = t.models[name]!;
    const owner = c.unowned === null ? "no issue list" : percent(c.unowned, t.failed);
    const label = name === FULL.name ? `**${LABEL[name]}**` : LABEL[name];
    return `| ${label} | ${per1000(c.silentlyWrongAtClose, t.prescriptions)} | ${minutesPer1000(c.hiddenMs, t.prescriptions)} | ${owner} |`;
  });
  return [...head, ...body].join("\n");
}

export function readmeHeadline(results: FaultResult[]): string {
  const r = headlineFault(results);
  return [metricTable(r, HEADLINE_ROWS), "", `*${scopeLine(r)}*`].join("\n");
}

export function readmeAblation(results: FaultResult[]): string {
  const r = headlineFault(results);
  return [metricTable(r, README_ABLATION_ROWS), "", `*${scopeLine(r)}*`].join("\n");
}

function costTable(r: FaultResult): string {
  const t = r.totals;
  const fa = t.falseAlarms;
  const lines = [
    "| Threshold for \"Not confirmed\" | Shown \"Not confirmed\", then delivered (per 1,000 prescriptions) |",
    "|---|---:|",
    ...BENCH.thresholdsMs.map((ms) => `| ${ms / 1000} s | ${per1000(fa.transient[String(ms)]!, t.prescriptions)} |`),
  ];
  const median = fa.lateResolveMs.length
    ? (fa.lateResolveMs[Math.floor((fa.lateResolveMs.length - 1) / 2)]! / 60_000).toFixed(1)
    : "none";
  return [
    ...lines,
    "",
    `At the ${STALE_AFTER_MS / 1000} s threshold, issues opened after the visit for prescriptions that were in fact delivered, per 1,000 delivered prescriptions:`,
    "",
    "| Kind | Per 1,000 delivered | Count |",
    "|---|---:|---:|",
    `| Confirmation never arrived (issue never resolves) | ${per1000(fa.issuesDropped, t.delivered)} | ${fmtInt(fa.issuesDropped)} |`,
    `| Confirmation arrived late (issue resolves on its own) | ${per1000(fa.issuesLate, t.delivered)} | ${fmtInt(fa.issuesLate)} |`,
    "",
    `Median time from visit close to a late confirmation: ${median} min.`,
  ].join("\n");
}

function sweepTable(results: FaultResult[]): string {
  const head = [
    "| Fault level | Read model | Silently wrong at visit close (per 1,000) | Known failure hidden (min per 1,000) | Failed with no owner | Prescriptions | Really failed |",
    "|---|---|---:|---:|---:|---:|---:|",
  ];
  const body = results.flatMap((r) =>
    HEADLINE_ROWS.map((name) => {
      const t = r.totals;
      const c = t.models[name]!;
      return `| ${pct(r.fault)} | ${LABEL[name]} | ${per1000(c.silentlyWrongAtClose, t.prescriptions)} | ${minutesPer1000(c.hiddenMs, t.prescriptions)} | ${c.unowned === null ? "no issue list" : percent(c.unowned, t.failed)} | ${fmtInt(t.prescriptions)} | ${fmtInt(t.failed)} |`;
    }),
  );
  return [...head, ...body].join("\n");
}

export function numbersMd(results: FaultResult[], meta: Meta): string {
  const r = headlineFault(results);
  return `# Numbers

Every number in the README comes from \`pnpm bench\`, which writes this file, \`results/raw/*.json\` and the two tables in the README. Nothing here is edited by hand: \`pnpm verify:numbers\` reruns the bench and fails on any difference.

- Command: \`${meta.command}\`
- Commit: ${meta.commit}
- Machine: ${meta.machine}
- Runs: ${BENCH.seeds} seeds (${r.seeds[0]}–${r.seeds[1]}) × ${BENCH.visits} visits at each fault level. Every number is an aggregate pooled over all prescriptions in those seeds, not a single run.
- Inputs are invented, not measured from any real service: failure rate 8% of prescriptions; terminal webhook delay lognormal (median 3 s, σ 1.5, at least 1 s); at fault level f, each webhook is dropped with probability f/2, delivered late (30 s to 10 min) with probability f, and delivered twice with probability f.
- The full read model's zeros below are by design, and the bench fails if they aren't zero. The conformance test (\`tests/property.test.ts\`) is what checks the design.

## Headline, fault level ${pct(r.fault)}

${scopeLine(r)}

${metricTable(r, HEADLINE_ROWS)}

## Every row, fault level ${pct(r.fault)}

Add-one rows start from "latest event wins, duplicates dropped" and add one rule. Remove-one rows start from this read model and take one rule away.

${metricTable(r, MODELS.map((m) => m.name))}

## Fault sweep

${sweepTable(results)}

## Cost of this read model, fault level ${pct(r.fault)}

"Not confirmed" is honest but not free. These come straight from the invented delay and drop inputs, so read them as a method to refit on real delay data, not as a finding.

${costTable(r)}

## Where each README number comes from

| Number | What it measures | Single run or aggregate | Runs / seeds | Produced by | Raw output |
|---|---|---|---|---|---|
| Headline table | Silently wrong, known failure hidden, failed with no owner, three read models | Aggregate, pooled | ${BENCH.seeds} seeds × ${BENCH.visits} visits | \`pnpm bench\` | \`results/raw/fault-${pct(r.fault).replace("%", "")}.json\` |
| Ablation table | Same three metrics, one rule added or removed | Aggregate, pooled | ${BENCH.seeds} seeds × ${BENCH.visits} visits | \`pnpm bench\` | \`results/raw/fault-${pct(r.fault).replace("%", "")}.json\` |
| Cost of this read model | False "Not confirmed" and false issues | Aggregate, pooled | ${BENCH.seeds} seeds × ${BENCH.visits} visits | \`pnpm bench\` | \`results/raw/fault-${pct(r.fault).replace("%", "")}.json\` |
`;
}

export function rawFileName(fault: number): string {
  return `fault-${Math.round(fault * 100)}.json`;
}

export function rawJson(r: FaultResult, meta: Meta): string {
  return `${JSON.stringify({ meta, ...r }, null, 2)}\n`;
}

/** Lines that legitimately differ between runs on different machines or commits. */
export function isMetaLine(line: string): boolean {
  return line.startsWith("- Commit:") || line.startsWith("- Machine:");
}

export const README_BLOCKS = {
  headline: ["<!-- results:headline -->", "<!-- /results:headline -->"],
  ablation: ["<!-- results:ablation -->", "<!-- /results:ablation -->"],
} as const;

/** Returns the text between a block's markers, or null if the markers are missing. */
export function readBlock(readme: string, block: keyof typeof README_BLOCKS): string | null {
  const [open, close] = README_BLOCKS[block];
  const start = readme.indexOf(open);
  const end = readme.indexOf(close);
  if (start === -1 || end === -1 || end < start) return null;
  return readme.slice(start + open.length, end).replace(/^\n/, "").replace(/\n$/, "");
}

export function writeBlock(readme: string, block: keyof typeof README_BLOCKS, content: string): string {
  const [open, close] = README_BLOCKS[block];
  const start = readme.indexOf(open);
  const end = readme.indexOf(close);
  if (start === -1 || end === -1 || end < start) throw new Error(`README is missing the ${open} block`);
  return `${readme.slice(0, start + open.length)}\n${content}\n${readme.slice(end)}`;
}
