import type { Database } from "bun:sqlite";
import type { BomLine, BomConstraint } from "#lib/server/db/projects.ts";

/** A BOM line with its constraints, before or after an edit. */
export interface BomLineState {
  line: BomLine;
  constraints: BomConstraint[];
}

export type BomChange =
  /** Quantity, unit, exact part, category, identifiers, or constraints may differ. */
  | { kind: "update"; before: BomLineState; after: BomLineState }
  | { kind: "delete"; before: BomLineState }
  /** The owner withdraws approval of a part for the line. */
  | { kind: "remove_choice"; line: BomLine; partId: number };

/**
 * Boundary for allocation rules on BOM edits.
 *
 * The project service calls `assertChangeAllowed` inside its write transaction: after it writes
 * an update (so `after` is the stored state), and before it deletes a line or a choice.
 * Reservations, picked stock, recorded use, and
 * incoming commitments of the line can then be compared with the new requirement. An
 * implementation throws an InventoryError that names the allocations that no longer fit; the
 * transaction then rolls back with no partial writes. Moving a line between components is not
 * a change here, because it keeps the line and its allocations.
 */
export interface BomAllocationGuard {
  assertChangeAllowed(db: Database, change: BomChange): void;
}

/** Guard for a project without allocations. */
export const noBomAllocations: BomAllocationGuard = {
  assertChangeAllowed() {},
};
