import type { Database } from "bun:sqlite";
import { OPEN_PROJECT_STATUSES } from "#lib/projects.ts";
import { getPart, type Part } from "#lib/server/db/catalog.ts";
import {
  getHoldingLocation,
  getLocation,
  insertHoldingLocation,
  type Location,
} from "#lib/server/db/locations.ts";
import {
  getBalance,
  getMovementByOperationId,
  insertMovement,
  type Movement,
} from "#lib/server/db/movements.ts";
import {
  getBomLine,
  getProject,
  listBomLines,
  listComponents,
  type BomLine,
  type Project,
} from "#lib/server/db/projects.ts";
import {
  addReservation,
  getReservation,
  listProjectReservations,
  listStorageStock,
  reservedQuantity,
  setReservationQuantity,
  type StorageStock,
} from "#lib/server/db/reservations.ts";
import {
  DuplicateOperationError,
  InsufficientStockError,
  InventoryError,
  NotFoundError,
} from "#lib/server/inventory/errors.ts";
import { requireBulkPart } from "#lib/server/inventory/pieces.ts";
import {
  assertUnit,
  compatibleUnits,
  formatQuantity,
  toBaseQuantity,
  type Unit,
} from "#lib/units.ts";
import {
  absoluteQuantity,
  allowedPartIds,
  lineCoverage,
  loadAllocations,
  type LineCoverage,
} from "./coverage";
import { fitLineCommitments } from "./commitments";
import { unitsCompatible } from "./matching";
import type { ComponentFilter } from "./projects";

interface LinePartInput {
  projectId: number;
  lineId: number;
  partId: number;
  /** Decimal amount in `unit`. It must convert to a whole number of the part's base unit. */
  amount: string;
  unit: Unit;
}

interface MovementInput {
  /** Unique ID for this submission. A repeated ID is rejected without writing. */
  operationId: string;
  /** YYYY-MM-DD */
  occurredOn: string;
}

export interface ReservationInput extends LinePartInput {
  /** Storage location of the reservation. */
  locationId: number;
}

export type PickInput = ReservationInput & MovementInput;

export interface UseInput extends LinePartInput, MovementInput {
  reason: string | null;
}

export interface ReturnInput extends LinePartInput, MovementInput {
  /** Storage location that receives the returned stock. */
  toLocationId: number;
  /** Reserve the returned stock for the same line again. */
  reserveAgain: boolean;
}

export interface PickListItem {
  reservationId: number;
  lineId: number;
  lineDescription: string;
  componentName: string | null;
  partId: number;
  partName: string;
  baseUnit: string;
  quantity: number;
}

export interface PickListStop {
  locationId: number;
  locationName: string;
  items: PickListItem[];
}

export type AllocationService = ReturnType<typeof createAllocationService>;

/**
 * Project stock: reserve and release storage stock for BOM lines, pick reserved stock to the
 * project's holding location, record use of picked stock, and return it to storage. Each
 * action runs in one SQLite transaction and checks current balances and reservations, so a
 * stale page cannot over-reserve or over-pick.
 *
 * Picking takes only reserved stock. To pick unreserved stock, reserve it first.
 */
