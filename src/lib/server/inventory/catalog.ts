import type { Database } from "bun:sqlite";
import {
  deleteSupplierPart,
  findSupplierPart,
  getAttributeDefinition,
  getCategory,
  getPart,
  insertAttributeDefinition,
  insertCategory,
  insertPart,
  insertSupplierPart,
  listAllTags,
  listAttributeApplicability,
  listAttributeDefinitions,
  listCategories,
  listPartAliases,
  listPartAttributes,
  listPartTags,
  listSupplierParts,
  mergePartInto,
  replacePartAliases,
  replacePartAttributes,
  replacePartTags,
  setPartArchived,
  updatePart,
  updateSupplierPart,
  type AttributeDefinition,
  type PartAttributeValue,
} from "#lib/server/db/catalog.ts";
import {
  countPartMovements,
  listLocationBalances,
  listPartMovements,
} from "#lib/server/db/movements.ts";
import { countPartOrderLines } from "#lib/server/db/orders.ts";
import { listStorageStock } from "#lib/server/db/reservations.ts";
import {
  expandAttributes,
  filterValueOf,
  formatAttributeValue,
  isNormalizationRule,
  normalizeAttributeValue,
} from "#lib/attributes.ts";
import { applicableAttributeKeys, categoryOptions } from "#lib/categories.ts";
import type { AttributeInput, PartInput } from "#lib/schemas/part.ts";
import {
  listAttributesOfParts,
  listFacetDefinitions,
  listFacetValues,
  searchParts,
  type AttributeCondition,
} from "#lib/server/db/part-search.ts";
import { InventoryError, NotFoundError } from "./errors";

export type CatalogService = ReturnType<typeof createCatalogService>;

export interface PartFilter {
  text: string | null;
  categoryId: number | null;
  /** Combined with AND. The values of one attribute are combined with OR. */
  attributes: { key: string; values: string[] }[];
  /** Combined with OR. */
  tags: string[];
  includeArchived: boolean;
}

export interface FacetValue {
  /** The normalized value, as used in a filter. */
  value: string;
  /** Readable form, such as `4.7 kΩ`. */
  label: string;
  partCount: number;
}

export interface AttributeFacet {
  key: string;
  label: string;
  values: FacetValue[];
}

const BOOLEAN_VALUES: Record<string, boolean> = { yes: true, true: true, no: false, false: false };

/**
 * Convert attribute text to the typed value its definition expects. Keeps the raw text.
 * Text that a normalization rule cannot read keeps no typed value.
 */
export function typedAttributeValue(
  definition: AttributeDefinition,
  input: AttributeInput
): PartAttributeValue {
  const value: PartAttributeValue = {
    attributeId: definition.id,
    rawValue: input.value,
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
  };
  if (isNormalizationRule(definition.normalization)) {
    return { ...value, ...normalizeAttributeValue(definition.normalization, input.value) };
  }
  switch (definition.valueType) {
    case "text":
      value.valueText = input.value;
      break;
    case "number": {
      const number = Number(input.value);
      if (input.value === "" || !Number.isFinite(number)) {
        throw new InventoryError(`${definition.label} must be a number`);
      }
      value.valueNumber = number;
      break;
    }
    case "boolean": {
      const bool = BOOLEAN_VALUES[input.value.toLowerCase()];
      if (bool === undefined) {
        throw new InventoryError(`${definition.label} must be yes or no`);
      }
      value.valueBoolean = bool;
      break;
    }
  }
  return value;
}

