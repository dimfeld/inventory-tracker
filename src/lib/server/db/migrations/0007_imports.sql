-- Reviewed imports of order lists and project BOMs. An import is a draft until it is committed.
-- Parsing only writes these tables; only the commit creates parts, orders, or BOM rows, and no
-- import step changes stock.

CREATE TABLE imports (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('order', 'project')),
  source_type TEXT NOT NULL CHECK (source_type IN ('text', 'csv')),
  -- The source as the owner pasted it. It stays editable until the commit.
  source_text TEXT NOT NULL CHECK (trim(source_text) <> ''),
  -- SHA-256 of source_text, for the repeated-source warning.
  source_hash TEXT NOT NULL,
  -- CSV only: JSON { hasHeader, roles } where roles[i] is the owner's role for column i.
  csv_settings TEXT,
  parse_state TEXT NOT NULL DEFAULT 'draft'
    CHECK (parse_state IN ('draft', 'parsing', 'parsed', 'failed')),
  parse_error TEXT,
  -- The model that answered, as reported by the SDK, and the versions used to ask it.
  model_id TEXT,
  prompt_version TEXT,
  schema_version TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  parsed_at TEXT,
  -- JSON of the owner-edited order or project details (supplier, reference, project, notes).
  header TEXT NOT NULL DEFAULT '{}',
  -- JSON of the extracted details with provenance, or NULL before a successful parse.
  header_proposal TEXT,
  commit_state TEXT NOT NULL DEFAULT 'open' CHECK (commit_state IN ('open', 'committed')),
  -- The unique ID of the commit operation. A repeated commit returns the recorded result.
  commit_operation_id TEXT UNIQUE,
  committed_at TEXT,
  order_id INTEGER REFERENCES orders (id) ON DELETE RESTRICT,
  project_id INTEGER REFERENCES projects (id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK ((commit_state = 'committed') = (commit_operation_id IS NOT NULL))
);

CREATE INDEX imports_source_hash ON imports (source_hash);

-- Proposed component groups of a project BOM import. The commit turns the groups that have
-- lines into project_components.
CREATE TABLE import_groups (
  id INTEGER PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES imports (id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (trim(name) <> ''),
  -- Source row and text of the explicit heading or group column. NULL for an owner's group.
  source_row INTEGER,
  source_excerpt TEXT,
  display_order INTEGER NOT NULL,
  -- Target of the composite key in import_lines that keeps a line in its own import's groups.
  UNIQUE (id, import_id)
);

CREATE TABLE import_lines (
  id INTEGER PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES imports (id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  -- NULL means ungrouped.
  group_id INTEGER,
  source_row INTEGER,
  source_excerpt TEXT,
  -- JSON of the extracted line: fields, provenance marks, and unresolved fields. NULL for a line
  -- the owner added.
  proposal TEXT,
  -- JSON of the current line fields with the owner's corrections.
  fields TEXT NOT NULL,
  -- How the line is committed: an existing part, a new part, or (BOMs only) a requirement
  -- described by category and constraints. NULL until chosen.
  resolution TEXT CHECK (resolution IN ('existing', 'new', 'requirement')),
  part_id INTEGER REFERENCES parts (id) ON DELETE RESTRICT,
  -- Records the commit created for this line.
  created_part_id INTEGER REFERENCES parts (id) ON DELETE RESTRICT,
  order_line_id INTEGER REFERENCES order_lines (id) ON DELETE SET NULL,
  bom_line_id INTEGER REFERENCES bom_lines (id) ON DELETE SET NULL,
  FOREIGN KEY (group_id, import_id) REFERENCES import_groups (id, import_id),
  CHECK ((resolution = 'existing') = (part_id IS NOT NULL))
);

CREATE INDEX import_lines_import ON import_lines (import_id, position);
CREATE INDEX import_lines_group ON import_lines (group_id);
