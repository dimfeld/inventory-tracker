import type { Database } from "bun:sqlite";
import { OPEN_PROJECT_STATUSES } from "#lib/projects.ts";
import {
  addCommitment,
  committedByOrderLine,
  getCommitment,
  listLineCommitments,
  setCommitmentQuantity,
} from "#lib/server/db/commitments.ts";
import { getOrder, getOrderLine, listIncomingLines } from "#lib/server/db/orders.ts";
import { getBomLine, getProject, type BomLine, type Project } from "#lib/server/db/projects.ts";
import { getPart } from "#lib/server/db/catalog.ts";
import { InventoryError, NotFoundError } from "#lib/server/inventory/errors.ts";
import { requireBulkPart } from "#lib/server/inventory/pieces.ts";
import { assertUnit, formatQuantity, UNITS } from "#lib/units.ts";
import { absoluteQuantity, allowedPartIds, lineCoverage, loadAllocations } from "./coverage";
import { unitsCompatible } from "./matching";

export interface AssignInput {
  projectId: number;
  lineId: number;
  orderLineId: number;
  /** Whole amount of the order line part's base unit. */
  quantity: number;
}

export interface ReleaseInput {
  projectId: number;
  lineId: number;
  commitmentId: number;
  /** Whole amount of the order line part's base unit. */
  quantity: number;
}

/** Outstanding supply of an order line that a requirement accepts. Quantities in `baseUnit`. */
export interface IncomingOption {
  orderLineId: number;
  orderId: number;
  supplier: string;
  reference: string | null;
  status: string;
  expectedOn: string | null;
  partId: number;
  partName: string;
  baseUnit: string;
  outstanding: number;
  /** Committed to any requirement, this one included. */
  committed: number;
  /** Not committed to any requirement. Only this can be assigned. */
  uncommitted: number;
}

function coverageOf(db: Database, line: BomLine) {
  return lineCoverage(line, loadAllocations(db, [line.id]).get(line.id) ?? []);
}

/**
 * Release the line's commitments beyond its remaining need, latest expected arrival first.
 * Call this after a change that lowers the remaining need, such as a reduced requirement or a
 * new reservation. Physical stock and reservations do not change. Returns the number of
 * commitments reduced.
 */
export function fitLineCommitments(db: Database, line: BomLine): number {
  const coverage = coverageOf(db, line);
  let excess = absoluteQuantity(coverage.ordered - coverage.uncovered, coverage.unit);
  let reduced = 0;
  for (const commitment of listLineCommitments(db, [line.id]).reverse()) {
    if (excess <= 0) break;
    // A part counted in a coarser unit than the row is released in whole base units.
    const size = UNITS[assertUnit(commitment.baseUnit)].size;
    const release = Math.min(commitment.quantity, Math.ceil(excess / size));
    setCommitmentQuantity(db, commitment.id, commitment.quantity - release);
    excess -= release * size;
    reduced += 1;
  }
  return reduced;
}

/**
 * Release the line's commitments of parts it no longer accepts: parts that are not its exact
 * part or an approved choice, or that are counted in an incompatible unit. Returns the number
 * of commitments released.
 */
export function releaseUnfitCommitments(db: Database, line: BomLine): number {
  const allowed = allowedPartIds(db, line);
  const unfit = listLineCommitments(db, [line.id]).filter(
    (c) => !allowed.has(c.partId) || !unitsCompatible(line.unit, c.baseUnit)
  );
  for (const commitment of unfit) setCommitmentQuantity(db, commitment.id, 0);
  return unfit.length;
}

export type CommitmentService = ReturnType<typeof createCommitmentService>;

/**
 * Incoming commitments: explicit assignment of outstanding order supply to BOM lines. Each
 * action runs in one SQLite transaction and checks the current outstanding supply, the other
 * commitments of the order line, and the line's remaining need, so a stale page cannot assign
 * the same incoming quantity twice.
 */
