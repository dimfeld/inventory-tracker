import type { Database } from "bun:sqlite";
import type { PieceDisplayUnit } from "#lib/pieces.ts";
import { PIECE_BALANCES } from "./pieces";

// A type alias (not an interface) so it can be passed as named SQL bindings.
export type NewPieceReservation = {
  bomLineId: number;
  pieceId: number;
  lengthMm: number;
  /** Null for 1D pieces. */
  widthMm: number | null;
};

export type PieceReservation = NewPieceReservation & { id: number };

/** A reservation of one cut piece, with its piece, location, and line. */
export interface PieceReservationDetail extends PieceReservation {
  projectId: number;
  projectName: string;
  lineDescription: string;
  componentId: number | null;
  partId: number;
  partName: string;
  baseUnit: string;
  kerfMm: number;
  displayUnit: PieceDisplayUnit;
  pieceLengthMm: number;
  pieceWidthMm: number | null;
  pieceLabel: string | null;
  locationId: number;
  locationName: string;
}

const DETAIL_SELECT = `WITH ${PIECE_BALANCES}
  SELECT r.id, r.bom_line_id AS bomLineId, r.piece_id AS pieceId, r.length_mm AS lengthMm,
    r.width_mm AS widthMm, l.project_id AS projectId, pr.name AS projectName,
    l.description AS lineDescription, l.component_id AS componentId, sp.part_id AS partId,
    p.name AS partName, p.base_unit AS baseUnit, p.kerf_mm AS kerfMm,
    p.piece_display_unit AS displayUnit, sp.length_mm AS pieceLengthMm,
    sp.width_mm AS pieceWidthMm, sp.label AS pieceLabel, loc.id AS locationId,
    loc.name AS locationName
  FROM piece_reservations r
  JOIN bom_lines l ON l.id = r.bom_line_id
  JOIN projects pr ON pr.id = l.project_id
  JOIN stock_pieces sp ON sp.id = r.piece_id
  JOIN parts p ON p.id = sp.part_id
  JOIN piece_balances b ON b.piece_id = r.piece_id
  JOIN locations loc ON loc.id = b.location_id`;

export function getPieceReservation(db: Database, id: number): PieceReservationDetail | null {
  return db.query<PieceReservationDetail, [number]>(`${DETAIL_SELECT} WHERE r.id = ?`).get(id);
}

/** Reservations of the lines, by part, location, and piece. */
export function listLinePieceReservations(
  db: Database,
  lineIds: number[]
): PieceReservationDetail[] {
  return db
    .query<PieceReservationDetail, [string]>(
      `${DETAIL_SELECT} WHERE r.bom_line_id IN (SELECT value FROM json_each(?))
       ORDER BY p.name COLLATE NOCASE, loc.name COLLATE NOCASE, r.piece_id, r.id`
    )
    .all(JSON.stringify(lineIds));
}

/** Reservations on the pieces, of any project. */
export function listPieceReservations(db: Database, pieceIds: number[]): PieceReservationDetail[] {
  return db
    .query<PieceReservationDetail, [string]>(
      `${DETAIL_SELECT} WHERE r.piece_id IN (SELECT value FROM json_each(?)) ORDER BY r.id`
    )
    .all(JSON.stringify(pieceIds));
}

/** Reservations of a project's lines, by location, part, and piece. */
export function listProjectPieceReservations(
  db: Database,
  projectId: number
): PieceReservationDetail[] {
  return db
    .query<PieceReservationDetail, [number]>(
      `${DETAIL_SELECT} WHERE l.project_id = ?
       ORDER BY loc.name COLLATE NOCASE, p.name COLLATE NOCASE, r.piece_id, r.length_mm DESC, r.id`
    )
    .all(projectId);
}

/** A piece picked for a BOM line and held at its project's holding location. */
export interface PickedPiece {
  bomLineId: number;
  pieceId: number;
  partId: number;
  partName: string;
  displayUnit: PieceDisplayUnit;
  lengthMm: number;
  widthMm: number | null;
  label: string | null;
  locationId: number;
}

/**
 * Pieces picked for the lines that are not used or returned: pieces whose movements for a line
 * leave a balance of 1 at the line's project holding location.
 */
export function listPickedPieces(db: Database, lineIds: number[]): PickedPiece[] {
  return db
    .query<PickedPiece, [string]>(
      `SELECT m.bom_line_id AS bomLineId, m.piece_id AS pieceId, sp.part_id AS partId,
         p.name AS partName, p.piece_display_unit AS displayUnit, sp.length_mm AS lengthMm,
         sp.width_mm AS widthMm, sp.label, h.id AS locationId
       FROM stock_movements m
       JOIN bom_lines l ON l.id = m.bom_line_id
       JOIN locations h ON h.project_id = l.project_id
       JOIN stock_pieces sp ON sp.id = m.piece_id
       JOIN parts p ON p.id = sp.part_id
       WHERE m.piece_id IS NOT NULL AND m.bom_line_id IN (SELECT value FROM json_each(?))
       GROUP BY m.bom_line_id, m.piece_id
       HAVING sum(CASE WHEN m.to_location_id = h.id THEN 1
                       WHEN m.from_location_id = h.id THEN -1 ELSE 0 END) > 0
       ORDER BY p.name COLLATE NOCASE, sp.length_mm DESC, sp.id`
    )
    .all(JSON.stringify(lineIds));
}

/** Move reservations to another piece, such as the remainder of a cut. */
export function movePieceReservations(db: Database, ids: number[], pieceId: number): void {
  db.run(
    `UPDATE piece_reservations SET piece_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id IN (SELECT value FROM json_each(?))`,
    [pieceId, JSON.stringify(ids)]
  );
}

export function insertPieceReservation(db: Database, fields: NewPieceReservation): number {
  return db
    .query<{ id: number }, NewPieceReservation>(
      `INSERT INTO piece_reservations (bom_line_id, piece_id, length_mm, width_mm)
       VALUES ($bomLineId, $pieceId, $lengthMm, $widthMm) RETURNING id`
    )
    .get(fields)!.id;
}

export function setPieceReservationSize(
  db: Database,
  id: number,
  size: { lengthMm: number; widthMm: number | null }
): void {
  db.run(
    `UPDATE piece_reservations SET length_mm = ?, width_mm = ?,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
    [size.lengthMm, size.widthMm, id]
  );
}

export function deletePieceReservation(db: Database, id: number): void {
  db.run("DELETE FROM piece_reservations WHERE id = ?", [id]);
}

/** Remove every piece reservation of a project. Returns the number removed. */
export function deleteProjectPieceReservations(db: Database, projectId: number): number {
  return db.run(
    `DELETE FROM piece_reservations
     WHERE bom_line_id IN (SELECT id FROM bom_lines WHERE project_id = ?)`,
    [projectId]
  ).changes;
}
