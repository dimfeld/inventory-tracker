import type { Database } from "bun:sqlite";
import { calculateCut, checkSplit, formatArea, formatLength, freeLengthMm } from "#lib/pieces.ts";
import {
  getAttributeDefinitionById,
  getPart,
  type AttributeDefinition,
  type Part,
} from "#lib/server/db/catalog.ts";
import { getLocation, type Location } from "#lib/server/db/locations.ts";
import {
  listPieceReservations,
  type PieceReservationDetail,
} from "#lib/server/db/piece-reservations.ts";
import {
  getMovementByOperationId,
  insertMovement,
  type Movement,
  type NewMovement,
} from "#lib/server/db/movements.ts";
import {
  getCurrentPiece,
  getPiece,
  getPieceStatus,
  insertPiece,
  listChildPieces,
  listLocationPieces,
  listPartPieces,
  listPieceMovements,
  listPieceTotals,
  listRetiredPieces,
  type CurrentPiece,
  type StockPiece,
} from "#lib/server/db/pieces.ts";
import { DuplicateOperationError, InventoryError, NotFoundError } from "./errors";

interface PieceActionBase {
  /** Unique ID for this submission. A repeated ID is rejected without writing. */
  operationId: string;
  /** YYYY-MM-DD */
  occurredOn: string;
}

export interface PieceSizeInput {
  lengthMm: number;
  /** Required for a part with a width dimension, and null for 1D pieces. */
  widthMm: number | null;
  label?: string | null;
}

export interface AddPiecesInput extends PieceActionBase {
  partId: number;
  locationId: number;
  pieces: PieceSizeInput[];
  /** `opening` for existing stock (the default), `count_correction` for pieces found by a count. */
  movementType?: "opening" | "count_correction";
  reason?: string | null;
}

export interface MovePieceInput extends PieceActionBase {
  pieceId: number;
  toLocationId: number;
  reason?: string | null;
}

export interface RemovePieceInput extends PieceActionBase {
  pieceId: number;
  reason: string;
  /**
   * `loss` for a lost or damaged piece (the default), `scrap` for a piece that is thrown away,
   * and `use` for a piece used outside a project, such as for a repair.
   */
  kind?: "loss" | "scrap" | "use";
}

/**
 * Where one output piece of a cut goes: kept at a storage location, scrapped, used outside a
 * project, or picked for a BOM line to its project's holding location. Scrapped and used
 * outputs are retired at once.
 */
export type PieceDestination =
  | { kind: "keep"; locationId: number }
  | { kind: "scrap" }
  | { kind: "use" }
  | { kind: "pick"; holdingLocationId: number; bomLineId: number };

export interface CutOutput {
  lengthMm: number;
  label?: string | null;
  destination: PieceDestination;
}

export interface CutPieceInput extends PieceActionBase {
  pieceId: number;
  /** The pieces cut from the parent. Each cut loses the part's kerf. */
  cuts: CutOutput[];
  /** Where the remainder goes. There is no remainder piece when the cuts use the whole length. */
  remainder: { destination: PieceDestination; label?: string | null };
  /** Required when an output is used outside a project. */
  reason?: string | null;
  /**
   * Cut a reserved piece. Only a project pick sets this; it moves the piece's other
   * reservations to the remainder in the same transaction.
   */
  allowReserved?: boolean;
}

export interface SplitOutput {
  lengthMm: number;
  widthMm: number;
  label?: string | null;
  destination: PieceDestination;
}

export interface SplitPieceInput extends PieceActionBase {
  pieceId: number;
  /** The used piece and the leftover pieces, as the user measured them. */
  outputs: SplitOutput[];
  /** Required when an output is used outside a project. */
  reason?: string | null;
  /** Split a reserved piece. Only a project pick of the piece's reservation sets this. */
  allowReserved?: boolean;
}

/** The new pieces of a cut or split, and warnings that did not stop it. */
export interface CutPieceResult {
  pieces: StockPiece[];
  warnings: string[];
}

/** The attribute definitions that name a pieces part's dimensions. */
export interface PieceDimensions {
  length: AttributeDefinition;
  width: AttributeDefinition | null;
}

