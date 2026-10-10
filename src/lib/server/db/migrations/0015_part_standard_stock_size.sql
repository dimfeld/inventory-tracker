-- The size that a pieces part usually comes in, such as a 4 × 8 ft plywood sheet, in mm. Used
-- when an order line and its supplier SKU give no size, and as a stock size for shopping.
-- Width is null for 1D pieces.
ALTER TABLE parts ADD COLUMN standard_length_mm REAL CHECK (standard_length_mm > 0);
ALTER TABLE parts ADD COLUMN standard_width_mm REAL
  CHECK (standard_width_mm IS NULL OR (standard_width_mm > 0 AND standard_length_mm IS NOT NULL));
