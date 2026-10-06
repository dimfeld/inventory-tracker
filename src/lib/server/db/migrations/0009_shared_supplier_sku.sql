-- One supplier SKU can belong to several parts. For example, all the variants on one AliExpress
-- product page have the same SKU. A SKU is unique only on each part. SQLite cannot change a
-- table constraint in place, so the table is rebuilt. No table has a foreign key to it.
CREATE TABLE supplier_parts_new (
  id INTEGER PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES parts (id) ON DELETE RESTRICT,
  supplier TEXT NOT NULL CHECK (trim(supplier) <> ''),
  sku TEXT NOT NULL CHECK (trim(sku) <> ''),
  url TEXT,
  -- How the supplier sells it, such as 'each', 'pack', or 'reel'.
  purchase_unit TEXT,
  -- Base units of the part in one purchase unit. NULL when the pack size is not known.
  pack_quantity INTEGER CHECK (pack_quantity > 0),
  UNIQUE (part_id, supplier, sku)
);

INSERT INTO supplier_parts_new (id, part_id, supplier, sku, url, purchase_unit, pack_quantity)
SELECT id, part_id, supplier, sku, url, purchase_unit, pack_quantity FROM supplier_parts;

DROP TABLE supplier_parts;
ALTER TABLE supplier_parts_new RENAME TO supplier_parts;

CREATE INDEX supplier_parts_part ON supplier_parts (part_id);
CREATE INDEX supplier_parts_sku ON supplier_parts (supplier, sku);
