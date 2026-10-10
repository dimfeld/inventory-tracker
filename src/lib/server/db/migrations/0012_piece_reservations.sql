-- Cut-size BOM requirements and reservations of stock pieces.

-- The size of each cut piece a requirement needs, in mm, such as 2 × 415 mm. With a cut size,
-- the line quantity is the number of cut pieces. A line of a pieces part without a cut size
-- needs whole pieces. The width is only for 2D pieces such as sheet stock.
ALTER TABLE bom_lines ADD COLUMN cut_length_mm REAL CHECK (cut_length_mm > 0);
ALTER TABLE bom_lines
  ADD COLUMN cut_width_mm REAL
  CHECK (cut_width_mm IS NULL OR (cut_width_mm > 0 AND cut_length_mm IS NOT NULL));

-- One cut piece of a stock piece in storage, reserved for a BOM line. Several lines, and
-- several cut pieces of one line, can reserve the same 1D piece while the reserved lengths and
-- a kerf for each cut fit in it. A 2D piece has one reservation at most.
--
-- A reservation is not a physical movement. A pick cuts the piece and removes the
-- reservation; the picked piece is then tracked by its movements for the line, like picked
-- bulk stock.
CREATE TABLE piece_reservations (
  id INTEGER PRIMARY KEY,
  bom_line_id INTEGER NOT NULL REFERENCES bom_lines (id) ON DELETE RESTRICT,
  piece_id INTEGER NOT NULL REFERENCES stock_pieces (id) ON DELETE RESTRICT,
  length_mm REAL NOT NULL CHECK (length_mm > 0),
  -- Null for 1D pieces.
  width_mm REAL CHECK (width_mm > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX piece_reservations_piece ON piece_reservations (piece_id);
CREATE INDEX piece_reservations_line ON piece_reservations (bom_line_id);
