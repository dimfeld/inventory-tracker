import type { Database } from "bun:sqlite";
import {
  getAttributeDefinitionById,
  getPart,
  type AttributeDefinition,
  type Part,
} from "#lib/server/db/catalog.ts";
import { getLocation, type Location } from "#lib/server/db/locations.ts";
import {
  getMovementByOperationId,
  insertMovement,
  type Movement,
  type NewMovement,
} from "#lib/server/db/movements.ts";
import {
  getCurrentPiece,
  getPiece,
  insertPiece,
  listLocationPieces,
  listPartPieces,
  listPieceTotals,
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
    "operationId" | "toLocationId" | "movementType" | "occurredOn" | "reason" | "receiptLineId"
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

export type PieceService = ReturnType<typeof createPieceService>;

/**
 * Stock of parts tracked as pieces. Each piece is a row in `stock_pieces` with fixed
 * dimensions; it moves with quantity-1 movements that name it, and is where its movement
 * balance is 1. Each change runs in one SQLite transaction.
 */
export function createPieceService(db: Database) {
  function inTransaction<T>(fn: () => T): T {
    return db.transaction(fn).immediate();
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

    /** Remove a lost, damaged, or discarded piece from inventory. The piece is retired. */
    removePiece(input: RemovePieceInput): Movement {
      return inTransaction(() => {
        requireNewOperation(input.operationId);
        const { piece, part } = requireCurrentPiece(input.pieceId);
        requireStorage(piece.locationId);
        return insertMovement(db, {
          operationId: input.operationId,
          partId: part.id,
          quantity: 1,
          fromLocationId: piece.locationId,
          toLocationId: null,
          movementType: "loss",
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
  };
}
