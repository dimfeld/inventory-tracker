import type { Database } from "bun:sqlite";
import { formatAttributeValue, isNormalizationRule } from "#lib/attributes.ts";
import { categoryOptions } from "#lib/categories.ts";
import {
  getAttributeDefinition,
  getCategory,
  getPart,
  listAttributeDefinitions,
  listCategories,
  type AttributeDefinition,
  type AttributeValueType,
} from "#lib/server/db/catalog.ts";
import {
  countCategoryUses,
  deleteAttributeAssignment,
  deleteAttributeDefinition,
  deleteCategory,
  deletePartAttribute,
  insertFullAttributeDefinition,
  listAttributeAssignments,
  listAttributeUsage,
  listAttributeValueUsage,
  listStoredValues,
  setAttributeAssignment,
  setPartCategory,
  updateAttributeDefinition,
  updateCategory,
  upsertPartAttribute,
} from "#lib/server/db/taxonomy.ts";
import { typedAttributeValue } from "./catalog";
import { InventoryError, NotFoundError } from "./errors";

export const VALUE_TYPES: AttributeValueType[] = ["text", "number", "boolean"];

/** Editable fields of an attribute definition. The key never changes after creation. */
export interface AttributeFields {
  label: string;
  valueType: AttributeValueType;
  /** Rule name from src/lib/attributes.ts, or null to store the value as typed. */
  normalization: string | null;
  canonicalUnit: string | null;
}

const KEY = /^[a-z][a-z0-9_]*$/;

export type TaxonomyService = ReturnType<typeof createTaxonomyService>;

/**
 * Management of categories and attribute definitions: create, edit, and remove them, choose
 * which categories an attribute applies to, and change stored attribute values in bulk.
 */
