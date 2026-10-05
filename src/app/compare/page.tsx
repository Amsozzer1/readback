import { Compare } from "@/components/Compare";
import { DEMO, demoEvents } from "@/scenarios/demo";

export const metadata = {
  title: "readback: prescription status, two read models",
};

export default function ComparePage() {
  // The money shot: open on the late webhook, the moment the two sides disagree.
  return <Compare scenario={DEMO} events={demoEvents()} initialMs={DEMO.frames[2]!.atMs} />;
}
