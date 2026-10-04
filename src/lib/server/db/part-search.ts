import type { Database, SQLQueryBindings } from "bun:sqlite";
import type { AttributeDefinition, PartSummary } from "./catalog";

export interface AttributeCondition {
  attributeId: number;
  /** Normalized values. A part matches when its typed value equals any of them. */
  texts: string[];
  numbers: number[];
}

export interface PartSearchQuery {
  /** Matched against name, aliases, manufacturer part number, and supplier SKUs. */
  text: string | null;
  /** Includes parts in all descendant categories. */
  categoryId: number | null;
  /** All conditions must match. */
  attributes: AttributeCondition[];
  /** Any of these tags matches. */
  tags: string[];
  includeArchived: boolean;
}

export interface PartSearchRow extends PartSummary {
  categoryId: number | null;
}

export interface PartAttributeRow {
  partId: number;
  key: string;
  label: string;
  normalization: string | null;
  rawValue: string;
  valueText: string | null;
  valueNumber: number | null;
}

export interface FacetValueRow {
  attributeId: number;
  valueText: string | null;
  valueNumber: number | null;
  partCount: number;
}

// The category and its descendants. Binds one parameter: the category ID.
const SCOPE_CTE = `scope(id) AS (
  SELECT id FROM categories WHERE id = ?
  UNION SELECT c.id FROM categories c JOIN scope s ON c.parent_id = s.id
)`;

// The category and its ancestors. Binds one parameter: the category ID.
const ANCESTORS_CTE = `ancestors(id) AS (
  SELECT id FROM categories WHERE id = ?
  UNION SELECT c.parent_id FROM categories c JOIN ancestors a ON c.id = a.id
  WHERE c.parent_id IS NOT NULL
)`;

// Binds the category ID. With no category, every part is in scope.
const IN_SCOPE = "(? IS NULL OR p.category_id IN (SELECT id FROM scope))";

function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function searchParts(db: Database, query: PartSearchQuery): PartSearchRow[] {
  // The first parameter is for the scope CTE.
  const params: SQLQueryBindings[] = [query.categoryId, query.categoryId];
  const conditions = [IN_SCOPE, "(? OR p.archived_at IS NULL)"];
  params.push(query.includeArchived ? 1 : 0);

  if (query.text) {
    conditions.push(`(p.name LIKE ? ESCAPE '\\' OR p.part_number LIKE ? ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM part_aliases pa WHERE pa.part_id = p.id AND pa.alias LIKE ? ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM supplier_parts sp WHERE sp.part_id = p.id AND sp.sku LIKE ? ESCAPE '\\'))`);
    const pattern = likePattern(query.text);
    params.push(pattern, pattern, pattern, pattern);
  }

  for (const condition of query.attributes) {
    conditions.push(`EXISTS (SELECT 1 FROM part_attributes a
      WHERE a.part_id = p.id AND a.attribute_id = ?
        AND (a.value_text IN (SELECT value FROM json_each(?))
          OR a.value_number IN (SELECT value FROM json_each(?))))`);
    params.push(
      condition.attributeId,
      JSON.stringify(condition.texts),
      JSON.stringify(condition.numbers)
    );
  }

  if (query.tags.length > 0) {
    conditions.push(`EXISTS (SELECT 1 FROM part_tags t
      WHERE t.part_id = p.id AND t.tag IN (SELECT value FROM json_each(?)))`);
    params.push(JSON.stringify(query.tags));
  }

  return db
    .query<PartSearchRow, SQLQueryBindings[]>(
      `WITH RECURSIVE ${SCOPE_CTE}
       SELECT p.id, p.name, p.category_id AS categoryId, c.name AS categoryName,
         p.base_unit AS baseUnit, p.manufacturer, p.part_number AS partNumber,
         p.archived_at AS archivedAt,
         coalesce((SELECT sum(CASE WHEN m.to_location_id IS NOT NULL THEN m.quantity ELSE 0 END)
                        - sum(CASE WHEN m.from_location_id IS NOT NULL THEN m.quantity ELSE 0 END)
                   FROM stock_movements m WHERE m.part_id = p.id), 0) AS totalQuantity
       FROM parts p
       LEFT JOIN categories c ON c.id = p.category_id
       WHERE ${conditions.join(" AND ")}
       ORDER BY p.archived_at IS NOT NULL, p.name COLLATE NOCASE`
    )
    .all(...params);
}

/** Attributes of the given parts, for showing key attributes in results. */
export function listAttributesOfParts(db: Database, partIds: number[]): PartAttributeRow[] {
  return db
    .query<PartAttributeRow, [string]>(
      `SELECT a.part_id AS partId, d.key, d.label, d.normalization, a.raw_value AS rawValue,
         a.value_text AS valueText, a.value_number AS valueNumber
       FROM part_attributes a
       JOIN attribute_definitions d ON d.id = a.attribute_id
       WHERE a.part_id IN (SELECT value FROM json_each(?))
       ORDER BY d.label`
    )
    .all(JSON.stringify(partIds));
}

/**
 * Attributes to offer as filters for a category scope: those applicable to the category, its
 * ancestors, or its descendants, plus any attribute with a value on a part in scope. With no
 * category, every attribute that has a value.
 */
export function listFacetDefinitions(
  db: Database,
  categoryId: number | null,
  includeArchived: boolean
): AttributeDefinition[] {
  return db
    .query<AttributeDefinition, SQLQueryBindings[]>(
      `WITH RECURSIVE ${SCOPE_CTE}, ${ANCESTORS_CTE}
       SELECT d.id, d.key, d.label, d.value_type AS valueType,
         d.canonical_unit AS canonicalUnit, d.normalization
       FROM attribute_definitions d
       WHERE EXISTS (
           SELECT 1 FROM attribute_applicability aa
           WHERE aa.attribute_id = d.id
             AND (aa.category_id IN (SELECT id FROM scope) OR aa.category_id IN (SELECT id FROM ancestors)))
         OR EXISTS (
           SELECT 1 FROM part_attributes a JOIN parts p ON p.id = a.part_id
           WHERE a.attribute_id = d.id AND ${IN_SCOPE} AND (? OR p.archived_at IS NULL))
       ORDER BY d.label`
    )
    .all(categoryId, categoryId, categoryId, includeArchived ? 1 : 0);
}

/** Distinct typed values per attribute among parts in the category scope. */
export function listFacetValues(
  db: Database,
  categoryId: number | null,
  includeArchived: boolean
): FacetValueRow[] {
  return db
    .query<FacetValueRow, SQLQueryBindings[]>(
      `WITH RECURSIVE ${SCOPE_CTE}
       SELECT a.attribute_id AS attributeId, a.value_text AS valueText,
         a.value_number AS valueNumber, count(*) AS partCount
       FROM part_attributes a
       JOIN parts p ON p.id = a.part_id
       WHERE (a.value_text IS NOT NULL OR a.value_number IS NOT NULL)
         AND ${IN_SCOPE} AND (? OR p.archived_at IS NULL)
       GROUP BY a.attribute_id, a.value_text, a.value_number
       ORDER BY a.attribute_id, a.value_number, a.value_text`
    )
    .all(categoryId, categoryId, includeArchived ? 1 : 0);
}