export function createTaxonomyService(db: Database) {
  const inTransaction = <T>(fn: () => T): T => db.transaction(fn)();

  function requireAttribute(key: string): AttributeDefinition {
    const definition = getAttributeDefinition(db, key);
    if (!definition) throw new NotFoundError(`Attribute "${key}" does not exist`);
    return definition;
  }

  function requireCategory(id: number) {
    const category = getCategory(db, id);
    if (!category) throw new NotFoundError(`Category ${id} does not exist`);
    return category;
  }

  function checkFields(fields: AttributeFields) {
    if (!fields.label.trim()) throw new InventoryError("Enter a label");
    if (!VALUE_TYPES.includes(fields.valueType)) {
      throw new InventoryError(`Value type must be one of ${VALUE_TYPES.join(", ")}`);
    }
    if (fields.normalization !== null && !isNormalizationRule(fields.normalization)) {
      throw new InventoryError(`Unknown normalization rule "${fields.normalization}"`);
    }
  }

  /** Store `rawValue` on a part, typed with the definition's rule. */
  function storeValue(definition: AttributeDefinition, partId: number, rawValue: string) {
    const value = typedAttributeValue(definition, {
      key: definition.key,
      label: definition.label,
      value: rawValue,
    });
    upsertPartAttribute(db, { ...value, partId });
  }

  return {
    /**
     * Every category with its full path, the attribute keys assigned to it directly, and how
     * many parts, child categories, and BOM rows use it.
     */
    listCategories() {
      const categories = listCategories(db);
      const byId = new Map(categories.map((c) => [c.id, c]));
      const keys = new Map(listAttributeDefinitions(db).map((d) => [d.id, d.key]));
      const assigned = Map.groupBy(listAttributeAssignments(db), (a) => a.categoryId);
      return categoryOptions(categories).map(({ id, path }) => ({
        id,
        path,
        name: byId.get(id)!.name,
        parentId: byId.get(id)!.parentId,
        attributes: (assigned.get(id) ?? []).map((a) => ({
          key: keys.get(a.attributeId)!,
          required: a.required,
        })),
        ...countCategoryUses(db, id),
      }));
    },

    /** Every attribute definition with its usage and the categories it is assigned to. */
    listAttributes() {
      const usage = new Map(listAttributeUsage(db).map((u) => [u.attributeId, u]));
      const assignments = Map.groupBy(listAttributeAssignments(db), (a) => a.attributeId);
      const paths = new Map(categoryOptions(listCategories(db)).map((c) => [c.id, c.path]));
      return listAttributeDefinitions(db).map((definition) => ({
        ...definition,
        partCount: usage.get(definition.id)?.partCount ?? 0,
        constraintCount: usage.get(definition.id)?.constraintCount ?? 0,
        categories: (assignments.get(definition.id) ?? [])
          .map((a) => ({
            categoryId: a.categoryId,
            path: paths.get(a.categoryId) ?? "?",
            required: a.required,
          }))
          .sort((a, b) => a.path.localeCompare(b.path)),
      }));
    },

    /** The distinct raw values of an attribute, with their readable form and part counts. */
    listValues(key: string) {
      const definition = requireAttribute(key);
      return listAttributeValueUsage(db, definition.id).map((value) => ({
        ...value,
        display: formatAttributeValue(definition.normalization, value),
      }));
    },

    createAttribute(key: string, fields: AttributeFields): number {
      return inTransaction(() => {
        if (!KEY.test(key)) {
          throw new InventoryError(
            "A key starts with a lowercase letter and has only lowercase letters, digits, and _"
          );
        }
        checkFields(fields);
        if (getAttributeDefinition(db, key)) {
          throw new InventoryError(`Attribute "${key}" already exists`);
        }
        return insertFullAttributeDefinition(db, { key, ...fields });
      });
    },

    /**
     * Change an attribute's label, type, rule, or unit. Stored part values are typed again
     * with the new rule; a value that the new type rejects stops the change. An attribute that
     * BOM rows constrain keeps its type and rule, because the constraints use them.
     */
    updateAttribute(key: string, fields: AttributeFields): void {
      inTransaction(() => {
        const definition = requireAttribute(key);
        checkFields(fields);
        const retyped =
          definition.valueType !== fields.valueType ||
          definition.normalization !== fields.normalization ||
          definition.canonicalUnit !== fields.canonicalUnit;
        if (retyped) {
          const constraints =
            listAttributeUsage(db).find((u) => u.attributeId === definition.id)?.constraintCount ??
            0;
          if (constraints > 0) {
            throw new InventoryError(
              `${constraints} BOM row(s) constrain ${definition.label}; only its label can change`
            );
          }
        }
        updateAttributeDefinition(db, definition.id, fields);
        if (!retyped) return;
        const updated = { ...definition, ...fields };
        for (const value of listStoredValues(db, definition.id)) {
          storeValue(updated, value.partId, value.rawValue);
        }
      });
    },

    /** Remove an attribute that no part and no BOM row uses. */
    deleteAttribute(key: string): void {
      inTransaction(() => {
        const definition = requireAttribute(key);
        const usage = listAttributeUsage(db).find((u) => u.attributeId === definition.id);
        if (usage && usage.partCount + usage.constraintCount > 0) {
          throw new InventoryError(
            `${definition.label} is used by ${usage.partCount} part(s) and ` +
              `${usage.constraintCount} BOM row(s). Remove those values first.`
          );
        }
        deleteAttributeDefinition(db, definition.id);
      });
    },

    /**
     * Assign an attribute to a category (and so to its descendants), or change whether it is
     * required there. `required: null` removes the assignment.
     */
    setApplicability(key: string, categoryId: number, required: boolean | null): void {
      inTransaction(() => {
        const definition = requireAttribute(key);
        requireCategory(categoryId);
        if (required === null) deleteAttributeAssignment(db, definition.id, categoryId);
        else setAttributeAssignment(db, { attributeId: definition.id, categoryId, required });
      });
    },

    /**
     * Change every part value of an attribute whose raw text is exactly `from` to `to`, typed
     * with the attribute's rule. Returns the number of parts changed.
     */
    replaceValue(key: string, from: string, to: string): number {
      return inTransaction(() => {
        const definition = requireAttribute(key);
        if (!to.trim()) throw new InventoryError("Enter the new value");
        const values = listStoredValues(db, definition.id, from);
        for (const value of values) storeValue(definition, value.partId, to.trim());
        return values.length;
      });
    },

    /** Set or, with null, remove one attribute value of one part. */
    setPartValue(partId: number, key: string, value: string | null): void {
      inTransaction(() => {
        const definition = requireAttribute(key);
        if (!getPart(db, partId)) throw new NotFoundError(`Part ${partId} does not exist`);
        if (value === null || !value.trim()) deletePartAttribute(db, partId, definition.id);
        else storeValue(definition, partId, value.trim());
      });
    },

    /** Move a part to a category, or with null remove its category. Its attributes stay. */
    setPartCategory(partId: number, categoryId: number | null): void {
      inTransaction(() => {
        if (!getPart(db, partId)) throw new NotFoundError(`Part ${partId} does not exist`);
        if (categoryId !== null) requireCategory(categoryId);
        setPartCategory(db, partId, categoryId);
      });
    },

    /** Rename a category or move it under another parent (null for top level). */
    updateCategory(id: number, fields: { name: string; parentId: number | null }): void {
      inTransaction(() => {
        requireCategory(id);
        const name = fields.name.trim();
        if (!name) throw new InventoryError("Enter a name");
        const categories = listCategories(db);
        if (fields.parentId !== null) {
          requireCategory(fields.parentId);
          const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
          for (
            let at: number | null = fields.parentId;
            at !== null;
            at = parentOf.get(at) ?? null
          ) {
            if (at === id) throw new InventoryError("A category cannot move under itself");
          }
        }
        if (
          categories.some((c) => c.id !== id && c.parentId === fields.parentId && c.name === name)
        ) {
          throw new InventoryError(`Category "${name}" already exists there`);
        }
        updateCategory(db, id, { name, parentId: fields.parentId });
      });
    },

    /** Remove a category that no part, child category, or BOM row uses. */
    deleteCategory(id: number): void {
      inTransaction(() => {
        const category = requireCategory(id);
        const uses = countCategoryUses(db, id);
        if (uses.parts + uses.children + uses.bomLines > 0) {
          throw new InventoryError(
            `${category.name} has ${uses.parts} part(s), ${uses.children} child categories, ` +
              `and ${uses.bomLines} BOM row(s). Move them first.`
          );
        }
        deleteCategory(db, id);
      });
    },
  };
}
