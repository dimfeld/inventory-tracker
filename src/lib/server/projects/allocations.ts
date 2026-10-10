import type { Database } from "bun:sqlite";
import type { ProjectStatus } from "#lib/projects.ts";
import {
  deleteLineCommitments,
  deleteProjectCommitments,
  listLineCommitments,
  setCommitmentQuantity,
} from "#lib/server/db/commitments.ts";
import { formatSize } from "#lib/pieces.ts";
import { deleteProjectPieceReservations } from "#lib/server/db/piece-reservations.ts";
import { listBomLines, type BomLine, type BomConstraint } from "#lib/server/db/projects.ts";
import { countLineMovements, deleteProjectReservations } from "#lib/server/db/reservations.ts";
import { InventoryError } from "#lib/server/inventory/errors.ts";
import { formatQuantity } from "#lib/units.ts";
import { fitLineCommitments, releaseUnfitCommitments } from "./commitments";
import { allowedPartIds, lineCoverage, loadAllocations, type PartAllocation } from "./coverage";
import { unitsCompatible } from "./matching";

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

export interface StatusChange {
  projectId: number;
  from: ProjectStatus;
  to: ProjectStatus;
}

export interface StatusChangeResult {
  /** Number of storage reservations released by the change. */
  releasedReservations: number;
  /** Number of incoming commitments released by the change. */
  releasedCommitments: number;
}

/**
 * Boundary for allocation rules on BOM edits and project status changes.
 *
 * The project service calls `applyChange` inside its write transaction: after it writes
 * an update (so `after` is the stored state), and before it deletes a line or a choice.
 * Reservations, picked stock, recorded use, and
 * incoming commitments of the line can then be compared with the new requirement. An
 * implementation may release incoming commitments that no longer fit, or throw an
 * InventoryError that names the allocations that no longer fit; the transaction then rolls back
 * with no partial writes. Moving a line between components is not a change here, because it
 * keeps the line and its allocations.
 *
 * `applyStatusChange` runs in the same transaction as a status update. It may release
 * allocations or throw to reject the new status.
 */
export interface BomAllocationGuard {
  applyChange(db: Database, change: BomChange): void;
  applyStatusChange(db: Database, change: StatusChange): StatusChangeResult;
}

/** Guard for a project without allocations. */
export const noBomAllocations: BomAllocationGuard = {
  applyChange() {},
  applyStatusChange: () => ({ releasedReservations: 0, releasedCommitments: 0 }),
};

function describeAllocation(allocation: PartAllocation, include: { used: boolean }): string {
  const fmt = (quantity: number) => formatQuantity(quantity, allocation.baseUnit);
  const states = [
    ...allocation.reservations.map((r) => `${fmt(r.quantity)} reserved at ${r.locationName}`),
    ...allocation.pieceReservations.map(
      (r) => `${formatSize(r, r.displayUnit)} reserved on piece #${r.pieceId} at ${r.locationName}`
    ),
    ...(allocation.picked > 0 ? [`${fmt(allocation.picked)} picked`] : []),
    ...(include.used && allocation.used > 0 ? [`${fmt(allocation.used)} used`] : []),
  ];
  return `${allocation.partName}: ${states.join(", ")}`;
}

function reject(problems: string[], action: string): never {
  throw new InventoryError(`${action} first. ${problems.join("; ")}.`);
}

