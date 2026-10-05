// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, within } from "@testing-library/react";
import { Compare } from "@/components/Compare";
import { DEMO, demoEvents } from "@/scenarios/demo";

afterEach(cleanup);

const [f1, f2, f3, f4] = DEMO.frames.map((f) => f.atMs) as [number, number, number, number];

function at(ms: number) {
  const { container } = render(<Compare scenario={DEMO} events={demoEvents()} initialMs={ms} />);
  const cell = (pane: "left" | "right", med: string) =>
    container.querySelector<HTMLElement>(`[data-pane="${pane}"][data-med="${med}"]`)!;
  const below = (pane: "left" | "right") => container.querySelector<HTMLElement>(`.below[data-pane="${pane}"]`)!;
  return { container, cell, below };
}

describe("compare view", () => {
  test("both panes are labeled with the read model they show", () => {
    const { container } = at(f1);
    expect(container.textContent).toContain("Latest event wins (duplicates dropped)");
    expect(container.textContent).toContain("This read model");
  });

  test("17:00: left says Sent, right says Sending", () => {
    const { cell } = at(f1);
    expect(cell("left", "Lamotrigine").textContent).toContain("Sent");
    expect(cell("right", "Lamotrigine").textContent).toContain("Sending");
  });

  test("17:04: both show lamotrigine Failed; the right says what to do", () => {
    const { cell } = at(f2);
    expect(cell("left", "Lamotrigine").textContent).toContain("Failed");
    expect(cell("right", "Lamotrigine").textContent).toContain("Ask patient for another pharmacy");
    expect(cell("left", "Sertraline").textContent).toContain("Delivered");
  });

  test("19:00: left flips back to Sent with no failure text; right keeps Failed at a store that isn't the usual one", () => {
    const { container, cell } = at(f3);
    const left = cell("left", "Lamotrigine").textContent!;
    expect(left).toContain("Sent");
    expect(left).not.toContain("Failed");
    expect(left).not.toContain("e-Rx failed");
    const right = cell("right", "Lamotrigine").textContent!;
    expect(right).toContain("Failed");
    expect(right).toContain("This pharmacy can't take e-prescriptions");
    expect(right).toContain("e-Rx failed 17:04");
    expect(right).toContain("Northgate Pharmacy");
    expect(within(container.querySelector<HTMLElement>(".usual")!).queryByText(/Northgate/)).toBeNull();
    expect(container.querySelector(".usual")!.textContent).toContain("Larkspur Pharmacy");
    expect(cell("right", "Trazodone").textContent).toContain("Not confirmed");
    expect(cell("right", "Trazodone").textContent).toContain("No delivery confirmation since 18:30");
    expect(container.textContent).toContain("Arrived late, not a duplicate");
  });

  test("25:00: left still says Sent; the clinic queue has both issues with owner and age", () => {
    const { cell, below } = at(f4);
    expect(cell("left", "Lamotrigine").textContent).toContain("Sent");
    expect(cell("left", "Trazodone").textContent).toContain("Sent");
    const queue = below("right").textContent!;
    expect(queue).toContain("Open prescription issues");
    expect(queue).toContain("Care team");
    expect(queue).toContain("7:56");
    expect(queue).toContain("Ops");
    expect(queue).toContain("6:30");
    expect(below("left").textContent).toContain("No issue list");
  });

  test("meds not sent today have no status pill", () => {
    const { cell } = at(f3);
    expect(cell("right", "Bupropion XL").querySelector(".pill")).toBeNull();
    expect(cell("right", "Bupropion XL").textContent).toContain("refills remain");
  });
});
