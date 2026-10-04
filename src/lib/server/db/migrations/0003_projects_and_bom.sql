-- Projects, BOM requirements with typed constraints, component groups, and approved part choices.

-- Attributes that a generic requirement in the category must specify before any part can match.
-- A requirement without one of them is unresolved, so an M3 screw without a length or head
-- type never matches an arbitrary M3 screw.
ALTER TABLE attribute_applicability
  ADD COLUMN required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1));

UPDATE attribute_applicability SET required = 1
WHERE (attribute_id, category_id) IN (
  SELECT d.id, c.id
  FROM (
    SELECT 'thread' AS key, 'Screws' AS category
    UNION ALL SELECT 'length', 'Screws'
    UNION ALL SELECT 'head', 'Screws'
    UNION ALL SELECT 'thread', 'Inserts'
    UNION ALL SELECT 'outer_diameter', 'Inserts'
    UNION ALL SELECT 'length', 'Inserts'
    UNION ALL SELECT 'resistance', 'Resistors'
    UNION ALL SELECT 'package', 'Resistors'
    UNION ALL SELECT 'capacitance', 'Capacitors'
    UNION ALL SELECT 'voltage', 'Capacitors'
    UNION ALL SELECT 'package', 'Capacitors'
    UNION ALL SELECT 'pitch', 'Connectors'
    UNION ALL SELECT 'pin_count', 'Connectors'
  ) AS r
  JOIN attribute_definitions d ON d.key = r.key
  JOIN categories c ON c.name = r.category
    AND c.parent_id IN (
      SELECT id FROM categories
      WHERE name IN ('Fasteners', 'Hardware', 'Passives', 'Electronics')
    )
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL CHECK (trim(name) <> ''),
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned', 'active', 'paused', 'complete', 'cancelled')),
  notes TEXT,
  -- One URL per line.
  links TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Named presentation groups of BOM lines. Membership never excludes a line from the build.
CREATE TABLE project_components (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (trim(name) <> ''),
  notes TEXT,
  display_order INTEGER NOT NULL,
  -- Target of the composite key in bom_lines that keeps a line in its own project's components.
  UNIQUE (id, project_id)
);

CREATE INDEX project_components_project ON project_components (project_id, display_order);

-- A project requirement. With part_id set it names an exact catalog part; otherwise the
-- category, identifiers, and bom_line_constraints describe what fits.
CREATE TABLE bom_lines (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects (id) ON DELETE RESTRICT,
  -- NULL means ungrouped. Rows are ungrouped before their component is removed.
  component_id INTEGER,
  -- Requirement text as written in the source BOM.
  description TEXT NOT NULL CHECK (trim(description) <> ''),
  -- Integer amount of `unit` (a unit code from src/lib/units.ts). For an exact part this is
  -- the part's base unit.
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit TEXT NOT NULL,
  part_id INTEGER REFERENCES parts (id) ON DELETE RESTRICT,
  category_id INTEGER REFERENCES categories (id) ON DELETE RESTRICT,
  manufacturer TEXT,
  -- Manufacturer part number, alias, or supplier SKU as given by the source.
  part_number TEXT,
  reference_designators TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- Not checked while component_id is NULL.
  FOREIGN KEY (component_id, project_id) REFERENCES project_components (id, project_id)
);

CREATE INDEX bom_lines_project ON bom_lines (project_id);
CREATE INDEX bom_lines_component ON bom_lines (component_id);

-- Typed attribute constraints of a requirement. Values are normalized like part attributes.
-- 'equal' needs the same typed value. 'at_least' and 'range' are numeric comparisons that the
-- requirement explicitly permits, such as a minimum voltage rating.
CREATE TABLE bom_line_constraints (
  id INTEGER PRIMARY KEY,
  bom_line_id INTEGER NOT NULL REFERENCES bom_lines (id) ON DELETE CASCADE,
  attribute_id INTEGER NOT NULL REFERENCES attribute_definitions (id) ON DELETE RESTRICT,
  comparison TEXT NOT NULL DEFAULT 'equal' CHECK (comparison IN ('equal', 'at_least', 'range')),
  raw_value TEXT NOT NULL,
  value_text TEXT,
  value_number REAL,
  value_boolean INTEGER CHECK (value_boolean IN (0, 1)),
  -- Upper bound for 'range'.
  raw_max_value TEXT,
  max_value_number REAL,
  UNIQUE (bom_line_id, attribute_id),
  CHECK (comparison = 'equal' OR value_number IS NOT NULL),
  CHECK ((comparison = 'range') = (max_value_number IS NOT NULL))
);

-- Parts the owner accepted for a requirement. Quantities belong to later allocation records.
CREATE TABLE bom_part_choices (
  id INTEGER PRIMARY KEY,
  bom_line_id INTEGER NOT NULL REFERENCES bom_lines (id) ON DELETE CASCADE,
  part_id INTEGER NOT NULL REFERENCES parts (id) ON DELETE RESTRICT,
  substitute INTEGER NOT NULL DEFAULT 0 CHECK (substitute IN (0, 1)),
  note TEXT,
  approved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (bom_line_id, part_id),
  CHECK (substitute = 0 OR trim(coalesce(note, '')) <> '')
);
