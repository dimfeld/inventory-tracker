import type { Database } from "bun:sqlite";
import type { PieceDisplayUnit } from "#lib/pieces.ts";
import type { LocationKind } from "./locations";
import { MOVEMENT_COLUMNS, type MovementHistoryEntry, type MovementType } from "./movements";

// A type alias (not an interface) so it can be passed as named SQL bindings.
export type NewStockPiece = {
  partId: number;
  lengthMm: number;
  /** Null for 1D pieces. */
  widthMm: number | null;
  parentPieceId: number | null;
  label: string | null;
};

export type StockPiece = NewStockPiece & {
  id: number;
  createdAt: string;
};

/**
 * A piece that is in stock, with the location where its movement balance is 1, and the cut
 * settings of its part.
 */
export interface CurrentPiece extends StockPiece {
  partName: string;
  kerfMm: number;
  minOffcutMm: number;
  displayUnit: PieceDisplayUnit;
  locationId: number;
  locationName: string;
  locationKind: LocationKind;
}

/** Pieces of one part at one location. */
export interface PieceLocationTotal {
  locationId: number;
  locationName: string;
  pieceCount: number;
  totalLengthMm: number;
  /** Total area in mm² of 2D pieces, or null when the pieces are 1D. */
  totalAreaMm2: number | null;
}

const PIECE_COLUMNS = `p.id, p.part_id AS partId, p.length_mm AS lengthMm, p.width_mm AS widthMm,
  p.parent_piece_id AS parentPieceId, p.label, p.created_at AS createdAt`;

/**
 * The location of every piece in stock: the location where the balance of the piece's
 * movements is positive. Retired pieces have no row.
 */
export const PIECE_BALANCES = `piece_balances AS (
  SELECT piece_id, location_id
  FROM (
    SELECT piece_id, to_location_id AS location_id, quantity AS delta
    FROM stock_movements WHERE piece_id IS NOT NULL AND to_location_id IS NOT NULL
    UNION ALL
    SELECT piece_id, from_location_id, -quantity
    FROM stock_movements WHERE piece_id IS NOT NULL AND from_location_id IS NOT NULL
  )
  GROUP BY piece_id, location_id
  HAVING sum(delta) > 0
)`;

export function insertPiece(db: Database, piece: NewStockPiece): StockPiece {
  return db
    .query<StockPiece, NewStockPiece>(
      `INSERT INTO stock_pieces (part_id, length_mm, width_mm, parent_piece_id, label)
       VALUES ($partId, $lengthMm, $widthMm, $parentPieceId, $label)
       RETURNING id, part_id AS partId, length_mm AS lengthMm, width_mm AS widthMm,
         parent_piece_id AS parentPieceId, label, created_at AS createdAt`
    )
    .get(piece)!;
}

export function getPiece(db: Database, id: number): StockPiece | null {
  return db
    .query<StockPiece, [number]>(`SELECT ${PIECE_COLUMNS} FROM stock_pieces p WHERE p.id = ?`)
    .get(id);
}

/** Pieces in stock that match the filter, ordered by location, then longest first. */
function listCurrentPieces(
  db: Database,
  filter: { partId?: number; locationId?: number; pieceId?: number }
): CurrentPiece[] {
  return db
    .query<
      CurrentPiece,
      { partId: number | null; locationId: number | null; pieceId: number | null }
    >(
      `WITH ${PIECE_BALANCES}
       SELECT ${PIECE_COLUMNS}, pt.name AS partName, pt.kerf_mm AS kerfMm,
         pt.min_offcut_mm AS minOffcutMm, pt.piece_display_unit AS displayUnit, l.id AS locationId,
         l.name AS locationName, l.kind AS locationKind
       FROM stock_pieces p
       JOIN piece_balances b ON b.piece_id = p.id
       JOIN locations l ON l.id = b.location_id
       JOIN parts pt ON pt.id = p.part_id
       WHERE ($partId IS NULL OR p.part_id = $partId)
         AND ($locationId IS NULL OR l.id = $locationId)
         AND ($pieceId IS NULL OR p.id = $pieceId)
       ORDER BY l.name COLLATE NOCASE, pt.name COLLATE NOCASE, p.length_mm DESC,
         p.width_mm DESC, p.id`
    )
    .all({
      partId: filter.partId ?? null,
      locationId: filter.locationId ?? null,
      pieceId: filter.pieceId ?? null,
    });
}

/** The piece with its current location, or null when it is retired or does not exist. */
export function getCurrentPiece(db: Database, pieceId: number): CurrentPiece | null {
  return listCurrentPieces(db, { pieceId })[0] ?? null;
}

