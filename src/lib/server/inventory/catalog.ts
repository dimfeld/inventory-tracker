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
  listCategories,
  listPartAliases,
  listParts,
  listPartAttributes,
  listSupplierParts,
  replacePartAliases,
  replacePartAttributes,
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
import type { AttributeInput, PartInput } from "#lib/schemas/part.ts";
import { InventoryError, NotFoundError } from "./errors";

export type CatalogService = ReturnType<typeof createCatalogService>;

const BOOLEAN_VALUES: Record<string, boolean> = { yes: true, true: true, no: false, false: false };

/** Convert attribute text to the typed value its definition expects. Keeps the raw text. */
function typedValue(definition: AttributeDefinition, input: AttributeInput): PartAttributeValue {
  const value: PartAttributeValue = {
    attributeId: definition.id,
    rawValue: input.value,
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
  };
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
    const values = attributes.map((attribute) => {
      const definition =
        getAttributeDefinition(db, attribute.key) ??
        insertAttributeDefinition(db, {
          key: attribute.key,
          label: attribute.label,
          valueType: "text",
        });
      return typedValue(definition, attribute);
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
      const other = findSupplierPart(db, fields.supplier, fields.sku);
      if (other && other.id !== id) {
        throw new InventoryError(
          `${fields.supplier} SKU ${fields.sku} already belongs to ${
            other.partId === partId ? "this part" : `part ${other.partId}`
          }`
        );
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

  return {
    listCategories: () => listCategories(db),

    listParts: (options: { includeArchived: boolean }) => listParts(db, options),

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
        if (part.baseUnit !== input.baseUnit && countPartMovements(db, id) > 0) {
          throw new InventoryError(
            "The base unit cannot change after stock has been recorded, because existing quantities use it"
          );
        }
        updatePart(db, id, partFields(input));
        saveDetails(id, input);
      })();
    },

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
        supplierParts: listSupplierParts(db, id),
        balances: listLocationBalances(db, id),
        movements: listPartMovements(db, id),
      };
    },

    /** True when the part has stock history, so its base unit cannot change. */
    hasMovements(id: number): boolean {
      return countPartMovements(db, id) > 0;
    },
  };
}
