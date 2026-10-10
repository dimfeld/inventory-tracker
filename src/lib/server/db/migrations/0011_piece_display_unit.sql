-- The unit that piece sizes of a part are shown and entered in. Values are always stored in mm.
ALTER TABLE parts ADD COLUMN piece_display_unit TEXT NOT NULL DEFAULT 'mm'
  CHECK (piece_display_unit IN ('mm', 'in'));
