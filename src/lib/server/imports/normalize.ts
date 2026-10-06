/**
 * Normalization of validated extraction output into editable line proposals.
 *
 * Units become unit codes, categories become category IDs, and attribute values are checked
 * with their normalization rules. Values are converted only by exact rules: a purchase unit of
 * "each" holds one piece, and a purchase unit that is itself a measurement unit (such as m)
 * converts to the base unit. Any other pack size must come from the source. Anything that
 * cannot be read stays visible as an unresolved field for the owner.
 */
import { expandAttributes, isNormalizationRule, normalizeAttributeValue } from "#lib/attributes.ts";
import {
  emptyLineFields,
  type ImportAttribute,
  type ImportLineFields,
  type ImportHeader,
  type ImportKind,
  type LineProposal,
  type ProvenanceMarks,
} from "#lib/imports.ts";
import { isUnit, toBaseQuantity, UnitError, UNITS, type Unit } from "#lib/units.ts";
import type { CatalogContext } from "./context";
import type {
  LineCleanupOutput,
  MarkedValue,
  OrderLineOutput,
  OrderOutput,
  PartOutput,
  ProjectLineOutput,
  ProjectOutput,
} from "./schema";

export interface NormalizedGroup {
  name: string;
  sourceRow: number | null;
  sourceExcerpt: string | null;
}

export interface NormalizedLine {
  sourceRow: number | null;
  sourceExcerpt: string | null;
  proposal: LineProposal;
}

export interface NormalizedImport {
  header: Partial<ImportHeader>;
  headerProvenance: ProvenanceMarks;
  groups: NormalizedGroup[];
  lines: NormalizedLine[];
}

const COUNT_WORDS = new Set(["each", "ea", "pc", "pcs", "piece", "pieces"]);
const UNIT_WORDS: Record<string, Unit> = { ml: "mL", l: "L" };
const DECIMAL = /^\d+(\.\d+)?$/;

/** The unit code for a unit as written, or null when it is not a known unit. */
export function normalizeUnit(raw: string): Unit | null {
  const text = raw.trim();
  if (isUnit(text)) return text;
  const lower = text.toLowerCase().replace(/\.$/, "");
  if (COUNT_WORDS.has(lower)) return "pcs";
  if (isUnit(lower)) return lower;
  return UNIT_WORDS[lower] ?? null;
}

/** Base units in one purchase unit that is itself a measurement unit, such as 1 m = 1000 mm. */
function measuredPack(purchaseUnit: string | null, baseUnit: Unit | null): number | null {
  const unit = purchaseUnit === null ? null : normalizeUnit(purchaseUnit);
  if (unit === null || baseUnit === null) return null;
  if (UNITS[unit].dimension !== UNITS[baseUnit].dimension) return null;
  try {
    return toBaseQuantity("1", unit, baseUnit);
  } catch (error) {
    if (error instanceof UnitError) return null;
    throw error;
  }
}

const isCountPurchaseUnit = (raw: string) => COUNT_WORDS.has(raw.trim().toLowerCase());

/** Notes about a missing purchase field of an order line, by field. */
const MISSING_PURCHASE_NOTES = {
  purchaseUnit: "Purchase unit is missing",
  packQuantity: "Pack size is not stated",
  unit: "Base unit is missing",
} as const;

/** Optional text fields of a line. */
type TextField = Exclude<keyof LineProposal["fields"], "attributes" | "categoryId" | "description">;

/** Collects field values, provenance marks, and unresolved notes of one line. */
class LineBuilder {
  fields = emptyLineFields();
  provenance: ProvenanceMarks = {};
  unresolved: string[] = [];

  constructor(private context: CatalogContext) {}

  /** Copy a marked text value. Returns the trimmed value or null. */
  text(field: TextField, value: MarkedValue) {
    const text = value?.value.trim() || null;
    this.fields[field] = text;
    if (text !== null && value) this.provenance[field] = value.provenance;
    return text;
  }

  /** Set a value that normalization derived from a stated one. */
  set(field: TextField, text: string) {
    this.fields[field] = text;
    this.provenance[field] = "normalized";
  }

  note(text: string) {
    if (!this.unresolved.includes(text)) this.unresolved.push(text);
  }

  /** Read a unit into its code. An unknown unit stays as written and is unresolved. */
  unit(value: MarkedValue) {
    const raw = this.text("unit", value);
    if (raw === null) return null;
    const unit = normalizeUnit(raw);
    if (unit === null) {
      this.note(`Unit "${raw}" is not a known unit`);
      return null;
    }
    if (unit !== raw) this.set("unit", unit);
    return unit;
  }

  part(line: PartOutput) {
    this.fields.description = line.description.trim();
    this.text("manufacturer", line.manufacturer);
    this.text("partNumber", line.partNumber);
    this.text("supplierSku", line.supplierSku);
    this.text("notes", line.notes);
    for (const note of line.unresolved) this.note(note);
    this.category(line.category);
    this.attributes(line.attributes);
    this.checkRequired();
  }

