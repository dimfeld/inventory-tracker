import type { Database } from "bun:sqlite";
import type { PieceDisplayUnit, TrackingMode } from "#lib/pieces.ts";

export interface Category {
  id: number;
  name: string;
  parentId: number | null;
}

export interface PartSummary {
  id: number;
  name: string;
  categoryName: string | null;
  baseUnit: string;
  manufacturer: string | null;
  partNumber: string | null;
  archivedAt: string | null;
  /** Total physical stock across all locations, in base units. */
  totalQuantity: number;
}

/** How a part's stock is tracked. Dimension attributes are attribute definition IDs. */
export type PartTracking = {
  trackingMode: TrackingMode;
  /** The per-piece length dimension. Set exactly when the part is tracked as pieces. */
  pieceLengthAttributeId: number | null;
  /** The per-piece width dimension of 2D pieces, or null. */
  pieceWidthAttributeId: number | null;
  /** Material lost to each cut, in mm. */
  kerfMm: number;
  /** The shortest offcut worth keeping, in mm. */
  minOffcutMm: number;
  /** The unit that piece sizes are shown and entered in. */
  pieceDisplayUnit: PieceDisplayUnit;
  /**
   * The size in mm that the part usually comes in, such as a 4 × 8 ft sheet, or null. Width is
   * null for 1D pieces.
   */
  standardLengthMm: number | null;
  standardWidthMm: number | null;
};

export const BULK_TRACKING: PartTracking = {
  trackingMode: "bulk",
  pieceLengthAttributeId: null,
  pieceWidthAttributeId: null,
  kerfMm: 0,
  minOffcutMm: 0,
  pieceDisplayUnit: "mm",
  standardLengthMm: null,
  standardWidthMm: null,
};

export interface Part extends PartTracking {
  id: number;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  baseUnit: string;
  manufacturer: string | null;
  partNumber: string | null;
  notes: string | null;
  archivedAt: string | null;
}

// A type alias (not an interface) so it can be passed as named SQL bindings.
export type PartFields = PartTracking & {
  name: string;
  categoryId: number | null;
  baseUnit: string;
  manufacturer: string | null;
  partNumber: string | null;
  notes: string | null;
};

export type AttributeValueType = "text" | "number" | "boolean";

export interface AttributeDefinition {
  id: number;
  key: string;
  label: string;
  valueType: AttributeValueType;
  canonicalUnit: string | null;
  /** Rule name from src/lib/attributes.ts, or null for plain text. */
  normalization: string | null;
}

export interface PartAttribute {
  key: string;
  label: string;
  valueType: AttributeValueType;
  normalization: string | null;
  rawValue: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
}

export interface PartAttributeValue {
  attributeId: number;
  rawValue: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
}

export interface SupplierPart {
  id: number;
  supplier: string;
  sku: string;
  url: string | null;
  purchaseUnit: string | null;
  packQuantity: number | null;
  /** Size in mm of one stock piece of a pieces part, such as a 1220 mm stick. */
  stockLengthMm: number | null;
  /** Width in mm of one stock piece of a 2D pieces part. */
  stockWidthMm: number | null;
}

export type SupplierPartFields = Omit<SupplierPart, "id">;

const PART_COLUMNS = `p.id, p.name, p.category_id AS categoryId, c.name AS categoryName,
  p.base_unit AS baseUnit, p.manufacturer, p.part_number AS partNumber, p.notes,
  p.archived_at AS archivedAt, p.tracking_mode AS trackingMode,
  p.piece_length_attribute_id AS pieceLengthAttributeId,
  p.piece_width_attribute_id AS pieceWidthAttributeId, p.kerf_mm AS kerfMm,
  p.min_offcut_mm AS minOffcutMm, p.piece_display_unit AS pieceDisplayUnit,
  p.standard_length_mm AS standardLengthMm, p.standard_width_mm AS standardWidthMm`;

