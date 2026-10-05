import { describe, expect, test } from "vitest";
import { fold, FULL, NAIVE, NAIVE_DEDUPE, REMOVE_ONE, type Line, type Model } from "@/domain/fold";
import { MINUTE, SECOND } from "@/domain/types";
import { DEMO, demoEvents } from "@/scenarios/demo";
import { stream } from "./helpers";

const at = (events: ReturnType<ReturnType<typeof stream>["build"]>, t: number, model: Model, id = "o1"): Line =>
  fold(events, t, model).get(id)!;
const fullMinus = (rule: string) => REMOVE_ONE.find((m) => m.name === `full - ${rule}`)!;

describe("read models", () => {
  test("a repeated delivery of an old webhook fools the naive model only", () => {
    const events = stream()
      .signed("o1", 0)
      .vendor("o1", "submitted", 500)
      .vendor("o1", "error", 4_000)
      .vendor("o1", "submitted", 500, 60_000, { copy: 1 })
      .build();
    expect(at(events, 60_000, NAIVE).status).toBe("sent");
    expect(at(events, 60_000, NAIVE_DEDUPE).status).toBe("failed");
    expect(at(events, 60_000, FULL).status).toBe("failed");
  });

  test("a late first delivery after the error fools naive + dedupe; rank keeps it Failed", () => {
    const events = stream().signed("o1", 0).vendor("o1", "error", 4_000).vendor("o1", "submitted", 500, 120_000).build();
    expect(at(events, 120_000, NAIVE_DEDUPE).status).toBe("sent");
    expect(at(events, 120_000, fullMinus("rank")).status).toBe("not_confirmed");
    const full = at(events, 120_000, FULL);
    expect(full.status).toBe("failed");
    expect(full.errorAtMs).toBe(4_000);
  });

  test("delivered before submitted (reordered) stays Delivered under rank", () => {
    const events = stream().signed("o1", 0).vendor("o1", "delivered", 3_000).vendor("o1", "submitted", 500, 45_000).build();
    expect(at(events, 45_000, FULL).status).toBe("delivered");
    expect(at(events, 45_000, NAIVE_DEDUPE).status).toBe("sent");
  });

  test("a dropped terminal webhook: Sending, then Not confirmed at 90 s; naive says Sent forever", () => {
    const events = stream().signed("o1", 0).vendor("o1", "submitted", 500).build();
    expect(at(events, 89_999, FULL).status).toBe("sending");
    expect(at(events, 90_000, FULL).status).toBe("not_confirmed");
    expect(at(events, 90_000, FULL).tone).toBe("amber");
    expect(at(events, 10 * MINUTE, NAIVE).status).toBe("sent");
    expect(at(events, 10 * MINUTE, NAIVE).tone).toBe("green");
  });

  test("green only on delivery: signed and submitted show gray Sending", () => {
    const events = stream().signed("o1", 0).vendor("o1", "submitted", 500).build();
    expect(at(events, 1_000, FULL)).toMatchObject({ status: "sending", tone: "gray" });
    expect(at(events, 1_000, fullMinus("greenOnly"))).toMatchObject({ status: "sent", tone: "green" });
  });

  test("an error after the visit closed turns an unconfirmed issue into a failed one, keeping its age", () => {
    const events = stream()
      .signed("o1", 0)
      .vendor("o1", "submitted", 500)
      .closed(5 * MINUTE)
      .vendor("o1", "error", 2_000, 8 * MINUTE, { category: "patient_details_rejected" })
      .build();
    const before = at(events, 6 * MINUTE, FULL);
    expect(before.status).toBe("not_confirmed");
    expect(before.issue).toMatchObject({ owner: "Ops", nextStep: "Call the pharmacy to confirm it arrived" });
    expect(before.issue!.ageMs).toBe(6 * MINUTE - 90 * SECOND);
    const after = at(events, 9 * MINUTE, FULL);
    expect(after.status).toBe("failed");
    expect(after.issue).toMatchObject({ owner: "Ops", nextStep: "Fix details and resend" });
    expect(after.issue!.ageMs).toBe(9 * MINUTE - 90 * SECOND);
  });

  test("equal rank keeps the first arrival's category and time", () => {
    const events = stream()
      .signed("o1", 0)
      .vendor("o1", "error", 3_000, 3_000, { category: "pharmacy_system_down" })
      .vendor("o1", "error", 3_000, 70_000, { category: "prescriber_enrollment", key: "vm:o1:error:resent" })
      .build();
    const line = at(events, 80_000, FULL);
    expect(line.category).toBe("pharmacy_system_down");
    expect(line.errorAtMs).toBe(3_000);
  });

  test("with rank off the line shows only the last-arrived event", () => {
    const events = stream().signed("o1", 0).vendor("o1", "delivered", 2_000).vendor("o1", "submitted", 500, 50_000).build();
    expect(at(events, 50_000, fullMinus("rank")).status).toBe("sending");
    expect(at(events, 50_000, FULL).status).toBe("delivered");
  });

  test("the naive models show no next steps and open no issues", () => {
    const events = stream().signed("o1", 0).vendor("o1", "error", 3_000).closed(MINUTE).build();
    const line = at(events, 2 * MINUTE, NAIVE);
    expect(line.status).toBe("failed");
    expect(line.nextStep).toBeNull();
    expect(line.issue).toBeNull();
  });
});

