import {
  isConstraintComparison,
  isProjectStatus,
  type ConstraintComparison,
  type ProjectStatus,
} from "#lib/projects.ts";
import { isUnit, type Unit } from "#lib/units.ts";
import { allText, optionalText, parseId, text, type FieldErrors, type ParseResult } from "./result";

export interface ProjectInput {
  name: string;
  status: ProjectStatus;
  notes: string | null;
  links: string[];
}

export interface ComponentInput {
  name: string;
  notes: string | null;
}

export interface ConstraintInput {
  /** Attribute definition key. */
  key: string;
  comparison: ConstraintComparison;
  value: string;
  /** Upper bound for a range. */
  maxValue: string | null;
}

export interface BomLineInput {
  description: string;
  /** Decimal amount in `unit`. */
  amount: string;
  unit: Unit;
  componentId: number | null;
  referenceDesignators: string | null;
  notes: string | null;
  /** The exact part, or null when the category, identifiers, and constraints describe it. */
  partId: number | null;
  categoryId: number | null;
  manufacturer: string | null;
  /** Manufacturer part number, alias, or supplier SKU. */
  partNumber: string | null;
  constraints: ConstraintInput[];
}

export interface ChoiceInput {
  partId: number;
  substitute: boolean;
  note: string | null;
}

const AMOUNT = /^\d+(\.\d+)?$/;

function result<T>(errors: FieldErrors, data: () => T): ParseResult<T> {
  return Object.keys(errors).length > 0
    ? { success: false, errors }
    : { success: true, data: data() };
}

/** Links are one per line. */
export function parseProjectForm(form: FormData): ParseResult<ProjectInput> {
  const errors: FieldErrors = {};
  const name = text(form, "name");
  if (!name) errors.name = "Name is required";
  const status = text(form, "status") || "planned";
  if (!isProjectStatus(status)) errors.status = "Choose a status";
  const links = text(form, "links")
    .split("\n")
    .map((link) => link.trim())
    .filter(Boolean);
  return result(errors, () => ({
    name,
    status: status as ProjectStatus,
    notes: optionalText(form, "notes"),
    links,
  }));
}

export function parseComponentForm(form: FormData): ParseResult<ComponentInput> {
  const name = text(form, "name");
  if (!name) return { success: false, errors: { name: "Name is required" } };
  return { success: true, data: { name, notes: optionalText(form, "notes") } };
}

/** An optional ID field. Returns NaN for an invalid value. */
function optionalId(form: FormData, name: string): number | null {
  return parseId(text(form, name));
}

/**
 * Parse the BOM line form. `mode` is `exact` (a catalog part in `part_id`) or `constraints`
 * (`category_id`, `manufacturer`, `part_number`). Constraint rows use parallel fields
 * `constraint_key`/`constraint_comparison`/`constraint_value`/`constraint_max`; rows without a
 * value are ignored. Constraints apply in both modes.
 */
export function parseBomLineForm(form: FormData): ParseResult<BomLineInput> {
  const errors: FieldErrors = {};

  const description = text(form, "description");
  if (!description) errors.description = "Description is required";

  const amount = text(form, "amount");
  if (!AMOUNT.test(amount)) errors.amount = "Enter a quantity";

  const unit = text(form, "unit");
  if (!isUnit(unit)) errors.unit = "Choose a unit";

  const componentId = optionalId(form, "component_id");
  if (Number.isNaN(componentId)) errors.component_id = "Choose a valid component";

  const exact = text(form, "mode") === "exact";
  const partId = exact ? optionalId(form, "part_id") : null;
  if (exact && (partId === null || Number.isNaN(partId))) errors.part_id = "Choose a part";
  const categoryId = exact ? null : optionalId(form, "category_id");
  if (Number.isNaN(categoryId)) errors.category_id = "Choose a valid category";

  const keys = allText(form, "constraint_key");
  const comparisons = allText(form, "constraint_comparison");
  const values = allText(form, "constraint_value");
  const maxValues = allText(form, "constraint_max");
  const constraints: ConstraintInput[] = [];
  const seen = new Set<string>();
  keys.forEach((key, index) => {
    const value = values[index] ?? "";
    if (!value) return;
    const comparison = comparisons[index] || "equal";
    const maxValue = maxValues[index] || null;
    if (!key) {
      errors.constraints = "Choose an attribute for each constraint";
    } else if (seen.has(key)) {
      errors.constraints = `Attribute "${key}" is listed more than once`;
    } else if (!isConstraintComparison(comparison)) {
      errors.constraints = "Choose a comparison";
    } else if (comparison === "range" && !maxValue) {
      errors.constraints = "A range needs an upper value";
    } else {
      seen.add(key);
      constraints.push({
        key,
        comparison,
        value,
        maxValue: comparison === "range" ? maxValue : null,
      });
    }
  });

  return result(errors, () => ({
    description,
    amount,
    unit: unit as Unit,
    componentId,
    referenceDesignators: optionalText(form, "reference_designators"),
    notes: optionalText(form, "notes"),
    partId,
    categoryId,
    manufacturer: exact ? null : optionalText(form, "manufacturer"),
    partNumber: exact ? null : optionalText(form, "part_number"),
    constraints,
  }));
}

export function parseChoiceForm(form: FormData): ParseResult<ChoiceInput> {
  const partId = optionalId(form, "part_id");
  if (partId === null || Number.isNaN(partId)) {
    return { success: false, errors: { part_id: "Choose a part" } };
  }
  return {
    success: true,
    data: {
      partId,
      substitute: text(form, "substitute") === "on",
      note: optionalText(form, "note"),
    },
  };
}
