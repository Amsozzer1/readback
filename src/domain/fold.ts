// The read models. One rule-independent `step` folds events into per-prescription state;
// `view` turns that state into what a pane shows at a moment, under a set of rules.
// The naive baseline, the full read model and every ablation row are the same code with
// different rules, so the comparison can't drift.

import { ACTIONS, type ProblemKind } from "./actions";
import { SECOND, type ErrorCategory, type RxEvent, type VendorKind } from "./types";

export const STALE_AFTER_MS = 90 * SECOND;

export type Kind = "signed" | VendorKind;
const RANK: Record<Kind, number> = { signed: 0, submitted: 1, delivered: 2, error: 3 };

export interface OrderState {
  orderId: string;
  visitId: string;
  pharmacyId: string;
  signedMs: number;
  maxKind: Kind;
  maxCategory: ErrorCategory | null;
  lastKind: Kind;
  lastCategory: ErrorCategory | null;
  lastArrivedMs: number;
  firstErrorArrivedMs: number | null;
  visitClosedMs: number | null;
}

export interface Rules {
  /** A lower- or equal-rank event never overwrites (off: the last arrival wins). */
  rank: boolean;
  /** Only "delivered" is green; signed/submitted show gray "Sending" (off: green "Sent"). */
  greenOnly: boolean;
  /** No delivered or error 90 s after signing shows amber "Not confirmed". */
  staleness: boolean;
  /** Failed and unconfirmed lines carry a next step, and after the visit become owned issues. */
  issues: boolean;
}

export type RuleName = keyof Rules;
export const RULE_NAMES: readonly RuleName[] = ["rank", "greenOnly", "staleness", "issues"];

export interface Model {
  name: string;
  /** Read the log, where repeated deliveries of one webhook are dropped at insert. */
  dedupe: boolean;
  rules: Rules;
}

const ALL_OFF: Rules = { rank: false, greenOnly: false, staleness: false, issues: false };
const ALL_ON: Rules = { rank: true, greenOnly: true, staleness: true, issues: true };

export const NAIVE: Model = { name: "naive", dedupe: false, rules: ALL_OFF };
export const NAIVE_DEDUPE: Model = { name: "naive + dedupe", dedupe: true, rules: ALL_OFF };
export const FULL: Model = { name: "full", dedupe: true, rules: ALL_ON };

export const ADD_ONE: readonly Model[] = RULE_NAMES.map((r) => ({
  name: `naive + dedupe + ${r}`,
  dedupe: true,
  rules: { ...ALL_OFF, [r]: true },
}));
export const REMOVE_ONE: readonly Model[] = RULE_NAMES.map((r) => ({
  name: `full - ${r}`,
  dedupe: true,
  rules: { ...ALL_ON, [r]: false },
}));

export type Status = "sent" | "sending" | "delivered" | "failed" | "not_confirmed";
export type Tone = "green" | "gray" | "red" | "amber";

export interface Issue {
  owner: string;
  nextStep: string;
  queueText: string;
  ageMs: number;
}

export interface Line {
  orderId: string;
  status: Status;
  tone: Tone;
  category: ErrorCategory | null;
  /** Reason shown on the line when failed or not confirmed. */
  reason: string | null;
  /** When the first error arrived, if the line shows Failed. */
  errorAtMs: number | null;
  nextStep: string | null;
  issue: Issue | null;
}

const TONE: Record<Status, Tone> = {
  sent: "green",
  delivered: "green",
  sending: "gray",
  failed: "red",
  not_confirmed: "amber",
};

/** Applies one event to one prescription's state. Independent of rules. */
export function step(state: OrderState | undefined, e: RxEvent): OrderState | undefined {
  switch (e.type) {
    case "Signed":
      if (state) return state;
      return {
        orderId: e.orderId,
        visitId: e.visitId,
        pharmacyId: e.pharmacyId,
        signedMs: e.arrivedMs,
        maxKind: "signed",
        maxCategory: null,
        lastKind: "signed",
        lastCategory: null,
        lastArrivedMs: e.arrivedMs,
        firstErrorArrivedMs: null,
        visitClosedMs: null,
      };
    case "VendorEvent": {
      if (!state) throw new Error(`webhook ${e.key} arrived before its prescription was signed`);
      const category = e.category ?? null;
      const higher = RANK[e.kind] > RANK[state.maxKind];
      return {
        ...state,
        maxKind: higher ? e.kind : state.maxKind,
        maxCategory: higher ? category : state.maxCategory,
        lastKind: e.kind,
        lastCategory: category,
        lastArrivedMs: e.arrivedMs,
        firstErrorArrivedMs:
          e.kind === "error" && state.firstErrorArrivedMs === null ? e.arrivedMs : state.firstErrorArrivedMs,
      };
    }
    case "VisitClosed":
      if (!state || state.visitClosedMs !== null) return state;
      return { ...state, visitClosedMs: e.arrivedMs };
  }
}