export function listPartPieces(db: Database, partId: number): CurrentPiece[] {
  return listCurrentPieces(db, { partId });
}

/** Pieces of every part at one location. */
export function listLocationPieces(db: Database, locationId: number): CurrentPiece[] {
  return listCurrentPieces(db, { locationId });
}

/** Number, total length, and total area (for 2D pieces) of a part's pieces per location. */
export function listPieceTotals(db: Database, partId: number): PieceLocationTotal[] {
  return db
    .query<PieceLocationTotal, [number]>(
      `WITH ${PIECE_BALANCES}
       SELECT l.id AS locationId, l.name AS locationName, count(*) AS pieceCount,
         sum(p.length_mm) AS totalLengthMm, sum(p.length_mm * p.width_mm) AS totalAreaMm2
       FROM stock_pieces p
       JOIN piece_balances b ON b.piece_id = p.id
       JOIN locations l ON l.id = b.location_id
       WHERE p.part_id = ?
       GROUP BY l.id
       ORDER BY l.name COLLATE NOCASE`
    )
    .all(partId);
}

/** Number of pieces ever made for a part, including retired ones. */
export function countPartPieces(db: Database, partId: number): number {
  return db
    .query<{ count: number }, [number]>(
      "SELECT count(*) AS count FROM stock_pieces WHERE part_id = ?"
    )
    .get(partId)!.count;
}

/** A piece with its location when it is in stock, and how it left stock when it is retired. */
export interface PieceStatus extends StockPiece {
  /** Null when the piece is retired. */
  locationId: number | null;
  locationName: string | null;
  /** The type of the last movement that took the piece out of inventory, such as `cut`. */
  retiredBy: MovementType | null;
}

/** Pieces that match the filter, in stock or retired, newest first. */
function listPieceStatuses(
  db: Database,
  filter: { pieceId?: number; parentPieceId?: number; retiredOfPartId?: number }
): PieceStatus[] {
  return db
    .query<
      PieceStatus,
      { pieceId: number | null; parentPieceId: number | null; retiredOfPartId: number | null }
    >(
      `WITH ${PIECE_BALANCES}
       SELECT ${PIECE_COLUMNS}, l.id AS locationId, l.name AS locationName,
         CASE WHEN b.piece_id IS NULL THEN (
           SELECT m.movement_type FROM stock_movements m
           WHERE m.piece_id = p.id AND m.to_location_id IS NULL
           ORDER BY m.id DESC LIMIT 1
         ) END AS retiredBy
       FROM stock_pieces p
       LEFT JOIN piece_balances b ON b.piece_id = p.id
       LEFT JOIN locations l ON l.id = b.location_id
       WHERE ($pieceId IS NULL OR p.id = $pieceId)
         AND ($parentPieceId IS NULL OR p.parent_piece_id = $parentPieceId)
         AND ($retiredOfPartId IS NULL OR (p.part_id = $retiredOfPartId AND b.piece_id IS NULL))
       ORDER BY p.created_at DESC, p.id DESC`
    )
    .all({
      pieceId: filter.pieceId ?? null,
      parentPieceId: filter.parentPieceId ?? null,
      retiredOfPartId: filter.retiredOfPartId ?? null,
    });
}

/** One piece in stock or retired, or null when it does not exist. */
export function getPieceStatus(db: Database, pieceId: number): PieceStatus | null {
  return listPieceStatuses(db, { pieceId })[0] ?? null;
}

/** Pieces made by cutting `pieceId`. Pieces with the same parent come from the same cut. */
export function listChildPieces(db: Database, pieceId: number): PieceStatus[] {
  return listPieceStatuses(db, { parentPieceId: pieceId });
}

/** A part's pieces that are no longer in stock: cut, scrapped, used, or lost. */
export function listRetiredPieces(db: Database, partId: number): PieceStatus[] {
  return listPieceStatuses(db, { retiredOfPartId: partId });
}

/** Movements of one piece, newest first. */
export function listPieceMovements(db: Database, pieceId: number): MovementHistoryEntry[] {
  return db
    .query<MovementHistoryEntry, [number]>(
      `SELECT ${MOVEMENT_COLUMNS}, fl.name AS fromLocationName, tl.name AS toLocationName
       FROM stock_movements m
       LEFT JOIN locations fl ON fl.id = m.from_location_id
       LEFT JOIN locations tl ON tl.id = m.to_location_id
       WHERE m.piece_id = ?
       ORDER BY m.occurred_on DESC, m.id DESC`
    )
    .all(pieceId);
}
