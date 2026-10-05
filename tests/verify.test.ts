import { describe, expect, test } from "vitest";
import { numbersMd, rawFileName, rawJson, readmeAblation, readmeHeadline } from "@/bench/render";
import { runBench } from "@/bench/run";
import { verifyNumbers, type CommittedFiles } from "@/bench/verify";

const results = runBench();
const meta = { command: "pnpm bench", commit: "abc1234", machine: "Test CPU, linux, Node v24" };

function committed(): CommittedFiles {
  return {
    readme: [
      "# Title", "", "<!-- results:headline -->", readmeHeadline(results), "<!-- /results:headline -->", "",
      "<!-- results:ablation -->", readmeAblation(results), "<!-- /results:ablation -->", "",
    ].join("\n"),
    numbersMd: numbersMd(results, meta),
    raw: Object.fromEntries(results.map((r) => [rawFileName(r.fault), rawJson(r, meta)])),
  };
}

describe("verify:numbers", () => {
  test("passes on freshly rendered files, whatever the commit and machine", () => {
    const files = committed();
    files.numbersMd = files.numbersMd.replace("- Machine: Test CPU", "- Machine: Other CPU");
    expect(verifyNumbers(results, files)).toEqual([]);
  });

  test("the bench is deterministic: a second run renders identical files", () => {
    expect(JSON.stringify(runBench())).toBe(JSON.stringify(results));
  });

  test("fails after a hand edit to a raw number", () => {
    const files = committed();
    const name = rawFileName(0.1);
    files.raw[name] = files.raw[name]!.replace(/"silentlyWrongAtClose": (\d+)/, (_, n) => `"silentlyWrongAtClose": ${Number(n) + 1}`);
    expect(verifyNumbers(results, files).join("\n")).toMatch(/results\/raw\/fault-10\.json differs/);
  });

  test("fails after a hand edit to a number in numbers.md", () => {
    const files = committed();
    files.numbersMd = files.numbersMd.replace("| 13.3 |", "| 12.3 |");
    expect(files.numbersMd).not.toBe(committed().numbersMd);
    expect(verifyNumbers(results, files).join("\n")).toMatch(/results\/numbers\.md differs/);
  });

  test("fails after a hand edit to a README table cell, or swapped rows", () => {
    const edited = committed();
    edited.readme = edited.readme.replace("| 670.1 |", "| 67.1 |");
    expect(verifyNumbers(results, edited).join("\n")).toMatch(/README\.md headline table differs/);

    const swapped = committed();
    const [a, b] = ["| Latest event wins | 13.3 |", "| Latest event wins, duplicates dropped | 11.6 |"];
    swapped.readme = swapped.readme.replace(a, "@@A@@").replace(b, a).replace("@@A@@", b);
    expect(verifyNumbers(results, swapped).length).toBeGreaterThan(0);
  });

  test("fails when a results block or raw file is missing", () => {
    const files = committed();
    files.readme = "# Title\n";
    delete files.raw[rawFileName(0)];
    const problems = verifyNumbers(results, files).join("\n");
    expect(problems).toMatch(/no headline results block/);
    expect(problems).toMatch(/fault-0\.json is missing/);
  });
});