/**
 * Reject a part tracked as pieces in an action that changes bulk quantities, so it cannot
 * write quantities that do not belong to a piece.
 */
export function requireBulkPart(part: Pick<Part, "name" | "trackingMode">) {
  if (part.trackingMode === "pieces") {
    throw new InventoryError(
      `${part.name} is tracked as pieces. This action does not support pieces yet.`
    );
  }
}

/** The dimension attributes of a part tracked as pieces. */
export function pieceDimensions(db: Database, part: Part): PieceDimensions {
  const length = getAttributeDefinitionById(db, part.pieceLengthAttributeId!)!;
  const width =
    part.pieceWidthAttributeId === null
      ? null
      : getAttributeDefinitionById(db, part.pieceWidthAttributeId);
  return { length, width };
}

/** Check that a size has a positive length, and a positive width exactly for 2D pieces. */
export function checkPieceSize(dimensions: PieceDimensions, size: PieceSizeInput) {
  const { length, width } = dimensions;
  if (!Number.isFinite(size.lengthMm) || size.lengthMm <= 0) {
    throw new InventoryError(`${length.label} must be greater than zero`);
  }
  if (width === null) {
    if (size.widthMm !== null) {
      throw new InventoryError("These pieces have no width. Enter only the length.");
    }
  } else if (size.widthMm === null || !Number.isFinite(size.widthMm) || size.widthMm <= 0) {
    throw new InventoryError(`${width.label} must be greater than zero`);
  }
}

/**
 * Insert new pieces that come from outside the inventory into `toLocationId`, each with its own
 * quantity-1 movement. Movement operation IDs are `operationId` with the piece's position, such
 * as `abc:1`. Sizes must already be checked. Run it in a transaction.
 */
export function insertIncomingPieces(
  db: Database,
  part: Part,
  sizes: PieceSizeInput[],
  movement: Pick<
    NewMovement,
    | "operationId"
    | "toLocationId"
    | "movementType"
    | "occurredOn"
    | "reason"
    | "receiptLineId"
    | "bomLineId"
  >
): StockPiece[] {
  return sizes.map((size, index) => {
    const piece = insertPiece(db, {
      partId: part.id,
      lengthMm: size.lengthMm,
      widthMm: size.widthMm,
      parentPieceId: null,
      label: size.label?.trim() || null,
    });
    insertMovement(db, {
      ...movement,
      operationId: `${movement.operationId}:${index + 1}`,
      partId: part.id,
      quantity: 1,
      fromLocationId: null,
      pieceId: piece.id,
    });
    return piece;
  });
}

/** A piece in storage with its reservations. */
export interface StoragePiece extends CurrentPiece {
  reservations: PieceReservationDetail[];
  /**
   * The length of a 1D piece that is free for more cuts after its reservations and their kerf.
   * A 2D piece has one reservation at most, so it is its length when unreserved, else zero.
   */
  freeLengthMm: number;
}

/** Pieces of the parts in storage, with their reservations and free length. */
export function listStoragePieces(db: Database, partIds: number[]): StoragePiece[] {
  const pieces = partIds
    .flatMap((id) => listPartPieces(db, id))
    .filter((piece) => piece.locationKind === "storage");
  const reservations = Map.groupBy(
    listPieceReservations(
      db,
      pieces.map((p) => p.id)
    ),
    (r) => r.pieceId
  );
  return pieces.map((piece) => {
    const held = reservations.get(piece.id) ?? [];
    const free =
      piece.widthMm === null
        ? freeLengthMm(
            piece,
            piece.kerfMm,
            held.map((r) => r.lengthMm)
          )
        : held.length > 0
          ? 0
          : piece.lengthMm;
    return { ...piece, reservations: held, freeLengthMm: free };
  });
}

export type PieceService = ReturnType<typeof createPieceService>;

/**
 * Stock of parts tracked as pieces. Each piece is a row in `stock_pieces` with fixed
 * dimensions; it moves with quantity-1 movements that name it, and is where its movement
 * balance is 1. Each change runs in one SQLite transaction.
 */
