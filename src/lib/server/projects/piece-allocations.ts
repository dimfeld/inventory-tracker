import type { Database } from "bun:sqlite";
import { OPEN_PROJECT_STATUSES } from "#lib/projects.ts";
import {
  calculateCut,
  checkSplit,
  cutsFit,
  fitsWithin,
  formatLength,
  formatSize,
  freeLengthMm,
  isWholePiece,
  suggestCuts,
  type PieceDisplayUnit,
} from "#lib/pieces.ts";
import { getPart, type Part } from "#lib/server/db/catalog.ts";
import { ensureHoldingLocation, getLocation } from "#lib/server/db/locations.ts";
import {
  getMovementByOperationId,
  insertMovement,
  type Movement,
} from "#lib/server/db/movements.ts";
import {
  deletePieceReservation,
  getPieceReservation,
  insertPieceReservation,
  listPickedPieces,
  listPieceReservations,
  listProjectPieceReservations,
  movePieceReservations,
  setPieceReservationSize,
  type PickedPiece,
  type PieceReservationDetail,
} from "#lib/server/db/piece-reservations.ts";
import { getCurrentPiece, getPiece, type CurrentPiece } from "#lib/server/db/pieces.ts";
import { getBomLine, getProject, type BomLine, type Project } from "#lib/server/db/projects.ts";
import {
  DuplicateOperationError,
  InsufficientStockError,
  InventoryError,
  NotFoundError,
} from "#lib/server/inventory/errors.ts";
import {
  createPieceService,
  listStoragePieces,
  type StoragePiece,
} from "#lib/server/inventory/pieces.ts";
import { formatQuantity } from "#lib/units.ts";
import { fitLineCommitments } from "./commitments";
import { absoluteQuantity, allowedPartIds, lineCoverage, loadAllocations } from "./coverage";
import { unitsCompatible } from "./matching";
import type { ComponentFilter } from "./projects";

/** The size of a cut piece in mm. Width is null for 1D pieces. */
export interface PieceSize {
  lengthMm: number;
  widthMm: number | null;
}

export interface PieceReservationEntry {
  pieceId: number;
  /**
   * The size of the cut piece. By default the line's cut size, or the whole piece for a line
   * without a cut size.
   */
  size?: PieceSize | null;
  /** The user confirms that a 2D cut size smaller than the piece fits in it. */
  confirmFit?: boolean;
}

export interface ReservePiecesInput {
  projectId: number;
  lineId: number;
  pieces: PieceReservationEntry[];
}

export interface ResizePieceReservationInput {
  projectId: number;
  reservationId: number;
  size: PieceSize;
  confirmFit?: boolean;
}

interface MovementInput {
  /** Unique ID for this submission. A repeated ID is rejected without writing. */
  operationId: string;
  /** YYYY-MM-DD */
  occurredOn: string;
}

export interface PickPiecesInput extends MovementInput {
  projectId: number;
  /** Reservations to pick, in order. Several reservations can be on the same piece. */
  picks: {
    reservationId: number;
    /**
     * Leftover pieces of a 2D piece to keep in storage, as the user measured them. Required to
     * pick a 2D reservation smaller than its piece; an empty list keeps no leftovers.
     */
    leftovers?: PieceSize[];
  }[];
}

export interface UsePieceInput extends MovementInput {
  projectId: number;
  lineId: number;
  pieceId: number;
  reason: string | null;
}

export interface ReturnPieceInput extends MovementInput {
  projectId: number;
  lineId: number;
  pieceId: number;
  /** Storage location that receives the piece. */
  toLocationId: number;
  /** Reserve the returned piece for the same line again. */
  reserveAgain: boolean;
}

/** One reservation on a piece in the pick list: a cut to make for a line. */
export interface PiecePickCut {
  reservationId: number;
  lineId: number;
  lineDescription: string;
  componentId: number | null;
  lengthMm: number;
  widthMm: number | null;
  /** The reservation is the whole piece, so the pick moves the piece without a cut. */
  whole: boolean;
}