export function listCategories(db: Database): Category[] {
  return db
    .query<Category, []>("SELECT id, name, parent_id AS parentId FROM categories ORDER BY name")
    .all();
}

export function getCategory(db: Database, id: number): Category | null {
  return db
    .query<Category, [number]>(
      "SELECT id, name, parent_id AS parentId FROM categories WHERE id = ?"
    )
    .get(id);
}

export function insertCategory(db: Database, name: string, parentId: number | null): number {
  const row = db
    .query<{ id: number }, [string, number | null]>(
      "INSERT INTO categories (name, parent_id) VALUES (?, ?) RETURNING id"
    )
    .get(name, parentId);
  return row!.id;
}

export function getPart(db: Database, id: number): Part | null {
  return db
    .query<Part, [number]>(
      `SELECT ${PART_COLUMNS} FROM parts p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.id = ?`
    )
    .get(id);
}

/** An active part with this name, ignoring case and surrounding spaces. */
/** Display unit and dimensions of each active part tracked as pieces, by part ID. */
export function listPiecePartSettings(
  db: Database
): { id: number; displayUnit: PieceDisplayUnit; twoD: boolean }[] {
  return db
    .query<{ id: number; displayUnit: PieceDisplayUnit; twoD: number }, []>(
      `SELECT id, piece_display_unit AS displayUnit,
         piece_width_attribute_id IS NOT NULL AS twoD
       FROM parts WHERE tracking_mode = 'pieces' AND archived_at IS NULL`
    )
    .all()
    .map((row) => ({ ...row, twoD: row.twoD === 1 }));
}

export function findActivePartByName(db: Database, name: string): Part | null {
  return db
    .query<Part, [string]>(
      `SELECT ${PART_COLUMNS} FROM parts p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE p.archived_at IS NULL AND lower(trim(p.name)) = lower(trim(?))
       LIMIT 1`
    )
    .get(name);
}

export function insertPart(db: Database, fields: PartFields): number {
  const row = db
    .query<{ id: number }, PartFields>(
      `INSERT INTO parts (name, category_id, base_unit, manufacturer, part_number, notes,
         tracking_mode, piece_length_attribute_id, piece_width_attribute_id, kerf_mm,
         min_offcut_mm, piece_display_unit, standard_length_mm, standard_width_mm)
       VALUES ($name, $categoryId, $baseUnit, $manufacturer, $partNumber, $notes, $trackingMode,
         $pieceLengthAttributeId, $pieceWidthAttributeId, $kerfMm, $minOffcutMm,
         $pieceDisplayUnit, $standardLengthMm, $standardWidthMm)
       RETURNING id`
    )
    .get(fields);
  return row!.id;
}

export function updatePart(db: Database, id: number, fields: PartFields): void {
  db.query<unknown, PartFields & { id: number }>(
    `UPDATE parts SET name = $name, category_id = $categoryId, base_unit = $baseUnit,
       manufacturer = $manufacturer, part_number = $partNumber, notes = $notes,
       tracking_mode = $trackingMode, piece_length_attribute_id = $pieceLengthAttributeId,
       piece_width_attribute_id = $pieceWidthAttributeId, kerf_mm = $kerfMm,
       min_offcut_mm = $minOffcutMm, piece_display_unit = $pieceDisplayUnit,
       standard_length_mm = $standardLengthMm, standard_width_mm = $standardWidthMm,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $id`
  ).run({ ...fields, id });
}

/** Change how a part's stock is tracked. Run it in a transaction with the stock changes. */
export function setPartTracking(db: Database, id: number, tracking: PartTracking): void {
  db.query<unknown, PartTracking & { id: number }>(
    `UPDATE parts SET tracking_mode = $trackingMode,
       piece_length_attribute_id = $pieceLengthAttributeId,
       piece_width_attribute_id = $pieceWidthAttributeId, kerf_mm = $kerfMm,
       min_offcut_mm = $minOffcutMm, piece_display_unit = $pieceDisplayUnit,
       standard_length_mm = $standardLengthMm, standard_width_mm = $standardWidthMm,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $id`
  ).run({ ...tracking, id });
}

