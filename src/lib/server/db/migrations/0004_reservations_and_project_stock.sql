-- Storage reservations, project holding locations, and BOM-linked stock movements.

-- A project holding location belongs to exactly one project. Storage locations have no project.
ALTER TABLE locations
  ADD COLUMN project_id INTEGER REFERENCES projects (id) ON DELETE RESTRICT
  CHECK ((kind = 'project') = (project_id IS NOT NULL));

CREATE UNIQUE INDEX locations_project ON locations (project_id) WHERE project_id IS NOT NULL;

-- The requirement a pick ('pick'), use ('project_use'), or return ('project_return') belongs to.
-- Picked quantities are the holding-location balance of these movements per BOM line, so
-- identical parts for different requirements stay separate.
ALTER TABLE stock_movements
  ADD COLUMN bom_line_id INTEGER REFERENCES bom_lines (id) ON DELETE RESTRICT;

CREATE INDEX stock_movements_bom_line ON stock_movements (bom_line_id, part_id);

-- Storage stock committed to a requirement. A reservation is not a physical movement: it
-- reduces available stock at its storage location. `quantity` is the active reserved amount in
-- the part's base unit; a row is removed when it reaches zero.
CREATE TABLE reservations (
  id INTEGER PRIMARY KEY,
  bom_line_id INTEGER NOT NULL REFERENCES bom_lines (id) ON DELETE RESTRICT,
  part_id INTEGER NOT NULL REFERENCES parts (id) ON DELETE RESTRICT,
  location_id INTEGER NOT NULL REFERENCES locations (id) ON DELETE RESTRICT,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (bom_line_id, part_id, location_id)
);

CREATE INDEX reservations_stock ON reservations (part_id, location_id);
