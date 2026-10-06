import type { Database } from "bun:sqlite";
import type {
  CommitState,
  CsvSettings,
  ImportHeader,
  ImportKind,
  ImportLineFields,
  LineProposal,
  ParseState,
  ProvenanceMarks,
  Resolution,
  SourceType,
} from "#lib/imports.ts";

export interface ImportRecord {
  id: number;
  kind: ImportKind;
  sourceType: SourceType;
  sourceText: string;
  sourceHash: string;
  csvSettings: CsvSettings | null;
  parseState: ParseState;
  parseError: string | null;
  modelId: string | null;
  promptVersion: string | null;
  schemaVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  parsedAt: string | null;
  header: ImportHeader;
  /** Provenance of the extracted header values, or null before a successful parse. */
  headerProvenance: ProvenanceMarks | null;
  commitState: CommitState;
  commitOperationId: string | null;
  committedAt: string | null;
  orderId: number | null;
  projectId: number | null;
  createdAt: string;
}

export interface ImportSummary {
  id: number;
  kind: ImportKind;
  sourceType: SourceType;
  parseState: ParseState;
  commitState: CommitState;
  orderId: number | null;
  projectId: number | null;
  lineCount: number;
  /** The first source line, as a title. */
  title: string;
  createdAt: string;
}

export interface ImportGroup {
  id: number;
  importId: number;
  name: string;
  sourceRow: number | null;
  sourceExcerpt: string | null;
  displayOrder: number;
}

export interface ImportLine {
  id: number;
  importId: number;
  position: number;
  groupId: number | null;
  sourceRow: number | null;
  sourceExcerpt: string | null;
  proposal: LineProposal | null;
  fields: ImportLineFields;
  resolution: Resolution | null;
  partId: number | null;
  createdPartId: number | null;
  orderLineId: number | null;
  bomLineId: number | null;
}

type RawImport = Omit<ImportRecord, "csvSettings" | "header" | "headerProvenance"> & {
  csvSettings: string | null;
  header: string;
  headerProvenance: string | null;
};

type RawLine = Omit<ImportLine, "proposal" | "fields"> & {
  proposal: string | null;
  fields: string;
};

const IMPORT_COLUMNS = `id, kind, source_type AS sourceType, source_text AS sourceText,
  source_hash AS sourceHash, csv_settings AS csvSettings, parse_state AS parseState,
  parse_error AS parseError, model_id AS modelId, prompt_version AS promptVersion,
  schema_version AS schemaVersion, input_tokens AS inputTokens, output_tokens AS outputTokens,
  total_tokens AS totalTokens, parsed_at AS parsedAt, header,
  header_proposal AS headerProvenance, commit_state AS commitState,
  commit_operation_id AS commitOperationId, committed_at AS committedAt, order_id AS orderId,
  project_id AS projectId, created_at AS createdAt`;

const LINE_COLUMNS = `id, import_id AS importId, position, group_id AS groupId,
  source_row AS sourceRow, source_excerpt AS sourceExcerpt, proposal, fields, resolution,
  part_id AS partId, created_part_id AS createdPartId, order_line_id AS orderLineId,
  bom_line_id AS bomLineId`;

const GROUP_COLUMNS = `id, import_id AS importId, name, source_row AS sourceRow,
  source_excerpt AS sourceExcerpt, display_order AS displayOrder`;

const NOW = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

function toImport(row: RawImport): ImportRecord {
  return {
    ...row,
    csvSettings: row.csvSettings === null ? null : JSON.parse(row.csvSettings),
    header: JSON.parse(row.header),
    headerProvenance: row.headerProvenance === null ? null : JSON.parse(row.headerProvenance),
  };
}

function toLine(row: RawLine): ImportLine {
  return {
    ...row,
    proposal: row.proposal === null ? null : JSON.parse(row.proposal),
    fields: JSON.parse(row.fields),
  };
}