export function renamePart(db: Database, id: number, name: string): void {
  db.run(
    "UPDATE parts SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
    [name, id]
  );
}

export function setPartArchived(db: Database, id: number, archived: boolean): void {
  db.query<unknown, [number, number]>(
    `UPDATE parts SET archived_at = CASE WHEN ? THEN coalesce(archived_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) END,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`
  ).run(archived ? 1 : 0, id);
}

const DEFINITION_COLUMNS = `id, key, label, value_type AS valueType,
  canonical_unit AS canonicalUnit, normalization`;

export function listAttributeDefinitions(db: Database): AttributeDefinition[] {
  return db
    .query<AttributeDefinition, []>(
      `SELECT ${DEFINITION_COLUMNS} FROM attribute_definitions ORDER BY label`
    )
    .all();
}

/** Attribute keys assigned directly to each category. Descendants inherit them. */
export function listAttributeApplicability(db: Database): { categoryId: number; key: string }[] {
  return db
    .query<{ categoryId: number; key: string }, []>(
      `SELECT a.category_id AS categoryId, d.key
       FROM attribute_applicability a
       JOIN attribute_definitions d ON d.id = a.attribute_id
       ORDER BY d.label`
    )
    .all();
}

export function getAttributeDefinition(db: Database, key: string): AttributeDefinition | null {
  return db
    .query<AttributeDefinition, [string]>(
      `SELECT ${DEFINITION_COLUMNS} FROM attribute_definitions WHERE key = ?`
    )
    .get(key);
}

export function getAttributeDefinitionById(db: Database, id: number): AttributeDefinition | null {
  return db
    .query<AttributeDefinition, [number]>(
      `SELECT ${DEFINITION_COLUMNS} FROM attribute_definitions WHERE id = ?`
    )
    .get(id);
}

export function insertAttributeDefinition(
  db: Database,
  fields: { key: string; label: string; valueType: AttributeValueType }
): AttributeDefinition {
  return db
    .query<AttributeDefinition, typeof fields>(
      `INSERT INTO attribute_definitions (key, label, value_type) VALUES ($key, $label, $valueType)
       RETURNING ${DEFINITION_COLUMNS}`
    )
    .get(fields)!;
}

export function listPartAttributes(db: Database, partId: number): PartAttribute[] {
  return db
    .query<Omit<PartAttribute, "valueBoolean"> & { valueBoolean: number | null }, [number]>(
      `SELECT d.key, d.label, d.value_type AS valueType, d.normalization, a.raw_value AS rawValue,
         a.value_text AS valueText, a.value_number AS valueNumber, a.value_boolean AS valueBoolean
       FROM part_attributes a
       JOIN attribute_definitions d ON d.id = a.attribute_id
       WHERE a.part_id = ?
       ORDER BY d.label`
    )
    .all(partId)
    .map((row) => ({
      ...row,
      valueBoolean: row.valueBoolean === null ? null : row.valueBoolean === 1,
    }));
}

