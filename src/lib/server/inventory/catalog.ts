import type { Database } from "bun:sqlite";
import {
  BULK_TRACKING,
  deleteSupplierPart,
  findSupplierPart,
  getAttributeDefinition,
  getAttributeDefinitionById,
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
  type Part,
  type PartAttributeValue,
  type PartTracking,
} from "#lib/server/db/catalog.ts";
import {
  countPartMovements,
  listLocationBalances,
  listPartMovements,
} from "#lib/server/db/movements.ts";
import { countPartOrderLines } from "#lib/server/db/orders.ts";
import { countPartPieces, listPartPieces, listPieceTotals } from "#lib/server/db/pieces.ts";
import { listStorageStock } from "#lib/server/db/reservations.ts";
import {
  expandAttributes,
  filterValueOf,
  formatAttributeValue,
  isNormalizationRule,
  normalizeAttributeValue,
} from "#lib/attributes.ts";
import { applicableAttributeKeys, categoryOptions } from "#lib/categories.ts";
import type {
  AttributeInput,
  PartInput,
  SupplierPartInput,
  TrackingInput,
} from "#lib/schemas/part.ts";
import { assertUnit } from "#lib/units.ts";
import {
  listAttributesOfParts,
  listFacetDefinitions,
  listFacetValues,
  searchParts,
  type AttributeCondition,
} from "#lib/server/db/part-search.ts";
import { InventoryError, NotFoundError } from "./errors";
import { pieceDimensions } from "./pieces";

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

  /** The stock size of a SKU fits the part: only for pieces, with a width only for 2D pieces. */
  function stockSize(row: SupplierPartInput, tracking: PartTracking) {
    const size = {
      stockLengthMm: row.stockLengthMm ?? null,
      stockWidthMm: row.stockWidthMm ?? null,
    };
    const name = `${row.supplier} SKU ${row.sku}`;
    if (size.stockLengthMm === null && size.stockWidthMm === null) return size;
    if (tracking.trackingMode !== "pieces") {
      throw new InventoryError(`${name}: a stock size is only for parts tracked as pieces`);
    }
    for (const value of [size.stockLengthMm, size.stockWidthMm]) {
      if (value !== null && (!Number.isFinite(value) || value <= 0)) {
        throw new InventoryError(`${name}: the stock size must be greater than zero`);
      }
    }
    if (tracking.pieceWidthAttributeId === null) {
      if (size.stockWidthMm !== null) {
        throw new InventoryError(`${name}: these pieces have no width. Enter only the length.`);
      }
    } else if ((size.stockLengthMm === null) !== (size.stockWidthMm === null)) {
      throw new InventoryError(`${name}: enter both the length and the width of the stock size`);
    }
    return size;
  }

  function saveSupplierParts(
    partId: number,
    input: PartInput["supplierParts"],
    tracking: PartTracking
  ) {
    const existingIds = new Set(listSupplierParts(db, partId).map((row) => row.id));
    const keptIds = new Set(input.flatMap((row) => (row.id === null ? [] : [row.id])));

    for (const id of existingIds) {
      if (!keptIds.has(id)) deleteSupplierPart(db, partId, id);
    }

    for (const { id, ...row } of input) {
      const fields = { ...row, ...stockSize({ id, ...row }, tracking) };
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

  function saveDetails(partId: number, input: PartInput, tracking: PartTracking) {
    saveAttributes(partId, input.attributes);
    replacePartAliases(db, partId, input.aliases);
    replacePartTags(db, partId, input.tags);
    saveSupplierParts(partId, input.supplierParts, tracking);
  }

  function partFields(input: PartInput, tracking: PartTracking) {
    return {
      name: input.name,
      categoryId: input.categoryId,
      baseUnit: input.baseUnit,
      manufacturer: input.manufacturer,
      partNumber: input.partNumber,
      notes: input.notes,
      ...tracking,
    };
  }

  /** A piece dimension must be a numeric attribute measured in mm. */
  function dimensionDefinition(key: string): AttributeDefinition {
    const definition = getAttributeDefinition(db, key);
    if (!definition) throw new NotFoundError(`Attribute "${key}" does not exist`);
    if (definition.valueType !== "number" || definition.canonicalUnit !== "mm") {
      throw new InventoryError(
        `${definition.label} cannot be a piece dimension. Make it a number attribute in mm first.`
      );
    }
    return definition;
  }

  /** The tracking to save: the input's, or else the existing part's, or else bulk. */
  function trackingOf(input: PartInput, existing: Part | null): PartTracking {
    const tracking = input.tracking;
    if (!tracking) {
      if (!existing) return BULK_TRACKING;
      const { trackingMode, pieceLengthAttributeId, pieceWidthAttributeId, kerfMm, minOffcutMm } =
        existing;
      return { trackingMode, pieceLengthAttributeId, pieceWidthAttributeId, kerfMm, minOffcutMm };
    }
    for (const [label, value] of [
      ["Kerf", tracking.kerfMm],
      ["Minimum offcut", tracking.minOffcutMm],
    ] as const) {
      if (!Number.isFinite(value) || value < 0) {
        throw new InventoryError(`${label} must be zero or more mm`);
      }
    }
    const settings = { kerfMm: tracking.kerfMm, minOffcutMm: tracking.minOffcutMm };
    if (tracking.mode === "bulk") return { ...BULK_TRACKING, ...settings };
    return { ...pieceTracking(input, tracking), ...settings };
  }

  function pieceTracking(input: PartInput, tracking: TrackingInput) {
    if (input.baseUnit !== "pcs") {
      throw new InventoryError("A part tracked as pieces counts pieces. Use the pcs base unit.");
    }
    if (!tracking.lengthKey) {
      throw new InventoryError("Choose the attribute that is the length of each piece");
    }
    const length = dimensionDefinition(tracking.lengthKey);
    const width = tracking.widthKey ? dimensionDefinition(tracking.widthKey) : null;
    if (width?.id === length.id) {
      throw new InventoryError("The length and width of a piece must be different attributes");
    }
    return {
      trackingMode: "pieces" as const,
      pieceLengthAttributeId: length.id,
      pieceWidthAttributeId: width?.id ?? null,
    };
  }

  /** Stock already recorded must keep the tracking it was recorded with. */
  function checkTrackingChange(part: Part, tracking: PartTracking) {
    if (tracking.trackingMode !== part.trackingMode && countPartMovements(db, part.id) > 0) {
      throw new InventoryError(
        "The tracking mode cannot change after stock has been recorded. Convert the part instead."
      );
    }
    const wasFlat = part.pieceWidthAttributeId !== null;
    const isFlat = tracking.pieceWidthAttributeId !== null;
    if (wasFlat !== isFlat && countPartPieces(db, part.id) > 0) {
      throw new InventoryError(
        "A width dimension cannot be added or removed after pieces have been recorded"
      );
    }
  }

  function attributeKey(id: number | null): string | null {
    return id === null ? null : (getAttributeDefinitionById(db, id)?.key ?? null);
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
          ({ key, label, valueType, canonicalUnit, normalization }) => ({
            key,
            label,
            valueType,
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
        const tracking = trackingOf(input, null);
        const id = insertPart(db, partFields(input, tracking));
        saveDetails(id, input, tracking);
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
        const tracking = trackingOf(input, part);
        checkTrackingChange(part, tracking);
        updatePart(db, id, partFields(input, tracking));
        saveDetails(id, input, tracking);
      })();
    },

    /**
     * Merge a duplicate part into another part. Stock history, orders, BOM rows, reservations,
     * import lines, aliases, and supplier SKUs of the source move to the destination. The
     * destination keeps its own attributes and tags; those of the source are deleted.
     */
    mergePart(sourceId: number, destinationId: number): void {
      db.transaction(() => {
        if (sourceId === destinationId) {
          throw new InventoryError("A part cannot be merged into itself");
        }
        const source = requirePart(sourceId);
        const destination = requirePart(destinationId);
        if (source.trackingMode === "pieces" || destination.trackingMode === "pieces") {
          throw new InventoryError(
            "Parts tracked as pieces cannot be merged. Convert the parts to pieces instead."
          );
        }
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
        /** Dimension attributes of a part tracked as pieces, or null for a bulk part. */
        pieceDimensions: part.trackingMode === "pieces" ? pieceDimensions(db, part) : null,
        /** Pieces in stock and their totals per location. Empty for a bulk part. */
        pieces: listPartPieces(db, id),
        pieceTotals: listPieceTotals(db, id),
      };
    },

    /**
     * The input of a new part that starts as a copy of part `id`: the same name, category,
     * base unit, manufacturer, attributes, tags, and notes. Identifiers of that one part (the
     * manufacturer part number, aliases, and supplier references) are not copied. Null when
     * the part does not exist.
     */
    copyPartInput(id: number): PartInput | null {
      const part = getPart(db, id);
      if (!part) return null;
      return {
        name: part.name,
        categoryId: part.categoryId,
        baseUnit: assertUnit(part.baseUnit),
        manufacturer: part.manufacturer,
        partNumber: null,
        notes: part.notes,
        attributes: listPartAttributes(db, id).map((a) => ({
          key: a.key,
          label: a.label,
          value: a.rawValue,
        })),
        aliases: [],
        tags: listPartTags(db, id),
        supplierParts: [],
        tracking: {
          mode: part.trackingMode,
          lengthKey: attributeKey(part.pieceLengthAttributeId),
          widthKey: attributeKey(part.pieceWidthAttributeId),
          kerfMm: part.kerfMm,
          minOffcutMm: part.minOffcutMm,
        },
      };
    },

    /** True when the part has stock history, so its base unit cannot change. */
    hasMovements(id: number): boolean {
      return countPartMovements(db, id) > 0;
    },
  };
}
