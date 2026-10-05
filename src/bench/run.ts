// The bench: every read-model row against the same simulated streams, at four fault levels.
// Pure and deterministic; scripts/bench.ts writes the results and scripts/verify-numbers.ts
// reruns this to check the committed files.

import {
  ADD_ONE, dedupe, FULL, groupByOrder, NAIVE, NAIVE_DEDUPE, REMOVE_ONE, STALE_AFTER_MS, stateAt, view,
  type Model,
} from "../domain/fold";
import { simulate, VISIT_CLOSE_MS } from "../domain/sim";
import { MINUTE, SECOND, type RealOutcome, type RxEvent } from "../domain/types";

export const BENCH = {
  seeds: 200,
  visits: 20,
  faults: [0, 0.05, 0.1, 0.2],
  headlineFault: 0.1,
  thresholdsMs: [60 * SECOND, 90 * SECOND, 180 * SECOND],
} as const;

/** Every row: three baselines, then add-one and remove-one ablations. */
export const MODELS: readonly Model[] = [NAIVE, NAIVE_DEDUPE, FULL, ...ADD_ONE, ...REMOVE_ONE];

/** "Known failure hidden" is counted from the error's arrival up to here. */
export const HIDDEN_UNTIL_MS = VISIT_CLOSE_MS + 60 * MINUTE;
/** "Failed with no owner" is checked here. */
export const OWNER_CHECK_MS = VISIT_CLOSE_MS + 10 * MINUTE;
/** False issues are looked for from close to here. */
export const ISSUE_WINDOW_END_MS = VISIT_CLOSE_MS + 60 * MINUTE;

export interface ModelCounts {
  /** Shown green at visit close while the prescription really failed. */
  silentlyWrongAtClose: number;
  /** Ms a prescription whose error had arrived was shown as anything but Failed. */
  hiddenMs: number;
  /** Really failed, no open issue at close + 10 min. Null when the model has no issue list. */
  unowned: number | null;
}

export interface FalseAlarmCounts {
  /** Per staleness threshold (ms): shown Not confirmed, then delivered. */
  transient: Record<string, number>;
  /** Really delivered, issue opened after close, confirmation never arrived. */
  issuesDropped: number;
  /** Really delivered, issue opened after close, confirmation arrived later. */
  issuesLate: number;
  /** For issuesLate: ms from visit close to the confirmation's arrival. */
  lateResolveMs: number[];
}

export interface SeedResult {
  seed: number;
  prescriptions: number;
  failed: number;
  delivered: number;
  models: Record<string, ModelCounts>;
  falseAlarms: FalseAlarmCounts;
}

export interface FaultResult {
  fault: number;
  seeds: [number, number];
  visits: number;
  totals: Omit<SeedResult, "seed">;
  perSeed: SeedResult[];
}

function emptyCounts(model: Model): ModelCounts {
  return { silentlyWrongAtClose: 0, hiddenMs: 0, unowned: model.rules.issues ? 0 : null };
}

function emptyFalseAlarms(): FalseAlarmCounts {
  return {
    transient: Object.fromEntries(BENCH.thresholdsMs.map((t) => [String(t), 0])),
    issuesDropped: 0,
    issuesLate: 0,
    lateResolveMs: [],
  };
}

function uniqueSorted(xs: number[]): number[] {
  return [...new Set(xs)].sort((a, b) => a - b);
}