/** What a pane shows for one prescription at `atMs`, given state built from events arrived by then. */
export function view(state: OrderState, atMs: number, rules: Rules): Line {
  const kind = rules.rank ? state.maxKind : state.lastKind;
  const category = rules.rank ? state.maxCategory : state.lastCategory;

  let status: Status;
  if (kind === "error") status = "failed";
  else if (kind === "delivered") status = "delivered";
  else if (rules.staleness && atMs - state.signedMs >= STALE_AFTER_MS) status = "not_confirmed";
  else status = rules.greenOnly ? "sending" : "sent";

  const problem: ProblemKind | null =
    status === "failed" ? category : status === "not_confirmed" ? "not_confirmed" : null;
  const text = problem ? ACTIONS[problem] : null;
  const closed = state.visitClosedMs !== null && atMs >= state.visitClosedMs;

  let issue: Issue | null = null;
  if (rules.issues && text && closed) {
    const starts = [
      rules.staleness ? state.signedMs + STALE_AFTER_MS : Infinity,
      state.firstErrorArrivedMs ?? Infinity,
    ];
    issue = {
      owner: text.afterClose.owner,
      nextStep: text.afterClose.nextStep,
      queueText: text.queueText,
      ageMs: atMs - Math.min(...starts),
    };
  }

  return {
    orderId: state.orderId,
    status,
    tone: TONE[status],
    category: status === "failed" ? category : null,
    reason: text ? text.lineText : null,
    errorAtMs: status === "failed" ? state.firstErrorArrivedMs : null,
    nextStep: rules.issues && text ? (closed ? text.afterClose.nextStep : text.inVisit.nextStep) : null,
    issue,
  };
}

/** Keeps the first arrival of each idempotency key, as the log's unique key does at insert. */
export function dedupe(events: readonly RxEvent[]): RxEvent[] {
  const seen = new Set<string>();
  return events.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
}

/**
 * Groups an arrival-ordered stream by prescription, routing each VisitClosed to every
 * prescription of that visit. Each group stays in arrival order.
 */
export function groupByOrder(events: readonly RxEvent[]): Map<string, RxEvent[]> {
  const visitOf = new Map<string, string>();
  for (const e of events) if (e.type === "Signed") visitOf.set(e.orderId, e.visitId);
  const ordersOf = new Map<string, string[]>();
  for (const [orderId, visitId] of visitOf) ordersOf.set(visitId, [...(ordersOf.get(visitId) ?? []), orderId]);

  const groups = new Map<string, RxEvent[]>();
  for (const orderId of visitOf.keys()) groups.set(orderId, []);
  for (const e of events) {
    const targets = e.type === "VisitClosed" ? (ordersOf.get(e.visitId) ?? []) : [e.orderId];
    for (const id of targets) groups.get(id)?.push(e);
  }
  return groups;
}

/** State of one prescription from its arrival-ordered events, counting only those arrived by `atMs`. */
export function stateAt(orderEvents: readonly RxEvent[], atMs: number): OrderState | undefined {
  let state: OrderState | undefined;
  for (const e of orderEvents) {
    if (e.arrivedMs > atMs) break;
    state = step(state, e);
  }
  return state;
}

/** Every line a model shows at `atMs`. `events` is the raw arrival stream, duplicates included. */
export function fold(events: readonly RxEvent[], atMs: number, model: Model): Map<string, Line> {
  const input = model.dedupe ? dedupe(events) : events;
  const lines = new Map<string, Line>();
  for (const [orderId, orderEvents] of groupByOrder(input)) {
    const state = stateAt(orderEvents, atMs);
    if (state) lines.set(orderId, view(state, atMs, model.rules));
  }
  return lines;
}
