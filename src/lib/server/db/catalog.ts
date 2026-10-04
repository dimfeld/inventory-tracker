import type { Database } from "bun:sqlite";

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

export interface Part {
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
export type PartFields = {
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
}

export type SupplierPartFields = Omit<SupplierPart, "id">;

const PART_COLUMNS = `p.id, p.name, p.category_id AS categoryId, c.name AS categoryName,
  p.base_unit AS baseUnit, p.manufacturer, p.part_number AS partNumber, p.notes,
  p.archived_at AS archivedAt`;

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

export function insertPart(db: Database, fields: PartFields): number {
  const row = db
    .query<{ id: number }, PartFields>(
      `INSERT INTO parts (name, category_id, base_unit, manufacturer, part_number, notes)
       VALUES ($name, $categoryId, $baseUnit, $manufacturer, $partNumber, $notes)
       RETURNING id`
    )
    .get(fields);
  return row!.id;
}

export function updatePart(db: Database, id: number, fields: PartFields): void {
  db.query<unknown, PartFields & { id: number }>(
    `UPDATE parts SET name = $name, category_id = $categoryId, base_unit = $baseUnit,
       manufacturer = $manufacturer, part_number = $partNumber, notes = $notes,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = $id`
  ).run({ ...fields, id });
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

export function listSupplierParts(db: Database, partId: number): SupplierPart[] {
  return db
    .query<SupplierPart, [number]>(
      `SELECT id, supplier, sku, url, purchase_unit AS purchaseUnit, pack_quantity AS packQuantity
       FROM supplier_parts WHERE part_id = ? ORDER BY supplier, sku`
    )
    .all(partId);
}

export function insertSupplierPart(db: Database, partId: number, fields: SupplierPartFields): void {
  db.query<unknown, SupplierPartFields & { partId: number }>(
    `INSERT INTO supplier_parts (part_id, supplier, sku, url, purchase_unit, pack_quantity)
     VALUES ($partId, $supplier, $sku, $url, $purchaseUnit, $packQuantity)`
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
       purchase_unit = $purchaseUnit, pack_quantity = $packQuantity
     WHERE id = $id AND part_id = $partId`
  ).run({ ...fields, id, partId });
}

export function deleteSupplierPart(db: Database, partId: number, id: number): void {
  db.run("DELETE FROM supplier_parts WHERE id = ? AND part_id = ?", [id, partId]);
}

export function findSupplierPart(
  db: Database,
  supplier: string,
  sku: string
): { id: number; partId: number } | null {
  return db
    .query<{ id: number; partId: number }, [string, string]>(
      "SELECT id, part_id AS partId FROM supplier_parts WHERE supplier = ? AND sku = ?"
    )
    .get(supplier, sku);
}
