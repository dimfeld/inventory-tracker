/**
 * Deterministic candidate matching for BOM requirements.
 *
 * Candidates are found in this order: the exact part the requirement names or its
 * manufacturer part number, a known alias or supplier SKU, parts in the requirement's category
 * (checked against its typed constraints), then parts the owner approved for the requirement.
 * How a candidate was found is not proof that it fits: every candidate is checked against
 * every supplied unit, identifier, category, and constraint. Unknown values are unresolved,
 * never matches. Numeric minimums and ranges apply only when the constraint says so.
 */
import type { Database } from "bun:sqlite";
import { formatAttributeValue } from "#lib/attributes.ts";
import { formatPieceSize } from "#lib/pieces.ts";
import { isUnit, UNITS } from "#lib/units.ts";
import {
  categoryScope,
  findPartsByAlias,
  findPartsByPartNumber,
  findPartsBySupplierSku,
  getCandidateParts,
  listCandidateAttributes,
  listPartIdentifiers,
  listPartsInCategories,
  listRequiredAttributes,
  type CandidateAttribute,
  type CandidatePart,
  type RequiredAttribute,
} from "#lib/server/db/candidates.ts";
import {
  listChoices,
  listConstraints,
  type BomConstraint,
  type BomLine,
  type BomPartChoice,
} from "#lib/server/db/projects.ts";

export type CandidateSource =
  | "exact_part"
  | "part_number"
  | "alias"
  | "supplier_sku"
  | "attributes"
  | "approved";

export const SOURCE_LABELS: Record<CandidateSource, string> = {
  exact_part: "Exact part",
  part_number: "Manufacturer part number",
  alias: "Alias",
  supplier_sku: "Supplier SKU",
  attributes: "Category and attributes",
  approved: "Approved for this requirement",
};

/** `match` only when nothing conflicts and nothing is unknown. */
export type CandidateStatus = "match" | "unresolved" | "conflict";

/** A requirement constraint, with or without a stored BOM line. */
export type RequirementConstraint = Omit<BomConstraint, "bomLineId">;

export interface Requirement {
  /** Null when the unit is not known yet, such as in an import proposal. */
  unit: string | null;
  partId: number | null;
  categoryName: string | null;
  /** The requirement's category and its descendants, or null without a category. */
  categoryScope: number[] | null;
  manufacturer: string | null;
  partNumber: string | null;
  constraints: RequirementConstraint[];
  /**
   * Size of each cut piece, for a part tracked as pieces. It is not a part constraint: it is
   * checked against the pieces the line reserves.
   */
  cutSize: { lengthMm: number; widthMm: number | null } | null;
  /**
   * Required attributes of the category that a generic requirement does not specify. Empty
   * when the requirement names an exact part or part number, which identifies the part.
   */
  missingRequired: RequiredAttribute[];
}

export interface PartFacts {
  part: CandidatePart;
  attributes: CandidateAttribute[];
  /** Aliases and supplier SKUs. */
  identifiers: string[];
}

export interface Evaluation {
  status: CandidateStatus;
  /** Why the candidate fits. */
  evidence: string[];
  /** Constraints that need review because a value is unknown or not specified. */
  unresolved: string[];
  conflicts: string[];
}

export interface Candidate extends Evaluation {
  part: CandidatePart;
  source: CandidateSource;
  /** The owner's approval of this part for the requirement, if any. */
  choice: BomPartChoice | null;
}

export interface MatchResult {
  requirement: Requirement;
  candidates: Candidate[];
}

