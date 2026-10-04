-- Incoming supply explicitly assigned to project requirements.

-- `quantity` of an order line's outstanding supply, in the line part's base unit, committed to
-- one BOM line. The commitments of an order line never exceed its outstanding usable supply.
-- `sequence` orders the commitments of one order line: a partial receipt fills lower sequences
-- first unless the owner changes the assignment, and lost supply removes the highest first.
-- A row is removed when its quantity reaches zero.
CREATE TABLE incoming_commitments (
  id INTEGER PRIMARY KEY,
  bom_line_id INTEGER NOT NULL REFERENCES bom_lines (id) ON DELETE RESTRICT,
  order_line_id INTEGER NOT NULL REFERENCES order_lines (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  sequence INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (bom_line_id, order_line_id),
  UNIQUE (order_line_id, sequence)
);

CREATE INDEX incoming_commitments_bom_line ON incoming_commitments (bom_line_id);