export function createAllocationService(db: Database) {
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

  function requirePart(id: number): Part {
    const part = getPart(db, id);
    if (!part) throw new NotFoundError(`Part ${id} does not exist`);
    return part;
  }

  function requireStorage(locationId: number): Location {
    const location = getLocation(db, locationId);
    if (!location) throw new NotFoundError(`Location ${locationId} does not exist`);
    if (location.kind !== "storage") {
      throw new InventoryError(`${location.name} is not a storage location`);
    }
    return location;
  }

  /** A part whose stock the action changes. Pieces parts are not supported yet. */
  function requireStockPart(id: number): Part {
    const part = requirePart(id);
    requireBulkPart(part);
    return part;
  }

  function positiveQuantity(part: Part, input: { amount: string; unit: Unit }): number {
    const quantity = toBaseQuantity(input.amount, input.unit, assertUnit(part.baseUnit));
    if (quantity <= 0) throw new InventoryError("Quantity must be greater than zero");
    return quantity;
  }

  function startMovement(input: MovementInput) {
    if (getMovementByOperationId(db, input.operationId)) {
      throw new DuplicateOperationError(input.operationId);
    }
  }

  function holdingLocation(project: Project): Location {
    const existing = getHoldingLocation(db, project.id);
    if (existing) return existing;
    insertHoldingLocation(db, project.id, `Project #${project.id} holding`);
    return getHoldingLocation(db, project.id)!;
  }

  function coverageOf(line: BomLine): LineCoverage {
    return lineCoverage(line, loadAllocations(db, [line.id]).get(line.id) ?? []);
  }

  /** Stock of `partId` held for the line at the project's holding location. */
  function pickedQuantity(line: BomLine, partId: number): number {
    return coverageOf(line).parts.find((p) => p.partId === partId)?.picked ?? 0;
  }

  /**
   * Check every reservation rule and add `quantity` to the line's reservation. Incoming
   * commitments that the reservation makes unnecessary are released.
   */
  function reserveQuantity(
    project: Project,
    line: BomLine,
    part: Part,
    location: Location,
    quantity: number
  ) {
    if (!OPEN_PROJECT_STATUSES.includes(project.status)) {
      throw new InventoryError(`${project.name} is ${project.status}; it cannot reserve stock`);
    }
    if (!allowedPartIds(db, line).has(part.id)) {
      throw new InventoryError(
        `${part.name} is not the row's exact part or an approved choice. Approve it first.`
      );
    }
    if (!unitsCompatible(line.unit, part.baseUnit)) {
      throw new InventoryError(
        `${part.name} is counted in ${part.baseUnit}, which cannot convert to ${line.unit}`
      );
    }
    if (part.archivedAt) {
      throw new InventoryError(`${part.name} is archived. Restore it before reserving it.`);
    }

    const available =
      getBalance(db, part.id, location.id) - reservedQuantity(db, part.id, location.id);
    if (quantity > available) {
      throw new InsufficientStockError(
        `${location.name} has ${formatQuantity(Math.max(available, 0), part.baseUnit)} of ` +
          `${part.name} available; cannot reserve ${formatQuantity(quantity, part.baseUnit)}`
      );
    }

    const coverage = coverageOf(line);
    if (
      absoluteQuantity(quantity, part.baseUnit) >
      absoluteQuantity(coverage.uncovered, coverage.unit)
    ) {
      throw new InventoryError(
        `This row needs only ${formatQuantity(coverage.uncovered, coverage.unit)} more; ` +
          `cannot reserve ${formatQuantity(quantity, part.baseUnit)}`
      );
    }

    addReservation(db, {
      bomLineId: line.id,
      partId: part.id,
      locationId: location.id,
      quantity,
    });
    fitLineCommitments(db, line);
  }

  /** Take `quantity` from the line's reservation of a part at a location. */
  function takeFromReservation(
    line: BomLine,
    part: Part,
    location: Location,
    quantity: number,
    action: string
  ) {
    const reservation = getReservation(db, {
      bomLineId: line.id,
      partId: part.id,
      locationId: location.id,
    });
    const reserved = reservation?.quantity ?? 0;
    if (!reservation || quantity > reserved) {
      throw new InventoryError(
        `${formatQuantity(reserved, part.baseUnit)} of ${part.name} is reserved at ` +
          `${location.name} for this row; cannot ${action} ${formatQuantity(quantity, part.baseUnit)}`
      );
    }
    setReservationQuantity(db, reservation.id, reserved - quantity);
  }

  /** Check that the line holds at least `quantity` of the part as picked stock. */
  function requirePicked(line: BomLine, part: Part, quantity: number, action: string) {
    const picked = pickedQuantity(line, part.id);
    if (quantity > picked) {
      throw new InsufficientStockError(
        `${formatQuantity(picked, part.baseUnit)} of ${part.name} is picked for this row; ` +
          `cannot ${action} ${formatQuantity(quantity, part.baseUnit)}`
      );
    }
  }

  return {
    /** Reserve storage stock for a line. No physical stock moves. */
    reserve(input: ReservationInput): void {
      inTransaction(() => {
        const project = requireProject(input.projectId);
        const line = requireLine(project.id, input.lineId);
        const part = requireStockPart(input.partId);
        const location = requireStorage(input.locationId);
        reserveQuantity(project, line, part, location, positiveQuantity(part, input));
      });
    },

    /** Release part or all of a reservation. */
    release(input: ReservationInput): void {
      inTransaction(() => {
        const line = requireLine(requireProject(input.projectId).id, input.lineId);
        const part = requireStockPart(input.partId);
        const location = requireStorage(input.locationId);
        takeFromReservation(line, part, location, positiveQuantity(part, input), "release");
      });
    },

    /**
     * Move reserved stock from storage to the project's holding location. The reservation
     * shrinks by the same quantity in the same transaction.
     */
    pick(input: PickInput): Movement {
      return inTransaction(() => {
        startMovement(input);
        const project = requireProject(input.projectId);
        const line = requireLine(project.id, input.lineId);
        const part = requireStockPart(input.partId);
        const location = requireStorage(input.locationId);
        const quantity = positiveQuantity(part, input);
        takeFromReservation(line, part, location, quantity, "pick");
        if (getBalance(db, part.id, location.id) < quantity) {
          throw new InsufficientStockError(`${location.name} does not have the reserved stock`);
        }
        return insertMovement(db, {
          operationId: input.operationId,
          partId: part.id,
          quantity,
          fromLocationId: location.id,
          toLocationId: holdingLocation(project).id,
          movementType: "pick",
          occurredOn: input.occurredOn,
          reason: null,
          bomLineId: line.id,
        });
      });
    },

    /** Record that picked stock was consumed or installed for the line. */
    use(input: UseInput): Movement {
      return inTransaction(() => {
        startMovement(input);
        const project = requireProject(input.projectId);
        const line = requireLine(project.id, input.lineId);
        const part = requireStockPart(input.partId);
        const quantity = positiveQuantity(part, input);
        requirePicked(line, part, quantity, "use");
        return insertMovement(db, {
          operationId: input.operationId,
          partId: part.id,
          quantity,
          fromLocationId: holdingLocation(project).id,
          toLocationId: null,
          movementType: "project_use",
          occurredOn: input.occurredOn,
          reason: input.reason,
          bomLineId: line.id,
        });
      });
    },

    /** Move unused picked stock back to storage, and optionally reserve it again. */
    returnPicked(input: ReturnInput): Movement {
      return inTransaction(() => {
        startMovement(input);
        const project = requireProject(input.projectId);
        const line = requireLine(project.id, input.lineId);
        const part = requireStockPart(input.partId);
        const location = requireStorage(input.toLocationId);
        const quantity = positiveQuantity(part, input);
        requirePicked(line, part, quantity, "return");
        const movement = insertMovement(db, {
          operationId: input.operationId,
          partId: part.id,
          quantity,
          fromLocationId: holdingLocation(project).id,
          toLocationId: location.id,
          movementType: "project_return",
          occurredOn: input.occurredOn,
          reason: null,
          bomLineId: line.id,
        });
        if (input.reserveAgain) reserveQuantity(project, line, part, location, quantity);
        return movement;
      });
    },

    /** Quantity breakdown of every line of a project, by line ID. */
    getProjectCoverage(projectId: number): Record<number, LineCoverage> {
      const lines = listBomLines(db, projectId);
      const allocations = loadAllocations(
        db,
        lines.map((line) => line.id)
      );
      return Object.fromEntries(
        lines.map((line) => [line.id, lineCoverage(line, allocations.get(line.id) ?? [])])
      );
    },

    /**
     * Breakdown of one line, with the parts it accepts and their storage stock so the owner
     * can choose what to reserve.
     */
    getLineStock(projectId: number, lineId: number) {
      const line = requireLine(projectId, lineId);
      const coverage = coverageOf(line);
      const allowed = allowedPartIds(db, line);
      const partIds = [...new Set([...allowed, ...coverage.parts.map((p) => p.partId)])];
      const storage = Map.groupBy(listStorageStock(db, partIds), (s) => s.partId);
      const parts = partIds
        .map((id) => requirePart(id))
        .map((part) => ({
          partId: part.id,
          partName: part.name,
          baseUnit: part.baseUnit,
          allowed: allowed.has(part.id),
          archived: part.archivedAt !== null,
          /** Tracked as pieces, which cannot be reserved yet. */
          pieces: part.trackingMode === "pieces",
          units: compatibleUnits(assertUnit(part.baseUnit)),
          storage: (storage.get(part.id) ?? []).map((s: StorageStock) => ({
            ...s,
            available: s.balance - s.reserved,
          })),
        }));
      return { coverage, parts };
    },

    /**
     * Reserved stock still to pick, by storage location. The filter limits which lines are
     * shown; it does not change any reservation.
     */
    getPickList(projectId: number, filter: ComponentFilter = null): PickListStop[] {
      const components = new Map(listComponents(db, projectId).map((c) => [c.id, c.name]));
      const reservations = listProjectReservations(db, projectId).filter((r) =>
        filter === null
          ? true
          : filter === "ungrouped"
            ? r.componentId === null
            : r.componentId === filter
      );
      const stops = Map.groupBy(reservations, (r) => r.locationId);
      return [...stops.values()].map((items) => ({
        locationId: items[0].locationId,
        locationName: items[0].locationName,
        items: items.map((r) => ({
          reservationId: r.id,
          lineId: r.bomLineId,
          lineDescription: r.lineDescription,
          componentName: r.componentId === null ? null : (components.get(r.componentId) ?? null),
          partId: r.partId,
          partName: r.partName,
          baseUnit: r.baseUnit,
          quantity: r.quantity,
        })),
      }));
    },
  };
}
