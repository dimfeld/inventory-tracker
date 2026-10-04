/**
 * Structured output schemas for import extraction. Order and project schemas are separate and
 * share the part schema. A schema checks the shape of the answer, not whether it is true; the
 * normalization step and the owner's review check the values.
 */
import * as z from "zod";
import { PROVENANCES } from "#lib/imports.ts";

/** Increase when a schema changes shape. Saved with each parsed import. */
export const SCHEMA_VERSION = "1";

const provenance = z
  .enum(PROVENANCES)
  .describe(
    "source: stated in the source. normalized: converted from a stated value. inferred: not stated, deduced from context."
  );

/** A text value with its provenance, or null when the source does not give it. */
const marked = (description: string) =>
  z.object({ value: z.string(), provenance }).nullable().describe(description);

const evidence = z
  .object({
    row: z.number().int().nullable().describe("Source row number, or null if not row-based"),
    excerpt: z.string().describe("The exact source text this item comes from"),
  })
  .describe("Where the item is in the source");

const attribute = z.object({
  key: z.string().describe("An attribute key from the attribute definitions"),
  value: z.string().describe("The value as written in the source, such as 4k7 or M3x8"),
  provenance,
});

/** Part identity fields shared by order lines and BOM rows. */
const partFields = {
  description: z.string().describe("The item as described in the source"),
  category: marked("A category path from the category definitions"),
  manufacturer: marked("Manufacturer name"),
  partNumber: marked("Manufacturer part number"),
  supplierSku: marked("Supplier's own product code or SKU"),
  attributes: z.array(attribute).describe("Typed attributes that the source states or implies"),
  evidence,
  unresolved: z
    .array(z.string())
    .describe(
      "Fields that are missing, unclear, or contradictory, such as 'length' or 'pack size'"
    ),
  notes: marked("Other relevant remarks from the source"),
};

export const orderLineSchema = z.object({
  ...partFields,
  purchaseQuantity: z
    .object({ value: z.number().int(), provenance })
    .nullable()
    .describe("How many purchase units were ordered"),
  purchaseUnit: marked("How the supplier sells the item: each, pack, bag, reel, m, ..."),
  packQuantity: z
    .object({ value: z.number().int(), provenance })
    .nullable()
    .describe("Base units in one purchase unit; null unless the source states the pack size"),
  baseUnit: marked("Unit the item is counted in: pcs, mm, m, g, mL, ..."),
  unitPrice: marked("Price of one purchase unit as a decimal number without currency symbol"),
  currency: marked("ISO currency code, such as USD"),
});

export const orderOutputSchema = z.object({
  supplier: marked("Supplier or shop name"),
  reference: marked("The supplier's order number"),
  lines: z.array(orderLineSchema),
});

export const projectLineSchema = z.object({
  ...partFields,
  quantity: marked("Required amount as a decimal number"),
  unit: marked("Unit of the quantity: pcs, mm, m, g, mL, ..."),
  referenceDesignators: marked("Reference designators, such as R1, R2"),
  group: marked(
    "Name of the explicit source heading or component column value this row belongs to; null for ungrouped rows"
  ),
});

export const projectOutputSchema = z.object({
  projectName: marked("Project name, if the source states one"),
  groups: z
    .array(
      z.object({
        name: z.string().describe("The heading or component name as written"),
        evidence,
      })
    )
    .describe("Explicit headings or component column values. Empty for a flat BOM."),
  lines: z.array(projectLineSchema),
});

export type MarkedValue = z.infer<ReturnType<typeof marked>>;
export type OrderOutput = z.infer<typeof orderOutputSchema>;
export type OrderLineOutput = z.infer<typeof orderLineSchema>;
export type ProjectOutput = z.infer<typeof projectOutputSchema>;
export type ProjectLineOutput = z.infer<typeof projectLineSchema>;
export type PartOutput = Pick<OrderLineOutput, keyof typeof partFields>;

export const OUTPUT_SCHEMAS = {
  order: orderOutputSchema,
  project: projectOutputSchema,
} as const;
