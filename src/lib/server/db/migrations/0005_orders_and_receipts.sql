-- Purchase orders, order lines, and receipts of usable stock.

-- `status` is the purchase state. Draft orders are not incoming supply. `delivery_state` is
-- the parcel state, kept separate from stock receipt: a delivered parcel can wait for review,
-- and only receipts add stock.
CREATE TABLE orders (
  id INTEGER PRIMARY KEY,
  supplier TEXT NOT NULL CHECK (trim(supplier) <> ''),
  -- The supplier's order number. Repeated references are allowed and only cause a warning.
  reference TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'placed', 'shipped')),
  placed_on TEXT,
  shipped_on TEXT,
  expected_on TEXT,
  delivery_state TEXT NOT NULL DEFAULT 'not_delivered'
    CHECK (delivery_state IN ('not_delivered', 'awaiting_review', 'reviewed')),
  delivered_on TEXT,
  tracking_url TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX orders_reference ON orders (supplier, reference);

-- One purchased item. The supplier sells `purchase_quantity` of `purchase_unit` (such as
-- 2 packs); each purchase unit holds `pack_quantity` of the part's base unit. `quantity` is the
-- ordered amount in the part's base unit. Received, damaged, and cancelled totals are in the
-- base unit too, and the receipt service updates them in the receipt transaction.
-- Outstanding supply is quantity - received - damaged - cancelled.
CREATE TABLE order_lines (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  part_id INTEGER NOT NULL REFERENCES parts (id) ON DELETE RESTRICT,
  supplier_sku TEXT,
  purchase_quantity INTEGER NOT NULL CHECK (purchase_quantity > 0),
  purchase_unit TEXT NOT NULL CHECK (trim(purchase_unit) <> ''),
  pack_quantity INTEGER NOT NULL CHECK (pack_quantity > 0),
  quantity INTEGER GENERATED ALWAYS AS (purchase_quantity * pack_quantity) STORED,
  received_quantity INTEGER NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  damaged_quantity INTEGER NOT NULL DEFAULT 0 CHECK (damaged_quantity >= 0),
  cancelled_quantity INTEGER NOT NULL DEFAULT 0 CHECK (cancelled_quantity >= 0),
  -- Optional price of one purchase unit as an exact decimal string, in `currency`.
  unit_price TEXT,
  currency TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (received_quantity + damaged_quantity + cancelled_quantity <= quantity),
  CHECK (unit_price IS NULL OR currency IS NOT NULL)
);

CREATE INDEX order_lines_order ON order_lines (order_id);
CREATE INDEX order_lines_part ON order_lines (part_id);

-- One reviewed arrival. `operation_id` makes a repeated submission return this receipt.
CREATE TABLE receipts (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  operation_id TEXT NOT NULL UNIQUE,
  received_on TEXT NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX receipts_order ON receipts (order_id);

-- Accepted (usable) and damaged amounts of one order line in a receipt, in the part's base
-- unit. Accepted stock goes to `location_id` through a 'receipt' movement; damaged stock does
-- not enter the inventory.
CREATE TABLE receipt_lines (
  id INTEGER PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES receipts (id) ON DELETE RESTRICT,
  order_line_id INTEGER NOT NULL REFERENCES order_lines (id) ON DELETE RESTRICT,
  accepted_quantity INTEGER NOT NULL CHECK (accepted_quantity >= 0),
  damaged_quantity INTEGER NOT NULL CHECK (damaged_quantity >= 0),
  location_id INTEGER REFERENCES locations (id) ON DELETE RESTRICT,
  notes TEXT,
  CHECK (accepted_quantity + damaged_quantity > 0),
  CHECK (accepted_quantity = 0 OR location_id IS NOT NULL)
);

CREATE INDEX receipt_lines_receipt ON receipt_lines (receipt_id);
CREATE INDEX receipt_lines_order_line ON receipt_lines (order_line_id);

-- The receipt line a 'receipt' movement belongs to.
ALTER TABLE stock_movements
  ADD COLUMN receipt_line_id INTEGER REFERENCES receipt_lines (id) ON DELETE RESTRICT;