export function insertImport(
  db: Database,
  fields: {
    kind: ImportKind;
    sourceType: SourceType;
    sourceText: string;
    sourceHash: string;
    csvSettings: CsvSettings | null;
    header: ImportHeader;
  }
): number {
  return db
    .query<{ id: number }, [string, string, string, string, string | null, string]>(
      `INSERT INTO imports (kind, source_type, source_text, source_hash, csv_settings, header)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
    )
    .get(
      fields.kind,
      fields.sourceType,
      fields.sourceText,
      fields.sourceHash,
      fields.csvSettings === null ? null : JSON.stringify(fields.csvSettings),
      JSON.stringify(fields.header)
    )!.id;
}

export function getImport(db: Database, id: number): ImportRecord | null {
  const row = db
    .query<RawImport, [number]>(`SELECT ${IMPORT_COLUMNS} FROM imports WHERE id = ?`)
    .get(id);
  return row ? toImport(row) : null;
}

/**
 * Imports that need action come first: parsed imports to review and commit, then failed parses,
 * parses in progress, and drafts. Committed imports come last. Newest first within each state.
 */
export function listImports(db: Database): ImportSummary[] {
  return db
    .query<ImportSummary, []>(
      `SELECT i.id, i.kind, i.source_type AS sourceType, i.parse_state AS parseState,
         i.commit_state AS commitState, i.order_id AS orderId, i.project_id AS projectId,
         (SELECT count(*) FROM import_lines l WHERE l.import_id = i.id) AS lineCount,
         coalesce(
           nullif(trim(json_extract(i.header, '$.supplier') || ' ' ||
             coalesce(json_extract(i.header, '$.reference'), '')), ''),
           substr(ltrim(i.source_text), 1,
             instr(ltrim(i.source_text) || char(10), char(10)) - 1)
         ) AS title,
         i.created_at AS createdAt
       FROM imports i
       ORDER BY
         CASE
           WHEN i.commit_state = 'committed' THEN 4
           WHEN i.parse_state = 'parsed' THEN 0
           WHEN i.parse_state = 'failed' THEN 1
           WHEN i.parse_state = 'parsing' THEN 2
           ELSE 3
         END,
         i.id DESC`
    )
    .all();
}

/** Other imports of the same kind with the same source text. */
export function listImportsWithSource(
  db: Database,
  kind: ImportKind,
  sourceHash: string,
  excludeId: number
): { id: number; commitState: CommitState }[] {
  return db
    .query<{ id: number; commitState: CommitState }, [string, string, number]>(
      `SELECT id, commit_state AS commitState FROM imports
       WHERE kind = ? AND source_hash = ? AND id <> ? ORDER BY id`
    )
    .all(kind, sourceHash, excludeId);
}

export function updateSource(
  db: Database,
  id: number,
  fields: { sourceText: string; sourceHash: string; csvSettings: CsvSettings | null }
): void {
  db.run(
    `UPDATE imports SET source_text = ?, source_hash = ?, csv_settings = ?, updated_at = ${NOW}
     WHERE id = ?`,
    [
      fields.sourceText,
      fields.sourceHash,
      fields.csvSettings === null ? null : JSON.stringify(fields.csvSettings),
      id,
    ]
  );
}

export function updateHeader(db: Database, id: number, header: ImportHeader): void {
  db.run(`UPDATE imports SET header = ?, updated_at = ${NOW} WHERE id = ?`, [
    JSON.stringify(header),
    id,
  ]);
}

export function setParseState(
  db: Database,
  id: number,
  state: ParseState,
  error: string | null
): void {
  db.run(`UPDATE imports SET parse_state = ?, parse_error = ?, updated_at = ${NOW} WHERE id = ?`, [
    state,
    error,
    id,
  ]);
}

/** Record a successful parse with the model, versions, and usage. */
export function recordParse(
  db: Database,
  id: number,
  fields: {
    modelId: string | null;
    promptVersion: string | null;
    schemaVersion: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    header: ImportHeader;
    headerProvenance: ProvenanceMarks;
  }
): void {
  db.run(
    `UPDATE imports SET parse_state = 'parsed', parse_error = NULL, model_id = ?,
       prompt_version = ?, schema_version = ?, input_tokens = ?, output_tokens = ?,
       total_tokens = ?, parsed_at = ${NOW}, header = ?, header_proposal = ?, updated_at = ${NOW}
     WHERE id = ?`,
    [
      fields.modelId,
      fields.promptVersion,
      fields.schemaVersion,
      fields.inputTokens,
      fields.outputTokens,
      fields.totalTokens,
      JSON.stringify(fields.header),
      JSON.stringify(fields.headerProvenance),
      id,
    ]
  );
}

export function recordCommit(
  db: Database,
  id: number,
  fields: { operationId: string; orderId: number | null; projectId: number | null }
): void {
  db.run(
    `UPDATE imports SET commit_state = 'committed', commit_operation_id = ?, committed_at = ${NOW},
       order_id = ?, project_id = ?, updated_at = ${NOW}
     WHERE id = ?`,
    [fields.operationId, fields.orderId, fields.projectId, id]
  );
}

export function deleteImport(db: Database, id: number): void {
  db.run("DELETE FROM imports WHERE id = ?", [id]);
}

export function listGroups(db: Database, importId: number): ImportGroup[] {
  return db
    .query<ImportGroup, [number]>(
      `SELECT ${GROUP_COLUMNS} FROM import_groups WHERE import_id = ? ORDER BY display_order, id`
    )
    .all(importId);
}

export function insertGroup(
  db: Database,
  importId: number,
  fields: { name: string; sourceRow: number | null; sourceExcerpt: string | null }
): number {
  return db
    .query<{ id: number }, [number, string, number | null, string | null]>(
      `INSERT INTO import_groups (import_id, name, source_row, source_excerpt, display_order)
       VALUES (?1, ?2, ?3, ?4, (SELECT coalesce(max(display_order), 0) + 1
                                FROM import_groups WHERE import_id = ?1))
       RETURNING id`
    )
    .get(importId, fields.name, fields.sourceRow, fields.sourceExcerpt)!.id;
}

export function renameGroup(db: Database, id: number, name: string): void {
  db.run("UPDATE import_groups SET name = ? WHERE id = ?", [name, id]);
}

/** Delete a group after moving its lines to the ungrouped section. */
export function deleteGroup(db: Database, id: number): void {
  db.run("UPDATE import_lines SET group_id = NULL WHERE group_id = ?", [id]);
  db.run("DELETE FROM import_groups WHERE id = ?", [id]);
}

export function listLines(db: Database, importId: number): ImportLine[] {
  return db
    .query<RawLine, [number]>(
      `SELECT ${LINE_COLUMNS} FROM import_lines WHERE import_id = ? ORDER BY position, id`
    )
    .all(importId)
    .map(toLine);
}

export function getLine(db: Database, id: number): ImportLine | null {
  const row = db
    .query<RawLine, [number]>(`SELECT ${LINE_COLUMNS} FROM import_lines WHERE id = ?`)
    .get(id);
  return row ? toLine(row) : null;
}

export function insertLine(
  db: Database,
  importId: number,
  line: {
    groupId: number | null;
    sourceRow: number | null;
    sourceExcerpt: string | null;
    proposal: LineProposal | null;
    fields: ImportLineFields;
    resolution: Resolution | null;
    partId: number | null;
  }
): number {
  return db
    .query<
      { id: number },
      [
        number,
        number | null,
        number | null,
        string | null,
        string | null,
        string,
        string | null,
        number | null,
      ]
    >(
      `INSERT INTO import_lines (import_id, position, group_id, source_row, source_excerpt,
         proposal, fields, resolution, part_id)
       VALUES (?1, (SELECT coalesce(max(position), 0) + 1 FROM import_lines WHERE import_id = ?1),
         ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       RETURNING id`
    )
    .get(
      importId,
      line.groupId,
      line.sourceRow,
      line.sourceExcerpt,
      line.proposal === null ? null : JSON.stringify(line.proposal),
      JSON.stringify(line.fields),
      line.resolution,
      line.partId
    )!.id;
}

export function updateLine(
  db: Database,
  id: number,
  fields: {
    groupId: number | null;
    fields: ImportLineFields;
    resolution: Resolution | null;
    partId: number | null;
  }
): void {
  db.run(
    "UPDATE import_lines SET group_id = ?, fields = ?, resolution = ?, part_id = ? WHERE id = ?",
    [fields.groupId, JSON.stringify(fields.fields), fields.resolution, fields.partId, id]
  );
}

/** Replace the model's proposal of a line, such as after a cleanup. */
export function updateLineProposal(db: Database, id: number, proposal: LineProposal): void {
  db.run("UPDATE import_lines SET proposal = ? WHERE id = ?", [JSON.stringify(proposal), id]);
}

/**
 * Order imports, open or committed, of a supplier order. A skipped order has a committed import
 * and no order, so this finds the orders that were handled without creating an order.
 */
export function listOrderImportsWithReference(
  db: Database,
  supplier: string,
  reference: string
): { id: number; commitState: CommitState }[] {
  return db
    .query<{ id: number; commitState: CommitState }, [string, string]>(
      `SELECT id, commit_state AS commitState FROM imports
       WHERE kind = 'order'
         AND json_extract(header, '$.supplier') = ? COLLATE NOCASE
         AND json_extract(header, '$.reference') = ? COLLATE NOCASE
       ORDER BY id`
    )
    .all(supplier, reference);
}

export function deleteLine(db: Database, id: number): void {
  db.run("DELETE FROM import_lines WHERE id = ?", [id]);
}

/** Remove all lines and groups, before a new parse replaces them. */
export function clearProposals(db: Database, importId: number): void {
  db.run("DELETE FROM import_lines WHERE import_id = ?", [importId]);
  db.run("DELETE FROM import_groups WHERE import_id = ?", [importId]);
}

export function recordLineCommit(
  db: Database,
  id: number,
  records: { createdPartId: number | null; orderLineId: number | null; bomLineId: number | null }
): void {
  db.run(
    "UPDATE import_lines SET created_part_id = ?, order_line_id = ?, bom_line_id = ? WHERE id = ?",
    [records.createdPartId, records.orderLineId, records.bomLineId, id]
  );
}
