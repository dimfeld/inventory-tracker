-- The size of each stock piece that an order line of a pieces part brings, in mm. One supplier
-- SKU can sell several sizes, so the line's size comes first and the SKU's stock size is the
-- default when it is null. Width is null for 1D pieces.
ALTER TABLE order_lines ADD COLUMN piece_length_mm REAL CHECK (piece_length_mm > 0);
ALTER TABLE order_lines ADD COLUMN piece_width_mm REAL
  CHECK (piece_width_mm IS NULL OR (piece_width_mm > 0 AND piece_length_mm IS NOT NULL));
