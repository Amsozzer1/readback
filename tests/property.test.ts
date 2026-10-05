// Conformance test: the full read model must show exactly what the separately written
// `knowable` oracle says at every sampled moment, over 500 seeds at two fault levels.
// Then two checks that the test has teeth: turning off any one rule must make it fail,
// and injecting duplicate webhooks must change nothing.

import { describe, expect, test } from "vitest";
import {
  dedupe, FULL, groupByOrder, REMOVE_ONE, STALE_AFTER_MS, stateAt, view, type Line, type Model,
} from "@/domain/fold";
import { knowable } from "@/domain/knowable";
import { Rng } from "@/domain/prng";
import { simulate, VISIT_CLOSE_MS } from "@/domain/sim";
import { byArrival, type RxEvent } from "@/domain/types";

const SEEDS = 500;
const FAULTS = [0.1, 0.2];
const TIMEOUT_MS = 120_000;

/** Times worth checking for one prescription: every arrival, the staleness edge ± 1 ms, close, end of run. */
function sampleTimes(orderEvents: readonly RxEvent[], signedMs: number, endOfRun: number): number[] {
  const t = new Set<number>(orderEvents.map((e) => e.arrivedMs));
  const stale = signedMs + STALE_AFTER_MS;
  [stale - 1, stale, stale + 1, VISIT_CLOSE_MS, endOfRun].forEach((x) => t.add(x));
  return [...t].sort((a, b) => a - b);
}

/** Raw events relevant to one prescription, picked without the fold's own grouping helper. */
function rawFor(events: readonly RxEvent[], orderId: string, visitId: string): RxEvent[] {
  return events.filter((e) =>
    e.type === "VisitClosed" ? e.visitId === visitId : e.orderId === orderId,
  );
}

function project(line: Line) {
  return {
    status: line.status,
    category: line.category,
    errorAtMs: line.errorAtMs,
    nextStep: line.nextStep,
    issue: line.issue ? { owner: line.issue.owner, nextStep: line.issue.nextStep, ageMs: line.issue.ageMs } : null,
  };
}

/** First disagreement between a model and the oracle on one seed, or null. */
function firstMismatch(events: readonly RxEvent[], model: Model): string | null {
  const endOfRun = events.reduce((m, e) => Math.max(m, e.arrivedMs), 0);
  const log = model.dedupe ? dedupe(events) : [...events];
  for (const [orderId, orderEvents] of groupByOrder(log)) {
    const signed = orderEvents.find((e) => e.type === "Signed");
    if (!signed || signed.type !== "Signed") continue;
    const raw = rawFor(events, orderId, signed.visitId);
    for (const t of sampleTimes(orderEvents, signed.arrivedMs, endOfRun)) {
      const got = project(view(stateAt(orderEvents, t)!, t, model.rules));
      const want = knowable(raw, orderId, t);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        return `${orderId} at ${t}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`;
      }
    }
  }
  return null;
}

describe("conformance: full read model == knowable", () => {
  for (const fault of FAULTS) {
    test(`${SEEDS} seeds at fault ${fault}`, { timeout: TIMEOUT_MS }, () => {
      for (let seed = 0; seed < SEEDS; seed++) {
        const mismatch = firstMismatch(simulate({ seed, fault }).events, FULL);
        expect(mismatch, `seed ${seed}`).toBeNull();
      }
    });
  }
});

describe("ablation: removing any one rule breaks conformance", () => {
  for (const model of REMOVE_ONE) {
    test(model.name, { timeout: TIMEOUT_MS }, () => {
      let found: string | null = null;
      search: for (const fault of FAULTS) {
        for (let seed = 0; seed < SEEDS; seed++) {
          found = firstMismatch(simulate({ seed, fault }).events, model);
          if (found) break search;
        }
      }
      expect(found, `${model.name} never disagreed with the oracle`).not.toBeNull();
    });
  }
});

describe("idempotence: duplicate webhooks change nothing", () => {
  test("copies with the same or a new id, arriving after the original, leave every line unchanged", { timeout: TIMEOUT_MS }, () => {
    for (let seed = 0; seed < 100; seed++) {
      const events = simulate({ seed, fault: 0.1 }).events;
      const rng = new Rng(seed, "inject");
      const copies: RxEvent[] = [];
      for (const e of dedupe(events)) {
        if (e.type !== "VendorEvent" || rng.float() >= 0.3) continue;
        const newId = rng.float() < 0.5;
        const key = newId ? `${e.key}:resent` : e.key;
        copies.push({ ...e, key, vendorMsgId: key, arrivedMs: e.arrivedMs + rng.int(1, 600_000), copy: 1 });
      }
      const injected = [...events, ...copies].sort(byArrival);
      const times = [...new Set([...injected.map((e) => e.arrivedMs), VISIT_CLOSE_MS])];
      const before = groupByOrder(dedupe(events));
      const after = groupByOrder(dedupe(injected));
      for (const [orderId, orderEvents] of before) {
        const signedMs = orderEvents[0]!.arrivedMs;
        for (const t of [...times, signedMs + STALE_AFTER_MS - 1, signedMs + STALE_AFTER_MS]) {
          const a = stateAt(orderEvents, t);
          const b = stateAt(after.get(orderId)!, t);
          if (!a) continue;
          expect(view(b!, t, FULL.rules), `seed ${seed} ${orderId} at ${t}`).toEqual(view(a, t, FULL.rules));
        }
      }
    }
  });
});
