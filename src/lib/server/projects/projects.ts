import type { Database } from "bun:sqlite";
import { expandAttributes } from "#lib/attributes.ts";
import { applicableAttributeKeys, categoryOptions } from "#lib/categories.ts";
import type {
  BomLineInput,
  ChoiceInput,
  ComponentInput,
  ConstraintInput,
  ProjectInput,
} from "#lib/schemas/project.ts";
import {
  getAttributeDefinition,
  getCategory,
  getPart,
  listAttributeApplicability,
  listAttributeDefinitions,
  listCategories,
} from "#lib/server/db/catalog.ts";
import { listRequiredApplicability } from "#lib/server/db/candidates.ts";
import { searchParts } from "#lib/server/db/part-search.ts";
import {
  deleteBomLine,
  deleteChoice,
  deleteComponent,
  getBomLine,
  getComponent,
  getProject,
  insertBomLine,
  insertChoice,
  insertComponent,
  insertProject,
  listBomLines,
  listChoices,
  listComponents,
  listConstraints,
  listProjects,
  replaceConstraints,
  setBomLineComponent,
  setComponentOrder,
  ungroupComponentLines,
  updateBomLine,
  updateComponent,
  updateProject,
  type BomConstraint,
  type BomConstraintValue,
  type BomLine,
  type BomLineFields,
  type BomPartChoice,
  type Project,
  type ProjectComponent,
} from "#lib/server/db/projects.ts";
import { parseId } from "#lib/schemas/result.ts";
import { typedAttributeValue } from "#lib/server/inventory/catalog.ts";
import { InventoryError, NotFoundError } from "#lib/server/inventory/errors.ts";
import { assertUnit, toBaseQuantity } from "#lib/units.ts";
import {
  noBomAllocations,
  type BomAllocationGuard,
  type BomLineState,
  type StatusChangeResult,
} from "./allocations";
import { evaluatePart, findCandidates, loadRequirement, unitsCompatible } from "./matching";
import { summarizeBom, type BomTotal } from "./summary";

export interface ProjectServiceOptions {
  allocations?: BomAllocationGuard;
}

export interface BomLineView extends BomLine {
  constraints: BomConstraint[];
  choices: BomPartChoice[];
}

export interface BomSection {
  /** Null for the ungrouped section. */
  component: ProjectComponent | null;
  lines: BomLineView[];
  totals: BomTotal[];
}

/** Which lines to show: all, one component's, or the ungrouped ones. */
export type ComponentFilter = number | "ungrouped" | null;

/** Read a `component` URL parameter: a component ID, "ungrouped", or anything else for all. */
export function parseComponentFilter(value: string | null): ComponentFilter {
  if (value === "ungrouped") return "ungrouped";
  const id = parseId(value ?? "");
  return id === null || Number.isNaN(id) ? null : id;
}

export type ProjectService = ReturnType<typeof createProjectService>;

function projectFields(input: ProjectInput) {
  return {
    name: input.name,
    status: input.status,
    notes: input.notes,
    links: input.links.length > 0 ? input.links.join("\n") : null,
  };
}

export function linksOf(project: Project): string[] {
  return project.links ? project.links.split("\n") : [];
}

/**
 * Projects, BOM lines, component groups, and approved part choices. None of these operations
 * change physical stock. Status changes and BOM edits apply the allocation guard's rules to
 * reservations.
 */
