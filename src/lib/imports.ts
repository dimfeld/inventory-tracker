/** Shared types and labels of order and BOM imports. */

export const IMPORT_KINDS = ["order", "project"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

export const KIND_LABELS: Record<ImportKind, string> = {
  order: "Order list",
  project: "Project BOM",
};

export const SOURCE_TYPES = ["text", "csv"] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type ParseState = "draft" | "parsing" | "parsed" | "failed";
export type CommitState = "open" | "committed";

/**
 * Where a proposed value came from: stated in the source, converted from a stated value (such
 * as a unit symbol or a pack size into base units), or inferred from context.
 */
export const PROVENANCES = ["source", "normalized", "inferred"] as const;
export type Provenance = (typeof PROVENANCES)[number];

export const PROVENANCE_LABELS: Record<Provenance, string> = {
  source: "source-stated",
  normalized: "normalized",
  inferred: "inferred",
};

/** How a line is committed. `requirement` is for BOM lines only. */
export const RESOLUTIONS = ["existing", "new", "requirement"] as const;
export type Resolution = (typeof RESOLUTIONS)[number];

export interface ImportAttribute {
  key: string;
  value: string;
}

/**
 * The editable fields of an import line. Quantities are text so that a wrong value can be
 * shown and corrected; they are validated before the commit. Null means absent.
 */
export interface ImportLineFields {
  description: string;
  /** Orders: whole number of purchase units. BOMs: decimal amount of `unit`. */
  quantity: string | null;
  /** BOMs: unit code of the quantity. Orders: base unit of the part. */
  unit: string | null;
  /** Orders: how the supplier sells it, such as pack or each. */
  purchaseUnit: string | null;
  /** Orders: base units in one purchase unit. Never assumed. */
  packQuantity: string | null;
  unitPrice: string | null;
  currency: string | null;
  referenceDesignators: string | null;
  categoryId: number | null;
  manufacturer: string | null;
  /** Manufacturer part number. */
  partNumber: string | null;
  supplierSku: string | null;
  notes: string | null;
  attributes: ImportAttribute[];
}

/** Fields that carry a provenance mark. Attributes are marked by key as `attribute:<key>`. */
export type MarkedField = Exclude<keyof ImportLineFields, "attributes">;

export type ProvenanceMarks = Record<string, Provenance>;

/** A line as extracted and normalized, before the owner's corrections. */
export interface LineProposal {
  fields: ImportLineFields;
  provenance: ProvenanceMarks;
  /** Fields the source leaves unclear or incomplete. */
  unresolved: string[];
  /** The explicit source group, or null for an ungrouped row. */
  groupName: string | null;
}

/** Order or project details of an import. Fields of the other kind stay null. */
export interface ImportHeader {
  supplier: string | null;
  reference: string | null;
  /** An existing project to add the BOM to, or null to create `projectName`. */
  projectId: number | null;
  projectName: string | null;
  notes: string | null;
}

export const EMPTY_HEADER: ImportHeader = {
  supplier: null,
  reference: null,
  projectId: null,
  projectName: null,
  notes: null,
};

export function emptyLineFields(description = ""): ImportLineFields {
  return {
    description,
    quantity: null,
    unit: null,
    purchaseUnit: null,
    packQuantity: null,
    unitPrice: null,
    currency: null,
    referenceDesignators: null,
    categoryId: null,
    manufacturer: null,
    partNumber: null,
    supplierSku: null,
    notes: null,
    attributes: [],
  };
}

/** Roles the owner can give CSV columns. Several columns can form the description. */
export const COLUMN_ROLES = [
  "ignore",
  "description",
  "quantity",
  "unit",
  "purchase_unit",
  "pack_quantity",
  "unit_price",
  "manufacturer",
  "part_number",
  "supplier_sku",
  "reference_designators",
  "group",
  "notes",
] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];

export const COLUMN_ROLE_LABELS: Record<ColumnRole, string> = {
  ignore: "Ignore",
  description: "Description",
  quantity: "Quantity",
  unit: "Unit",
  purchase_unit: "Purchase unit",
  pack_quantity: "Pack size",
  unit_price: "Unit price",
  manufacturer: "Manufacturer",
  part_number: "Manufacturer part number",
  supplier_sku: "Supplier SKU",
  reference_designators: "Reference designators",
  group: "Component group",
  notes: "Notes",
};

export function isColumnRole(value: string): value is ColumnRole {
  return (COLUMN_ROLES as readonly string[]).includes(value);
}

export interface CsvSettings {
  hasHeader: boolean;
  /** Role of each column by index. */
  roles: ColumnRole[];
}
