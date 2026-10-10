import type { Database } from "bun:sqlite";
import { PIECE_BALANCES } from "./pieces";

/** An active reservation with the names needed to show it. Quantities are in `baseUnit`. */
export interface ReservationDetail {
  id: number;
  bomLineId: number;
  projectId: number;
  projectName: string;
  lineDescription: string;
  componentId: number | null;
  partId: number;
  partName: string;
  baseUnit: string;
  locationId: number;
  locationName: string;
  quantity: number;
}

/** Picked and used quantities of one part for one BOM line, in the part's base unit. */
export interface LineStock {
  bomLineId: number;
  partId: number;
  partName: string;
  baseUnit: string;
  picked: number;
  used: number;
}

/**
 * Physical and reserved quantities of a part at a storage location, in its base unit. For a
 * part tracked as pieces, `balance` counts its pieces and `reserved` counts the pieces with
 * any piece reservation, so `balance - reserved` is the pieces that are free as a whole.
 */
export interface StorageStock {
  partId: number;
  locationId: number;
  locationName: string;
  balance: number;
  reserved: number;
}

const DETAIL_SELECT = `SELECT r.id, r.bom_line_id AS bomLineId, l.project_id AS projectId,
    pr.name AS projectName, l.description AS lineDescription, l.component_id AS componentId,
    r.part_id AS partId, p.name AS partName, p.base_unit AS baseUnit,
    r.location_id AS locationId, loc.name AS locationName, r.quantity
  FROM reservations r
  JOIN bom_lines l ON l.id = r.bom_line_id
  JOIN projects pr ON pr.id = l.project_id
  JOIN parts p ON p.id = r.part_id
  JOIN locations loc ON loc.id = r.location_id`;

/** Reservations of a part at one location, newest first. */
export function listReservationsAt(
  db: Database,
  partId: number,
  locationId: number
): ReservationDetail[] {
  return db
    .query<ReservationDetail, [number, number]>(
      `${DETAIL_SELECT} WHERE r.part_id = ? AND r.location_id = ? ORDER BY r.id DESC`
    )
    .all(partId, locationId);
}

export function listProjectReservations(db: Database, projectId: number): ReservationDetail[] {
  return db
    .query<ReservationDetail, [number]>(
      `${DETAIL_SELECT} WHERE l.project_id = ?
       ORDER BY loc.name COLLATE NOCASE, p.name COLLATE NOCASE, r.bom_line_id`
    )
    .all(projectId);
}

export function listLineReservations(db: Database, lineIds: number[]): ReservationDetail[] {
  return db
    .query<ReservationDetail, [string]>(
      `${DETAIL_SELECT} WHERE r.bom_line_id IN (SELECT value FROM json_each(?))
       ORDER BY p.name COLLATE NOCASE, loc.name COLLATE NOCASE`
    )
    .all(JSON.stringify(lineIds));
}

/** Total active reservations of a part at one location. */
export function reservedQuantity(db: Database, partId: number, locationId: number): number {
  return db
    .query<{ total: number }, [number, number]>(
      `SELECT coalesce(sum(quantity), 0) AS total FROM reservations
       WHERE part_id = ? AND location_id = ?`
    )
    .get(partId, locationId)!.total;
}

export function getReservation(
  db: Database,
  key: { bomLineId: number; partId: number; locationId: number }
): { id: number; quantity: number } | null {
  return db
    .query<{ id: number; quantity: number }, [number, number, number]>(
      `SELECT id, quantity FROM reservations
       WHERE bom_line_id = ? AND part_id = ? AND location_id = ?`
    )
    .get(key.bomLineId, key.partId, key.locationId);
}

/** Add to the reservation of a line, part, and location, creating it when needed. */
export function addReservation(
  db: Database,
  fields: { bomLineId: number; partId: number; locationId: number; quantity: number }
): void {
  db.run(
    `INSERT INTO reservations (bom_line_id, part_id, location_id, quantity) VALUES (?, ?, ?, ?)
     ON CONFLICT (bom_line_id, part_id, location_id) DO UPDATE SET
       quantity = quantity + excluded.quantity,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [fields.bomLineId, fields.partId, fields.locationId, fields.quantity]
  );
}

/** Set the active quantity of a reservation. Zero removes it. */
export function setReservationQuantity(db: Database, id: number, quantity: number): void {
  if (quantity === 0) {
    db.run("DELETE FROM reservations WHERE id = ?", [id]);
  } else {
    db.run(
      `UPDATE reservations SET quantity = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
      [quantity, id]
    );
  }
}