export function createCatalogService(db: Database) {
  function requirePart(id: number) {
    const part = getPart(db, id);
    if (!part) throw new NotFoundError(`Part ${id} does not exist`);
    return part;
  }

  function checkCategory(categoryId: number | null) {
    if (categoryId !== null && !getCategory(db, categoryId)) {
      throw new NotFoundError(`Category ${categoryId} does not exist`);
    }
  }

  /** Attributes without a definition get a new text definition. */
  function saveAttributes(partId: number, attributes: AttributeInput[]) {
    const values = expandAttributes(attributes).map((attribute) => {
      const definition =
        getAttributeDefinition(db, attribute.key) ??
        insertAttributeDefinition(db, {
          key: attribute.key,
          label: attribute.label,
          valueType: "text",
        });
      return typedAttributeValue(definition, attribute);
    });
    replacePartAttributes(db, partId, values);
  }

  function saveSupplierParts(partId: number, input: PartInput["supplierParts"]) {
    const existingIds = new Set(listSupplierParts(db, partId).map((row) => row.id));
    const keptIds = new Set(input.flatMap((row) => (row.id === null ? [] : [row.id])));

    for (const id of existingIds) {
      if (!keptIds.has(id)) deleteSupplierPart(db, partId, id);
    }

    for (const { id, ...fields } of input) {
      // Several parts can share a supplier SKU, but one part lists it only once.
      const other = findSupplierPart(db, partId, fields.supplier, fields.sku);
      if (other !== null && other !== id) {
        throw new InventoryError(`${fields.supplier} SKU ${fields.sku} is already on this part`);
      }
      if (id !== null && existingIds.has(id)) {
        updateSupplierPart(db, partId, id, fields);
      } else {
        insertSupplierPart(db, partId, fields);
      }
    }
  }

  function saveDetails(partId: number, input: PartInput) {
    saveAttributes(partId, input.attributes);
    replacePartAliases(db, partId, input.aliases);
    replacePartTags(db, partId, input.tags);
    saveSupplierParts(partId, input.supplierParts);
  }

  function partFields(input: PartInput) {
    return {
      name: input.name,
      categoryId: input.categoryId,
      baseUnit: input.baseUnit,
      manufacturer: input.manufacturer,
      partNumber: input.partNumber,
      notes: input.notes,
    };
  }

  /** Typed conditions for a filter. Values are normalized with the attribute's own rule. */
  function attributeConditions(filter: PartFilter["attributes"]): AttributeCondition[] {
    return filter.map(({ key, values }) => {
      const definition = getAttributeDefinition(db, key);
      // An unknown attribute matches nothing.
      const condition: AttributeCondition = {
        attributeId: definition?.id ?? 0,
        texts: [],
        numbers: [],
      };
      if (!definition) return condition;
      for (const value of values) {
        const typed = isNormalizationRule(definition.normalization)
          ? normalizeAttributeValue(definition.normalization, value)
          : { valueText: value, valueNumber: null };
        if (typed?.valueText != null) condition.texts.push(typed.valueText);
        if (typed?.valueNumber != null) condition.numbers.push(typed.valueNumber);
      }
      return condition;
    });
  }

  return {
    listCategories: () => listCategories(db),

    listTags: () => listAllTags(db),

    /** Attribute definitions and the keys that apply to each category (including inherited). */
    attributeOptions() {
      return {
        definitions: listAttributeDefinitions(db).map(
          ({ key, label, canonicalUnit, normalization }) => ({
            key,
            label,
            canonicalUnit,
            normalization,
          })
        ),
        applicable: applicableAttributeKeys(listCategories(db), listAttributeApplicability(db)),
      };
    },

    /** Parts matching the filter, with category paths and attributes in readable form. */
    searchParts(filter: PartFilter) {
      const rows = searchParts(db, {
        text: filter.text,
        categoryId: filter.categoryId,
        attributes: attributeConditions(filter.attributes),
        tags: filter.tags,
        includeArchived: filter.includeArchived,
      });
      const paths = new Map(categoryOptions(listCategories(db)).map((c) => [c.id, c.path]));
      const attributes = Map.groupBy(
        listAttributesOfParts(
          db,
          rows.map((row) => row.id)
        ),
        (row) => row.partId
      );
      return rows.map((row) => ({
        ...row,
        categoryPath: row.categoryId === null ? null : (paths.get(row.categoryId) ?? null),
        attributes: (attributes.get(row.id) ?? []).map((a) => ({
          key: a.key,
          label: a.label,
          rawValue: a.rawValue,
          display: formatAttributeValue(a.normalization, a),
        })),
      }));
    },

    /** Filterable attributes for a category scope, with the values present in that scope. */
    partFacets(categoryId: number | null, includeArchived: boolean): AttributeFacet[] {
      const values = Map.groupBy(
        listFacetValues(db, categoryId, includeArchived),
        (row) => row.attributeId
      );
      return listFacetDefinitions(db, categoryId, includeArchived).map((definition) => ({
        key: definition.key,
        label: definition.label,
        values: (values.get(definition.id) ?? []).map((row) => ({
          value: filterValueOf(row),
          label: formatAttributeValue(definition.normalization, row) ?? filterValueOf(row),
          partCount: row.partCount,
        })),
      }));
    },

    createCategory(name: string, parentId: number | null): number {
      return db.transaction(() => {
        checkCategory(parentId);
        if (listCategories(db).some((c) => c.parentId === parentId && c.name === name)) {
          throw new InventoryError(`Category "${name}" already exists there`);
        }
        return insertCategory(db, name, parentId);
      })();
    },

    createPart(input: PartInput): number {
      return db.transaction(() => {
        checkCategory(input.categoryId);
        const id = insertPart(db, partFields(input));
        saveDetails(id, input);
        return id;
      })();
    },

    updatePart(id: number, input: PartInput): void {
      db.transaction(() => {
        const part = requirePart(id);
        checkCategory(input.categoryId);
        if (
          part.baseUnit !== input.baseUnit &&
          (countPartMovements(db, id) > 0 || countPartOrderLines(db, id) > 0)
        ) {
          throw new InventoryError(
            "The base unit cannot change after stock or orders have been recorded, because existing quantities use it"
          );
        }
        updatePart(db, id, partFields(input));
        saveDetails(id, input);
      })();
    },

    /**
     * Merge a duplicate part into another part. Stock history, orders, BOM rows, reservations,
     * and import lines of the source move to the destination. The destination keeps its own
     * details; the attributes, aliases, tags, and supplier SKUs of the source are deleted.
     */
    mergePart(sourceId: number, destinationId: number): void {
      db.transaction(() => {
        if (sourceId === destinationId) {
          throw new InventoryError("A part cannot be merged into itself");
        }
        const source = requirePart(sourceId);
        const destination = requirePart(destinationId);
        if (source.baseUnit !== destination.baseUnit) {
          throw new InventoryError(
            `Both parts must use the same base unit, because quantities use it (${source.baseUnit} and ${destination.baseUnit})`
          );
        }
        mergePartInto(db, sourceId, destinationId);
      })();
    },

    /** Parts that can be chosen in a form: every part that is not archived. */
    partOptions: () =>
      searchParts(db, {
        text: null,
        categoryId: null,
        attributes: [],
        tags: [],
        includeArchived: false,
      }).map(({ id, name, baseUnit, partNumber }) => ({ id, name, baseUnit, partNumber })),

    /** Archive a part. It stays in movement history and can be restored. */
    archivePart(id: number): void {
      requirePart(id);
      setPartArchived(db, id, true);
    },

    restorePart(id: number): void {
      requirePart(id);
      setPartArchived(db, id, false);
    },

    getPartDetails(id: number) {
      const part = getPart(db, id);
      if (!part) return null;
      return {
        part,
        attributes: listPartAttributes(db, id),
        aliases: listPartAliases(db, id),
        tags: listPartTags(db, id),
        supplierParts: listSupplierParts(db, id),
        balances: listLocationBalances(db, id),
        /** Active project reservations at storage locations. */
        reserved: listStorageStock(db, [id])
          .filter((s) => s.reserved > 0)
          .map(({ locationId, reserved }) => ({ locationId, reserved })),
        movements: listPartMovements(db, id),
      };
    },

    /** True when the part has stock history, so its base unit cannot change. */
    hasMovements(id: number): boolean {
      return countPartMovements(db, id) > 0;
    },
  };
}
