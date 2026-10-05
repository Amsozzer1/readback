// Who acts on a failed or unconfirmed prescription, and what the screen tells them to do.
// No next step claims work the system does on its own: retries are not modeled.

import type { ErrorCategory } from "./types";

export type ProblemKind = ErrorCategory | "not_confirmed";

export interface Action {
  owner: string;
  nextStep: string;
}

export interface ProblemText {
  /** Shown on the medication line. */
  lineText: string;
  /** Shown in the clinic queue after the visit. */
  queueText: string;
  inVisit: Action;
  afterClose: Action;
}

export const ACTIONS: Record<ProblemKind, ProblemText> = {
  pharmacy_cant_take_erx: {
    lineText: "This pharmacy can't take e-prescriptions",
    queueText: "Pharmacy can't take e-prescriptions (directory out of date)",
    inVisit: { owner: "Clinician", nextStep: "Ask patient for another pharmacy" },
    afterClose: { owner: "Care team", nextStep: "Get another pharmacy from patient; clinician re-signs" },
  },
  pharmacy_system_down: {
    lineText: "Pharmacy system down",
    queueText: "Pharmacy system down",
    inVisit: { owner: "Ops", nextStep: "Resend when the pharmacy is back" },
    afterClose: { owner: "Ops", nextStep: "Resend when the pharmacy is back" },
  },
  patient_details_rejected: {
    lineText: "Patient details rejected",
    queueText: "Patient details rejected",
    inVisit: { owner: "Ops", nextStep: "Fix details and resend" },
    afterClose: { owner: "Ops", nextStep: "Fix details and resend" },
  },
  prescriber_enrollment: {
    lineText: "Prescriber enrollment problem",
    queueText: "Prescriber enrollment problem",
    inVisit: { owner: "Ops", nextStep: "Fix enrollment and resend" },
    afterClose: { owner: "Ops", nextStep: "Fix enrollment and resend" },
  },
  not_confirmed: {
    lineText: "No delivery confirmation",
    queueText: "No delivery confirmation",
    inVisit: { owner: "Ops", nextStep: "Call the pharmacy to confirm it arrived" },
    afterClose: { owner: "Ops", nextStep: "Call the pharmacy to confirm it arrived" },
  },
};
