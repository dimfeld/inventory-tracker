import {
  IMPORT_KINDS,
  isColumnRole,
  RESOLUTIONS,
  SOURCE_TYPES,
  type CsvSettings,
  type ImportAttribute,
  type ImportHeader,
  type ImportKind,
  type ImportLineFields,
  type Resolution,
  type SourceType,
} from "#lib/imports.ts";
import { allText, optionalText, parseId, text, type FieldErrors, type ParseResult } from "./result";

export interface NewImportInput {
  kind: ImportKind;
  sourceType: SourceType;
  sourceText: string;
}

/** A line edit as the review form sends it. Quantities are checked before the commit. */
export interface LineEditInput {
  fields: ImportLineFields;
  groupId: number | null;
  resolution: Resolution | null;
  partId: number | null;
}

function result<T>(errors: FieldErrors, data: () => T): ParseResult<T> {
  return Object.keys(errors).length > 0
    ? { success: false, errors }
    : { success: true, data: data() };
}

const oneOf = <T extends string>(values: readonly T[], value: string): value is T =>
  (values as readonly string[]).includes(value);

export function parseNewImportForm(form: FormData): ParseResult<NewImportInput> {
  const errors: FieldErrors = {};
  const kind = text(form, "kind");
  if (!oneOf(IMPORT_KINDS, kind)) errors.kind = "Choose an order list or a project BOM";
  const sourceType = text(form, "source_type");
  if (!oneOf(SOURCE_TYPES, sourceType)) errors.source_type = "Choose text or CSV";
  const sourceText = text(form, "source_text");
  if (!sourceText) errors.source_text = "Paste the source";
  return result(errors, () => ({
    kind: kind as ImportKind,
    sourceType: sourceType as SourceType,
    sourceText,
  }));
}

export function parseSourceForm(form: FormData): ParseResult<string> {
  const sourceText = text(form, "source_text");
  return sourceText
    ? { success: true, data: sourceText }
    : { success: false, errors: { source_text: "The source cannot be empty" } };
}

/** Column roles are parallel `role` fields, one per column. */
export function parseCsvSettingsForm(form: FormData): ParseResult<CsvSettings> {
  const roles = allText(form, "role");
  if (!roles.every(isColumnRole)) {
    return { success: false, errors: { role: "Choose a role for each column" } };
  }
  return { success: true, data: { hasHeader: text(form, "has_header") === "on", roles } };
}

export function parseHeaderForm(form: FormData): ParseResult<ImportHeader> {
  const errors: FieldErrors = {};
  const projectId = parseId(text(form, "project_id"));
  if (Number.isNaN(projectId)) errors.project_id = "Choose a valid project";
  return result(errors, () => ({
    supplier: optionalText(form, "supplier"),
    reference: optionalText(form, "reference"),
    projectId,
    projectName: optionalText(form, "project_name"),
    notes: optionalText(form, "notes"),
  }));
}

/**
 * Parse a review line form. Attribute rows use parallel `attribute_key`/`attribute_value`
 * fields; rows without a key or value are ignored. `resolution` is existing, new, requirement,
 * or empty; `part_id` applies to existing.
 */
export function parseLineForm(form: FormData): ParseResult<LineEditInput> {
  const errors: FieldErrors = {};
  const categoryId = parseId(text(form, "category_id"));
  if (Number.isNaN(categoryId)) errors.category_id = "Choose a valid category";
  const groupId = parseId(text(form, "group_id"));
  if (Number.isNaN(groupId)) errors.group_id = "Choose a valid group";
  const resolution = text(form, "resolution");
  if (resolution && !oneOf(RESOLUTIONS, resolution)) errors.resolution = "Choose how to commit";
  const partId = parseId(text(form, "part_id"));
  if (Number.isNaN(partId)) errors.part_id = "Choose a valid part";

  const values = allText(form, "attribute_value");
  const attributes: ImportAttribute[] = [];
  allText(form, "attribute_key").forEach((key, index) => {
    const value = values[index] ?? "";
    if (!key || !value) return;
    if (attributes.some((a) => a.key === key)) {
      errors.attributes = `Attribute "${key}" is listed more than once`;
    } else {
      attributes.push({ key, value });
    }
  });

  return result(errors, () => ({
    fields: {
      description: text(form, "description"),
      quantity: optionalText(form, "quantity"),
      unit: optionalText(form, "unit"),
      purchaseUnit: optionalText(form, "purchase_unit"),
      packQuantity: optionalText(form, "pack_quantity"),
      unitPrice: optionalText(form, "unit_price"),
      currency: optionalText(form, "currency")?.toUpperCase() ?? null,
      referenceDesignators: optionalText(form, "reference_designators"),
      categoryId,
      manufacturer: optionalText(form, "manufacturer"),
      partNumber: optionalText(form, "part_number"),
      supplierSku: optionalText(form, "supplier_sku"),
      notes: optionalText(form, "notes"),
      attributes,
    },
    groupId,
    resolution: (resolution || null) as Resolution | null,
    partId,
  }));
}
