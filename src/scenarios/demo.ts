// The scripted visit behind the compare view. Hand-written, synthetic, and labeled as
// scripted on screen. The README's numbers come from random seeds, not from this file.

import { byArrival, MINUTE, SECOND, type RealOutcome, type RxEvent } from "../domain/types";

export interface DemoMed {
  med: string;
  dose: string;
  /** Previous dose when this visit changes it, shown inline as "100 → 150 mg". */
  doseBefore?: string;
  sig: string;
  /** Present when the med is sent today. */
  orderId?: string;
  pharmacyId?: string;
  /** Quiet text for meds not sent today. */
  note?: string;
}

export interface DemoFrame {
  atMs: number;
  label: string;
  note: string;
}

const SIGNED_MS = 17 * MINUTE;

export const DEMO = {
  visitId: "demo",
  patient: "A. Morgan",
  visitLabel: "Follow-up, telehealth, 20 min",
  usualPharmacyId: "ph-larkspur",
  priorVisit: [
    "Last visit Sep 8 (4 weeks ago): bipolar II follow-up",
    "Since then: lamotrigine 50 → 100 mg; sertraline unchanged",
    "PHQ-9 14 → 9 · GAD-7 11 → 8",
  ],
  meds: [
    { med: "Lamotrigine", dose: "150 mg", doseBefore: "100 mg", sig: "1 tab daily", orderId: "demo-lam", pharmacyId: "ph-northgate" },
    { med: "Sertraline", dose: "100 mg", sig: "1 tab daily", orderId: "demo-ser", pharmacyId: "ph-larkspur" },
    { med: "Trazodone", dose: "50 mg", sig: "1 tab at bedtime", orderId: "demo-traz", pharmacyId: "ph-larkspur" },
    { med: "Bupropion XL", dose: "300 mg", sig: "1 tab every morning", note: "refills remain · last sent Sep 8" },
    { med: "Hydroxyzine", dose: "25 mg", sig: "1 tab up to 3x daily as needed", note: "refills remain · last sent Sep 8" },
  ] satisfies DemoMed[],
  startMs: 16 * MINUTE + 30 * SECOND,
  endMs: 30 * MINUTE,
  frames: [
    { atMs: SIGNED_MS, label: "17:00 signed", note: "Three prescriptions signed and submitted." },
    { atMs: SIGNED_MS + 4 * SECOND, label: "17:04 error", note: "The service returns an error for lamotrigine." },
    { atMs: 19 * MINUTE, label: "19:00 late webhook", note: "Arrived late, not a duplicate: dropping duplicates doesn't catch it." },
    { atMs: 25 * MINUTE, label: "25:00 after the visit", note: "The visit ended at 20:00. Who owns each problem now?" },
  ] satisfies DemoFrame[],
} as const;

// Omit distributed over the union, so each event type keeps its own fields.
type Draft = RxEvent extends infer E ? (E extends RxEvent ? Omit<E, "emitIndex"> : never) : never;

function draft(): Draft[] {
  const at = (ms: number) => ({ emittedMs: ms, arrivedMs: ms, copy: 0 as const });
  const signed = (orderId: string, med: string, dose: string, pharmacyId: string): Draft => ({
    type: "Signed", key: `signed:${orderId}`, ...at(SIGNED_MS),
    orderId, visitId: DEMO.visitId, med, dose, pharmacyId,
  });
  return [
    signed("demo-lam", "Lamotrigine", "150 mg", "ph-northgate"),
    signed("demo-ser", "Sertraline", "100 mg", "ph-larkspur"),
    signed("demo-traz", "Trazodone", "50 mg", "ph-larkspur"),
    // Lamotrigine's "submitted" first reaches us at 19:00: our endpoint timed out at 17:00
    // and the service retried. It is not a duplicate; no earlier copy was ever stored.
    { type: "VendorEvent", key: "vm:demo-lam:submitted", vendorMsgId: "vm:demo-lam:submitted", orderId: "demo-lam",
      kind: "submitted", emittedMs: SIGNED_MS + 500, arrivedMs: 19 * MINUTE, copy: 0 },
    { type: "VendorEvent", key: "vm:demo-ser:submitted", vendorMsgId: "vm:demo-ser:submitted", orderId: "demo-ser",
      kind: "submitted", ...at(SIGNED_MS + 500) },
    { type: "VendorEvent", key: "vm:demo-traz:submitted", vendorMsgId: "vm:demo-traz:submitted", orderId: "demo-traz",
      kind: "submitted", ...at(SIGNED_MS + 500) },
    { type: "VendorEvent", key: "vm:demo-ser:delivered", vendorMsgId: "vm:demo-ser:delivered", orderId: "demo-ser",
      kind: "delivered", ...at(SIGNED_MS + 3 * SECOND) },
    { type: "VendorEvent", key: "vm:demo-lam:error", vendorMsgId: "vm:demo-lam:error", orderId: "demo-lam",
      kind: "error", category: "pharmacy_cant_take_erx", ...at(SIGNED_MS + 4 * SECOND) },
    // Trazodone's terminal webhook (an error) is never delivered to us.
    { type: "VisitClosed", key: `closed:${DEMO.visitId}`, visitId: DEMO.visitId, ...at(20 * MINUTE) },
  ] as Draft[];
}

/** The scripted arrival stream, with emission indexes assigned like the simulator does. */
export function demoEvents(): RxEvent[] {
  const drafts = draft();
  const emitOrder = drafts
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.emittedMs - b.e.emittedMs || a.i - b.i);
  const events = emitOrder.map(({ e }, emitIndex) => ({ ...e, emitIndex }) as RxEvent);
  return events.sort(byArrival);
}

/** What really happened. Used only by tests; the screen never sees it. */
export const DEMO_REAL: readonly RealOutcome[] = [
  { orderId: "demo-lam", visitId: "demo", signedMs: SIGNED_MS, outcome: "failed", category: "pharmacy_cant_take_erx" },
  { orderId: "demo-ser", visitId: "demo", signedMs: SIGNED_MS, outcome: "delivered" },
  { orderId: "demo-traz", visitId: "demo", signedMs: SIGNED_MS, outcome: "failed", category: "pharmacy_system_down" },
];