export function createCommitmentService(db: Database) {
  function inTransaction<T>(fn: () => T): T {
    return db.transaction(fn).immediate();
  }

  function requireProject(id: number): Project {
    const project = getProject(db, id);
    if (!project) throw new NotFoundError(`Project ${id} does not exist`);
    return project;
  }

  function requireLine(projectId: number, lineId: number): BomLine {
    const line = getBomLine(db, lineId);
    if (!line || line.projectId !== projectId) {
      throw new NotFoundError(`BOM line ${lineId} does not exist in this project`);
    }
    return line;
  }

  function wholeQuantity(quantity: number, unit: string) {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new InventoryError(`Enter a whole amount of ${unit} greater than zero`);
    }
  }

  return {
    /**
     * Commit outstanding supply of an order line to a BOM line. The order must be placed or
     * shipped, its part must be the line's exact part or an approved choice in a compatible
     * unit, the order line must have that much uncommitted outstanding supply, and the line
     * must need that much beyond its stock and other commitments.
     */
    assign(input: AssignInput): void {
      inTransaction(() => {
        const project = requireProject(input.projectId);
        if (!OPEN_PROJECT_STATUSES.includes(project.status)) {
          throw new InventoryError(
            `${project.name} is ${project.status}; it cannot take incoming supply`
          );
        }
        const line = requireLine(project.id, input.lineId);
        const orderLine = getOrderLine(db, input.orderLineId);
        if (!orderLine) throw new NotFoundError(`Order line ${input.orderLineId} does not exist`);
        const { baseUnit, partName } = orderLine;
        requireBulkPart({
          name: partName,
          trackingMode: getPart(db, orderLine.partId)!.trackingMode,
        });
        wholeQuantity(input.quantity, baseUnit);
        if (getOrder(db, orderLine.orderId)?.status === "draft") {
          throw new InventoryError("Draft orders are not incoming supply. Place the order first.");
        }
        if (!allowedPartIds(db, line).has(orderLine.partId)) {
          throw new InventoryError(
            `${partName} is not the row's exact part or an approved choice. Approve it first.`
          );
        }
        if (!unitsCompatible(line.unit, baseUnit)) {
          throw new InventoryError(
            `${partName} is counted in ${baseUnit}, which cannot convert to ${line.unit}`
          );
        }

        const committed = committedByOrderLine(db).get(orderLine.id) ?? 0;
        const uncommitted = Math.max(orderLine.outstanding - committed, 0);
        if (input.quantity > uncommitted) {
          throw new InventoryError(
            `${formatQuantity(uncommitted, baseUnit)} of ${partName} on this order is not ` +
              `committed yet; cannot commit ${formatQuantity(input.quantity, baseUnit)}`
          );
        }

        const coverage = coverageOf(db, line);
        if (
          absoluteQuantity(input.quantity, baseUnit) >
          absoluteQuantity(coverage.neededNotOrdered, coverage.unit)
        ) {
          throw new InventoryError(
            `This row needs only ${formatQuantity(coverage.neededNotOrdered, coverage.unit)} ` +
              `beyond its stock and orders; cannot commit ${formatQuantity(input.quantity, baseUnit)}`
          );
        }

        addCommitment(db, {
          bomLineId: line.id,
          orderLineId: orderLine.id,
          quantity: input.quantity,
        });
      });
    },

    /** Release part or all of a commitment. The supply becomes uncommitted again. */
    release(input: ReleaseInput): void {
      inTransaction(() => {
        const line = requireLine(requireProject(input.projectId).id, input.lineId);
        const commitment = getCommitment(db, input.commitmentId);
        if (!commitment || commitment.bomLineId !== line.id) {
          throw new InventoryError("This commitment no longer exists for this row. Reload.");
        }
        wholeQuantity(input.quantity, commitment.baseUnit);
        if (input.quantity > commitment.quantity) {
          throw new InventoryError(
            `${formatQuantity(commitment.quantity, commitment.baseUnit)} is committed; cannot ` +
              `release ${formatQuantity(input.quantity, commitment.baseUnit)}`
          );
        }
        setCommitmentQuantity(db, commitment.id, commitment.quantity - input.quantity);
      });
    },

    /**
     * Outstanding order supply of the parts a line accepts, with what is already committed.
     * Draft orders are not listed.
     */
    listIncomingOptions(projectId: number, lineId: number): IncomingOption[] {
      const line = requireLine(projectId, lineId);
      const committed = committedByOrderLine(db);
      // Supply of parts tracked as pieces cannot be committed yet.
      return listIncomingLines(db, [...allowedPartIds(db, line)])
        .filter(
          (incoming) =>
            unitsCompatible(line.unit, incoming.baseUnit) &&
            getPart(db, incoming.partId)?.trackingMode !== "pieces"
        )
        .map((incoming) => {
          const total = committed.get(incoming.orderLineId) ?? 0;
          return {
            ...incoming,
            committed: total,
            uncommitted: Math.max(incoming.outstanding - total, 0),
          };
        });
    },
  };
}
