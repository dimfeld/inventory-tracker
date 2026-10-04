-- Category tree, typed attribute definitions, and optional part tags.
-- Normalization names refer to the rules in src/lib/attributes.ts.

-- Existing categories with the same name and parent are kept.
INSERT OR IGNORE INTO categories (name, parent_id) VALUES ('Hardware', NULL), ('Electronics', NULL);

INSERT OR IGNORE INTO categories (name, parent_id)
SELECT child.name, parent.id
FROM (
  SELECT 'Fasteners' AS name, 'Hardware' AS parent
  UNION ALL SELECT 'Inserts', 'Hardware'
  UNION ALL SELECT 'Passives', 'Electronics'
  UNION ALL SELECT 'Connectors', 'Electronics'
) AS child
JOIN categories parent ON parent.name = child.parent AND parent.parent_id IS NULL;

INSERT OR IGNORE INTO categories (name, parent_id)
SELECT child.name, parent.id
FROM (
  SELECT 'Screws' AS name, 'Fasteners' AS parent, 'Hardware' AS grandparent
  UNION ALL SELECT 'Heat-set inserts', 'Inserts', 'Hardware'
  UNION ALL SELECT 'Resistors', 'Passives', 'Electronics'
  UNION ALL SELECT 'Capacitors', 'Passives', 'Electronics'
) AS child
JOIN categories grandparent ON grandparent.name = child.grandparent AND grandparent.parent_id IS NULL
JOIN categories parent ON parent.name = child.parent AND parent.parent_id = grandparent.id;

-- Definitions with these keys may already exist as plain text attributes; they become typed.
INSERT INTO attribute_definitions (key, label, value_type, canonical_unit, normalization) VALUES
  ('thread', 'Thread', 'text', NULL, 'thread'),
  ('length', 'Length', 'number', 'mm', 'length'),
  ('material', 'Material', 'text', NULL, 'keyword'),
  ('head', 'Head', 'text', NULL, 'keyword'),
  ('drive', 'Drive', 'text', NULL, 'keyword'),
  ('outer_diameter', 'Outer diameter', 'number', 'mm', 'length'),
  ('resistance', 'Resistance', 'number', 'ohm', 'resistance'),
  ('tolerance', 'Tolerance', 'number', '%', 'percent'),
  ('power', 'Power', 'number', 'W', 'power'),
  ('package', 'Package', 'text', NULL, 'code'),
  ('capacitance', 'Capacitance', 'number', 'pF', 'capacitance'),
  ('voltage', 'Voltage', 'number', 'V', 'voltage'),
  ('pitch', 'Pitch', 'number', 'mm', 'length'),
  ('pin_count', 'Pin count', 'number', NULL, 'count'),
  ('gender', 'Gender', 'text', NULL, 'keyword'),
  ('mounting', 'Mounting', 'text', NULL, 'keyword')
ON CONFLICT (key) DO UPDATE SET
  label = excluded.label,
  value_type = excluded.value_type,
  canonical_unit = excluded.canonical_unit,
  normalization = excluded.normalization;

-- Descendant categories inherit these.
INSERT OR IGNORE INTO attribute_applicability (attribute_id, category_id)
SELECT d.id, c.id
FROM (
  SELECT 'thread' AS key, 'Screws' AS category
  UNION ALL SELECT 'length', 'Screws'
  UNION ALL SELECT 'material', 'Screws'
  UNION ALL SELECT 'head', 'Screws'
  UNION ALL SELECT 'drive', 'Screws'
  UNION ALL SELECT 'thread', 'Inserts'
  UNION ALL SELECT 'outer_diameter', 'Inserts'
  UNION ALL SELECT 'length', 'Inserts'
  UNION ALL SELECT 'resistance', 'Resistors'
  UNION ALL SELECT 'tolerance', 'Resistors'
  UNION ALL SELECT 'power', 'Resistors'
  UNION ALL SELECT 'package', 'Resistors'
  UNION ALL SELECT 'capacitance', 'Capacitors'
  UNION ALL SELECT 'voltage', 'Capacitors'
  UNION ALL SELECT 'package', 'Capacitors'
  UNION ALL SELECT 'pitch', 'Connectors'
  UNION ALL SELECT 'pin_count', 'Connectors'
  UNION ALL SELECT 'gender', 'Connectors'
  UNION ALL SELECT 'mounting', 'Connectors'
) AS a
JOIN attribute_definitions d ON d.key = a.key
JOIN categories c ON c.name = a.category
  AND c.parent_id IN (
    SELECT id FROM categories
    WHERE name IN ('Fasteners', 'Hardware', 'Passives', 'Electronics')
  );

CREATE INDEX part_attributes_text ON part_attributes (attribute_id, value_text);
CREATE INDEX part_attributes_number ON part_attributes (attribute_id, value_number);

-- Optional labels for organization. Technical comparisons use typed attributes, not tags.
CREATE TABLE part_tags (
  part_id INTEGER NOT NULL REFERENCES parts (id) ON DELETE CASCADE,
  tag TEXT NOT NULL CHECK (trim(tag) <> ''),
  PRIMARY KEY (part_id, tag)
);

CREATE INDEX part_tags_tag ON part_tags (tag);
