import {
  parseLengthMm,
  PIECE_DISPLAY_UNITS,
  TRACKING_MODES,
  type PieceDisplayUnit,
  type TrackingMode,
} from "#lib/pieces.ts";
import { isUnit, type Unit } from "#lib/units.ts";
import { allText, optionalText, parseId, text, type FieldErrors, type ParseResult } from "./result";

export interface AttributeInput {
  /** Normalized key, such as `thread` or `head_type`. */
  key: string;
  /** The key as typed, used as the label for a new attribute. */
  label: string;
  value: string;
}

export interface SupplierPartInput {
  /** Existing supplier reference ID, or null for a new one. */
  id: number | null;
  supplier: string;
  sku: string;
  url: string | null;
  purchaseUnit: string | null;
  /** Base units in one purchase unit, or null when not known. */
  packQuantity: number | null;
  /** Length in mm of one stock piece, for a part tracked as pieces. */
  stockLengthMm?: number | null;
  /** Width in mm of one stock piece, for a 2D pieces part. */
  stockWidthMm?: number | null;
}

/** How the part's stock is tracked. Dimensions are attribute keys. */
export interface TrackingInput {
  mode: TrackingMode;
  /** The per-piece length attribute of a pieces part, such as `length`. */
  lengthKey: string | null;
  /** The per-piece width attribute of a 2D pieces part, or null. */
  widthKey: string | null;
  /** Material lost to each cut, in mm. */
  kerfMm: number;
  /** The shortest offcut worth keeping, in mm. */
  minOffcutMm: number;
  /** The size in mm that the part usually comes in, or null. Omitted: none. */
  standardLengthMm?: number | null;
  standardWidthMm?: number | null;
  /** The unit that piece sizes are shown and entered in. Omitted: mm. */
  displayUnit?: PieceDisplayUnit;
}

export interface PartInput {
  name: string;
  categoryId: number | null;
  baseUnit: Unit;
  manufacturer: string | null;
  partNumber: string | null;
  notes: string | null;
  attributes: AttributeInput[];
  aliases: string[];
  /** Optional organization labels, lower case. */
  tags: string[];
  supplierParts: SupplierPartInput[];
  /** Omitted: a new part is bulk, and an updated part keeps its tracking. */
  tracking?: TrackingInput;
}

export function normalizeAttributeKey(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, "_");
}

/**
 * Parse the part form. Repeated rows use parallel fields: `attribute_key`/`attribute_value`,
 * and `supplier_id`/`supplier_name`/`supplier_sku`/`supplier_url`/`supplier_purchase_unit`/
 * `supplier_pack_quantity`. Rows without an attribute value or supplier details are ignored, so
 * the form can offer empty rows for the category's attributes. Aliases are one per line; tags
 * are separated by commas.
 */