function sameText(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function unitsCompatible(requirementUnit: string, baseUnit: string): boolean {
  return (
    isUnit(requirementUnit) &&
    isUnit(baseUnit) &&
    UNITS[requirementUnit].dimension === UNITS[baseUnit].dimension
  );
}

function display(
  normalization: string | null,
  value: { valueText: string | null; valueNumber: number | null; valueBoolean: boolean | null },
  raw: string
): string {
  if (value.valueBoolean !== null) return value.valueBoolean ? "yes" : "no";
  return formatAttributeValue(normalization, value) ?? raw;
}

type Check = { evidence: string } | { unresolved: string } | { conflict: string };

function checkConstraint(
  constraint: RequirementConstraint,
  value: CandidateAttribute | undefined
): Check {
  const { label, normalization } = constraint;
  const wanted = display(normalization, constraint, constraint.rawValue);
  if (!value) {
    return { unresolved: `${label} is unknown for this part; requirement needs ${wanted}` };
  }
  if (value.valueText === null && value.valueNumber === null && value.valueBoolean === null) {
    return {
      unresolved: `${label} "${value.rawValue}" is not recognized; requirement needs ${wanted}`,
    };
  }
  const actual = display(normalization, value, value.rawValue);

  switch (constraint.comparison) {
    case "equal": {
      const equal =
        constraint.valueText !== null
          ? value.valueText === constraint.valueText
          : constraint.valueNumber !== null
            ? value.valueNumber === constraint.valueNumber
            : value.valueBoolean === constraint.valueBoolean;
      return equal
        ? { evidence: `${label} is ${actual}` }
        : { conflict: `${label} is ${actual}; requirement needs ${wanted}` };
    }
    case "at_least": {
      if (value.valueNumber === null) {
        return { unresolved: `${label} is not a number; requirement needs at least ${wanted}` };
      }
      return value.valueNumber >= constraint.valueNumber!
        ? { evidence: `${label} ${actual} meets the permitted minimum of ${wanted}` }
        : { conflict: `${label} is ${actual}; requirement needs at least ${wanted}` };
    }
    case "range": {
      const max = display(
        normalization,
        { valueText: null, valueNumber: constraint.maxValueNumber, valueBoolean: null },
        constraint.rawMaxValue ?? ""
      );
      if (value.valueNumber === null) {
        return { unresolved: `${label} is not a number; requirement needs ${wanted} to ${max}` };
      }
      return value.valueNumber >= constraint.valueNumber! &&
        value.valueNumber <= constraint.maxValueNumber!
        ? { evidence: `${label} ${actual} is within the permitted range ${wanted} to ${max}` }
        : { conflict: `${label} is ${actual}; requirement needs ${wanted} to ${max}` };
    }
  }
}

/** Check one part against everything the requirement supplies. */
export function evaluateCandidate(requirement: Requirement, facts: PartFacts): Evaluation {
  const { part } = facts;
  const evidence: string[] = [];
  const unresolved: string[] = [];
  const conflicts: string[] = [];

  if (requirement.unit !== null) {
    if (unitsCompatible(requirement.unit, part.baseUnit)) {
      evidence.push(`Counted in ${part.baseUnit}, compatible with ${requirement.unit}`);
    } else {
      conflicts.push(
        `Counted in ${part.baseUnit}, which cannot convert to the requirement's ${requirement.unit}`
      );
    }
  }

  if (requirement.partId !== null) {
    if (requirement.partId === part.id) evidence.push("Exact part named by the requirement");
    else conflicts.push("Not the exact part named by the requirement");
  }

  if (requirement.manufacturer !== null) {
    if (part.manufacturer === null) {
      unresolved.push(`Manufacturer is unknown; requirement names ${requirement.manufacturer}`);
    } else if (sameText(part.manufacturer, requirement.manufacturer)) {
      evidence.push(`Manufacturer is ${part.manufacturer}`);
    } else {
      conflicts.push(
        `Manufacturer is ${part.manufacturer}; requirement names ${requirement.manufacturer}`
      );
    }
  }

  if (requirement.partNumber !== null) {
    const wanted = requirement.partNumber;
    if (part.partNumber !== null && sameText(part.partNumber, wanted)) {
      evidence.push(`Manufacturer part number is ${part.partNumber}`);
    } else if (facts.identifiers.some((identifier) => sameText(identifier, wanted))) {
      evidence.push(`Known alias or supplier SKU ${wanted}`);
    } else if (part.partNumber !== null) {
      conflicts.push(`Part number is ${part.partNumber}; requirement names ${wanted}`);
    } else {
      unresolved.push(`Part number is unknown; requirement names ${wanted}`);
    }
  }

  if (requirement.categoryScope !== null) {
    if (part.categoryId === null) {
      unresolved.push(`Part has no category; requirement is for ${requirement.categoryName}`);
    } else if (requirement.categoryScope.includes(part.categoryId)) {
      evidence.push(`In ${requirement.categoryName}`);
    } else {
      conflicts.push(
        `Category is ${part.categoryName}; requirement is for ${requirement.categoryName}`
      );
    }
  }

  // A pieces part keeps its per-piece dimensions on its pieces, not as part attributes, so
  // they are checked against the pieces the line reserves.
  const pieceDimensions = new Set(
    part.trackingMode === "pieces" ? [part.pieceLengthAttributeId, part.pieceWidthAttributeId] : []
  );
  if (requirement.cutSize !== null) {
    const size = formatPieceSize(requirement.cutSize);
    if (part.trackingMode !== "pieces") {
      conflicts.push(`Not tracked as pieces; requirement needs cut pieces of ${size}`);
    } else if (requirement.cutSize.widthMm !== null && part.pieceWidthAttributeId === null) {
      conflicts.push(`Pieces have no width; requirement needs cut pieces of ${size}`);
    } else if (requirement.cutSize.widthMm === null && part.pieceWidthAttributeId !== null) {
      unresolved.push(`Pieces have a width; requirement gives only a cut length of ${size}`);
    } else {
      evidence.push(`Tracked as pieces; cut size ${size} is checked against pieces`);
    }
  }

  const values = new Map(facts.attributes.map((a) => [a.attributeId, a]));
  for (const constraint of requirement.constraints) {
    if (pieceDimensions.has(constraint.attributeId)) {
      evidence.push(`${constraint.label} is a piece dimension, checked against pieces`);
      continue;
    }
    const result = checkConstraint(constraint, values.get(constraint.attributeId));
    if ("evidence" in result) evidence.push(result.evidence);
    if ("unresolved" in result) unresolved.push(result.unresolved);
    if ("conflict" in result) conflicts.push(result.conflict);
  }

  for (const missing of requirement.missingRequired) {
    if (pieceDimensions.has(missing.attributeId)) continue;
    unresolved.push(`Requirement does not specify ${missing.label}`);
  }

  const status: CandidateStatus =
    conflicts.length > 0 ? "conflict" : unresolved.length > 0 ? "unresolved" : "match";
  return { status, evidence, unresolved, conflicts };
}

/** The fields of a requirement that matching reads, from a BOM line or an import proposal. */
export interface RequirementSource {
  unit: string | null;
  partId: number | null;
  categoryId: number | null;
  categoryName: string | null;
  manufacturer: string | null;
  partNumber: string | null;
  cutLengthMm: number | null;
  cutWidthMm: number | null;
}

/** The requirement as the matcher sees it, with the category's required-attribute rules. */
export function requirementOf(
  db: Database,
  source: RequirementSource,
  constraints: RequirementConstraint[]
): Requirement {
  const constrained = new Set(constraints.map((c) => c.attributeId));
  const generic = source.partId === null && source.partNumber === null;
  return {
    unit: source.unit,
    partId: source.partId,
    categoryName: source.categoryName,
    categoryScope: source.categoryId === null ? null : categoryScope(db, source.categoryId),
    manufacturer: source.manufacturer,
    partNumber: source.partNumber,
    constraints,
    cutSize:
      source.cutLengthMm === null
        ? null
        : { lengthMm: source.cutLengthMm, widthMm: source.cutWidthMm },
    missingRequired:
      source.categoryId === null || !generic
        ? []
        : listRequiredAttributes(db, source.categoryId).filter(
            (required) => !constrained.has(required.attributeId)
          ),
  };
}

/** The requirement of a stored BOM line. */
export function loadRequirement(db: Database, line: BomLine): Requirement {
  return requirementOf(db, line, listConstraints(db, [line.id]));
}

function loadFacts(db: Database, parts: CandidatePart[]): PartFacts[] {
  const ids = parts.map((p) => p.id);
  const attributes = Map.groupBy(listCandidateAttributes(db, ids), (a) => a.partId);
  const identifiers = Map.groupBy(listPartIdentifiers(db, ids), (i) => i.partId);
  return parts.map((part) => ({
    part,
    attributes: attributes.get(part.id) ?? [],
    identifiers: (identifiers.get(part.id) ?? []).map((i) => i.identifier),
  }));
}

/** Evaluate one specific part for a requirement, such as a part the owner wants to approve. */
export function evaluatePart(
  db: Database,
  requirement: Requirement,
  partId: number
): (Evaluation & { part: CandidatePart }) | null {
  const [facts] = loadFacts(db, getCandidateParts(db, [partId]));
  return facts ? { part: facts.part, ...evaluateCandidate(requirement, facts) } : null;
}

const STATUS_ORDER: Record<CandidateStatus, number> = { match: 0, unresolved: 1, conflict: 2 };

export interface MatchOptions {
  /** A supplier SKU to look up in addition to the requirement's part number. */
  supplierSku?: string | null;
  /** Parts the owner approved for the requirement. */
  choices?: BomPartChoice[];
}

/**
 * Candidates for a requirement, in discovery order. Parts found only through the category are
 * listed when nothing conflicts; parts found through an identifier or an approval are always
 * listed, so the owner can see why they do or do not fit.
 */
export function matchRequirement(
  db: Database,
  requirement: Requirement,
  options: MatchOptions = {}
): Candidate[] {
  const choices = new Map((options.choices ?? []).map((c) => [c.partId, c]));
  const found = new Map<number, { part: CandidatePart; source: CandidateSource }>();
  const add = (parts: CandidatePart[], source: CandidateSource) => {
    for (const part of parts) {
      if (!found.has(part.id)) found.set(part.id, { part, source });
    }
  };

  if (requirement.partId !== null) add(getCandidateParts(db, [requirement.partId]), "exact_part");
  if (requirement.partNumber !== null) {
    add(findPartsByPartNumber(db, requirement.partNumber), "part_number");
    add(findPartsByAlias(db, requirement.partNumber), "alias");
    add(findPartsBySupplierSku(db, requirement.partNumber), "supplier_sku");
  }
  if (options.supplierSku) add(findPartsBySupplierSku(db, options.supplierSku), "supplier_sku");
  if (requirement.partId === null && requirement.categoryScope !== null) {
    add(listPartsInCategories(db, requirement.categoryScope), "attributes");
  }
  add(getCandidateParts(db, [...choices.keys()]), "approved");

  const facts = new Map(
    loadFacts(
      db,
      [...found.values()].map((f) => f.part)
    ).map((f) => [f.part.id, f])
  );
  const candidates: Candidate[] = [];
  for (const { part, source } of found.values()) {
    const evaluation = evaluateCandidate(requirement, facts.get(part.id)!);
    const choice = choices.get(part.id) ?? null;
    if (source === "attributes" && evaluation.status === "conflict" && !choice) continue;
    candidates.push({ part, source, choice, ...evaluation });
  }

  const sourceOrder = Object.keys(SOURCE_LABELS);
  candidates.sort(
    (a, b) =>
      sourceOrder.indexOf(a.source) - sourceOrder.indexOf(b.source) ||
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  );
  return candidates;
}

/** Candidates for a BOM line. */
export function findCandidates(db: Database, line: BomLine): MatchResult {
  const requirement = loadRequirement(db, line);
  return {
    requirement,
    candidates: matchRequirement(db, requirement, { choices: listChoices(db, [line.id]) }),
  };
}
