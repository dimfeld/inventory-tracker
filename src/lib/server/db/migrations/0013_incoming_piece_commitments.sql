-- Shopping and incoming orders for piece-tracked parts.

-- How many cut pieces of a 2D cut-size requirement fit on one stock sheet, as the user says.
-- The app does not calculate 2D layouts, so shopping buys one sheet per cut when it is null.
ALTER TABLE bom_lines ADD COLUMN cuts_per_sheet INTEGER CHECK (cuts_per_sheet >= 1);

-- One cut piece of an incoming stock piece, committed to a BOM line. The order line of a pieces
-- part brings one stock piece per outstanding unit, each of its supplier SKU's stock size;
-- `stick_index` (from 0) names one of them. Several lines, and several cut pieces of one line,
-- can share an incoming 1D piece while the cut lengths and a kerf for each cut fit in it, as with
-- piece reservations. A 2D piece has one commitment at most.
--
-- When pieces arrive, the commitments of the lowest stick indexes become piece reservations on
-- the new pieces, in receipt order, and the other sticks move down. Sticks at or above the
-- outstanding count, such as after damage or a cancellation, lose their commitments.
CREATE TABLE incoming_piece_commitments (
  id INTEGER PRIMARY KEY,
  bom_line_id INTEGER NOT NULL REFERENCES bom_lines (id) ON DELETE RESTRICT,
  order_line_id INTEGER NOT NULL REFERENCES order_lines (id) ON DELETE RESTRICT,
  stick_index INTEGER NOT NULL CHECK (stick_index >= 0),
  length_mm REAL NOT NULL CHECK (length_mm > 0),
  -- Null for 1D pieces.
  width_mm REAL CHECK (width_mm > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX incoming_piece_commitments_order_line
  ON incoming_piece_commitments (order_line_id, stick_index);
CREATE INDEX incoming_piece_commitments_line ON incoming_piece_commitments (bom_line_id);
