export interface SummaryLine {
  id: number;
  description: string;
  quantity: number;
  unit: string;
  partId: number | null;
  partName: string | null;
}

export interface BomTotal {
  /** The exact part, or null for a generic requirement, which is never combined with others. */
  partId: number | null;
  /** Part name, or the requirement description for a generic requirement. */
  label: string;
  quantity: number;
  unit: string;
  lineIds: number[];
}

/**
 * Required quantities of a set of BOM lines. Each line counts once. Lines for the same exact
 * part and unit are added together; generic requirements and different parts or units stay
 * separate, so unlike quantities are never added.
 */
export function summarizeBom(lines: SummaryLine[]): BomTotal[] {
  const totals = new Map<string, BomTotal>();
  for (const line of lines) {
    const key = line.partId === null ? `line:${line.id}` : `part:${line.partId}:${line.unit}`;
    const total = totals.get(key);
    if (total) {
      total.quantity += line.quantity;
      total.lineIds.push(line.id);
    } else {
      totals.set(key, {
        partId: line.partId,
        label: line.partName ?? line.description,
        quantity: line.quantity,
        unit: line.unit,
        lineIds: [line.id],
      });
    }
  }
  return [...totals.values()];
}
