// The simulated e-prescribing service. Seeded and deterministic.
//
// Each signed prescription produces two webhooks: "submitted" shortly after signing, and
// exactly one terminal event ("delivered" or "error"). Delivery to us then misbehaves the
// way webhook delivery does: some events are dropped (an assumption of this project),
// some arrive late (our endpoint timed out and the service retried), some arrive twice.
//
// Two independent random streams: "world" (visits, outcomes, delays) and "faults". The
// world for a seed is the same at every fault level, so fault sweeps compare like with like.

import { MEDS, PHARMACIES } from "./fixtures";
import { Rng } from "./prng";
import {
  byArrival,
  MINUTE,
  SECOND,
  type ErrorCategory,
  type RealOutcome,
  type RxEvent,
  type SignedEvent,
  type VendorEvent,
  type VisitClosedEvent,
} from "./types";

export const VISIT_CLOSE_MS = 20 * MINUTE;
export const SIGN_FROM_MS = 15 * MINUTE;
export const SIGN_TO_MS = 19 * MINUTE;
export const FAILURE_RATE = 0.08;
export const CATEGORY_WEIGHTS: readonly (readonly [ErrorCategory, number])[] = [
  ["pharmacy_cant_take_erx", 0.4],
  ["pharmacy_system_down", 0.25],
  ["patient_details_rejected", 0.2],
  ["prescriber_enrollment", 0.15],
];
export const SUBMITTED_AFTER_MS = 500;
export const TERMINAL_MEDIAN_MS = 3 * SECOND;
export const TERMINAL_SIGMA = 1.5;
export const TERMINAL_FLOOR_MS = 1 * SECOND;
export const RETRY_DELAY_MIN_MS = 30 * SECOND;
export const RETRY_DELAY_MAX_MS = 10 * MINUTE;

export interface SimConfig {
  seed: number;
  /** Fault level f: drop f/2, late first delivery f, duplicate f (see the PRD's knob table). */
  fault: number;
  visits?: number;
}

export interface SimVisit {
  visitId: string;
  usualPharmacyId: string;
  activeMeds: string[];
  orderIds: string[];
}

/** Which faults hit one emitted webhook. Used to check knob rates, never by the read models. */
export interface FaultTrace {
  vendorMsgId: string;
  kind: VendorEvent["kind"];
  dropped: boolean;
  late: boolean;
  duplicated: boolean;
}

export interface SimRun {
  config: Required<SimConfig>;
  /** Everything that reached us, duplicates included, in arrival order. */
  events: RxEvent[];
  real: RealOutcome[];
  visits: SimVisit[];
  trace: FaultTrace[];
}

type Emitted = Omit<SignedEvent, "emitIndex" | "arrivedMs" | "copy">
  | Omit<VendorEvent, "emitIndex" | "arrivedMs" | "copy">
  | Omit<VisitClosedEvent, "emitIndex" | "arrivedMs" | "copy">;

function retryDelay(u: number): number {
  return Math.round(RETRY_DELAY_MIN_MS + u * (RETRY_DELAY_MAX_MS - RETRY_DELAY_MIN_MS));
}

export function simulate(input: SimConfig): SimRun {
  const config: Required<SimConfig> = { visits: 20, ...input };
  if (!(config.fault >= 0 && config.fault <= 1)) throw new Error(`fault must be in [0, 1], got ${config.fault}`);
  const world = new Rng(config.seed, "world");
  const faults = new Rng(config.seed, "faults");

  const emitted: Emitted[] = [];
  const real: RealOutcome[] = [];
  const visits: SimVisit[] = [];

  for (let v = 1; v <= config.visits; v++) {
    const visitId = `v${v}`;
    const activeCount = world.int(3, 6);
    const signedCount = world.int(1, 3);
    const active = world.shuffle(MEDS).slice(0, activeCount);
    const usualPharmacyId = world.pick(PHARMACIES).id;
    const orderIds: string[] = [];

    for (let k = 0; k < signedCount; k++) {
      const med = active[k];
      if (!med) throw new Error("signed more meds than are active");
      const orderId = `${visitId}-o${k + 1}`;
      const signedMs = world.int(SIGN_FROM_MS, SIGN_TO_MS);
      const failed = world.float() < FAILURE_RATE;
      const category = failed ? world.weighted(CATEGORY_WEIGHTS) : undefined;
      const terminalAfter = Math.max(
        TERMINAL_FLOOR_MS,
        Math.round(world.lognormal(TERMINAL_MEDIAN_MS, TERMINAL_SIGMA)),
      );
      orderIds.push(orderId);
      real.push({ orderId, visitId, signedMs, outcome: failed ? "failed" : "delivered", ...(category ? { category } : {}) });

      emitted.push({
        type: "Signed", key: `signed:${orderId}`, emittedMs: signedMs,
        orderId, visitId, med: med.med, dose: med.dose, pharmacyId: usualPharmacyId,
      });
      emitted.push({
        type: "VendorEvent", key: `vm:${orderId}:submitted`, emittedMs: signedMs + SUBMITTED_AFTER_MS,
        vendorMsgId: `vm:${orderId}:submitted`, orderId, kind: "submitted",
      });
      const terminalKind = failed ? "error" : "delivered";
      emitted.push({
        type: "VendorEvent", key: `vm:${orderId}:${terminalKind}`, emittedMs: signedMs + terminalAfter,
        vendorMsgId: `vm:${orderId}:${terminalKind}`, orderId, kind: terminalKind,
        ...(category ? { category } : {}),
      });
    }
    emitted.push({ type: "VisitClosed", key: `closed:${visitId}`, emittedMs: VISIT_CLOSE_MS, visitId });
    visits.push({ visitId, usualPharmacyId, activeMeds: active.map((m) => m.med), orderIds });
  }

  // Emission order: by time, then creation order (Array.prototype.sort is stable).
  const ordered = emitted
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.emittedMs - b.e.emittedMs || a.i - b.i);

  const events: RxEvent[] = [];
  const trace: FaultTrace[] = [];
  ordered.forEach(({ e }, emitIndex) => {
    if (e.type !== "VendorEvent") {
      events.push({ ...e, emitIndex, arrivedMs: e.emittedMs, copy: 0 } as RxEvent);
      return;
    }
    // Always draw all five numbers so one event's faults never shift another's.
    const uDrop = faults.float();
    const uLate = faults.float();
    const uLateDelay = faults.float();
    const uDup = faults.float();
    const uDupDelay = faults.float();
    const dropped = uDrop < config.fault / 2;
    const late = !dropped && uLate < config.fault;
    const duplicated = !dropped && uDup < config.fault;
    trace.push({ vendorMsgId: e.vendorMsgId, kind: e.kind, dropped, late, duplicated });
    if (dropped) return;
    const arrivedMs = e.emittedMs + (late ? retryDelay(uLateDelay) : 0);
    events.push({ ...e, emitIndex, arrivedMs, copy: 0 });
    if (duplicated) events.push({ ...e, emitIndex, arrivedMs: arrivedMs + retryDelay(uDupDelay), copy: 1 });
  });

  events.sort(byArrival);
  return { config, events, real, visits, trace };
}
