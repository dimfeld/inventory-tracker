import type { Database } from "bun:sqlite";
import type { OrderStatus } from "#lib/orders.ts";
import type { PieceDisplayUnit } from "#lib/pieces.ts";
import type { IncomingLine } from "./orders";

// A type alias (not an interface) so it can be passed as named SQL bindings.
export type NewPieceCommitment = {
  bomLineId: number;
  orderLineId: number;
  /** Which incoming stock piece of the order line, from 0. */
  stickIndex: number;
  lengthMm: number;
  /** Null for 1D pieces. */
  widthMm: number | null;
};

/** One cut piece of an incoming stock piece committed to a BOM line, with its order and line. */
export interface PieceCommitmentDetail extends NewPieceCommitment {
  id: number;
  projectId: number;
  projectName: string;
  lineDescription: string;
  componentId: number | null;
  orderId: number;
  supplier: string;
  reference: string | null;
  orderStatus: OrderStatus;
  expectedOn: string | null;
  partId: number;
  partName: string;
  baseUnit: string;
  kerfMm: number;
  displayUnit: PieceDisplayUnit;
}

const DETAIL_SELECT = `SELECT c.id, c.bom_line_id AS bomLineId, c.order_line_id AS orderLineId,
    c.stick_index AS stickIndex, c.length_mm AS lengthMm, c.width_mm AS widthMm,
    l.project_id AS projectId, pr.name AS projectName, l.description AS lineDescription,
    l.component_id AS componentId, o.id AS orderId, o.supplier, o.reference,
    o.status AS orderStatus, o.expected_on AS expectedOn, ol.part_id AS partId,
    p.name AS partName, p.base_unit AS baseUnit, p.kerf_mm AS kerfMm,
    p.piece_display_unit AS displayUnit
  FROM incoming_piece_commitments c
  JOIN bom_lines l ON l.id = c.bom_line_id
  JOIN projects pr ON pr.id = l.project_id
  JOIN order_lines ol ON ol.id = c.order_line_id
  JOIN orders o ON o.id = ol.order_id
  JOIN parts p ON p.id = ol.part_id`;

export function getPieceCommitment(db: Database, id: number): PieceCommitmentDetail | null {
  return db.query<PieceCommitmentDetail, [number]>(`${DETAIL_SELECT} WHERE c.id = ?`).get(id);
}

/** Piece commitments of the BOM lines, in order of expected arrival. */
export function listLinePieceCommitments(db: Database, lineIds: number[]): PieceCommitmentDetail[] {
  return db
    .query<PieceCommitmentDetail, [string]>(
      `${DETAIL_SELECT} WHERE c.bom_line_id IN (SELECT value FROM json_each(?))
       ORDER BY o.expected_on IS NULL, o.expected_on, c.order_line_id, c.stick_index, c.id`
    )
    .all(JSON.stringify(lineIds));
}

/** Piece commitments of the order lines, by order line and stick. */
export function listOrderLinePieceCommitments(
  db: Database,
  orderLineIds: number[]
): PieceCommitmentDetail[] {
  return db
    .query<PieceCommitmentDetail, [string]>(
      `${DETAIL_SELECT} WHERE c.order_line_id IN (SELECT value FROM json_each(?))
       ORDER BY c.order_line_id, c.stick_index, c.id`
    )
    .all(JSON.stringify(orderLineIds));
}

export function insertPieceCommitment(db: Database, fields: NewPieceCommitment): number {
  return db
    .query<{ id: number }, NewPieceCommitment>(
      `INSERT INTO incoming_piece_commitments
         (bom_line_id, order_line_id, stick_index, length_mm, width_mm)
       VALUES ($bomLineId, $orderLineId, $stickIndex, $lengthMm, $widthMm) RETURNING id`
    )
    .get(fields)!.id;
}

export function deletePieceCommitments(db: Database, ids: number[]): void {
  db.run("DELETE FROM incoming_piece_commitments WHERE id IN (SELECT value FROM json_each(?))", [
    JSON.stringify(ids),
  ]);
}

/** Move the order line's commitments down by `count` sticks, after that many arrived. */
export function shiftPieceCommitments(db: Database, orderLineId: number, count: number): void {
  db.run(
    `UPDATE incoming_piece_commitments SET stick_index = stick_index - ?1,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE order_line_id = ?2`,
    [count, orderLineId]
  );
}

/** Outstanding supply of a pieces part, with the stock size of its supplier SKU in mm. */
export interface IncomingPieceLine extends IncomingLine {
  /** Null when the order line has no SKU with a stock size. */
  stockLengthMm: number | null;
  stockWidthMm: number | null;
  kerfMm: number;
}

/**
 * Lines of placed and shipped orders of pieces parts that still have outstanding supply, with
 * the stock size of each line's supplier SKU.
 */
export function listIncomingPieceLines(db: Database, partIds: number[]): IncomingPieceLine[] {
  const outstanding = `max(ol.quantity - ol.received_quantity - ol.damaged_quantity
    - ol.cancelled_quantity, 0)`;
  return db
    .query<IncomingPieceLine, [string]>(
      `SELECT ol.id AS orderLineId, o.id AS orderId, o.supplier, o.reference, o.status,
         o.expected_on AS expectedOn, ol.part_id AS partId, p.name AS partName,
         p.base_unit AS baseUnit, ${outstanding} AS outstanding,
         sp.stock_length_mm AS stockLengthMm, sp.stock_width_mm AS stockWidthMm,
         p.kerf_mm AS kerfMm
       FROM order_lines ol
       JOIN orders o ON o.id = ol.order_id
       JOIN parts p ON p.id = ol.part_id
       LEFT JOIN supplier_parts sp
         ON sp.part_id = ol.part_id AND sp.supplier = o.supplier AND sp.sku = ol.supplier_sku
       WHERE o.status IN ('placed', 'shipped') AND ${outstanding} > 0
         AND p.tracking_mode = 'pieces'
         AND ol.part_id IN (SELECT value FROM json_each(?))
       ORDER BY p.name COLLATE NOCASE, o.expected_on IS NULL, o.expected_on, ol.id`
    )
    .all(JSON.stringify(partIds));
}
