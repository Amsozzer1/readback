// The oracle the full read model is tested against: what a correct screen should show at
// time t, given only the distinct webhooks that had arrived by t. Deliberately written as
// a separate, set-based code path. It shares the ACTIONS table (data) and the staleness
// threshold with the fold, nothing else.

import { ACTIONS, type ProblemKind } from "./actions";
import { STALE_AFTER_MS, type Status } from "./fold";
import type { ErrorCategory, RxEvent } from "./types";

export interface Expected {
  status: Exclude<Status, "sent">;
  category: ErrorCategory | null;
  errorAtMs: number | null;
  nextStep: string | null;
  /** Present after the visit closes for failed or unconfirmed prescriptions. */
  issue: { owner: string; nextStep: string; ageMs: number } | null;
}

/**
 * @param events the raw arrival stream (duplicates included); only events with arrivedMs <= t count
 */
export function knowable(events: readonly RxEvent[], orderId: string, t: number): Expected | null {
  const arrived = events.filter((e) => e.arrivedMs <= t);
  const signed = arrived.find((e) => e.type === "Signed" && e.orderId === orderId);
  if (!signed || signed.type !== "Signed") return null;

  const vendor = arrived.filter((e) => e.type === "VendorEvent" && e.orderId === orderId);
  const errors = vendor.filter((e) => e.type === "VendorEvent" && e.kind === "error");
  const kinds = new Set(vendor.map((e) => (e.type === "VendorEvent" ? e.kind : null)));
  const closedAt = arrived.find((e) => e.type === "VisitClosed" && e.visitId === signed.visitId)?.arrivedMs ?? null;

  const firstError = errors.length ? Math.min(...errors.map((e) => e.arrivedMs)) : null;
  const firstErrorEvent = errors.find((e) => e.arrivedMs === firstError);
  const category = firstErrorEvent?.type === "VendorEvent" ? (firstErrorEvent.category ?? null) : null;

  let status: Expected["status"];
  if (kinds.has("error")) status = "failed";
  else if (kinds.has("delivered")) status = "delivered";
  else if (t - signed.arrivedMs >= STALE_AFTER_MS) status = "not_confirmed";
  else status = "sending";

  const problem: ProblemKind | null =
    status === "failed" ? category : status === "not_confirmed" ? "not_confirmed" : null;
  const closed = closedAt !== null && t >= closedAt;
  const text = problem ? ACTIONS[problem] : null;

  return {
    status,
    category: status === "failed" ? category : null,
    errorAtMs: status === "failed" ? firstError : null,
    nextStep: text ? (closed ? text.afterClose.nextStep : text.inVisit.nextStep) : null,
    issue:
      text && closed
        ? {
            owner: text.afterClose.owner,
            nextStep: text.afterClose.nextStep,
            ageMs: t - Math.min(signed.arrivedMs + STALE_AFTER_MS, firstError ?? Infinity),
          }
        : null,
  };
}
