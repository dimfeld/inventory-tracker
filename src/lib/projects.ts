export const PROJECT_STATUSES = ["planned", "active", "paused", "complete", "cancelled"] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

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

/** Readable form of a requirement constraint, using the values as the owner entered them. */
export function describeConstraint(constraint: {
  label: string;
  comparison: ConstraintComparison;
  rawValue: string;
  rawMaxValue: string | null;
}): string {
  const { label, comparison, rawValue, rawMaxValue } = constraint;
  const range = comparison === "range" ? ` and ${rawMaxValue}` : "";
  return `${label} ${COMPARISON_LABELS[comparison]} ${rawValue}${range}`;
}
