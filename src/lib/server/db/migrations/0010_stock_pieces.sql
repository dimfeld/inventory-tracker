-- Piece-tracked parts: stock of cut materials (extrusion, sheet, rod) as individual physical
-- pieces with their own dimensions.

-- A 'bulk' part has one fungible quantity per location. A 'pieces' part counts physical pieces;
-- each piece has its own length (and width for sheet stock). The dimension definitions are
-- attribute definitions, so their labels come from there. A pieces part always has a length
-- dimension; the width dimension is only for 2D pieces.
ALTER TABLE parts ADD COLUMN tracking_mode TEXT NOT NULL DEFAULT 'bulk'
  CHECK (tracking_mode IN ('bulk', 'pieces'));
ALTER TABLE parts
  ADD COLUMN piece_length_attribute_id INTEGER
  REFERENCES attribute_definitions (id) ON DELETE RESTRICT
  CHECK ((tracking_mode = 'pieces') = (piece_length_attribute_id IS NOT NULL));
ALTER TABLE parts
  ADD COLUMN piece_width_attribute_id INTEGER
  REFERENCES attribute_definitions (id) ON DELETE RESTRICT
  CHECK (piece_width_attribute_id IS NULL OR piece_length_attribute_id IS NOT NULL);
-- Material lost to each cut, and the shortest offcut worth keeping, in mm.
ALTER TABLE parts ADD COLUMN kerf_mm REAL NOT NULL DEFAULT 0 CHECK (kerf_mm >= 0);
ALTER TABLE parts ADD COLUMN min_offcut_mm REAL NOT NULL DEFAULT 0 CHECK (min_offcut_mm >= 0);

-- The usual width dimension of sheet stock. An existing definition with this key is kept.
INSERT INTO attribute_definitions (key, label, value_type, canonical_unit, normalization)
VALUES ('width', 'Width', 'number', 'mm', 'length')
ON CONFLICT (key) DO NOTHING;

-- One physical piece of a pieces part. Dimensions are in mm; width is NULL for 1D pieces. A
-- cut retires the parent piece and makes new child pieces, so rows never change after insert.
-- A piece is where its movement balance is 1; with no positive balance it is retired.
CREATE TABLE stock_pieces (
  id INTEGER PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES parts (id) ON DELETE RESTRICT,
  length_mm REAL NOT NULL CHECK (length_mm > 0),
  width_mm REAL CHECK (width_mm > 0),
  parent_piece_id INTEGER REFERENCES stock_pieces (id) ON DELETE RESTRICT,
  label TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX stock_pieces_part ON stock_pieces (part_id);
CREATE INDEX stock_pieces_parent ON stock_pieces (parent_piece_id);

CREATE TRIGGER stock_pieces_immutable BEFORE UPDATE ON stock_pieces
BEGIN
  SELECT RAISE(ABORT, 'Stock pieces cannot change after they are made');
END;

-- The piece a movement moves. A movement of a piece moves exactly that one piece.
ALTER TABLE stock_movements
  ADD COLUMN piece_id INTEGER REFERENCES stock_pieces (id) ON DELETE RESTRICT
  CHECK (piece_id IS NULL OR quantity = 1);

CREATE INDEX stock_movements_piece ON stock_movements (piece_id);

-- Every movement of a pieces part moves one of its pieces; a bulk part has no pieces.
CREATE TRIGGER stock_movements_piece_mode BEFORE INSERT ON stock_movements
WHEN (NEW.piece_id IS NOT NULL)
    <> ((SELECT tracking_mode FROM parts WHERE id = NEW.part_id) = 'pieces')
  OR (SELECT part_id FROM stock_pieces WHERE id = NEW.piece_id) <> NEW.part_id
BEGIN
  SELECT RAISE(ABORT, 'A movement of a piece-tracked part must move one piece of that part');
END;

-- Stock size of one supplier SKU of a pieces part, such as a 1220 mm or a 700 mm stick, in mm.
-- A receipt of the SKU makes one piece of this size per received unit.
ALTER TABLE supplier_parts ADD COLUMN stock_length_mm REAL CHECK (stock_length_mm > 0);
ALTER TABLE supplier_parts
  ADD COLUMN stock_width_mm REAL
  CHECK (stock_width_mm IS NULL OR (stock_width_mm > 0 AND stock_length_mm IS NOT NULL));
