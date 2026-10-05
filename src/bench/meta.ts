import { execFileSync } from "node:child_process";
import os from "node:os";
import type { Meta } from "./render";

/** Commit and machine for the record. CPU and OS only: never paths. */
export function collectMeta(command: string): Meta {
  let commit = "unknown";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    // The bench's own outputs don't count as uncommitted code.
    const dirty = execFileSync(
      "git", ["status", "--porcelain", "--untracked-files=no", "--", ".", ":!results", ":!README.md"],
      { encoding: "utf8" },
    ).trim();
    if (dirty) commit += " (with uncommitted changes)";
  } catch {
    // Not a git checkout; leave "unknown".
  }
  const cpu = os.cpus()[0]?.model ?? "unknown CPU";
  return { command, commit, machine: `${cpu}, ${os.platform()} ${os.release()}, Node ${process.version}` };
}
