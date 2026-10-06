import type { Database } from "bun:sqlite";
import type { AttributeValueType, PartAttributeValue } from "./catalog";

/** How often an attribute definition is used. */
export interface AttributeUsage {
  attributeId: number;
  partCount: number;
  constraintCount: number;
}

export interface AttributeAssignment {
  attributeId: number;
  categoryId: number;
  required: boolean;
}

/** One distinct raw value of an attribute and the parts that use it. */
export interface AttributeValueUsage {
  rawValue: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  partCount: number;
}

export interface StoredAttributeValue extends PartAttributeValue {
  partId: number;
}

export type AttributeDefinitionFields = {
  key: string;
  label: string;
  valueType: AttributeValueType;
  canonicalUnit: string | null;
  normalization: string | null;
};

export function listAttributeUsage(db: Database): AttributeUsage[] {
  return db
    .query<AttributeUsage, []>(
      `SELECT d.id AS attributeId,
         (SELECT count(*) FROM part_attributes a WHERE a.attribute_id = d.id) AS partCount,
         (SELECT count(*) FROM bom_line_constraints c WHERE c.attribute_id = d.id) AS constraintCount
       FROM attribute_definitions d`
    )
    .all();
}

export function listAttributeAssignments(db: Database): AttributeAssignment[] {
  return db
    .query<{ attributeId: number; categoryId: number; required: number }, []>(
      `SELECT attribute_id AS attributeId, category_id AS categoryId, required
       FROM attribute_applicability`
    )
    .all()
    .map((row) => ({ ...row, required: row.required === 1 }));
}

export function listAttributeValueUsage(db: Database, attributeId: number): AttributeValueUsage[] {
  return db
    .query<Omit<AttributeValueUsage, "valueBoolean"> & { valueBoolean: number | null }, [number]>(
      `SELECT raw_value AS rawValue, value_text AS valueText, value_number AS valueNumber,
         value_boolean AS valueBoolean, count(*) AS partCount
       FROM part_attributes WHERE attribute_id = ?
       GROUP BY raw_value
       ORDER BY value_number, value_text, raw_value COLLATE NOCASE`
    )
    .all(attributeId)
    .map((row) => ({
      ...row,
      valueBoolean: row.valueBoolean === null ? null : row.valueBoolean === 1,
    }));
}

/** Stored values of an attribute, optionally only those with one raw value. */
export function listStoredValues(
  db: Database,
  attributeId: number,
  rawValue: string | null = null
): StoredAttributeValue[] {
  return db
    .query<
      Omit<StoredAttributeValue, "valueBoolean"> & { valueBoolean: number | null },
      [number, string | null]
    >(
      `SELECT part_id AS partId, attribute_id AS attributeId, raw_value AS rawValue,
         value_text AS valueText, value_number AS valueNumber, value_boolean AS valueBoolean
       FROM part_attributes
       WHERE attribute_id = ?1 AND (?2 IS NULL OR raw_value = ?2)`
    )
    .all(attributeId, rawValue)
    .map((row) => ({
      ...row,
      valueBoolean: row.valueBoolean === null ? null : row.valueBoolean === 1,
    }));
}

/** Insert or replace the value of one attribute on one part. */
export function upsertPartAttribute(db: Database, value: StoredAttributeValue): void {
  db.query<unknown, [number, number, string, string | null, number | null, number | null]>(
    `INSERT INTO part_attributes (part_id, attribute_id, raw_value, value_text, value_number, value_boolean)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (part_id, attribute_id) DO UPDATE SET raw_value = excluded.raw_value,
       value_text = excluded.value_text, value_number = excluded.value_number,
       value_boolean = excluded.value_boolean`
  ).run(
    value.partId,
    value.attributeId,
    value.rawValue,
    value.valueText,
    value.valueNumber,
    value.valueBoolean === null ? null : Number(value.valueBoolean)
  );
}

export function deletePartAttribute(db: Database, partId: number, attributeId: number): void {
  db.run("DELETE FROM part_attributes WHERE part_id = ? AND attribute_id = ?", [
    partId,
    attributeId,
  ]);
}

export function insertFullAttributeDefinition(
  db: Database,
  fields: AttributeDefinitionFields
): number {
  return db
    .query<{ id: number }, AttributeDefinitionFields>(
      `INSERT INTO attribute_definitions (key, label, value_type, canonical_unit, normalization)
       VALUES ($key, $label, $valueType, $canonicalUnit, $normalization) RETURNING id`
    )
    .get(fields)!.id;
}

export function updateAttributeDefinition(
  db: Database,
  id: number,
  fields: Omit<AttributeDefinitionFields, "key">
): void {
  db.query<unknown, Omit<AttributeDefinitionFields, "key"> & { id: number }>(
    `UPDATE attribute_definitions SET label = $label, value_type = $valueType,
       canonical_unit = $canonicalUnit, normalization = $normalization
     WHERE id = $id`
  ).run({ ...fields, id });
}

export function deleteAttributeDefinition(db: Database, id: number): void {
  db.run("DELETE FROM attribute_definitions WHERE id = ?", [id]);
}

export function setAttributeAssignment(db: Database, assignment: AttributeAssignment): void {
  db.query<unknown, [number, number, number]>(
    `INSERT INTO attribute_applicability (attribute_id, category_id, required) VALUES (?, ?, ?)
     ON CONFLICT (attribute_id, category_id) DO UPDATE SET required = excluded.required`
  ).run(assignment.attributeId, assignment.categoryId, Number(assignment.required));
}

export function deleteAttributeAssignment(
  db: Database,
  attributeId: number,
  categoryId: number
): void {
  db.run("DELETE FROM attribute_applicability WHERE attribute_id = ? AND category_id = ?", [
    attributeId,
    categoryId,
  ]);
}

export function updateCategory(
  db: Database,
  id: number,
  fields: { name: string; parentId: number | null }
): void {
  db.run("UPDATE categories SET name = ?, parent_id = ? WHERE id = ?", [
    fields.name,
    fields.parentId,
    id,
  ]);
}

/** Parts, child categories, and BOM rows that use a category. */
export function countCategoryUses(db: Database, id: number) {
  return db
    .query<{ parts: number; children: number; bomLines: number }, [number]>(
      `SELECT (SELECT count(*) FROM parts WHERE category_id = ?1) AS parts,
         (SELECT count(*) FROM categories WHERE parent_id = ?1) AS children,
         (SELECT count(*) FROM bom_lines WHERE category_id = ?1) AS bomLines`
    )
    .get(id)!;
}

export function deleteCategory(db: Database, id: number): void {
  db.run("DELETE FROM categories WHERE id = ?", [id]);
}

export function setPartCategory(db: Database, partId: number, categoryId: number | null): void {
  db.run(
    `UPDATE parts SET category_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE id = ?`,
    [categoryId, partId]
  );
}
