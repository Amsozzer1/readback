import type { ErrorCategory, RxEvent, VendorKind } from "@/domain/types";
import { byArrival } from "@/domain/types";

/** Builds a small arrival stream for one visit by hand. Times are ms. */
export function stream() {
  const events: RxEvent[] = [];
  let emitIndex = 0;
  const api = {
    signed(orderId: string, atMs: number, visitId = "v1") {
      events.push({
        type: "Signed", key: `signed:${orderId}`, emitIndex: emitIndex++, emittedMs: atMs, arrivedMs: atMs, copy: 0,
        orderId, visitId, med: "Sertraline", dose: "100 mg", pharmacyId: "ph-larkspur",
      });
      return api;
    },
    vendor(orderId: string, kind: VendorKind, emittedMs: number, arrivedMs = emittedMs,
      opts: { category?: ErrorCategory; key?: string; copy?: 0 | 1 } = {}) {
      const key = opts.key ?? `vm:${orderId}:${kind}`;
      events.push({
        type: "VendorEvent", key, vendorMsgId: key, emitIndex: emitIndex++, emittedMs, arrivedMs, copy: opts.copy ?? 0,
        orderId, kind, ...(kind === "error" ? { category: opts.category ?? "pharmacy_system_down" } : {}),
      });
      return api;
    },
    closed(atMs: number, visitId = "v1") {
      events.push({ type: "VisitClosed", key: `closed:${visitId}`, emitIndex: emitIndex++, emittedMs: atMs, arrivedMs: atMs, copy: 0, visitId });
      return api;
    },
    build(): RxEvent[] {
      return [...events].sort(byArrival);
    },
  };
  return api;
}