/** A reserved piece to take from storage, with the project's cuts on it. */
export interface PiecePickItem {
  pieceId: number;
  partId: number;
  partName: string;
  displayUnit: PieceDisplayUnit;
  kerfMm: number;
  lengthMm: number;
  widthMm: number | null;
  label: string | null;
  cuts: PiecePickCut[];
}

export interface PiecePickStop {
  locationId: number;
  locationName: string;
  pieces: PiecePickItem[];
}

/** Cuts that the line can reserve from pieces in storage. */
export interface PieceSuggestion {
  cuts: { piece: StoragePiece; size: PieceSize }[];
  /** Number of pieces the line still needs that no piece in storage fits. */
  unplaced: number;
}

/**
 * Check the rules that every reservation for a line follows: the project is open, and the part
 * is accepted by the line, counts in a compatible unit, and is not archived.
 */
export function assertReservable(db: Database, project: Project, line: BomLine, part: Part) {
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
}

/** Piece number and size, such as `piece #12 (1220 mm)`. */
function describePiece(piece: CurrentPiece): string {
  return `piece #${piece.id} (${formatSize(piece, piece.displayUnit)})`;
}

/**
 * Check that a cut piece of `size` fits on `piece` next to its other reservations, and return
 * warnings that do not stop the reservation.
 *
 * 1D: the reserved lengths and one kerf per cut must fit in the piece length, as `cutsFit`
 * checks. A reservation of the whole length needs no cut and no kerf.
 *
 * 2D: a piece has one reservation at most. The whole piece needs no check; a smaller size needs
 * the user's confirmation that it fits. The app checks only the area and dimensions, as
 * warnings, because it does not calculate layouts.
 */
function checkPieceFit(
  piece: CurrentPiece,
  size: PieceSize,
  others: PieceReservationDetail[],
  confirmFit: boolean
): string[] {
  const unit = piece.displayUnit;
  for (const value of [size.lengthMm, size.widthMm]) {
    if (value !== null && !(Number.isFinite(value) && value > 0)) {
      throw new InventoryError("A cut size must be greater than zero");
    }
  }

  if (piece.widthMm === null) {
    if (size.widthMm !== null) {
      throw new InventoryError("This piece has no width. Enter only the length.");
    }
    const reserved = others.map((r) => r.lengthMm);
    if (!cutsFit(piece, piece.kerfMm, [...reserved, size.lengthMm])) {
      const free = freeLengthMm(piece, piece.kerfMm, reserved);
      throw new InsufficientStockError(
        `${formatLength(size.lengthMm, unit)} does not fit on ${describePiece(piece)}. ` +
          `${formatLength(free, unit)} is free, and each cut loses a kerf of ` +
          `${formatLength(piece.kerfMm, unit)}.`
      );
    }
    return [];
  }

  if (others.length > 0) {
    throw new InsufficientStockError(
      `${describePiece(piece)} is already reserved for ${others[0].projectName}. ` +
        "A piece with a width has one reservation."
    );
  }
  if (size.widthMm === null) throw new InventoryError("Enter the width of the cut piece");
  const sheet = { lengthMm: piece.lengthMm, widthMm: piece.widthMm };
  const cut = { lengthMm: size.lengthMm, widthMm: size.widthMm };
  if (isWholePiece(sheet, cut)) return [];
  if (!confirmFit) {
    throw new InventoryError(
      `Confirm that ${formatSize(size, unit)} fits in ${describePiece(piece)}`
    );
  }
  const check = checkSplit(sheet, [cut]);
  if (!check.areaFits) {
    return [`${formatSize(size, unit)} has more area than ${describePiece(piece)}`];
  }
  if (check.oversized.length > 0) {
    return [`${formatSize(size, unit)} is larger than ${describePiece(piece)} in one dimension`];
  }
  return [];
}

export type PieceAllocationService = ReturnType<typeof createPieceAllocationService>;

