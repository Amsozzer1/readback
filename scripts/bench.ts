// pnpm bench: runs every read model over the simulated streams and writes
// results/raw/*.json, results/numbers.md and the two result tables in README.md.
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { collectMeta } from "../src/bench/meta";
import { numbersMd, rawFileName, rawJson, readmeBlocks, writeBlock } from "../src/bench/render";
import { runBench } from "../src/bench/run";

const root = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));

const started = performance.now();
const results = runBench();
const meta = collectMeta("pnpm bench");

await mkdir(root("results/raw"), { recursive: true });
for (const f of await readdir(root("results/raw"))) if (f.endsWith(".json")) await rm(root(`results/raw/${f}`));
for (const r of results) await writeFile(root(`results/raw/${rawFileName(r.fault)}`), rawJson(r, meta));
await writeFile(root("results/numbers.md"), numbersMd(results, meta));

let readme = await readFile(root("README.md"), "utf8");
for (const [block, content] of readmeBlocks(results)) readme = writeBlock(readme, block, content);
await writeFile(root("README.md"), readme);

console.log(`bench: ${results.length} fault levels in ${((performance.now() - started) / 1000).toFixed(1)} s; wrote results/ and README tables`);
