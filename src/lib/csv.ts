/** A CSV record with its 1-based line number in the source, used as source evidence. */
export interface CsvRow {
  row: number;
  cells: string[];
}

/**
 * Parse comma-separated text: quoted fields may contain commas, doubled quotes, and line
 * breaks. Blank lines are skipped. Cells keep their text without surrounding whitespace.
 */
export function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let rowStart = 1;

  const endRow = () => {
    cells.push(cell.trim());
    if (cells.some((c) => c !== "")) rows.push({ row: rowStart, cells });
    cells = [];
    cell = "";
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        if (char === "\n") line++;
        cell += char;
      }
    } else if (char === '"' && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (char === ",") {
      cells.push(cell.trim());
      cell = "";
    } else if (char === "\n") {
      endRow();
      line++;
      rowStart = line;
    } else if (char !== "\r") {
      cell += char;
    }
  }
  endRow();
  return rows;
}
