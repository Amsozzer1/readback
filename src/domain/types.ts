// Event and outcome types shared by the simulator, the read models and the bench.
// All times are integer simulated milliseconds from the start of the clinic day's clock.

export type VendorKind = "submitted" | "delivered" | "error";

export type ErrorCategory =
  | "pharmacy_cant_take_erx"
  | "pharmacy_system_down"
  | "patient_details_rejected"
  | "prescriber_enrollment";

interface EventBase {
  /** Idempotency key: the vendor message id for webhooks, a command id for our own events. */
  key: string;
  /** Position in emission order. Ties in arrival time are broken by this. */
  emitIndex: number;
  emittedMs: number;
  arrivedMs: number;
  /** 1 for the second delivery of the same webhook, else 0. */
  copy: 0 | 1;
}

/** We signed and submitted; the e-prescribing service accepted the request synchronously. */
export interface SignedEvent extends EventBase {
  type: "Signed";
  orderId: string;
  visitId: string;
  med: string;
  dose: string;
  pharmacyId: string;
}

/** A webhook from the e-prescribing service. */
export interface VendorEvent extends EventBase {
  type: "VendorEvent";
  vendorMsgId: string;
  orderId: string;
  kind: VendorKind;
  category?: ErrorCategory;
}

export interface VisitClosedEvent extends EventBase {
  type: "VisitClosed";
  visitId: string;
}

export type RxEvent = SignedEvent | VendorEvent | VisitClosedEvent;

/** What really happened to a prescription, known only to the simulator. */
export interface RealOutcome {
  orderId: string;
  visitId: string;
  signedMs: number;
  outcome: "delivered" | "failed";
  category?: ErrorCategory;
}

/** Orders events the way a single writer would apply them: by arrival, then emission order. */
export function byArrival(a: RxEvent, b: RxEvent): number {
  return a.arrivedMs - b.arrivedMs || a.emitIndex - b.emitIndex || a.copy - b.copy;
}

export const SECOND = 1_000;
export const MINUTE = 60_000;

/** "mm:ss" for a sim time, e.g. 1_024_000 -> "17:04". */
export function clock(ms: number): string {
  const totalSeconds = Math.floor(ms / SECOND);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
