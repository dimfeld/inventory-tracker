import { measurementEquivalents } from "./attributes";

export const PROJECT_STATUSES = ["planned", "active", "paused", "complete", "cancelled"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Statuses in which a project may hold reservations and incoming commitments. */
export const OPEN_PROJECT_STATUSES: readonly ProjectStatus[] = ["planned", "active", "paused"];

export function isProjectStatus(value: string): value is ProjectStatus {
  return (PROJECT_STATUSES as readonly string[]).includes(value);
}

/**
 * How a requirement compares an attribute. `equal` is the default; the others are numeric and
 * apply only when the requirement explicitly permits them.
 */
export const CONSTRAINT_COMPARISONS = ["equal", "at_least", "range"] as const;

export type ConstraintComparison = (typeof CONSTRAINT_COMPARISONS)[number];

export const COMPARISON_LABELS: Record<ConstraintComparison, string> = {
  equal: "equals",
  at_least: "at least",
  range: "between",
};

export function isConstraintComparison(value: string): value is ConstraintComparison {
  return (CONSTRAINT_COMPARISONS as readonly string[]).includes(value);
}

/**
 * Readable form of a requirement constraint, using the values as the owner entered them. A
 * measurement such as a length also shows its equivalents: `1 in (25.4 mm · 1 in)`.
 */
export function describeConstraint(constraint: {
  label: string;
  normalization: string | null;
  comparison: ConstraintComparison;
  rawValue: string;
  valueNumber: number | null;
  rawMaxValue: string | null;
  maxValueNumber: number | null;
}): string {
  const { label, normalization, comparison } = constraint;
  const show = (raw: string, valueNumber: number | null) => {
    const equivalents =
      valueNumber === null ? null : measurementEquivalents(normalization, valueNumber);
    return equivalents ? `${raw} (${equivalents})` : raw;
  };
  const value = show(constraint.rawValue, constraint.valueNumber);
  const range =
    comparison === "range"
      ? ` and ${show(constraint.rawMaxValue ?? "", constraint.maxValueNumber)}`
      : "";
  return `${label} ${COMPARISON_LABELS[comparison]} ${value}${range}`;
}
