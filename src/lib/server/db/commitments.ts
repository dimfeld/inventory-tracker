import type { Database } from "bun:sqlite";
import type { OrderStatus } from "#lib/orders.ts";

/**
 * Outstanding order line supply committed to a BOM line, with the names needed to show it.
 * `quantity` is in the order line part's `baseUnit`.
 */
export interface CommitmentDetail {
  id: number;
  bomLineId: number;
  projectId: number;
  projectName: string;
  lineDescription: string;
  componentId: number | null;
  orderLineId: number;
  orderId: number;
  supplier: string;
  reference: string | null;
  orderStatus: OrderStatus;
  expectedOn: string | null;
  partId: number;
  partName: string;
  baseUnit: string;
  quantity: number;
  sequence: number;
}

const DETAIL_SELECT = `SELECT c.id, c.bom_line_id AS bomLineId, l.project_id AS projectId,
    pr.name AS projectName, l.description AS lineDescription, l.component_id AS componentId,
    c.order_line_id AS orderLineId, o.id AS orderId, o.supplier, o.reference,
    o.status AS orderStatus, o.expected_on AS expectedOn, ol.part_id AS partId,
    p.name AS partName, p.base_unit AS baseUnit, c.quantity, c.sequence
  FROM incoming_commitments c
  JOIN bom_lines l ON l.id = c.bom_line_id
  JOIN projects pr ON pr.id = l.project_id
  JOIN order_lines ol ON ol.id = c.order_line_id
  JOIN orders o ON o.id = ol.order_id
  JOIN parts p ON p.id = ol.part_id`;

export function getCommitment(db: Database, id: number): CommitmentDetail | null {
  return db.query<CommitmentDetail, [number]>(`${DETAIL_SELECT} WHERE c.id = ?`).get(id);
}

/** Commitments of the given BOM lines, in order of expected arrival. */
export function listLineCommitments(db: Database, lineIds: number[]): CommitmentDetail[] {
  return db
    .query<CommitmentDetail, [string]>(
      `${DETAIL_SELECT} WHERE c.bom_line_id IN (SELECT value FROM json_each(?))
       ORDER BY o.expected_on IS NULL, o.expected_on, c.order_line_id, c.sequence`
    )
    .all(JSON.stringify(lineIds));
}

/** Commitments of the given order lines, in assignment sequence. */
export function listOrderLineCommitments(db: Database, orderLineIds: number[]): CommitmentDetail[] {
  return db
    .query<CommitmentDetail, [string]>(
      `${DETAIL_SELECT} WHERE c.order_line_id IN (SELECT value FROM json_each(?))
       ORDER BY c.order_line_id, c.sequence`
    )
    .all(JSON.stringify(orderLineIds));
}

/** Total committed quantity of each order line that has commitments. */
export function committedByOrderLine(db: Database): Map<number, number> {
  const rows = db
    .query<{ orderLineId: number; total: number }, []>(
      `SELECT order_line_id AS orderLineId, sum(quantity) AS total
       FROM incoming_commitments GROUP BY order_line_id`
    )
    .all();
  return new Map(rows.map((row) => [row.orderLineId, row.total]));
}

/**
 * Add to the commitment of an order line to a BOM line. A new commitment takes the next
 * sequence of the order line; an existing one keeps its place.
 */
export function addCommitment(
  db: Database,
  fields: { bomLineId: number; orderLineId: number; quantity: number }
): void {
  db.run(
    `INSERT INTO incoming_commitments (bom_line_id, order_line_id, quantity, sequence)
     VALUES (?1, ?2, ?3, (SELECT coalesce(max(sequence), 0) + 1 FROM incoming_commitments
                          WHERE order_line_id = ?2))
     ON CONFLICT (bom_line_id, order_line_id) DO UPDATE SET
       quantity = quantity + excluded.quantity,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    [fields.bomLineId, fields.orderLineId, fields.quantity]
  );
}

/** Set the committed quantity. Zero removes the commitment. */
export function setCommitmentQuantity(db: Database, id: number, quantity: number): void {
  if (quantity === 0) {
    db.run("DELETE FROM incoming_commitments WHERE id = ?", [id]);
  } else {
    db.run(
      `UPDATE incoming_commitments SET quantity = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`,
      [quantity, id]
    );
  }
}

/** Remove every commitment of a BOM line. Returns the number removed. */
export function deleteLineCommitments(db: Database, lineId: number): number {
  return db.run("DELETE FROM incoming_commitments WHERE bom_line_id = ?", [lineId]).changes;
}

/** Remove every commitment of an order line. Returns the number removed. */
export function deleteOrderLineCommitments(db: Database, orderLineId: number): number {
  return db.run("DELETE FROM incoming_commitments WHERE order_line_id = ?", [orderLineId]).changes;
}

/** Remove every commitment of a project. Returns the number removed. */
export function deleteProjectCommitments(db: Database, projectId: number): number {
  return db.run(
    `DELETE FROM incoming_commitments
     WHERE bom_line_id IN (SELECT id FROM bom_lines WHERE project_id = ?)`,
    [projectId]
  ).changes;
}