describe("the four demo frames", () => {
  const events = demoEvents();
  const [f1, f2, f3, f4] = DEMO.frames.map((f) => f.atMs) as [number, number, number, number];
  const statuses = (t: number, model: Model) =>
    Object.fromEntries([...fold(events, t, model)].map(([id, l]) => [id, l.status]));

  test("17:00: left says Sent for all three, right says Sending", () => {
    expect(statuses(f1, NAIVE_DEDUPE)).toEqual({ "demo-lam": "sent", "demo-ser": "sent", "demo-traz": "sent" });
    expect(statuses(f1, FULL)).toEqual({ "demo-lam": "sending", "demo-ser": "sending", "demo-traz": "sending" });
  });

  test("17:04: both show the lamotrigine error; sertraline delivered", () => {
    expect(statuses(f2, NAIVE_DEDUPE)).toEqual({ "demo-lam": "failed", "demo-ser": "delivered", "demo-traz": "sent" });
    expect(statuses(f2, FULL)).toEqual({ "demo-lam": "failed", "demo-ser": "delivered", "demo-traz": "sending" });
    expect(fold(events, f2, FULL).get("demo-lam")!.nextStep).toBe("Ask patient for another pharmacy");
  });

  test("19:00: the late webhook flips the left back to Sent; the right keeps Failed and flags trazodone", () => {
    const left = fold(events, f3, NAIVE_DEDUPE).get("demo-lam")!;
    expect(left).toMatchObject({ status: "sent", tone: "green", errorAtMs: null, reason: null });
    const right = fold(events, f3, FULL);
    expect(right.get("demo-lam")).toMatchObject({
      status: "failed",
      reason: "This pharmacy can't take e-prescriptions",
      nextStep: "Ask patient for another pharmacy",
      errorAtMs: 17 * MINUTE + 4 * SECOND,
    });
    expect(right.get("demo-traz")!.status).toBe("not_confirmed");
  });

  test("25:00: left still says Sent; right has two owned issues aged 7:56 and 6:30", () => {
    expect(statuses(f4, NAIVE_DEDUPE)).toEqual({ "demo-lam": "sent", "demo-ser": "delivered", "demo-traz": "sent" });
    const right = fold(events, f4, FULL);
    expect(right.get("demo-lam")!.issue).toMatchObject({ owner: "Care team", ageMs: 7 * MINUTE + 56 * SECOND });
    expect(right.get("demo-traz")!.issue).toMatchObject({ owner: "Ops", ageMs: 6 * MINUTE + 30 * SECOND });
    expect(right.get("demo-ser")!.issue).toBeNull();
  });
});
