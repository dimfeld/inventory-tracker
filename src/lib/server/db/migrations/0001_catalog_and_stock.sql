-- Catalog, storage locations, and stock movements.

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (trim(name) <> ''),
  parent_id INTEGER REFERENCES categories (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Sibling names are unique, including at the top level where parent_id is NULL.
CREATE UNIQUE INDEX categories_parent_name ON categories (coalesce(parent_id, 0), name);

CREATE TABLE attribute_definitions (
  id INTEGER PRIMARY KEY,
  key TEXT NOT NULL UNIQUE CHECK (trim(key) <> ''),
  label TEXT NOT NULL,
  value_type TEXT NOT NULL CHECK (value_type IN ('text', 'number', 'boolean')),
  -- Unit of value_number for numeric attributes, such as 'mm' or 'ohm'.
  canonical_unit TEXT,
  -- Name of the normalization rule that converts raw text into the typed value.
  normalization TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Categories an attribute applies to. Descendant categories inherit applicability.
CREATE TABLE attribute_applicability (
  attribute_id INTEGER NOT NULL REFERENCES attribute_definitions (id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES categories (id) ON DELETE CASCADE,
  PRIMARY KEY (attribute_id, category_id)
);

CREATE TABLE parts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (trim(name) <> ''),
  category_id INTEGER REFERENCES categories (id) ON DELETE RESTRICT,
  -- Unit code from src/lib/units.ts. Quantities for this part are integer amounts of this unit.
  base_unit TEXT NOT NULL,
  manufacturer TEXT,
  part_number TEXT,
  notes TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX parts_category ON parts (category_id);

CREATE TABLE part_attributes (
  id INTEGER PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES parts (id) ON DELETE CASCADE,
  attribute_id INTEGER NOT NULL REFERENCES attribute_definitions (id) ON DELETE RESTRICT,
  -- Original text as entered or imported.
  raw_value TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  value_boolean INTEGER CHECK (value_boolean IN (0, 1)),
  UNIQUE (part_id, attribute_id)
);

CREATE TABLE part_aliases (
  id INTEGER PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES parts (id) ON DELETE CASCADE,
  alias TEXT NOT NULL CHECK (trim(alias) <> ''),
  UNIQUE (part_id, alias)
);

CREATE INDEX part_aliases_alias ON part_aliases (alias);

CREATE TABLE supplier_parts (
  id INTEGER PRIMARY KEY,
  part_id INTEGER NOT NULL REFERENCES parts (id) ON DELETE RESTRICT,
  supplier TEXT NOT NULL CHECK (trim(supplier) <> ''),
  sku TEXT NOT NULL CHECK (trim(sku) <> ''),
  url TEXT,
  -- How the supplier sells it, such as 'each', 'pack', or 'reel'.
  purchase_unit TEXT,
  -- Base units of the part in one purchase unit. NULL when the pack size is not known.
  pack_quantity INTEGER CHECK (pack_quantity > 0),
  UNIQUE (supplier, sku)
);

CREATE INDEX supplier_parts_part ON supplier_parts (part_id);

CREATE TABLE locations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE CHECK (trim(name) <> ''),
  kind TEXT NOT NULL DEFAULT 'storage' CHECK (kind IN ('storage', 'project')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Stock history. Balances are derived from these rows and rows are never updated or deleted.
-- A NULL from_location_id is an external source (opening stock, receipt, count gain).
-- A NULL to_location_id is an external destination (loss, supplier return, use, count loss).
-- Later plans add receipt and BOM line links with ALTER TABLE ... ADD COLUMN ... REFERENCES.
CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE,
  part_id INTEGER NOT NULL REFERENCES parts (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  from_location_id INTEGER REFERENCES locations (id) ON DELETE RESTRICT,
  to_location_id INTEGER REFERENCES locations (id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL,
  occurred_on TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (from_location_id IS NOT NULL OR to_location_id IS NOT NULL),
  CHECK (from_location_id IS NULL OR to_location_id IS NULL OR from_location_id <> to_location_id)
);

CREATE INDEX stock_movements_part ON stock_movements (part_id);
CREATE INDEX stock_movements_from ON stock_movements (from_location_id, part_id);
CREATE INDEX stock_movements_to ON stock_movements (to_location_id, part_id);