/**
 * Project stock of parts tracked as pieces: reservations, picks, use, and returns.
 *
 * A reservation holds one cut piece of a piece in storage: several lines, and several cut
 * pieces of one line, can share a 1D piece while the cuts and their kerf fit. A line with a cut
 * size reserves pieces of that size by default; a line without one (such as a line converted
 * from a bulk part) reserves whole pieces.
 *
 * A pick does the cut: the reserved size goes to the project's holding location for its line,
 * and the remainder stays in storage with the piece's other reservations. Picked pieces are
 * used or returned one by one. Each action runs in one SQLite transaction.
 */
export function createPieceAllocationService(db: Database) {
  const pieceService = createPieceService(db);

  function inTransaction<T>(fn: () => T): T {
    return db.transaction(fn).immediate();
  }

  function startMovement(operationId: string) {
    if (getMovementByOperationId(db, operationId)) {
      throw new DuplicateOperationError(operationId);
    }
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

  /** A piece in storage, which is the only place a piece can be reserved. */
  function requireStoragePiece(pieceId: number): CurrentPiece {
    const piece = getCurrentPiece(db, pieceId);
    if (!piece) {
      if (!getPiece(db, pieceId)) throw new NotFoundError(`Piece ${pieceId} does not exist`);
      throw new InventoryError(`Piece #${pieceId} is no longer in stock`);
    }
    if (piece.locationKind !== "storage") {
      throw new InventoryError(`Piece #${pieceId} is not in storage`);
    }
    return piece;
  }

  function requireReservation(projectId: number, id: number): PieceReservationDetail {
    const reservation = getPieceReservation(db, id);
    if (!reservation || reservation.projectId !== projectId) {
      throw new NotFoundError(`Piece reservation ${id} does not exist in this project`);
    }
    return reservation;
  }

  /** Whole pieces the line still needs: the uncovered quantity in pieces. */
  function neededPieces(line: BomLine): number {
    const coverage = lineCoverage(line, loadAllocations(db, [line.id]).get(line.id) ?? []);
    return Math.floor(
      absoluteQuantity(coverage.uncovered, coverage.unit) / absoluteQuantity(1, "pcs")
    );
  }

  /** The cut size a line reserves by default: its cut size, or the whole piece. */
  function defaultSize(line: BomLine, piece: CurrentPiece): PieceSize {
    return line.cutLengthMm === null
      ? { lengthMm: piece.lengthMm, widthMm: piece.widthMm }
      : { lengthMm: line.cutLengthMm, widthMm: line.cutWidthMm };
  }

  /** Pieces parts the line accepts and can reserve. */
  function reservableParts(line: BomLine): Part[] {
    return [...allowedPartIds(db, line)]
      .map((id) => getPart(db, id)!)
      .filter(
        (part) =>
          part.trackingMode === "pieces" &&
          !part.archivedAt &&
          unitsCompatible(line.unit, part.baseUnit)
      );
  }

  /** Check and add reservations for a line. The caller checks how many pieces it needs. */
  function reserveEntries(project: Project, line: BomLine, entries: PieceReservationEntry[]) {
    const reservationIds: number[] = [];
    const warnings: string[] = [];
    for (const entry of entries) {
      const piece = requireStoragePiece(entry.pieceId);
      assertReservable(db, project, line, getPart(db, piece.partId)!);
      const size = entry.size ?? defaultSize(line, piece);
      const others = listPieceReservations(db, [piece.id]);
      warnings.push(...checkPieceFit(piece, size, others, entry.confirmFit ?? false));
      reservationIds.push(
        insertPieceReservation(db, {
          bomLineId: line.id,
          pieceId: piece.id,
          lengthMm: size.lengthMm,
          widthMm: size.widthMm,
        })
      );
    }
    fitLineCommitments(db, line);
    return { reservationIds, warnings };
  }

  /**
   * Pick one reservation to the project's holding location for its line, and remove it.
   *
   * - The whole piece moves without a cut.
   * - A 1D cut uses the piece service's cut. The remainder stays at the piece's location with
   *   the piece's other reservations. A remainder shorter than the part's minimum offcut is
   *   scrapped when no reservation uses it, as the cut form proposes.
   * - A 2D cut is a split into the reserved size and the leftovers the user measured.
   */
  function pickReservation(
    project: Project,
    pick: PickPiecesInput["picks"][number],
    movement: MovementInput
  ): { pieceId: number; warnings: string[] } {
    const reservation = requireReservation(project.id, pick.reservationId);
    const line = getBomLine(db, reservation.bomLineId)!;
    const piece = requireStoragePiece(reservation.pieceId);
    const holding = ensureHoldingLocation(db, project.id);
    const others = listPieceReservations(db, [piece.id]).filter((r) => r.id !== reservation.id);
    deletePieceReservation(db, reservation.id);

    if (isWholePiece(piece, reservation)) {
      startMovement(movement.operationId);
      insertMovement(db, {
        ...movement,
        partId: piece.partId,
        quantity: 1,
        fromLocationId: piece.locationId,
        toLocationId: holding.id,
        movementType: "pick",
        reason: null,
        bomLineId: line.id,
        pieceId: piece.id,
      });
      return { pieceId: piece.id, warnings: [] };
    }

    const destination = {
      kind: "pick" as const,
      holdingLocationId: holding.id,
      bomLineId: line.id,
    };
    const keep = { kind: "keep" as const, locationId: piece.locationId };
    const cut = {
      ...movement,
      pieceId: piece.id,
      reason: `Picked for ${project.name}: ${line.description}`,
      allowReserved: true,
    };
    if (piece.widthMm === null) {
      const { remainderMm } = calculateCut(piece, piece, [reservation.lengthMm]);
      const keepRemainder = others.length > 0 || remainderMm >= piece.minOffcutMm;
      const result = pieceService.cutPiece({
        ...cut,
        cuts: [{ lengthMm: reservation.lengthMm, destination }],
        remainder: { destination: keepRemainder ? keep : { kind: "scrap" } },
      });
      const [picked, remainder] = result.pieces;
      if (others.length > 0) {
        movePieceReservations(
          db,
          others.map((r) => r.id),
          remainder.id
        );
      }
      return { pieceId: picked.id, warnings: result.warnings };
    }

    if (!pick.leftovers) {
      throw new InventoryError(
        `Enter the leftover pieces of ${describePiece(piece)} to keep, or none`
      );
    }
    const result = pieceService.splitPiece({
      ...cut,
      outputs: [
        { lengthMm: reservation.lengthMm, widthMm: reservation.widthMm!, destination },
        ...pick.leftovers.map((size) => {
          if (size.widthMm === null) throw new InventoryError("Enter the width of each leftover");
          return { lengthMm: size.lengthMm, widthMm: size.widthMm, destination: keep };
        }),
      ],
    });
    return { pieceId: result.pieces[0].id, warnings: result.warnings };
  }

  /** A piece picked for the line that is still at the project's holding location. */
  function requirePicked(line: BomLine, pieceId: number): PickedPiece {
    const picked = listPickedPieces(db, [line.id]).find((p) => p.pieceId === pieceId);
    if (!picked) throw new InventoryError(`Piece #${pieceId} is not picked for this row`);
    return picked;
  }

  return {
    /**
     * Reserve cut pieces of pieces in storage for a line, all or none. The line must still need
     * that many pieces. Returns warnings for 2D sizes that the user confirmed.
     */
    reservePieces(input: ReservePiecesInput): { reservationIds: number[]; warnings: string[] } {
      return inTransaction(() => {
        const project = requireProject(input.projectId);
        const line = requireLine(project.id, input.lineId);
        if (input.pieces.length === 0) throw new InventoryError("Choose at least one piece");
        const needed = neededPieces(line);
        if (input.pieces.length > needed) {
          throw new InventoryError(
            `This row needs only ${formatQuantity(needed, "pcs")} more; ` +
              `cannot reserve ${formatQuantity(input.pieces.length, "pcs")}`
          );
        }

        return reserveEntries(project, line, input.pieces);
      });
    },

    /**
     * Change the size of a reservation, such as a whole piece reserved by a converted line that
     * needs only a cut of it. The new size must fit next to the piece's other reservations.
     */
    resizePieceReservation(input: ResizePieceReservationInput): { warnings: string[] } {
      return inTransaction(() => {
        const reservation = requireReservation(input.projectId, input.reservationId);
        const piece = requireStoragePiece(reservation.pieceId);
        const others = listPieceReservations(db, [piece.id]).filter((r) => r.id !== reservation.id);
        const warnings = checkPieceFit(piece, input.size, others, input.confirmFit ?? false);
        setPieceReservationSize(db, reservation.id, input.size);
        return { warnings };
      });
    },

    /** Release one reserved cut piece. */
    releasePieceReservation(input: { projectId: number; reservationId: number }): void {
      inTransaction(() => {
        const reservation = requireReservation(input.projectId, input.reservationId);
        deletePieceReservation(db, reservation.id);
      });
    },

    /**
     * Pick reservations in order, in one transaction. Each pick has its own operation ID: the
     * input's ID with the reservation ID, such as `abc:12`. A reservation on the same piece as
     * an earlier pick is on that pick's remainder by then.
     */
    pickPieces(input: PickPiecesInput): { pieceIds: number[]; warnings: string[] } {
      return inTransaction(() => {
        const project = requireProject(input.projectId);
        if (input.picks.length === 0) throw new InventoryError("Choose at least one reservation");
        const pieceIds: number[] = [];
        const warnings: string[] = [];
        for (const pick of input.picks) {
          const result = pickReservation(project, pick, {
            operationId: `${input.operationId}:${pick.reservationId}`,
            occurredOn: input.occurredOn,
          });
          pieceIds.push(result.pieceId);
          warnings.push(...result.warnings);
        }
        return { pieceIds, warnings };
      });
    },

    /** Record that a picked piece was used for its line. It leaves the inventory. */
    usePiece(input: UsePieceInput): Movement {
      return inTransaction(() => {
        startMovement(input.operationId);
        const line = requireLine(requireProject(input.projectId).id, input.lineId);
        const picked = requirePicked(line, input.pieceId);
        return insertMovement(db, {
          operationId: input.operationId,
          partId: picked.partId,
          quantity: 1,
          fromLocationId: picked.locationId,
          toLocationId: null,
          movementType: "project_use",
          occurredOn: input.occurredOn,
          reason: input.reason,
          bomLineId: line.id,
          pieceId: picked.pieceId,
        });
      });
    },

    /**
     * Move a picked piece back to storage, with its dimensions, and optionally reserve it for
     * the line again.
     */
    returnPiece(input: ReturnPieceInput): Movement {
      return inTransaction(() => {
        startMovement(input.operationId);
        const project = requireProject(input.projectId);
        const line = requireLine(project.id, input.lineId);
        const picked = requirePicked(line, input.pieceId);
        const location = getLocation(db, input.toLocationId);
        if (!location) throw new NotFoundError(`Location ${input.toLocationId} does not exist`);
        if (location.kind !== "storage") {
          throw new InventoryError(`${location.name} is not a storage location`);
        }
        const movement = insertMovement(db, {
          operationId: input.operationId,
          partId: picked.partId,
          quantity: 1,
          fromLocationId: picked.locationId,
          toLocationId: location.id,
          movementType: "project_return",
          occurredOn: input.occurredOn,
          reason: null,
          bomLineId: line.id,
          pieceId: picked.pieceId,
        });
        if (input.reserveAgain) reserveEntries(project, line, [{ pieceId: picked.pieceId }]);
        return movement;
      });
    },

    /** Pieces picked for a line and not used or returned yet. */
    listPickedPieces(projectId: number, lineId: number): PickedPiece[] {
      return listPickedPieces(db, [requireLine(projectId, lineId).id]);
    },

    /**
     * Reserved pieces to take from storage, by location, each with the cuts this project
     * makes on it. The filter limits which lines are shown; it does not change any reservation.
     */
    getPiecePickList(projectId: number, filter: ComponentFilter = null): PiecePickStop[] {
      const reservations = listProjectPieceReservations(db, projectId).filter((r) =>
        filter === null
          ? true
          : filter === "ungrouped"
            ? r.componentId === null
            : r.componentId === filter
      );
      const stops = Map.groupBy(reservations, (r) => r.locationId);
      return [...stops.values()].map((atStop) => ({
        locationId: atStop[0].locationId,
        locationName: atStop[0].locationName,
        pieces: [...Map.groupBy(atStop, (r) => r.pieceId).values()].map((cuts) => ({
          pieceId: cuts[0].pieceId,
          partId: cuts[0].partId,
          partName: cuts[0].partName,
          displayUnit: cuts[0].displayUnit,
          kerfMm: cuts[0].kerfMm,
          lengthMm: cuts[0].pieceLengthMm,
          widthMm: cuts[0].pieceWidthMm,
          label: cuts[0].pieceLabel,
          cuts: cuts.map((r) => ({
            reservationId: r.id,
            lineId: r.bomLineId,
            lineDescription: r.lineDescription,
            componentId: r.componentId,
            lengthMm: r.lengthMm,
            widthMm: r.widthMm,
            whole: isWholePiece({ lengthMm: r.pieceLengthMm, widthMm: r.pieceWidthMm }, r),
          })),
        })),
      }));
    },

    /**
     * Pieces in storage that can cover the pieces the line still needs. 1D cuts use first-fit
     * decreasing, so offcuts and the smallest free lengths come first. A 2D cut takes the
     * smallest unreserved piece it fits in. Whole pieces come longest first. Nothing is
     * reserved; the user accepts or changes the suggestion.
     */
    suggestPieces(projectId: number, lineId: number): PieceSuggestion {
      const line = requireLine(projectId, lineId);
      const needed = neededPieces(line);
      const pieces = listStoragePieces(
        db,
        reservableParts(line).map((p) => p.id)
      );
      const unreserved = pieces.filter((p) => p.reservations.length === 0);
      const cuts: PieceSuggestion["cuts"] = [];

      if (line.cutLengthMm === null) {
        for (const piece of unreserved.toSorted((a, b) => b.lengthMm - a.lengthMm)) {
          if (cuts.length === needed) break;
          cuts.push({ piece, size: { lengthMm: piece.lengthMm, widthMm: piece.widthMm } });
        }
      } else if (line.cutWidthMm === null) {
        const linear = pieces.filter((p) => p.widthMm === null);
        const byId = new Map(linear.map((p) => [p.id, p]));
        const lengthMm = line.cutLengthMm;
        const suggestion = suggestCuts(
          linear.map((p) => ({ ...p, unreserved: p.reservations.length === 0 })),
          Array.from({ length: needed }, (_, index) => ({ key: index, lengthMm }))
        );
        for (const assignment of suggestion.assignments) {
          cuts.push({ piece: byId.get(assignment.pieceId)!, size: { lengthMm, widthMm: null } });
        }
      } else {
        const size = { lengthMm: line.cutLengthMm, widthMm: line.cutWidthMm };
        const area = (p: PieceSize) => p.lengthMm * (p.widthMm ?? 0);
        const fitting = unreserved
          .filter((p) => p.widthMm !== null && fitsWithin(size, { ...p, widthMm: p.widthMm }))
          .toSorted((a, b) => area(a) - area(b));
        for (const piece of fitting.slice(0, needed)) cuts.push({ piece, size });
      }
      return { cuts, unplaced: needed - cuts.length };
    },
  };
}