function measureOrder(
  real: RealOutcome,
  raw: readonly RxEvent[],
  logged: readonly RxEvent[],
  endOfRun: number,
  out: SeedResult,
): void {
  const firstError = raw.find((e) => e.type === "VendorEvent" && e.kind === "error")?.arrivedMs ?? null;
  const firstDelivered = raw.find((e) => e.type === "VendorEvent" && e.kind === "delivered")?.arrivedMs ?? null;
  const failed = real.outcome === "failed";

  for (const model of MODELS) {
    const events = model.dedupe ? logged : raw;
    const lineAt = (t: number) => view(stateAt(events, t)!, t, model.rules);
    const counts = out.models[model.name]!;

    if (failed && lineAt(VISIT_CLOSE_MS).tone === "green") counts.silentlyWrongAtClose++;

    if (firstError !== null && firstError < HIDDEN_UNTIL_MS) {
      // Status only changes when an event arrives or the staleness threshold passes.
      const points = uniqueSorted([
        firstError,
        ...events.map((e) => e.arrivedMs).filter((t) => t > firstError && t < HIDDEN_UNTIL_MS),
        ...[real.signedMs + STALE_AFTER_MS].filter((t) => t > firstError && t < HIDDEN_UNTIL_MS),
        HIDDEN_UNTIL_MS,
      ]);
      for (let i = 0; i + 1 < points.length; i++) {
        if (lineAt(points[i]!).status !== "failed") counts.hiddenMs += points[i + 1]! - points[i]!;
      }
    }

    if (counts.unowned !== null && failed && lineAt(OWNER_CHECK_MS).issue === null) counts.unowned++;
  }

  // Cost of the full read model, for prescriptions that were really delivered.
  if (!failed) {
    for (const threshold of BENCH.thresholdsMs) {
      const stale = view(stateAt(logged, real.signedMs + threshold)!, real.signedMs + threshold, FULL.rules, threshold);
      const later = view(stateAt(logged, endOfRun)!, endOfRun, FULL.rules, threshold);
      if (stale.status === "not_confirmed" && later.status === "delivered") out.falseAlarms.transient[String(threshold)]!++;
    }
    const points = uniqueSorted([
      VISIT_CLOSE_MS,
      real.signedMs + STALE_AFTER_MS,
      ...logged.map((e) => e.arrivedMs),
    ]).filter((t) => t >= VISIT_CLOSE_MS && t <= ISSUE_WINDOW_END_MS);
    const hadIssue = points.some((t) => view(stateAt(logged, t)!, t, FULL.rules).issue !== null);
    if (hadIssue) {
      if (firstDelivered === null) out.falseAlarms.issuesDropped++;
      else {
        out.falseAlarms.issuesLate++;
        out.falseAlarms.lateResolveMs.push(firstDelivered - VISIT_CLOSE_MS);
      }
    }
  }
}

export function benchSeed(seed: number, fault: number): SeedResult {
  const run = simulate({ seed, fault, visits: BENCH.visits });
  const endOfRun = run.events.reduce((m, e) => Math.max(m, e.arrivedMs), 0);
  const raw = groupByOrder(run.events);
  const logged = groupByOrder(dedupe(run.events));
  const out: SeedResult = {
    seed,
    prescriptions: run.real.length,
    failed: run.real.filter((r) => r.outcome === "failed").length,
    delivered: run.real.filter((r) => r.outcome === "delivered").length,
    models: Object.fromEntries(MODELS.map((m) => [m.name, emptyCounts(m)])),
    falseAlarms: emptyFalseAlarms(),
  };
  for (const real of run.real) measureOrder(real, raw.get(real.orderId)!, logged.get(real.orderId)!, endOfRun, out);
  return out;
}

function addInto(total: Omit<SeedResult, "seed">, s: SeedResult): void {
  total.prescriptions += s.prescriptions;
  total.failed += s.failed;
  total.delivered += s.delivered;
  for (const [name, c] of Object.entries(s.models)) {
    const t = total.models[name]!;
    t.silentlyWrongAtClose += c.silentlyWrongAtClose;
    t.hiddenMs += c.hiddenMs;
    if (t.unowned !== null && c.unowned !== null) t.unowned += c.unowned;
  }
  for (const [k, v] of Object.entries(s.falseAlarms.transient)) total.falseAlarms.transient[k]! += v;
  total.falseAlarms.issuesDropped += s.falseAlarms.issuesDropped;
  total.falseAlarms.issuesLate += s.falseAlarms.issuesLate;
  total.falseAlarms.lateResolveMs.push(...s.falseAlarms.lateResolveMs);
}

export function benchFault(fault: number): FaultResult {
  const perSeed = Array.from({ length: BENCH.seeds }, (_, seed) => benchSeed(seed, fault));
  const totals: Omit<SeedResult, "seed"> = {
    prescriptions: 0,
    failed: 0,
    delivered: 0,
    models: Object.fromEntries(MODELS.map((m) => [m.name, emptyCounts(m)])),
    falseAlarms: emptyFalseAlarms(),
  };
  for (const s of perSeed) addInto(totals, s);
  totals.falseAlarms.lateResolveMs.sort((a, b) => a - b);

  // The full read model is built so these are zero; a nonzero value is a bug, not a result.
  const full = totals.models[FULL.name]!;
  if (full.silentlyWrongAtClose !== 0 || full.hiddenMs !== 0 || full.unowned !== 0) {
    throw new Error(`full read model broke its guarantees at fault ${fault}: ${JSON.stringify(full)}`);
  }
  return { fault, seeds: [0, BENCH.seeds - 1], visits: BENCH.visits, totals, perSeed };
}

export function runBench(): FaultResult[] {
  return BENCH.faults.map(benchFault);
}
