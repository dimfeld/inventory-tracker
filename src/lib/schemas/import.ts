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
import * as z from "zod";
import { formId, formText, optionalFormText } from "./form";
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

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  const placedOn = optionalText(form, "placed_on");
  if (placedOn !== null && !DATE.test(placedOn)) errors.placed_on = "Enter a date as YYYY-MM-DD";
  return result(errors, () => ({
    supplier: optionalText(form, "supplier"),
    reference: optionalText(form, "reference"),
    placedOn,
    projectId,
    projectName: optionalText(form, "project_name"),
    notes: optionalText(form, "notes"),
  }));
}

/** What a submission of the review line form does. */
export const LINE_INTENTS = ["save", "remove", "cleanup", "split"] as const;
export type LineIntent = (typeof LINE_INTENTS)[number];

/**
 * The review line form. `id` is the line ID and `intent` the pressed button; `choosePart` saves
 * the line with that existing part, and `splitNotes` guides a split. Attribute rows without a key or value are ignored.
 * `resolution` is existing, new, requirement, or empty; `partId` applies to existing.
 */
export const lineFormSchema = z
  .object({
    id: z.number().int(),
    importId: z.number().int(),
    intent: z.enum(LINE_INTENTS).optional(),
    choosePart: formId("Choose a valid part"),
    splitNotes: optionalFormText,
    description: formText,
    quantity: optionalFormText,
    unit: optionalFormText,
    purchaseUnit: optionalFormText,
    packQuantity: optionalFormText,
    unitPrice: optionalFormText,
    currency: optionalFormText.transform((value) => value?.toUpperCase() ?? null),
    referenceDesignators: optionalFormText,
    categoryId: formId("Choose a valid category"),
    manufacturer: optionalFormText,
    partNumber: optionalFormText,
    supplierSku: optionalFormText,
    notes: optionalFormText,
    attributes: z.array(z.object({ key: formText, value: formText })).optional(),
    groupId: formId("Choose a valid group"),
    resolution: formText.pipe(z.enum([...RESOLUTIONS, ""], { error: "Choose how to commit" })),
    partId: formId("Choose a valid part"),
  })
  .transform((input, ctx) => {
    const attributes: ImportAttribute[] = [];
    for (const { key, value } of input.attributes ?? []) {
      if (!key || !value) continue;
      if (attributes.some((a) => a.key === key)) {
        ctx.addIssue({
          code: "custom",
          path: ["attributes"],
          message: `Attribute "${key}" is listed more than once`,
        });
        return z.NEVER;
      }
      attributes.push({ key, value });
    }
    const edit: LineEditInput = {
      fields: {
        description: input.description,
        quantity: input.quantity,
        unit: input.unit,
        purchaseUnit: input.purchaseUnit,
        packQuantity: input.packQuantity,
        unitPrice: input.unitPrice,
        currency: input.currency,
        referenceDesignators: input.referenceDesignators,
        categoryId: input.categoryId,
        manufacturer: input.manufacturer,
        partNumber: input.partNumber,
        supplierSku: input.supplierSku,
        notes: input.notes,
        attributes,
      },
      groupId: input.groupId,
      resolution: input.resolution || null,
      partId: input.partId,
    };
    return {
      lineId: input.id,
      importId: input.importId,
      intent: input.intent ?? ("save" as LineIntent),
      splitNotes: input.splitNotes,
      // A chosen candidate saves the line as that existing part.
      edit:
        input.choosePart === null
          ? edit
          : { ...edit, resolution: "existing" as const, partId: input.choosePart },
    };
  });