export function replacePartAttributes(
  db: Database,
  partId: number,
  values: PartAttributeValue[]
): void {
  db.run("DELETE FROM part_attributes WHERE part_id = ?", [partId]);
  const insert = db.query<
    unknown,
    [number, number, string, string | null, number | null, number | null]
  >(
    `INSERT INTO part_attributes (part_id, attribute_id, raw_value, value_text, value_number, value_boolean)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const value of values) {
    insert.run(
      partId,
      value.attributeId,
      value.rawValue,
      value.valueText,
      value.valueNumber,
      value.valueBoolean === null ? null : Number(value.valueBoolean)
    );
  }
}

export function deletePartAttributes(db: Database, partId: number, attributeIds: number[]): void {
  db.run(
    "DELETE FROM part_attributes WHERE part_id = ? AND attribute_id IN (SELECT value FROM json_each(?))",
    [partId, JSON.stringify(attributeIds)]
  );
}

/** Add an alias to a part unless it already has it. */
export function addPartAlias(db: Database, partId: number, alias: string): void {
  db.run("INSERT OR IGNORE INTO part_aliases (part_id, alias) VALUES (?, ?)", [partId, alias]);
}

export function listPartAliases(db: Database, partId: number): string[] {
  return db
    .query<{ alias: string }, [number]>(
      "SELECT alias FROM part_aliases WHERE part_id = ? ORDER BY alias"
    )
    .all(partId)
    .map((row) => row.alias);
}

export function replacePartAliases(db: Database, partId: number, aliases: string[]): void {
  db.run("DELETE FROM part_aliases WHERE part_id = ?", [partId]);
  const insert = db.query<unknown, [number, string]>(
    "INSERT INTO part_aliases (part_id, alias) VALUES (?, ?)"
  );
  for (const alias of aliases) {
    insert.run(partId, alias);
  }
}

export function listPartTags(db: Database, partId: number): string[] {
  return db
    .query<{ tag: string }, [number]>("SELECT tag FROM part_tags WHERE part_id = ? ORDER BY tag")
    .all(partId)
    .map((row) => row.tag);
}

export function listAllTags(db: Database): string[] {
  return db
    .query<{ tag: string }, []>("SELECT DISTINCT tag FROM part_tags ORDER BY tag")
    .all()
    .map((row) => row.tag);
}

export function replacePartTags(db: Database, partId: number, tags: string[]): void {
  db.run("DELETE FROM part_tags WHERE part_id = ?", [partId]);
  const insert = db.query<unknown, [number, string]>(
    "INSERT INTO part_tags (part_id, tag) VALUES (?, ?)"
  );
  for (const tag of tags) {
    insert.run(partId, tag);
  }
}

const SUPPLIER_PART_COLUMNS = `id, supplier, sku, url, purchase_unit AS purchaseUnit,
  pack_quantity AS packQuantity, stock_length_mm AS stockLengthMm, stock_width_mm AS stockWidthMm`;

export function listSupplierParts(db: Database, partId: number): SupplierPart[] {
  return db
    .query<SupplierPart, [number]>(
      `SELECT ${SUPPLIER_PART_COLUMNS} FROM supplier_parts WHERE part_id = ? ORDER BY supplier, sku`
    )
    .all(partId);
}

export function insertSupplierPart(db: Database, partId: number, fields: SupplierPartFields): void {
  db.query<unknown, SupplierPartFields & { partId: number }>(
    `INSERT INTO supplier_parts (part_id, supplier, sku, url, purchase_unit, pack_quantity,
       stock_length_mm, stock_width_mm)
     VALUES ($partId, $supplier, $sku, $url, $purchaseUnit, $packQuantity, $stockLengthMm,
       $stockWidthMm)`
  ).run({ ...fields, partId });
}

export function updateSupplierPart(
  db: Database,
  partId: number,
  id: number,
  fields: SupplierPartFields
): void {
  db.query<unknown, SupplierPartFields & { id: number; partId: number }>(
    `UPDATE supplier_parts SET supplier = $supplier, sku = $sku, url = $url,
       purchase_unit = $purchaseUnit, pack_quantity = $packQuantity,
       stock_length_mm = $stockLengthMm, stock_width_mm = $stockWidthMm
     WHERE id = $id AND part_id = $partId`
  ).run({ ...fields, id, partId });
}

export function deleteSupplierPart(db: Database, partId: number, id: number): void {
  db.run("DELETE FROM supplier_parts WHERE id = ? AND part_id = ?", [id, partId]);
}

/** The ID of the part's supplier SKU row for `supplier` and `sku`, or null. */
export function findSupplierPart(
  db: Database,
  partId: number,
  supplier: string,
  sku: string
): number | null {
  return (
    db
      .query<{ id: number }, [number, string, string]>(
        "SELECT id FROM supplier_parts WHERE part_id = ? AND supplier = ? AND sku = ?"
      )
      .get(partId, supplier, sku)?.id ?? null
  );
}

/** Set the stock size of every supplier SKU of a part. */
export function setSupplierStockSizes(
  db: Database,
  partId: number,
  lengthMm: number | null,
  widthMm: number | null
): void {
  db.run("UPDATE supplier_parts SET stock_length_mm = ?, stock_width_mm = ? WHERE part_id = ?", [
    lengthMm,
    widthMm,
    partId,
  ]);
}

/** The part's supplier SKU row for `supplier` and `sku`, or null. */
export function getSupplierPartBySku(
  db: Database,
  partId: number,
  supplier: string,
  sku: string
): SupplierPart | null {
  return db
    .query<SupplierPart, [number, string, string]>(
      `SELECT ${SUPPLIER_PART_COLUMNS} FROM supplier_parts
       WHERE part_id = ? AND supplier = ? AND sku = ?`
    )
    .get(partId, supplier, sku);
}

/**
 * Move every reference to part `sourceId` onto part `destinationId`, then delete the source.
 * Aliases and supplier SKUs of the source move too; its attributes and tags are deleted.
 * Both parts must use the same base unit, because the moved quantities are in that unit.
 * Run it in a transaction.
 */
export function mergePartInto(db: Database, sourceId: number, destinationId: number): void {
  const ids = { source: sourceId, destination: destinationId };
  const run = (sql: string) => db.query<unknown, typeof ids>(sql).run(ids);
  // Details that belong only to the source part.
  db.run("DELETE FROM part_attributes WHERE part_id = ?", [sourceId]);
  db.run("DELETE FROM part_tags WHERE part_id = ?", [sourceId]);

  // Aliases and supplier SKUs still identify the part. The destination's own rows win.
  run(`DELETE FROM part_aliases WHERE part_id = $source AND alias IN
       (SELECT alias FROM part_aliases WHERE part_id = $destination)`);
  run("UPDATE part_aliases SET part_id = $destination WHERE part_id = $source");
  run(`DELETE FROM supplier_parts WHERE part_id = $source AND EXISTS
       (SELECT 1 FROM supplier_parts d WHERE d.part_id = $destination
          AND d.supplier = supplier_parts.supplier AND d.sku = supplier_parts.sku)`);
  run("UPDATE supplier_parts SET part_id = $destination WHERE part_id = $source");

  // A BOM line that already approves the destination keeps that choice.
  run(`DELETE FROM bom_part_choices WHERE part_id = $source AND bom_line_id IN
       (SELECT bom_line_id FROM bom_part_choices WHERE part_id = $destination)`);
  run("UPDATE bom_part_choices SET part_id = $destination WHERE part_id = $source");

  // A reservation of both parts for the same line and location becomes one reservation.
  run(`UPDATE reservations AS d
     SET quantity = d.quantity + s.quantity, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     FROM reservations AS s
     WHERE d.part_id = $destination AND s.part_id = $source
       AND s.bom_line_id = d.bom_line_id AND s.location_id = d.location_id`);
  run(`DELETE FROM reservations WHERE part_id = $source AND EXISTS
       (SELECT 1 FROM reservations d WHERE d.part_id = $destination
          AND d.bom_line_id = reservations.bom_line_id AND d.location_id = reservations.location_id)`);
  run(`UPDATE reservations SET part_id = $destination,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE part_id = $source`);

  run("UPDATE stock_movements SET part_id = $destination WHERE part_id = $source");
  run("UPDATE order_lines SET part_id = $destination WHERE part_id = $source");
  run("UPDATE bom_lines SET part_id = $destination WHERE part_id = $source");
  run("UPDATE import_lines SET part_id = $destination WHERE part_id = $source");
  run("UPDATE import_lines SET created_part_id = $destination WHERE created_part_id = $source");

  db.run("DELETE FROM parts WHERE id = ?", [sourceId]);
}