  /** Set the category from its path. An unknown path is unresolved. */
  category(value: MarkedValue) {
    const categoryPath = value?.value.trim();
    if (!categoryPath) return;
    const category = this.findCategory(categoryPath);
    if (category) {
      this.fields.categoryId = category.id;
      this.provenance.categoryId = value!.provenance;
    } else {
      this.note(`Category "${categoryPath}" is not defined`);
    }
  }

  /** Set the attributes. Unknown keys and unreadable values are unresolved. */
  attributes(list: PartOutput["attributes"]) {
    const definitions = new Map(this.context.definitions.map((d) => [d.key, d]));
    const attributes: ImportAttribute[] = [];
    for (const attribute of list) {
      const key = attribute.key.trim();
      const value = attribute.value.trim();
      if (!key || !value || attributes.some((a) => a.key === key)) continue;
      attributes.push({ key, value });
      this.provenance[`attribute:${key}`] = attribute.provenance;
      const definition = definitions.get(key);
      if (!definition) {
        this.note(`Attribute "${key}" is not defined`);
      } else if (
        isNormalizationRule(definition.normalization) &&
        !normalizeAttributeValue(definition.normalization, value)
      ) {
        this.note(`${definition.label} "${value}" is not recognized`);
      }
    }
    this.fields.attributes = attributes;
  }

  /** A generic item must state its category's required attributes, such as a screw's length. */
  checkRequired() {
    const { categoryId, partNumber, supplierSku, attributes } = this.fields;
    if (categoryId === null || partNumber !== null || supplierSku !== null) return;
    const category = this.context.categories.find((c) => c.id === categoryId);
    const present = new Set(
      expandAttributes(attributes.map((a) => ({ ...a, label: a.key }))).map((a) => a.key)
    );
    for (const key of category?.requiredKeys ?? []) {
      if (present.has(key)) continue;
      const label = this.context.definitions.find((d) => d.key === key)?.label ?? key;
      this.note(`${label} is not specified`);
    }
  }

  private findCategory(path: string) {
    const wanted = path.toLowerCase().replace(/\s*[/>]\s*/g, " / ");
    const { categories } = this.context;
    const exact = categories.find((c) => c.path.toLowerCase() === wanted);
    if (exact) return exact;
    // A unique leaf name is accepted too.
    const leaf = categories.filter((c) => c.path.toLowerCase().endsWith(` / ${wanted}`));
    return leaf.length === 1 ? leaf[0] : null;
  }

  proposal(groupName: string | null): LineProposal {
    return {
      fields: this.fields,
      provenance: this.provenance,
      unresolved: this.unresolved,
      groupName,
    };
  }
}

function orderLine(context: CatalogContext, line: OrderLineOutput): LineProposal {
  const b = new LineBuilder(context);
  b.part(line);

  const purchase = line.purchaseQuantity;
  if (purchase && purchase.value > 0) {
    b.fields.quantity = String(purchase.value);
    b.provenance.quantity = purchase.provenance;
  } else {
    b.note("Quantity ordered is missing");
  }

  let baseUnit = b.unit(line.baseUnit);
  const purchaseUnit = b.text("purchaseUnit", line.purchaseUnit);
  const pack = line.packQuantity;
  if (pack && pack.value > 0) {
    b.fields.packQuantity = String(pack.value);
    b.provenance.packQuantity = pack.provenance;
  } else if (purchaseUnit !== null && isCountPurchaseUnit(purchaseUnit)) {
    // One piece per piece is a definition, not an assumed pack size.
    if (purchaseUnit !== "each") b.set("purchaseUnit", "each");
    if (baseUnit === null && b.fields.unit === null) {
      baseUnit = "pcs";
      b.set("unit", "pcs");
    }
    if (baseUnit === "pcs") b.set("packQuantity", "1");
    else b.note(MISSING_PURCHASE_NOTES.packQuantity);
  } else {
    const measured = measuredPack(purchaseUnit, baseUnit);
    if (measured !== null) b.set("packQuantity", String(measured));
    else b.note(MISSING_PURCHASE_NOTES.packQuantity);
  }
  if (purchaseUnit === null) b.note(MISSING_PURCHASE_NOTES.purchaseUnit);
  if (baseUnit === null && b.fields.unit === null) b.note(MISSING_PURCHASE_NOTES.unit);

  const price = b.text("unitPrice", line.unitPrice);
  if (price !== null && !DECIMAL.test(price)) b.note(`Price "${price}" is not a number`);
  const currency = b.text("currency", line.currency);
  if (currency !== null && currency !== currency.toUpperCase()) {
    b.set("currency", currency.toUpperCase());
  }
  return b.proposal(null);
}

