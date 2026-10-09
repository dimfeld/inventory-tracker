import type { Database } from "bun:sqlite";

export type MovementType =
  | "opening"
  | "transfer"
  | "loss"
  | "supplier_return"
  | "count_correction"
  /** Storage to a project holding location, for one BOM line. */
  | "pick"
  /** Project holding location to outside: consumed or installed for one BOM line. */
  | "project_use"
  /** Project holding location back to storage, for one BOM line. */
  | "project_return"
  /** Accepted stock from an order receipt, from outside to storage. */
  | "receipt";

// A type alias (not an interface) so it can be passed as named SQL bindings.
export type NewMovement = {
  operationId: string;
  partId: number;
  /** Positive integer quantity in the part's base unit. */
  quantity: number;
  /** NULL means the stock comes from outside the inventory. */
  fromLocationId: number | null;
  /** NULL means the stock leaves the inventory. */
  toLocationId: number | null;
  movementType: MovementType;
  /** Date the movement happened, as YYYY-MM-DD. */
  occurredOn: string;
  reason: string | null;
  /** The BOM line a project movement belongs to. Null for ordinary stock changes. */
  bomLineId?: number | null;
  /** The receipt line a receipt movement belongs to. */
  receiptLineId?: number | null;
  /**
   * The piece this movement moves, with quantity 1. Required for a part tracked as pieces and
   * not allowed for a bulk part; a database trigger rejects other movements.
   */
  pieceId?: number | null;
};

export type Movement = NewMovement & {
  id: number;
  createdAt: string;
};

export interface MovementHistoryEntry extends Movement {
  fromLocationName: string | null;
  toLocationName: string | null;
}

export interface LocationBalance {
  locationId: number;
  locationName: string;
  quantity: number;
}

const MOVEMENT_COLUMNS = `m.id, m.operation_id AS operationId, m.part_id AS partId, m.quantity,
  m.from_location_id AS fromLocationId, m.to_location_id AS toLocationId,
  m.movement_type AS movementType, m.occurred_on AS occurredOn, m.reason, m.bom_line_id AS bomLineId,
  m.receipt_line_id AS receiptLineId, m.piece_id AS pieceId, m.created_at AS createdAt`;

export function insertMovement(db: Database, movement: NewMovement): Movement {
  return db
    .query<Movement, NewMovement>(
      `INSERT INTO stock_movements (operation_id, part_id, quantity, from_location_id,
         to_location_id, movement_type, occurred_on, reason, bom_line_id, receipt_line_id,
         piece_id)
       VALUES ($operationId, $partId, $quantity, $fromLocationId, $toLocationId, $movementType,
         $occurredOn, $reason, $bomLineId, $receiptLineId, $pieceId)
       RETURNING id, operation_id AS operationId, part_id AS partId, quantity,
         from_location_id AS fromLocationId, to_location_id AS toLocationId,
         movement_type AS movementType, occurred_on AS occurredOn, reason,
         bom_line_id AS bomLineId, receipt_line_id AS receiptLineId, piece_id AS pieceId,
         created_at AS createdAt`
    )
    .get({ bomLineId: null, receiptLineId: null, pieceId: null, ...movement })!;
}

export function getMovementByOperationId(db: Database, operationId: string): Movement | null {
  return db
    .query<Movement, [string]>(
      `SELECT ${MOVEMENT_COLUMNS} FROM stock_movements m WHERE m.operation_id = ?`
    )
    .get(operationId);
}

/** Physical balance of a part at one location, derived from its movements. */
export function getBalance(db: Database, partId: number, locationId: number): number {
  const row = db
    .query<{ balance: number }, { partId: number; locationId: number }>(
      `SELECT coalesce(sum(CASE WHEN to_location_id = $locationId THEN quantity ELSE -quantity END), 0)
         AS balance
       FROM stock_movements
       WHERE part_id = $partId AND (to_location_id = $locationId OR from_location_id = $locationId)`
    )
    .get({ partId, locationId });
  return row!.balance;
}

/** Balances of a part at every location it has moved through, including zero balances. */
export function listLocationBalances(db: Database, partId: number): LocationBalance[] {
  return db
    .query<LocationBalance, [number, number]>(
      `SELECT l.id AS locationId, l.name AS locationName, sum(d.delta) AS quantity
       FROM (
         SELECT to_location_id AS location_id, quantity AS delta
         FROM stock_movements WHERE part_id = ? AND to_location_id IS NOT NULL
         UNION ALL
         SELECT from_location_id, -quantity
         FROM stock_movements WHERE part_id = ? AND from_location_id IS NOT NULL
       ) d
       JOIN locations l ON l.id = d.location_id
       GROUP BY l.id
       ORDER BY l.name COLLATE NOCASE`
    )
    .all(partId, partId);
}

export function listPartMovements(db: Database, partId: number): MovementHistoryEntry[] {
  return db
    .query<MovementHistoryEntry, [number]>(
      `SELECT ${MOVEMENT_COLUMNS}, fl.name AS fromLocationName, tl.name AS toLocationName
       FROM stock_movements m
       LEFT JOIN locations fl ON fl.id = m.from_location_id
       LEFT JOIN locations tl ON tl.id = m.to_location_id
       WHERE m.part_id = ?
       ORDER BY m.occurred_on DESC, m.id DESC`
    )
    .all(partId);
}

export function countPartMovements(db: Database, partId: number): number {
  return db
    .query<{ count: number }, [number]>(
      "SELECT count(*) AS count FROM stock_movements WHERE part_id = ?"
    )
    .get(partId)!.count;
}
