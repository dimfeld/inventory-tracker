import { parseCsv, type CsvRow } from "#lib/csv.ts";
import type { CsvSettings, SourceType } from "#lib/imports.ts";

/**
 * The rows of a source with their line numbers, which are the row numbers used as evidence.
 * A text row is one non-blank line; a CSV row is one record.
 */
export function sourceRows(sourceType: SourceType, text: string): CsvRow[] {
  if (sourceType === "csv") return parseCsv(text);
  return text
    .split("\n")
    .map((line, index) => ({ row: index + 1, cells: [line.trim()] }))
    .filter((row) => row.cells[0] !== "");
}

/** CSV column names (from the header row, or `Column n`) and the data rows. */
export function csvTable(rows: CsvRow[], settings: CsvSettings) {
  const width = Math.max(0, ...rows.map((r) => r.cells.length));
  const header = settings.hasHeader ? (rows[0]?.cells ?? []) : [];
  const columns = Array.from({ length: width }, (_, i) => header[i] || `Column ${i + 1}`);
  return { columns, dataRows: settings.hasHeader ? rows.slice(1) : rows };
}

/** Default CSV settings: a header row and no column roles. */
export function defaultCsvSettings(rows: CsvRow[]): CsvSettings {
  const width = Math.max(0, ...rows.map((r) => r.cells.length));
  return { hasHeader: true, roles: Array.from({ length: width }, () => "ignore") };
}