export function parsePartForm(form: FormData): ParseResult<PartInput> {
  const errors: FieldErrors = {};

  const name = text(form, "name");
  if (!name) errors.name = "Name is required";

  const categoryId = parseId(text(form, "category_id"));
  if (Number.isNaN(categoryId)) errors.category_id = "Choose a valid category";

  const baseUnit = text(form, "base_unit");
  if (!isUnit(baseUnit)) errors.base_unit = "Choose a unit";

  const attributeKeys = allText(form, "attribute_key");
  const attributeValues = allText(form, "attribute_value");
  const attributes: AttributeInput[] = [];
  const seenKeys = new Set<string>();
  attributeKeys.forEach((label, index) => {
    const value = attributeValues[index] ?? "";
    if (!value) return;
    const key = normalizeAttributeKey(label);
    if (!key) {
      errors.attributes = "Each attribute needs a name";
    } else if (seenKeys.has(key)) {
      errors.attributes = `Attribute "${label}" is listed more than once`;
    } else {
      seenKeys.add(key);
      attributes.push({ key, label, value });
    }
  });

  const aliases = [
    ...new Set(
      text(form, "aliases")
        .split("\n")
        .map((alias) => alias.trim())
        .filter(Boolean)
    ),
  ];

  const tags = [
    ...new Set(
      text(form, "tags")
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  const supplierIds = allText(form, "supplier_id");
  const supplierNames = allText(form, "supplier_name");
  const skus = allText(form, "supplier_sku");
  const urls = allText(form, "supplier_url");
  const purchaseUnits = allText(form, "supplier_purchase_unit");
  const packQuantities = allText(form, "supplier_pack_quantity");
  const stockLengths = allText(form, "supplier_stock_length");
  const stockWidths = allText(form, "supplier_stock_width");
  const supplierParts: SupplierPartInput[] = [];
  supplierNames.forEach((supplier, index) => {
    const sku = skus[index] ?? "";
    const url = urls[index] || null;
    const purchaseUnit = purchaseUnits[index] || null;
    const packText = packQuantities[index] ?? "";
    const lengthText = stockLengths[index] ?? "";
    const widthText = stockWidths[index] ?? "";
    if (!supplier && !sku && !url && !purchaseUnit && !packText && !lengthText && !widthText) {
      return;
    }

    const id = parseId(supplierIds[index] ?? "");
    const packQuantity = parseId(packText);
    const stockLengthMm = optionalLength(lengthText);
    const stockWidthMm = optionalLength(widthText);
    if (!supplier || !sku) {
      errors.supplier_parts = "Each supplier reference needs a supplier and a SKU";
    } else if (Number.isNaN(packQuantity)) {
      errors.supplier_parts = "Pack quantity must be a whole number greater than zero";
    } else if (Number.isNaN(stockLengthMm) || Number.isNaN(stockWidthMm)) {
      errors.supplier_parts = "Enter the stock size as a length, such as 1220 or 48 in";
    } else if (Number.isNaN(id)) {
      errors.supplier_parts = "Invalid supplier reference";
    } else {
      supplierParts.push({
        id,
        supplier,
        sku,
        url,
        purchaseUnit,
        packQuantity,
        stockLengthMm,
        stockWidthMm,
      });
    }
  });

  const tracking = parseTracking(form, errors);

  if (Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      name,
      categoryId,
      baseUnit: baseUnit as Unit,
      manufacturer: optionalText(form, "manufacturer"),
      partNumber: optionalText(form, "part_number"),
      notes: optionalText(form, "notes"),
      attributes,
      aliases,
      tags,
      supplierParts,
      ...(tracking && { tracking }),
    },
  };
}

/** A length in mm, null for empty text, or NaN for text that is not a length. */
function optionalLength(raw: string): number | null {
  if (raw === "") return null;
  return parseLengthMm(raw) ?? NaN;
}

/**
 * The tracking fields `tracking_mode`, `piece_length_key`, `piece_width_key`, `kerf`, and
 * `min_offcut`. Undefined when the form has no tracking mode, so the part keeps its tracking.
 */
function parseTracking(form: FormData, errors: FieldErrors): TrackingInput | undefined {
  const mode = text(form, "tracking_mode");
  if (!mode) return undefined;
  if (!(TRACKING_MODES as readonly string[]).includes(mode)) {
    errors.tracking_mode = "Choose how the stock is tracked";
    return undefined;
  }
  const kerfMm = optionalLength(text(form, "kerf")) ?? 0;
  if (Number.isNaN(kerfMm)) errors.kerf = "Enter the kerf as a length, such as 2 or 0.1 in";
  const minOffcutMm = optionalLength(text(form, "min_offcut")) ?? 0;
  if (Number.isNaN(minOffcutMm)) {
    errors.min_offcut = "Enter the minimum offcut as a length, such as 50 or 2 in";
  }
  const displayUnit = text(form, "piece_display_unit") || "mm";
  if (!(PIECE_DISPLAY_UNITS as readonly string[]).includes(displayUnit)) {
    errors.piece_display_unit = "Choose mm or in";
  }
  const standardLengthMm = optionalLength(text(form, "standard_length"));
  const standardWidthMm = optionalLength(text(form, "standard_width"));
  if (Number.isNaN(standardLengthMm) || Number.isNaN(standardWidthMm)) {
    errors.standard_size = "Enter the standard size as lengths, such as 2440 or 96 in";
  }
  return {
    mode: mode as TrackingMode,
    lengthKey: optionalText(form, "piece_length_key"),
    widthKey: optionalText(form, "piece_width_key"),
    kerfMm,
    minOffcutMm,
    displayUnit: displayUnit as PieceDisplayUnit,
    standardLengthMm,
    standardWidthMm,
  };
}