export function createProjectService(db: Database, options: ProjectServiceOptions = {}) {
  const allocations = options.allocations ?? noBomAllocations;

  function inTransaction<T>(fn: () => T): T {
    return db.transaction(fn).immediate();
  }

  function requireProject(id: number): Project {
    const project = getProject(db, id);
    if (!project) throw new NotFoundError(`Project ${id} does not exist`);
    return project;
  }

  function requireComponent(projectId: number, id: number): ProjectComponent {
    const component = getComponent(db, id);
    if (!component) throw new NotFoundError(`Component ${id} does not exist`);
    if (component.projectId !== projectId) {
      throw new InventoryError(`Component "${component.name}" belongs to another project`);
    }
    return component;
  }

  function requireLine(projectId: number, id: number): BomLine {
    const line = getBomLine(db, id);
    if (!line || line.projectId !== projectId) {
      throw new NotFoundError(`BOM line ${id} does not exist in this project`);
    }
    return line;
  }

  function lineState(line: BomLine): BomLineState {
    return { line, constraints: listConstraints(db, [line.id]) };
  }

  function typedConstraints(input: ConstraintInput[]): BomConstraintValue[] {
    // A thread such as M3x8 also sets the length, as it does for part attributes.
    const expanded = expandAttributes(input.map((c) => ({ ...c, label: c.key })));
    return expanded.map((constraint) => {
      const definition = getAttributeDefinition(db, constraint.key);
      if (!definition) throw new InventoryError(`Unknown attribute "${constraint.key}"`);
      const typed = (raw: string) => {
        const value = typedAttributeValue(definition, { ...constraint, value: raw });
        if (value.valueText === null && value.valueNumber === null && value.valueBoolean === null) {
          throw new InventoryError(`${definition.label}: "${raw}" is not a recognized value`);
        }
        return value;
      };
      const value = typed(constraint.value);
      if (constraint.comparison !== "equal" && value.valueNumber === null) {
        throw new InventoryError(`${definition.label} can only be compared for equality`);
      }
      let maxValueNumber: number | null = null;
      if (constraint.comparison === "range") {
        maxValueNumber = typed(constraint.maxValue!).valueNumber;
        if (maxValueNumber === null || maxValueNumber < value.valueNumber!) {
          throw new InventoryError(`${definition.label} range must go from low to high`);
        }
      }
      return {
        attributeId: definition.id,
        comparison: constraint.comparison,
        rawValue: value.rawValue,
        valueText: value.valueText,
        valueNumber: value.valueNumber,
        valueBoolean: value.valueBoolean,
        rawMaxValue: constraint.comparison === "range" ? constraint.maxValue : null,
        maxValueNumber,
      };
    });
  }

  /** Validate a line form and convert its amount to an exact integer quantity. */
  function lineFields(
    projectId: number,
    input: BomLineInput,
    current: BomLine | null
  ): BomLineFields {
    if (input.componentId !== null) requireComponent(projectId, input.componentId);
    if (input.categoryId !== null && !getCategory(db, input.categoryId)) {
      throw new NotFoundError(`Category ${input.categoryId} does not exist`);
    }

    let unit: string = input.unit;
    let quantity: number;
    if (input.partId !== null) {
      const part = getPart(db, input.partId);
      if (!part) throw new NotFoundError(`Part ${input.partId} does not exist`);
      if (part.archivedAt && part.id !== current?.partId) {
        throw new InventoryError(`${part.name} is archived. Restore it before adding it to a BOM.`);
      }
      // An exact part's requirement uses the part's base unit.
      unit = part.baseUnit;
      quantity = toBaseQuantity(input.amount, input.unit, assertUnit(part.baseUnit));
    } else {
      quantity = toBaseQuantity(input.amount, input.unit, input.unit);
    }
    if (quantity <= 0) throw new InventoryError("Quantity must be greater than zero");

    return {
      componentId: input.componentId,
      description: input.description,
      quantity,
      unit,
      partId: input.partId,
      categoryId: input.categoryId,
      manufacturer: input.manufacturer,
      partNumber: input.partNumber,
      referenceDesignators: input.referenceDesignators,
      notes: input.notes,
    };
  }

  function lineViews(lines: BomLine[]): BomLineView[] {
    const ids = lines.map((l) => l.id);
    const constraints = Map.groupBy(listConstraints(db, ids), (c) => c.bomLineId);
    const choices = Map.groupBy(listChoices(db, ids), (c) => c.bomLineId);
    return lines.map((line) => ({
      ...line,
      constraints: constraints.get(line.id) ?? [],
      choices: choices.get(line.id) ?? [],
    }));
  }

  return {
    listProjects: () => listProjects(db),

    createProject(input: ProjectInput): number {
      return insertProject(db, projectFields(input));
    },

    /**
     * Save a project. A status change applies its allocation rules in the same transaction,
     * such as releasing reservations on cancellation.
     */
    updateProject(id: number, input: ProjectInput): StatusChangeResult {
      return inTransaction(() => {
        const project = requireProject(id);
        updateProject(db, id, projectFields(input));
        if (project.status === input.status) return { releasedReservations: 0 };
        return allocations.applyStatusChange(db, {
          projectId: id,
          from: project.status,
          to: input.status,
        });
      });
    },

    /**
     * A project with its BOM in component sections (ungrouped last) and totals. The filter
     * limits the sections shown; `totals` always covers every line of the project once.
     */
    getProjectDetails(id: number, filter: ComponentFilter = null) {
      const project = getProject(db, id);
      if (!project) return null;
      const components = listComponents(db, id);
      const lines = lineViews(listBomLines(db, id));
      const byComponent = Map.groupBy(lines, (line) => line.componentId);
      const sections: BomSection[] = [...components, null]
        .filter((component) =>
          filter === null ? true : filter === "ungrouped" ? !component : component?.id === filter
        )
        .map((component) => {
          const sectionLines = byComponent.get(component?.id ?? null) ?? [];
          return { component, lines: sectionLines, totals: summarizeBom(sectionLines) };
        });
      return {
        project,
        links: linksOf(project),
        components,
        sections,
        lineCount: lines.length,
        totals: summarizeBom(lines),
      };
    },

    createComponent(projectId: number, input: ComponentInput): number {
      return inTransaction(() => {
        requireProject(projectId);
        return insertComponent(db, projectId, input);
      });
    },

    updateComponent(projectId: number, id: number, input: ComponentInput): void {
      inTransaction(() => {
        requireComponent(projectId, id);
        updateComponent(db, id, input);
      });
    },

    /** Move a component one place earlier or later in the display order. */
    moveComponent(projectId: number, id: number, direction: "up" | "down"): void {
      inTransaction(() => {
        requireComponent(projectId, id);
        const order = listComponents(db, projectId);
        const index = order.findIndex((c) => c.id === id);
        const target = direction === "up" ? index - 1 : index + 1;
        if (target < 0 || target >= order.length) return;
        [order[index], order[target]] = [order[target], order[index]];
        order.forEach((component, position) => setComponentOrder(db, component.id, position + 1));
      });
    },

    /** Remove a component. Its lines move to the ungrouped section with the same IDs. */
    removeComponent(projectId: number, id: number): void {
      inTransaction(() => {
        requireComponent(projectId, id);
        ungroupComponentLines(db, id);
        deleteComponent(db, id);
      });
    },

    /** Move a line to a component of its project, or to the ungrouped section with null. */
    setLineComponent(projectId: number, lineId: number, componentId: number | null): void {
      inTransaction(() => {
        requireLine(projectId, lineId);
        if (componentId !== null) requireComponent(projectId, componentId);
        setBomLineComponent(db, lineId, componentId);
      });
    },

    getLine(projectId: number, lineId: number): BomLineView | null {
      const line = getBomLine(db, lineId);
      if (!line || line.projectId !== projectId) return null;
      return lineViews([line])[0];
    },

    createBomLine(projectId: number, input: BomLineInput): number {
      return inTransaction(() => {
        requireProject(projectId);
        const id = insertBomLine(db, projectId, lineFields(projectId, input, null));
        replaceConstraints(db, id, typedConstraints(input.constraints));
        return id;
      });
    },

    updateBomLine(projectId: number, lineId: number, input: BomLineInput): void {
      inTransaction(() => {
        const before = lineState(requireLine(projectId, lineId));
        updateBomLine(db, lineId, lineFields(projectId, input, before.line));
        replaceConstraints(db, lineId, typedConstraints(input.constraints));
        allocations.assertChangeAllowed(db, {
          kind: "update",
          before,
          after: lineState(getBomLine(db, lineId)!),
        });
      });
    },

    deleteBomLine(projectId: number, lineId: number): void {
      inTransaction(() => {
        const before = lineState(requireLine(projectId, lineId));
        allocations.assertChangeAllowed(db, { kind: "delete", before });
        deleteBomLine(db, lineId);
      });
    },

    /** Candidate parts for a line, with evidence, unresolved constraints, and conflicts. */
    findCandidates(projectId: number, lineId: number) {
      return findCandidates(db, requireLine(projectId, lineId));
    },

    /**
     * Record the owner's approval of a part for a line. A part that is not a confirmed match
     * can only be approved as a substitute with a note. Approval does not reserve stock.
     */
    approveChoice(projectId: number, lineId: number, input: ChoiceInput): number {
      return inTransaction(() => {
        const line = requireLine(projectId, lineId);
        const part = getPart(db, input.partId);
        if (!part) throw new NotFoundError(`Part ${input.partId} does not exist`);
        if (part.archivedAt) {
          throw new InventoryError(`${part.name} is archived. Restore it before approving it.`);
        }
        if (listChoices(db, [lineId]).some((c) => c.partId === part.id)) {
          throw new InventoryError(`${part.name} is already approved for this requirement`);
        }
        if (!unitsCompatible(line.unit, part.baseUnit)) {
          throw new InventoryError(
            `${part.name} is counted in ${part.baseUnit}, which cannot convert to ${line.unit}`
          );
        }
        const evaluation = evaluatePart(db, loadRequirement(db, line), part.id)!;
        if (evaluation.status !== "match" && !input.substitute) {
          const reason = [...evaluation.conflicts, ...evaluation.unresolved][0];
          throw new InventoryError(
            `${part.name} is not a confirmed match (${reason}). Approve it as a substitute with a note.`
          );
        }
        if (input.substitute && !input.note) {
          throw new InventoryError("Enter a note that explains why the substitute is acceptable");
        }
        return insertChoice(db, {
          bomLineId: lineId,
          partId: part.id,
          substitute: input.substitute,
          note: input.note,
        });
      });
    },

    removeChoice(projectId: number, lineId: number, choiceId: number): void {
      inTransaction(() => {
        const line = requireLine(projectId, lineId);
        const choice = listChoices(db, [lineId]).find((c) => c.id === choiceId);
        if (!choice) throw new NotFoundError(`Approval ${choiceId} does not exist for this line`);
        allocations.assertChangeAllowed(db, { kind: "remove_choice", line, partId: choice.partId });
        deleteChoice(db, choiceId);
      });
    },

    /** Options for the BOM line form. */
    bomFormOptions() {
      const categories = listCategories(db);
      return {
        categories: categoryOptions(categories),
        definitions: listAttributeDefinitions(db).map(
          ({ key, label, valueType, canonicalUnit }) => ({
            key,
            label,
            valueType,
            canonicalUnit,
          })
        ),
        applicable: applicableAttributeKeys(categories, listAttributeApplicability(db)),
        required: applicableAttributeKeys(categories, listRequiredApplicability(db)),
        parts: searchParts(db, {
          text: null,
          categoryId: null,
          attributes: [],
          tags: [],
          includeArchived: false,
        }).map(({ id, name, baseUnit, partNumber }) => ({ id, name, baseUnit, partNumber })),
      };
    },
  };
}
