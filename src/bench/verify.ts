// The comparison behind `pnpm verify:numbers`, separated from disk access so tests can
// feed it edited copies and check it notices.

import { isMetaLine, numbersMd, rawFileName, rawJson, readBlock, readmeAblation, readmeHeadline } from "./render";
import type { FaultResult } from "./run";

export interface CommittedFiles {
  readme: string;
  numbersMd: string;
  /** results/raw/*.json by file name. */
  raw: Record<string, string>;
}

const PLACEHOLDER_META = { command: "pnpm bench", commit: "", machine: "" };

function firstDiff(committed: string, rerun: string): string {
  const a = committed.split("\n");
  const b = rerun.split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `line ${i + 1}:\n    committed: ${a[i] ?? "(missing)"}\n    rerun:     ${b[i] ?? "(missing)"}`;
  }
  return "no line differs";
}

function withoutMeta(text: string): string {
  return text.split("\n").filter((l) => !isMetaLine(l)).join("\n");
}

/** Every way the committed files differ from a fresh run. Empty means they match. */
export function verifyNumbers(results: FaultResult[], files: CommittedFiles): string[] {
  const problems: string[] = [];

  const expectedRaw = new Map(results.map((r) => [rawFileName(r.fault), rawJson(r, PLACEHOLDER_META)]));
  for (const name of new Set([...Object.keys(files.raw), ...expectedRaw.keys()])) {
    const committedText = files.raw[name];
    const expectedText = expectedRaw.get(name);
    if (committedText === undefined) { problems.push(`results/raw/${name} is missing`); continue; }
    if (expectedText === undefined) { problems.push(`results/raw/${name} is not produced by the bench`); continue; }
    const { meta: _a, ...committed } = JSON.parse(committedText);
    const { meta: _b, ...expected } = JSON.parse(expectedText);
    const a = JSON.stringify(committed, null, 2);
    const b = JSON.stringify(expected, null, 2);
    if (a !== b) problems.push(`results/raw/${name} differs, ${firstDiff(a, b)}`);
  }

  const expectedMd = withoutMeta(numbersMd(results, PLACEHOLDER_META));
  if (withoutMeta(files.numbersMd) !== expectedMd) {
    problems.push(`results/numbers.md differs, ${firstDiff(withoutMeta(files.numbersMd), expectedMd)}`);
  }

  for (const [block, expected] of [["headline", readmeHeadline(results)], ["ablation", readmeAblation(results)]] as const) {
    const committed = readBlock(files.readme, block);
    if (committed === null) problems.push(`README.md has no ${block} results block`);
    else if (committed !== expected) problems.push(`README.md ${block} table differs, ${firstDiff(committed, expected)}`);
  }
  return problems;
}
