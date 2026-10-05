// pnpm verify:numbers: reruns the bench in memory and fails if the committed raw results,
// results/numbers.md or the README's result tables differ from what it produces. Only the
// commit and machine metadata are excluded.
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runBench } from "../src/bench/run";
import { verifyNumbers } from "../src/bench/verify";

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

const rawNames = (await readdir(root("results/raw")).catch(() => [] as string[])).filter((f) => f.endsWith(".json"));
const raw = Object.fromEntries(
  await Promise.all(rawNames.map(async (n) => [n, await readFile(root(`results/raw/${n}`), "utf8")] as const)),
);
const problems = verifyNumbers(runBench(), {
  readme: await readFile(root("README.md"), "utf8"),
  numbersMd: await readFile(root("results/numbers.md"), "utf8"),
  raw,
});

if (problems.length) {
  console.error(`verify:numbers: ${problems.length} problem(s)\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("verify:numbers: raw results, results/numbers.md and README tables match a fresh run");