export function createPieceService(db: Database) {
  /** Run in a new transaction, or in the caller's, such as a project pick that cuts a piece. */
  function inTransaction<T>(fn: () => T): T {
    return db.inTransaction ? fn() : db.transaction(fn).immediate();
  }

  function requireNewOperation(operationId: string) {
    if (getMovementByOperationId(db, operationId)) {
      throw new DuplicateOperationError(operationId);
    }
  }

  function requirePiecesPart(partId: number): Part {
    const part = getPart(db, partId);
    if (!part) throw new NotFoundError(`Part ${partId} does not exist`);
    if (part.trackingMode !== "pieces") {
      throw new InventoryError(`${part.name} is not tracked as pieces`);
    }
    if (part.archivedAt) {
      throw new InventoryError(`${part.name} is archived. Restore it before changing its stock.`);
    }
    return part;
  }

  /** Ordinary piece changes apply to storage. Project holding stock changes only by BOM line. */
  function requireStorage(locationId: number): Location {
    const location = getLocation(db, locationId);
    if (!location) throw new NotFoundError(`Location ${locationId} does not exist`);
    if (location.kind === "project") {
      throw new InventoryError(
        `${location.name} holds picked stock. Use the project's use or return actions.`
      );
    }
    return location;
  }

  /** Check the destinations of a cut's outputs before anything is written. */
  function checkDestinations(destinations: PieceDestination[], reason: string | null) {
    for (const destination of destinations) {
      if (destination.kind === "keep") requireStorage(destination.locationId);
    }
    if (destinations.some((d) => d.kind === "use") && !reason) {
      throw new InventoryError("Enter a reason for a piece that is used outside a project");
    }
  }

  /**
   * Retire `piece` and make its outputs as child pieces, in one operation. Movement operation IDs
   * are the input's ID with a position: `:1` takes the parent out, and each output comes in
   * with the next one. A kept output comes in at its location. A scrapped, used, or picked output
   * comes in where the parent was and then goes out again (a pick to the project's holding
   * location, for its BOM line), so its history shows where it went.
   */
  function insertCut(
    input: PieceActionBase & { reason: string | null },
    piece: CurrentPiece,
    outputs: { size: PieceSizeInput; destination: PieceDestination }[]
  ): StockPiece[] {
    let position = 0;
    const movement = (
      fields: Omit<NewMovement, "operationId" | "partId" | "quantity" | "occurredOn" | "reason">
    ) => {
      position += 1;
      insertMovement(db, {
        ...fields,
        operationId: `${input.operationId}:${position}`,
        partId: piece.partId,
        quantity: 1,
        occurredOn: input.occurredOn,
        reason: input.reason,
      });
    };

    movement({
      fromLocationId: piece.locationId,
      toLocationId: null,
      movementType: "cut",
      pieceId: piece.id,
    });
    return outputs.map(({ size, destination }) => {
      const child = insertPiece(db, {
        partId: piece.partId,
        lengthMm: size.lengthMm,
        widthMm: size.widthMm,
        parentPieceId: piece.id,
        label: size.label?.trim() || null,
      });
      const locationId = destination.kind === "keep" ? destination.locationId : piece.locationId;
      movement({
        fromLocationId: null,
        toLocationId: locationId,
        movementType: "cut",
        pieceId: child.id,
      });
      if (destination.kind === "pick") {
        movement({
          fromLocationId: locationId,
          toLocationId: destination.holdingLocationId,
          movementType: "pick",
          pieceId: child.id,
          bomLineId: destination.bomLineId,
        });
      } else if (destination.kind !== "keep") {
        movement({
          fromLocationId: locationId,
          toLocationId: null,
          movementType: destination.kind,
          pieceId: child.id,
        });
      }
      return child;
    });
  }

  /**
   * A piece that is not reserved, so it can be cut or removed. A reserved piece moves with
   * its reservations, but a project pick cuts it.
   */
  function requireUnreserved(piece: CurrentPiece) {
    const holders = [...new Set(listPieceReservations(db, [piece.id]).map((r) => r.projectName))];
    if (holders.length > 0) {
      throw new InventoryError(
        `This piece is reserved for ${holders.join(", ")}. Release the reservations first, ` +
          "or pick it for the project."
      );
    }
  }

  /** The piece in stock with its part, or an error when it was retired. */
  function requireCurrentPiece(pieceId: number): { piece: CurrentPiece; part: Part } {
    const piece = getCurrentPiece(db, pieceId);
    if (!piece) {
      if (!getPiece(db, pieceId)) throw new NotFoundError(`Piece ${pieceId} does not exist`);
      throw new InventoryError("This piece is no longer in stock");
    }
    return { piece, part: requirePiecesPart(piece.partId) };
  }

  return {
    /**
     * Add new pieces at a storage location, such as existing stock when the app starts or
     * pieces found by a count. Each piece gets its own movement; their operation IDs are the
     * input's ID with the piece's position, such as `abc:1`.
     */
    addPieces(input: AddPiecesInput): StockPiece[] {
      return inTransaction(() => {
        requireNewOperation(`${input.operationId}:1`);
        const part = requirePiecesPart(input.partId);
        requireStorage(input.locationId);
        if (input.pieces.length === 0) throw new InventoryError("Enter at least one piece");
        const dimensions = pieceDimensions(db, part);
        for (const size of input.pieces) checkPieceSize(dimensions, size);
        return insertIncomingPieces(db, part, input.pieces, {
          operationId: input.operationId,
          toLocationId: input.locationId,
          movementType: input.movementType ?? "opening",
          occurredOn: input.occurredOn,
          reason: input.reason ?? null,
        });
      });
    },

    /** Move a piece from its current location to another storage location. */
    movePiece(input: MovePieceInput): Movement {
      return inTransaction(() => {
        requireNewOperation(input.operationId);
        const { piece, part } = requireCurrentPiece(input.pieceId);
        requireStorage(piece.locationId);
        const destination = requireStorage(input.toLocationId);
        if (destination.id === piece.locationId) {
          throw new InventoryError(`This piece is already in ${destination.name}`);
        }
        return insertMovement(db, {
          operationId: input.operationId,
          partId: part.id,
          quantity: 1,
          fromLocationId: piece.locationId,
          toLocationId: destination.id,
          movementType: "transfer",
          occurredOn: input.occurredOn,
          reason: input.reason ?? null,
          pieceId: piece.id,
        });
      });
    },

    /**
     * Cut a 1D piece into pieces of the given lengths. The remainder is the piece length minus
     * the cut lengths and the kerf of each cut; the cut is refused when it is negative. Each
     * output, and the remainder when it is not zero, goes to its own destination.
     */
    cutPiece(input: CutPieceInput): CutPieceResult {
      return inTransaction(() => {
        requireNewOperation(`${input.operationId}:1`);
        const { piece, part } = requireCurrentPiece(input.pieceId);
        requireStorage(piece.locationId);
        if (!input.allowReserved) requireUnreserved(piece);
        if (piece.widthMm !== null) {
          throw new InventoryError(
            "This piece has a width. Split it into measured pieces instead."
          );
        }
        if (input.cuts.length === 0) throw new InventoryError("Enter at least one cut length");
        const dimensions = pieceDimensions(db, part);
        const sizes = input.cuts.map((cut) => ({
          lengthMm: cut.lengthMm,
          widthMm: null,
          label: cut.label,
        }));
        for (const size of sizes) checkPieceSize(dimensions, size);
        const result = calculateCut(
          piece,
          part,
          sizes.map((s) => s.lengthMm)
        );
        if (!result.fits) {
          throw new InventoryError(
            `The cuts do not fit in this piece. They need ${formatLength(-result.remainderMm, part.pieceDisplayUnit)} more, with a kerf of ${formatLength(part.kerfMm, part.pieceDisplayUnit)} per cut.`
          );
        }

        const outputs = input.cuts.map((cut, index) => ({
          size: sizes[index],
          destination: cut.destination,
        }));
        if (result.remainderMm > 0) {
          outputs.push({
            size: { lengthMm: result.remainderMm, widthMm: null, label: input.remainder.label },
            destination: input.remainder.destination,
          });
        }
        const reason = input.reason?.trim() || null;
        checkDestinations(
          outputs.map((o) => o.destination),
          reason
        );
        return { pieces: insertCut({ ...input, reason }, piece, outputs), warnings: [] };
      });
    },

    /**
     * Split a 2D piece into pieces that the user measured: the used piece and the leftovers. The
     * app does not calculate layouts. The split is refused when the outputs have more area than
     * the parent; an output larger than the parent in one dimension is only a warning.
     */
    splitPiece(input: SplitPieceInput): CutPieceResult {
      return inTransaction(() => {
        requireNewOperation(`${input.operationId}:1`);
        const { piece, part } = requireCurrentPiece(input.pieceId);
        requireStorage(piece.locationId);
        if (!input.allowReserved) requireUnreserved(piece);
        if (piece.widthMm === null) {
          throw new InventoryError("This piece has no width. Cut it to lengths instead.");
        }
        if (input.outputs.length === 0) throw new InventoryError("Enter at least one piece");
        const dimensions = pieceDimensions(db, part);
        for (const output of input.outputs) checkPieceSize(dimensions, output);
        const check = checkSplit(
          { lengthMm: piece.lengthMm, widthMm: piece.widthMm },
          input.outputs
        );
        if (!check.areaFits) {
          throw new InventoryError(
            `The pieces have a total area of ${formatArea(check.outputAreaMm2, part.pieceDisplayUnit)}, more than the ${formatArea(check.parentAreaMm2, part.pieceDisplayUnit)} of this piece`
          );
        }

        const reason = input.reason?.trim() || null;
        checkDestinations(
          input.outputs.map((o) => o.destination),
          reason
        );
        const pieces = insertCut(
          { ...input, reason },
          piece,
          input.outputs.map(({ destination, ...size }) => ({ size, destination }))
        );
        const warnings = check.oversized.map(
          (index) => `Piece ${index + 1} is larger than this piece in one dimension`
        );
        return { pieces, warnings };
      });
    },

    /**
     * Take a piece out of inventory: lost or damaged, scrapped, or used outside a project. The
     * piece is retired.
     */
    removePiece(input: RemovePieceInput): Movement {
      return inTransaction(() => {
        requireNewOperation(input.operationId);
        const { piece, part } = requireCurrentPiece(input.pieceId);
        requireStorage(piece.locationId);
        requireUnreserved(piece);
        return insertMovement(db, {
          operationId: input.operationId,
          partId: part.id,
          quantity: 1,
          fromLocationId: piece.locationId,
          toLocationId: null,
          movementType: input.kind ?? "loss",
          occurredOn: input.occurredOn,
          reason: input.reason,
          pieceId: piece.id,
        });
      });
    },

    /** The dimension attributes of a pieces part, or null for a bulk part. */
    getDimensions(partId: number): PieceDimensions | null {
      const part = getPart(db, partId);
      return part?.trackingMode === "pieces" ? pieceDimensions(db, part) : null;
    },

    /** A part's pieces in stock with their locations, and totals per location. */
    listPartPieces(partId: number) {
      return { pieces: listPartPieces(db, partId), totals: listPieceTotals(db, partId) };
    },

    /** Pieces of every part at one location. */
    listLocationPieces: (locationId: number) => listLocationPieces(db, locationId),

    /** A part's pieces that are no longer in stock. */
    listRetiredPieces: (partId: number) => listRetiredPieces(db, partId),

    /**
     * One piece with its lineage and movements: the piece it was cut from, the pieces cut from
     * it, and its siblings (other pieces from the same cut). Null when it does not exist.
     */
    getPieceHistory(pieceId: number) {
      const piece = getPieceStatus(db, pieceId);
      if (!piece) return null;
      const part = getPart(db, piece.partId)!;
      const parent = piece.parentPieceId === null ? null : getPieceStatus(db, piece.parentPieceId);
      return {
        piece,
        part,
        /** The piece with its part's cut settings when it is in stock, for the cut form. */
        current: getCurrentPiece(db, pieceId),
        parent,
        children: listChildPieces(db, pieceId),
        siblings: parent ? listChildPieces(db, parent.id).filter((p) => p.id !== pieceId) : [],
        movements: listPieceMovements(db, pieceId),
      };
    },
  };
}
