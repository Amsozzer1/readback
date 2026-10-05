"use client";

import { useMemo, useState } from "react";
import { fold, FULL, NAIVE_DEDUPE, type Line, type Model } from "@/domain/fold";
import { pharmacyById } from "@/domain/fixtures";
import { clock, type RxEvent } from "@/domain/types";
import type { DemoFrame, DemoMed } from "@/scenarios/demo";

export interface CompareScenario {
  patient: string;
  visitLabel: string;
  usualPharmacyId: string;
  priorVisit: readonly string[];
  meds: readonly DemoMed[];
  frames: readonly DemoFrame[];
  startMs: number;
  endMs: number;
}

interface Props {
  scenario: CompareScenario;
  events: RxEvent[];
  initialMs?: number;
}

const LEFT: { model: Model; label: string; sub: string } = {
  model: NAIVE_DEDUPE,
  label: "Latest event wins (duplicates dropped)",
  sub: "Shows the last webhook to arrive",
};
const RIGHT: { model: Model; label: string; sub: string } = {
  model: FULL,
  label: "This read model",
  sub: "Lifecycle rank, green only on delivery, Not confirmed after 90 s, owned issues",
};

const PILL: Record<Line["status"], { icon: string; word: string }> = {
  sent: { icon: "✓", word: "Sent" },
  delivered: { icon: "✓", word: "Delivered" },
  sending: { icon: "…", word: "Sending" },
  failed: { icon: "✕", word: "Failed" },
  not_confirmed: { icon: "!", word: "Not confirmed" },
};

function age(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Pill({ line }: { line: Line }) {
  const p = PILL[line.status];
  return (
    <span className={`pill pill-${line.tone}`}>
      <span aria-hidden="true">{p.icon}</span> {p.word}
    </span>
  );
}

function MedCell({ med, line, usualPharmacyId }: { med: DemoMed; line: Line | undefined; usualPharmacyId: string }) {
  const dose = med.doseBefore ? `${med.doseBefore} → ${med.dose}` : med.dose;
  const store = med.pharmacyId ? pharmacyById(med.pharmacyId) : null;
  const showStore = store && (store.id !== usualPharmacyId || line?.status === "failed");
  return (
    <div className={`cell${line && line.tone !== "green" && line.tone !== "gray" ? ` cell-${line.tone}` : ""}`}>
      <div className="med">
        <span className="med-name">{med.med}</span> <span className="dose">{dose}</span>
        {line ? <Pill line={line} /> : null}
      </div>
      <div className="sig">{med.sig}</div>
      {!line && med.note ? <div className="quiet">{med.note}</div> : null}
      {line?.reason ? (
        <div className="reason">
          {line.reason}
          {line.notConfirmedSinceMs != null ? ` since ${clock(line.notConfirmedSinceMs)}` : null}
        </div>
      ) : null}
      {line?.nextStep ? <div className="next">Next: {line.nextStep}</div> : null}
      {showStore || line?.errorAtMs != null ? (
        <div className="store">
          {[showStore ? `${store.name} · ${store.street}` : null, line?.errorAtMs != null ? `e-Rx failed ${clock(line.errorAtMs)}` : null]
            .filter(Boolean)
            .join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

export function Compare({ scenario, events, initialMs }: Props) {
  const [atMs, setAtMs] = useState(initialMs ?? scenario.frames[0]?.atMs ?? scenario.startMs);
  const left = useMemo(() => fold(events, atMs, LEFT.model), [events, atMs]);
  const right = useMemo(() => fold(events, atMs, RIGHT.model), [events, atMs]);
  const usual = pharmacyById(scenario.usualPharmacyId);
  const closeEvent = events.find((e) => e.type === "VisitClosed");
  const closed = closeEvent !== undefined && atMs >= closeEvent.arrivedMs;
  const frame = scenario.frames.find((f) => f.atMs === atMs);
  const medOf = (orderId: string) => scenario.meds.find((m) => m.orderId === orderId)?.med ?? orderId;
  const needsAction = [...right.values()].filter((l) => l.nextStep !== null);

  return (
    <main className="compare">
      <p className="banner">Synthetic data. Scripted scenario. Same webhook stream on both sides.</p>

      <header className="visit">
        <div>
          <div className="visit-title">
            <strong>{scenario.patient}</strong> · {scenario.visitLabel}
          </div>
          <div className="visit-time" aria-label="Simulated time">
            {clock(atMs)} {closed ? <span className="ended">visit ended {clock(closeEvent!.arrivedMs)}</span> : <span className="live">in visit</span>}
          </div>
          <div className="usual">
            Usual pharmacy: {usual.name} · {usual.street} · directory: {usual.directoryTakesErx ? "takes e-Rx" : "no e-Rx"}
          </div>
        </div>
        <ul className="prior" aria-label="Prior-visit context">
          {scenario.priorVisit.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </header>

      <section className="grid" aria-label="Medication list, two read models">
        <div className="pane-head" data-pane="left">
          <h2>{LEFT.label}</h2>
          <p>{LEFT.sub}</p>
        </div>
        <div className="pane-head" data-pane="right">
          <h2>{RIGHT.label}</h2>
          <p>{RIGHT.sub}</p>
        </div>
        {scenario.meds.map((med) => (
          <div className="row" key={med.med}>
            <div data-pane="left" data-med={med.med}>
              <MedCell med={med} line={med.orderId ? left.get(med.orderId) : undefined} usualPharmacyId={usual.id} />
            </div>
            <div data-pane="right" data-med={med.med}>
              <MedCell med={med} line={med.orderId ? right.get(med.orderId) : undefined} usualPharmacyId={usual.id} />
            </div>
          </div>
        ))}
        <div className="below" data-pane="left">
          <p className="quiet">No issue list.</p>
        </div>
        <div className="below" data-pane="right">
          {!closed ? (
            <div className="actions" aria-label="Needs action">
              <h3>Needs action</h3>
              {needsAction.length === 0 ? <p className="quiet">Nothing right now.</p> : (
                <ul>
                  {needsAction.map((l) => (
                    <li key={l.orderId}><strong>{medOf(l.orderId)}</strong>: {l.reason}. {l.nextStep}.</li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="actions" aria-label="Open prescription issues">
              <h3>Open prescription issues · clinic queue</h3>
              <table>
                <thead>
                  <tr><th>Patient</th><th>Med</th><th>Problem</th><th>Owner</th><th>Next step</th><th>Age</th></tr>
                </thead>
                <tbody>
                  {[...right.values()].filter((l) => l.issue).map((l) => (
                    <tr key={l.orderId}>
                      <td>{scenario.patient}</td>
                      <td>{medOf(l.orderId)}</td>
                      <td>{l.issue!.queueText}</td>
                      <td>{l.issue!.owner}</td>
                      <td>{l.issue!.nextStep}</td>
                      <td>{age(l.issue!.ageMs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <section className="scrubber" aria-label="Timeline">
        <input
          type="range"
          min={scenario.startMs}
          max={scenario.endMs}
          step={1000}
          value={atMs}
          onChange={(e) => setAtMs(Number(e.target.value))}
          aria-label="Simulated time"
          aria-valuetext={clock(atMs)}
        />
        <div className="frames">
          {scenario.frames.map((f, i) => (
            <button key={f.atMs} type="button" aria-pressed={f.atMs === atMs} onClick={() => setAtMs(f.atMs)}>
              {i + 1} · {f.label}
            </button>
          ))}
          <span className="hint">or drag the slider (arrow keys step 1 s)</span>
        </div>
        <p className="note" aria-live="polite">{frame ? frame.note : " "}</p>
      </section>
    </main>
  );
}