/** Problems with a line's allocations after an update. Excess picked or used stock is allowed. */
function updateProblems(db: Database, line: BomLine): string[] {
  const allocations = loadAllocations(db, [line.id]).get(line.id) ?? [];
  if (allocations.length === 0) return [];

  const allowed = allowedPartIds(db, line);
  const problems: string[] = [];
  for (const allocation of allocations) {
    if (!unitsCompatible(line.unit, allocation.baseUnit)) {
      problems.push(
        `${describeAllocation(allocation, { used: true })} (counted in ${allocation.baseUnit}, ` +
          `which cannot convert to ${line.unit})`
      );
    } else if (!allowed.has(allocation.partId) && allocation.reserved + allocation.picked > 0) {
      problems.push(`${describeAllocation(allocation, { used: false })} (no longer fits this row)`);
    }
  }
  if (problems.length > 0) return problems;

  const coverage = lineCoverage(line, allocations);
  if (coverage.excess > 0 && coverage.reserved > 0) {
    const release = formatQuantity(Math.min(coverage.excess, coverage.reserved), coverage.unit);
    problems.push(
      `the row's allocations exceed the new quantity; release ${release} of: ` +
        allocations
          .filter((a) => a.reserved > 0)
          .map((a) => describeAllocation(a, { used: false }))
          .join("; ")
    );
  }
  return problems;
}

/**
 * Allocation rules for BOM edits and status changes:
 *
 * - An update may not leave reservations or picked stock on a part the row no longer accepts,
 *   allocations in a unit that cannot convert to the row's unit, or reservations beyond the
 *   new quantity. Picked and used stock beyond a reduced quantity stays as a visible excess.
 *   Incoming commitments of parts the row no longer accepts, and commitments beyond the new
 *   remaining need, are released.
 * - A row with reservations or any stock history cannot be deleted. Deleting a row releases
 *   its incoming commitments.
 * - Approval of a part cannot be withdrawn while that part is reserved or picked for the row.
 *   Withdrawing it releases the row's incoming commitments of that part.
 * - Cancelling a project releases its storage reservations and incoming commitments; picked
 *   stock stays until it is used or returned. Completing a project is rejected while picked
 *   stock remains, and releases any remaining reservations and commitments.
 */
export const bomAllocationGuard: BomAllocationGuard = {
  applyChange(db, change) {
    switch (change.kind) {
      case "update": {
        const { line } = change.after;
        releaseUnfitCommitments(db, line);
        const problems = updateProblems(db, line);
        if (problems.length > 0) reject(problems, "Release or return these allocations");
        fitLineCommitments(db, line);
        return;
      }
      case "delete": {
        const { line } = change.before;
        deleteLineCommitments(db, line.id);
        const allocations = loadAllocations(db, [line.id]).get(line.id) ?? [];
        if (allocations.length > 0) {
          reject(
            allocations.map((a) => describeAllocation(a, { used: true })),
            "This row has allocated stock. Release, return, or keep it"
          );
        }
        if (countLineMovements(db, line.id) > 0) {
          throw new InventoryError(
            "This row has stock history (picks or returns), so it is kept. Reduce its quantity instead."
          );
        }
        return;
      }
      case "remove_choice": {
        if (change.line.partId === change.partId) return;
        for (const commitment of listLineCommitments(db, [change.line.id])) {
          if (commitment.partId === change.partId) setCommitmentQuantity(db, commitment.id, 0);
        }
        const allocation = (loadAllocations(db, [change.line.id]).get(change.line.id) ?? []).find(
          (a) => a.partId === change.partId
        );
        if (allocation && allocation.reserved + allocation.picked > 0) {
          reject([describeAllocation(allocation, { used: false })], "Release or return");
        }
        return;
      }
    }
  },

  applyStatusChange(db, { projectId, to }) {
    if (to === "complete") {
      const lineIds = listBomLines(db, projectId).map((line) => line.id);
      const picked = [...loadAllocations(db, lineIds).values()]
        .flat()
        .filter((allocation) => allocation.picked > 0);
      if (picked.length > 0) {
        throw new InventoryError(
          "Record use or return of picked stock before completing the project: " +
            picked.map((a) => `${formatQuantity(a.picked, a.baseUnit)} of ${a.partName}`).join("; ")
        );
      }
    }
    if (to === "complete" || to === "cancelled") {
      return {
        releasedReservations:
          deleteProjectReservations(db, projectId) + deleteProjectPieceReservations(db, projectId),
        releasedCommitments: deleteProjectCommitments(db, projectId),
      };
    }
    return { releasedReservations: 0, releasedCommitments: 0 };
  },
};