function projectLine(context: CatalogContext, line: ProjectLineOutput): LineProposal {
  const b = new LineBuilder(context);
  b.part(line);
  const quantity = b.text("quantity", line.quantity);
  if (quantity === null) b.note("Quantity is missing");
  else if (!DECIMAL.test(quantity)) b.note(`Quantity "${quantity}" is not a number`);
  if (b.unit(line.unit) === null && b.fields.unit === null) b.note("Unit is missing");
  b.text("referenceDesignators", line.referenceDesignators);
  return b.proposal(line.group?.value.trim() || null);
}

/**
 * Apply a cleanup to a line's current fields. The description, category, and attributes are
 * replaced. The purchase unit, pack size, and base unit change only when the cleanup gives a
 * value. Other fields stay. Earlier provenance marks and unresolved notes of other fields stay
 * too, except notes about a purchase field that now has a value.
 */
export function cleanupLine(
  context: CatalogContext,
  current: { fields: ImportLineFields; proposal: LineProposal | null },
  output: LineCleanupOutput
): LineProposal {
  const b = new LineBuilder(context);
  b.fields = { ...current.fields, categoryId: null, attributes: [] };
  b.provenance = Object.fromEntries(
    Object.entries(current.proposal?.provenance ?? {}).filter(
      ([field]) => field !== "categoryId" && !field.startsWith("attribute:")
    )
  );
  for (const note of current.proposal?.unresolved ?? []) b.note(note);

  const description = output.description.trim();
  if (description && description !== current.fields.description) {
    b.fields.description = description;
    b.provenance.description = "normalized";
  }
  for (const note of output.unresolved) b.note(note);
  b.category(output.category);
  b.attributes(output.attributes);
  b.checkRequired();

  if (output.purchaseUnit?.value.trim()) b.text("purchaseUnit", output.purchaseUnit);
  if (output.baseUnit?.value.trim()) b.unit(output.baseUnit);
  if (output.packQuantity && output.packQuantity.value > 0) {
    b.fields.packQuantity = String(output.packQuantity.value);
    b.provenance.packQuantity = output.packQuantity.provenance;
  }
  const filled = Object.entries(MISSING_PURCHASE_NOTES)
    .filter(([field]) => b.fields[field as keyof typeof MISSING_PURCHASE_NOTES] !== null)
    .map(([, note]) => note as string);
  b.unresolved = b.unresolved.filter((note) => !filled.includes(note));
  return b.proposal(current.proposal?.groupName ?? null);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function markHeader(
  header: Partial<ImportHeader>,
  provenance: ProvenanceMarks,
  field: "supplier" | "reference" | "placedOn" | "projectName",
  value: MarkedValue
) {
  const text = value?.value.trim() || null;
  header[field] = text;
  if (text !== null && value) provenance[field] = value.provenance;
}

function evidenceOf(evidence: { row: number | null; excerpt: string }) {
  return { sourceRow: evidence.row, sourceExcerpt: evidence.excerpt.trim() || null };
}

export function normalizeOrder(context: CatalogContext, output: OrderOutput): NormalizedImport {
  const header: Partial<ImportHeader> = {};
  const headerProvenance: ProvenanceMarks = {};
  markHeader(header, headerProvenance, "supplier", output.supplier);
  markHeader(header, headerProvenance, "reference", output.reference);
  // Only a real calendar date can become the placed date; the owner can enter it in review.
  if (DATE.test(output.placedOn?.value.trim() ?? "")) {
    markHeader(header, headerProvenance, "placedOn", output.placedOn);
  }
  return {
    header,
    headerProvenance,
    groups: [],
    lines: output.lines.map((line) => ({
      ...evidenceOf(line.evidence),
      proposal: orderLine(context, line),
    })),
  };
}

/**
 * Project groups come only from the explicit groups of the output. A row naming a group that
 * is not in the list adds it, with the row as evidence. Rows without a group stay ungrouped.
 */
export function normalizeProject(context: CatalogContext, output: ProjectOutput): NormalizedImport {
  const header: Partial<ImportHeader> = {};
  const headerProvenance: ProvenanceMarks = {};
  markHeader(header, headerProvenance, "projectName", output.projectName);

  const groups: NormalizedGroup[] = [];
  const addGroup = (name: string, evidence: { row: number | null; excerpt: string }) => {
    if (!groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
      groups.push({ name, ...evidenceOf(evidence) });
    }
  };
  for (const group of output.groups) {
    if (group.name.trim()) addGroup(group.name.trim(), group.evidence);
  }

  const lines = output.lines.map((line) => {
    const proposal = projectLine(context, line);
    if (proposal.groupName) addGroup(proposal.groupName, line.evidence);
    return { ...evidenceOf(line.evidence), proposal };
  });
  return { header, headerProvenance, groups, lines };
}

export function normalizeOutput(
  kind: ImportKind,
  context: CatalogContext,
  output: OrderOutput | ProjectOutput
): NormalizedImport {
  return kind === "order"
    ? normalizeOrder(context, output as OrderOutput)
    : normalizeProject(context, output as ProjectOutput);
}
