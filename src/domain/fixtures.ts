// Synthetic data only. Pharmacies are fictional; no real chains, people or addresses.

export interface Pharmacy {
  id: string;
  name: string;
  street: string;
  /** What the pharmacy directory said at signing. It can be out of date. */
  directoryTakesErx: boolean;
}

export const PHARMACIES: readonly Pharmacy[] = [
  { id: "ph-larkspur", name: "Larkspur Pharmacy", street: "410 Cedar St", directoryTakesErx: true },
  { id: "ph-northgate", name: "Northgate Pharmacy", street: "88 Northgate Blvd", directoryTakesErx: true },
  { id: "ph-millbrook", name: "Millbrook Drug", street: "1200 Elm Ave", directoryTakesErx: true },
  { id: "ph-harbor", name: "Harbor Lane Pharmacy", street: "35 Harbor Ln", directoryTakesErx: true },
];

export function pharmacyById(id: string): Pharmacy {
  const p = PHARMACIES.find((ph) => ph.id === id);
  if (!p) throw new Error(`unknown pharmacy ${id}`);
  return p;
}

/** Non-controlled psychiatric maintenance medications (no controlled-substance workflows here). */
export const MEDS: readonly { med: string; dose: string; sig: string }[] = [
  { med: "Sertraline", dose: "100 mg", sig: "1 tab daily" },
  { med: "Escitalopram", dose: "10 mg", sig: "1 tab daily" },
  { med: "Fluoxetine", dose: "20 mg", sig: "1 cap daily" },
  { med: "Bupropion XL", dose: "300 mg", sig: "1 tab every morning" },
  { med: "Lamotrigine", dose: "150 mg", sig: "1 tab daily" },
  { med: "Trazodone", dose: "50 mg", sig: "1 tab at bedtime" },
  { med: "Mirtazapine", dose: "15 mg", sig: "1 tab at bedtime" },
  { med: "Hydroxyzine", dose: "25 mg", sig: "1 tab up to 3x daily as needed" },
  { med: "Buspirone", dose: "10 mg", sig: "1 tab twice daily" },
];