/** Remove every reservation of a project. Returns the number removed. */
export function deleteProjectReservations(db: Database, projectId: number): number {
  return db.run(
    `DELETE FROM reservations
     WHERE bom_line_id IN (SELECT id FROM bom_lines WHERE project_id = ?)`,
    [projectId]
  ).changes;
}

/**
 * Picked and used quantities per line and part. Picked is the balance of the line's movements
 * at its project's holding location; used is the total of its use movements. Parts whose
 * picked stock was fully returned are included with zero quantities.
 */
export function listLineStock(db: Database, lineIds: number[]): LineStock[] {
  return db
    .query<LineStock, [string]>(
      `SELECT m.bom_line_id AS bomLineId, m.part_id AS partId, p.name AS partName,
         p.base_unit AS baseUnit,
         sum(CASE WHEN m.to_location_id = h.id THEN m.quantity
                  WHEN m.from_location_id = h.id THEN -m.quantity ELSE 0 END) AS picked,
         sum(CASE WHEN m.movement_type = 'project_use' THEN m.quantity ELSE 0 END) AS used
       FROM stock_movements m
       JOIN bom_lines l ON l.id = m.bom_line_id
       JOIN locations h ON h.project_id = l.project_id
       JOIN parts p ON p.id = m.part_id
       WHERE m.bom_line_id IN (SELECT value FROM json_each(?))
       GROUP BY m.bom_line_id, m.part_id
       ORDER BY p.name COLLATE NOCASE`
    )
    .all(JSON.stringify(lineIds));
}

export function countLineMovements(db: Database, lineId: number): number {
  return db
    .query<{ count: number }, [number]>(
      "SELECT count(*) AS count FROM stock_movements WHERE bom_line_id = ?"
    )
    .get(lineId)!.count;
}

/** Storage locations that hold or reserve any of the parts. */
export function listStorageStock(db: Database, partIds: number[]): StorageStock[] {
  return db
    .query<StorageStock, [string]>(
      `WITH ids AS (SELECT value AS part_id FROM json_each(?1)),
       ${PIECE_BALANCES},
       reserved_pieces AS (
         SELECT sp.part_id, b.location_id, count(DISTINCT r.piece_id) AS reserved
         FROM piece_reservations r
         JOIN stock_pieces sp ON sp.id = r.piece_id
         JOIN piece_balances b ON b.piece_id = r.piece_id
         WHERE sp.part_id IN ids
         GROUP BY sp.part_id, b.location_id
       ),
       deltas AS (
         SELECT part_id, to_location_id AS location_id, quantity AS delta
         FROM stock_movements WHERE part_id IN ids AND to_location_id IS NOT NULL
         UNION ALL
         SELECT part_id, from_location_id, -quantity
         FROM stock_movements WHERE part_id IN ids AND from_location_id IS NOT NULL
         UNION ALL
         SELECT part_id, location_id, 0 FROM reservations WHERE part_id IN ids
       )
       SELECT d.part_id AS partId, loc.id AS locationId, loc.name AS locationName,
         sum(d.delta) AS balance,
         (SELECT coalesce(sum(r.quantity), 0) FROM reservations r
          WHERE r.part_id = d.part_id AND r.location_id = loc.id)
         + (SELECT coalesce(sum(rp.reserved), 0) FROM reserved_pieces rp
          WHERE rp.part_id = d.part_id AND rp.location_id = loc.id) AS reserved
       FROM deltas d
       JOIN locations loc ON loc.id = d.location_id AND loc.kind = 'storage'
       GROUP BY d.part_id, loc.id
       HAVING balance > 0 OR reserved > 0
       ORDER BY loc.name COLLATE NOCASE`
    )
    .all(JSON.stringify(partIds));
}
