import { describe, expect, test } from "vitest";
import { simulate, SUBMITTED_AFTER_MS, TERMINAL_FLOOR_MS, VISIT_CLOSE_MS } from "@/domain/sim";
import { MINUTE, SECOND, type VendorEvent } from "@/domain/types";
import { DEMO, DEMO_REAL, demoEvents } from "@/scenarios/demo";

describe("simulator", () => {
  test("the same seed gives a byte-identical stream", () => {
    const a = JSON.stringify(simulate({ seed: 7, fault: 0.1 }));
    const b = JSON.stringify(simulate({ seed: 7, fault: 0.1 }));
    expect(a).toBe(b);
    expect(JSON.stringify(simulate({ seed: 8, fault: 0.1 }))).not.toBe(a);
  });

  test("the world for a seed is the same at every fault level", () => {
    const calm = simulate({ seed: 3, fault: 0 });
    const rough = simulate({ seed: 3, fault: 0.2 });
    expect(rough.real).toEqual(calm.real);
    expect(rough.visits).toEqual(calm.visits);
  });

  test("at fault 0 every webhook arrives once, when it was emitted", () => {
    const run = simulate({ seed: 11, fault: 0 });
    expect(run.events.every((e) => e.arrivedMs === e.emittedMs && e.copy === 0)).toBe(true);
    expect(run.trace.every((t) => !t.dropped && !t.late && !t.duplicated)).toBe(true);
  });

  test("each prescription emits submitted, then exactly one terminal event matching its real outcome", () => {
    const run = simulate({ seed: 5, fault: 0 });
    for (const r of run.real) {
      const vendor = run.events.filter((e): e is VendorEvent => e.type === "VendorEvent" && e.orderId === r.orderId);
      expect(vendor.map((e) => e.kind)).toEqual(["submitted", r.outcome === "failed" ? "error" : "delivered"]);
      const [submitted, terminal] = vendor;
      expect(submitted!.emittedMs).toBe(r.signedMs + SUBMITTED_AFTER_MS);
      expect(terminal!.emittedMs).toBeGreaterThanOrEqual(r.signedMs + TERMINAL_FLOOR_MS);
      if (r.outcome === "failed") expect(terminal!.category).toBe(r.category);
    }
    const closes = run.events.filter((e) => e.type === "VisitClosed");
    expect(closes).toHaveLength(run.visits.length);
    expect(closes.every((e) => e.arrivedMs === VISIT_CLOSE_MS)).toBe(true);
  });

  test("events come out in arrival order", () => {
    const run = simulate({ seed: 9, fault: 0.2 });
    for (let i = 1; i < run.events.length; i++) {
      expect(run.events[i]!.arrivedMs).toBeGreaterThanOrEqual(run.events[i - 1]!.arrivedMs);
    }
  });

  test("knob rates are within 1 percentage point of the config over at least 10k events each", () => {
    const f = 0.1;
    const trace = Array.from({ length: 200 }, (_, seed) => simulate({ seed, fault: f }).trace).flat();
    const kept = trace.filter((t) => !t.dropped);
    expect(trace.length).toBeGreaterThanOrEqual(10_000);
    expect(kept.length).toBeGreaterThanOrEqual(10_000);
    const rate = (xs: typeof trace, pick: (t: (typeof trace)[number]) => boolean) => xs.filter(pick).length / xs.length;
    expect(Math.abs(rate(trace, (t) => t.dropped) - f / 2)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(rate(kept, (t) => t.late) - f)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(rate(kept, (t) => t.duplicated) - f)).toBeLessThanOrEqual(0.01);
  });

  test("late and duplicate deliveries land 30 s to 10 min after the earlier delivery", () => {
    const run = simulate({ seed: 21, fault: 0.3 });
    for (const e of run.events) {
      if (e.type !== "VendorEvent" || e.arrivedMs === e.emittedMs) continue;
      if (e.copy === 0) {
        expect(e.arrivedMs - e.emittedMs).toBeGreaterThanOrEqual(30 * SECOND);
        expect(e.arrivedMs - e.emittedMs).toBeLessThanOrEqual(10 * MINUTE);
      }
    }
    for (const copy of run.events.filter((e) => e.copy === 1)) {
      const first = run.events.find((e) => e.key === copy.key && e.copy === 0)!;
      expect(copy.arrivedMs - first.arrivedMs).toBeGreaterThanOrEqual(30 * SECOND);
      expect(copy.arrivedMs - first.arrivedMs).toBeLessThanOrEqual(10 * MINUTE);
    }
  });
});

describe("scripted demo stream", () => {
  const events = demoEvents();
  const arrival = (key: string) => events.find((e) => e.key === key)?.arrivedMs;

  test("arrival times match the money shot", () => {
    expect(arrival("signed:demo-lam")).toBe(17 * MINUTE);
    expect(arrival("vm:demo-ser:delivered")).toBe(17 * MINUTE + 3 * SECOND);
    expect(arrival("vm:demo-lam:error")).toBe(17 * MINUTE + 4 * SECOND);
    expect(arrival("vm:demo-lam:submitted")).toBe(19 * MINUTE);
    expect(arrival("closed:demo")).toBe(20 * MINUTE);
  });

  test("trazodone's terminal webhook never arrives, and nothing is a duplicate", () => {
    expect(events.some((e) => e.type === "VendorEvent" && e.orderId === "demo-traz" && e.kind !== "submitted")).toBe(false);
    expect(events.every((e) => e.copy === 0)).toBe(true);
    expect(new Set(events.map((e) => e.key)).size).toBe(events.length);
  });

  test("lamotrigine's late submitted webhook is the first and only delivery of that message", () => {
    const lateOnes = events.filter((e) => e.arrivedMs > e.emittedMs);
    expect(lateOnes.map((e) => e.key)).toEqual(["vm:demo-lam:submitted"]);
  });

  test("frames are in time order inside the scrubber range, and real outcomes cover every order", () => {
    const times = DEMO.frames.map((f) => f.atMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times[0]).toBeGreaterThanOrEqual(DEMO.startMs);
    expect(times.at(-1)).toBeLessThanOrEqual(DEMO.endMs);
    const orderIds = DEMO.meds.flatMap((m) => ("orderId" in m && m.orderId ? [m.orderId] : []));
    expect(DEMO_REAL.map((r) => r.orderId).sort()).toEqual([...orderIds].sort());
  });
});
