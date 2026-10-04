import type { Database } from "bun:sqlite";
import { listChoices, type BomLine } from "#lib/server/db/projects.ts";
import { listLineReservations, listLineStock } from "#lib/server/db/reservations.ts";
import { assertUnit, UNITS, type Unit } from "#lib/units.ts";

export interface LineReservation {
  id: number;
  locationId: number;
  locationName: string;
  quantity: number;
}

/** Stock of one part allocated to one BOM line. Quantities are in `baseUnit`. */
export interface PartAllocation {
  partId: number;
  partName: string;
  baseUnit: string;
  used: number;
  picked: number;
  reserved: number;
  reservations: LineReservation[];
}

/**
 * Quantity states of a requirement, all in `unit`. Each quantity counts once:
 * uncovered = max(required - used - picked - reserved, 0). `excess` is the amount by which the
 * allocations exceed the requirement, such as picked stock after the requirement was reduced.
 */
export interface LineCoverage {
  unit: string;
  required: number;
  used: number;
  picked: number;
  reserved: number;
  uncovered: number;
  excess: number;
  parts: PartAllocation[];
}

/** Reservations, picked stock, and use of the lines, by line ID. */
export function loadAllocations(db: Database, lineIds: number[]): Map<number, PartAllocation[]> {
  const result = new Map<number, Map<number, PartAllocation>>();
  const entry = (lineId: number, part: { partId: number; partName: string; baseUnit: string }) => {
    let parts = result.get(lineId);
    if (!parts) result.set(lineId, (parts = new Map()));
    let allocation = parts.get(part.partId);
    if (!allocation) {
      allocation = {
        partId: part.partId,
        partName: part.partName,
        baseUnit: part.baseUnit,
        used: 0,
        picked: 0,
        reserved: 0,
        reservations: [],
      };
      parts.set(part.partId, allocation);
    }
    return allocation;
  };

  for (const stock of listLineStock(db, lineIds)) {
    if (stock.picked === 0 && stock.used === 0) continue;
    const allocation = entry(stock.bomLineId, stock);
    allocation.picked = stock.picked;
    allocation.used = stock.used;
  }
  for (const reservation of listLineReservations(db, lineIds)) {
    const allocation = entry(reservation.bomLineId, reservation);
    allocation.reserved += reservation.quantity;
    allocation.reservations.push({
      id: reservation.id,
      locationId: reservation.locationId,
      locationName: reservation.locationName,
      quantity: reservation.quantity,
    });
  }
  return new Map([...result].map(([lineId, parts]) => [lineId, [...parts.values()]]));
}

/** Parts whose stock may be allocated to the line: its exact part and approved choices. */
export function allowedPartIds(db: Database, line: BomLine): Set<number> {
  const ids = new Set(listChoices(db, [line.id]).map((choice) => choice.partId));
  if (line.partId !== null) ids.add(line.partId);
  return ids;
}

/** Of compatible units, the one with the smallest size, so every quantity converts exactly. */
function finestUnit(units: Unit[]): Unit {
  return units.reduce((finest, unit) => (UNITS[unit].size < UNITS[finest].size ? unit : finest));
}

/** Convert an integer quantity to a unit that is the same size or finer. */
function convert(quantity: number, from: Unit, to: Unit): number {
  return (quantity * UNITS[from].size) / UNITS[to].size;
}

/**
 * The quantity breakdown of a requirement. Part allocations must use units compatible with the
 * requirement; the BOM allocation guard rejects edits that would break this.
 */
export function lineCoverage(
  line: Pick<BomLine, "quantity" | "unit">,
  parts: PartAllocation[]
): LineCoverage {
  const lineUnit = assertUnit(line.unit);
  const unit = finestUnit([lineUnit, ...parts.map((p) => assertUnit(p.baseUnit))]);
  const sum = (key: "used" | "picked" | "reserved") =>
    parts.reduce((total, p) => total + convert(p[key], assertUnit(p.baseUnit), unit), 0);

  const required = convert(line.quantity, lineUnit, unit);
  const used = sum("used");
  const picked = sum("picked");
  const reserved = sum("reserved");
  const allocated = used + picked + reserved;
  return {
    unit,
    required,
    used,
    picked,
    reserved,
    uncovered: Math.max(required - allocated, 0),
    excess: Math.max(allocated - required, 0),
    parts,
  };
}

/** A quantity of `unit` in the smallest unit of its dimension, for comparisons. */
export function absoluteQuantity(quantity: number, unit: string): number {
  return quantity * UNITS[assertUnit(unit)].size;
}
