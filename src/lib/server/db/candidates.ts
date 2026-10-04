import type { Database } from "bun:sqlite";

export interface CandidatePart {
  id: number;
  name: string;
  categoryId: number | null;
  categoryName: string | null;
  baseUnit: string;
  manufacturer: string | null;
  partNumber: string | null;
  archivedAt: string | null;
}

export interface CandidateAttribute {
  partId: number;
  attributeId: number;
  rawValue: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
}

export interface RequiredAttribute {
  attributeId: number;
  key: string;
  label: string;
}

const PART_COLUMNS = `p.id, p.name, p.category_id AS categoryId, c.name AS categoryName,
  p.base_unit AS baseUnit, p.manufacturer, p.part_number AS partNumber, p.archived_at AS archivedAt`;

const PART_FROM = "parts p LEFT JOIN categories c ON c.id = p.category_id";

// Identifiers compare without case and surrounding space.
const SAME_TEXT = "lower(trim(?1))";

export function getCandidateParts(db: Database, ids: number[]): CandidatePart[] {
  return db
    .query<CandidatePart, [string]>(
      `SELECT ${PART_COLUMNS} FROM ${PART_FROM}
       WHERE p.id IN (SELECT value FROM json_each(?1)) ORDER BY p.name COLLATE NOCASE`
    )
    .all(JSON.stringify(ids));
}

/** Active parts whose manufacturer part number equals `partNumber`. */
export function findPartsByPartNumber(db: Database, partNumber: string): CandidatePart[] {
  return db
    .query<CandidatePart, [string]>(
      `SELECT ${PART_COLUMNS} FROM ${PART_FROM}
       WHERE p.archived_at IS NULL AND lower(trim(p.part_number)) = ${SAME_TEXT}
       ORDER BY p.name COLLATE NOCASE`
    )
    .all(partNumber);
}

/** Active parts with an alias equal to `text`. */
export function findPartsByAlias(db: Database, text: string): CandidatePart[] {
  return db
    .query<CandidatePart, [string]>(
      `SELECT ${PART_COLUMNS} FROM ${PART_FROM}
       WHERE p.archived_at IS NULL AND EXISTS (
         SELECT 1 FROM part_aliases a WHERE a.part_id = p.id AND lower(trim(a.alias)) = ${SAME_TEXT})
       ORDER BY p.name COLLATE NOCASE`
    )
    .all(text);
}

/** Active parts mapped to a supplier SKU equal to `sku`. */
export function findPartsBySupplierSku(db: Database, sku: string): CandidatePart[] {
  return db
    .query<CandidatePart, [string]>(
      `SELECT ${PART_COLUMNS} FROM ${PART_FROM}
       WHERE p.archived_at IS NULL AND EXISTS (
         SELECT 1 FROM supplier_parts s WHERE s.part_id = p.id AND lower(trim(s.sku)) = ${SAME_TEXT})
       ORDER BY p.name COLLATE NOCASE`
    )
    .all(sku);
}

/** The category and all its descendants. */
export function categoryScope(db: Database, categoryId: number): number[] {
  return db
    .query<{ id: number }, [number]>(
      `WITH RECURSIVE scope(id) AS (
         SELECT id FROM categories WHERE id = ?
         UNION SELECT c.id FROM categories c JOIN scope s ON c.parent_id = s.id
       )
       SELECT id FROM scope`
    )
    .all(categoryId)
    .map((row) => row.id);
}

/** Active parts in the category or its descendants. */
export function listPartsInCategories(db: Database, categoryIds: number[]): CandidatePart[] {
  return db
    .query<CandidatePart, [string]>(
      `SELECT ${PART_COLUMNS} FROM ${PART_FROM}
       WHERE p.archived_at IS NULL AND p.category_id IN (SELECT value FROM json_each(?))
       ORDER BY p.name COLLATE NOCASE`
    )
    .all(JSON.stringify(categoryIds));
}

/** Attributes that a requirement in the category must specify, including inherited ones. */
export function listRequiredAttributes(db: Database, categoryId: number): RequiredAttribute[] {
  return db
    .query<RequiredAttribute, [number]>(
      `WITH RECURSIVE ancestors(id) AS (
         SELECT id FROM categories WHERE id = ?
         UNION SELECT c.parent_id FROM categories c JOIN ancestors a ON c.id = a.id
         WHERE c.parent_id IS NOT NULL
       )
       SELECT DISTINCT d.id AS attributeId, d.key, d.label
       FROM attribute_applicability aa
       JOIN attribute_definitions d ON d.id = aa.attribute_id
       WHERE aa.required = 1 AND aa.category_id IN (SELECT id FROM ancestors)
       ORDER BY d.label`
    )
    .all(categoryId);
}

/** Required attribute keys assigned directly to each category. Descendants inherit them. */
export function listRequiredApplicability(db: Database): { categoryId: number; key: string }[] {
  return db
    .query<{ categoryId: number; key: string }, []>(
      `SELECT aa.category_id AS categoryId, d.key
       FROM attribute_applicability aa
       JOIN attribute_definitions d ON d.id = aa.attribute_id
       WHERE aa.required = 1
       ORDER BY d.label`
    )
    .all();
}

export function listCandidateAttributes(db: Database, partIds: number[]): CandidateAttribute[] {
  return db
    .query<Omit<CandidateAttribute, "valueBoolean"> & { valueBoolean: number | null }, [string]>(
      `SELECT part_id AS partId, attribute_id AS attributeId, raw_value AS rawValue,
         value_text AS valueText, value_number AS valueNumber, value_boolean AS valueBoolean
       FROM part_attributes WHERE part_id IN (SELECT value FROM json_each(?))`
    )
    .all(JSON.stringify(partIds))
    .map((row) => ({
      ...row,
      valueBoolean: row.valueBoolean === null ? null : row.valueBoolean === 1,
    }));
}

/** Aliases and supplier SKUs of the given parts, for identifier checks. */
export function listPartIdentifiers(
  db: Database,
  partIds: number[]
): { partId: number; identifier: string }[] {
  return db
    .query<{ partId: number; identifier: string }, [string]>(
      `SELECT part_id AS partId, alias AS identifier FROM part_aliases
       WHERE part_id IN (SELECT value FROM json_each(?1))
       UNION ALL
       SELECT part_id, sku FROM supplier_parts WHERE part_id IN (SELECT value FROM json_each(?1))`
    )
    .all(JSON.stringify(partIds));
}
