import type { Database } from "bun:sqlite";
import { OPEN_PROJECT_STATUSES } from "#lib/projects.ts";
import { committedByOrderLine } from "#lib/server/db/commitments.ts";
import { listIncomingLines } from "#lib/server/db/orders.ts";
import {
  listBomLines,
  listChoices,
  listComponents,
  listProjects,
  type BomLine,
  type BomPartChoice,
  type ProjectComponent,
} from "#lib/server/db/projects.ts";
import { listStorageStock } from "#lib/server/db/reservations.ts";
import { lineCoverage, loadAllocations } from "./coverage";
import type { ComponentFilter } from "./projects";

/** Which open projects and rows the list covers. */
export interface ShoppingSelection {
  /** Projects to include, or null for every planned, active, and paused project. */
  projectIds: number[] | null;
  component: ComponentFilter;
}

/** One requirement's need that no stock or committed order covers, in `unit`. */
export interface ShoppingRequirement {
  projectId: number;
  projectName: string;
  componentName: string | null;
  lineId: number;
  lineDescription: string;
  quantity: number;
  unit: string;
}

/**
 * Supply that could cover a resolved part but is not assigned to any requirement, in the
 * part's base unit. It is a suggestion only: reserve stock or commit incoming supply to count
 * it as coverage.
 */
export interface SupplySuggestion {
  baseUnit: string;
  /** Storage stock minus every project's reservations. */
  available: number;
  /** Outstanding order supply minus every project's commitments. */
  uncommittedIncoming: number;
}

export interface ShoppingItem {
  key: string;
  /** The resolved part, or null for a requirement without one, which is never combined. */
  partId: number | null;
  label: string;
  /** Total need of the requirements, in `unit`. */
  quantity: number;
  unit: string;
  /** For an item without a resolved part: the approved choices, if there are several. */
  choices: string[];
  requirements: ShoppingRequirement[];
  suggestion: SupplySuggestion | null;
}

export interface ShoppingProject {
  id: number;
  name: string;
  status: string;
  components: ProjectComponent[];
}

/**
 * The part a requirement resolves to: its exact part, or its only approved choice. A
 * requirement with no choice or several choices is ambiguous.
 */
export function resolvedPart(line: BomLine, choices: BomPartChoice[]) {
  // An exact part's requirement is in the part's base unit.
  if (line.partId !== null) return { id: line.partId, name: line.partName!, baseUnit: line.unit };
  if (choices.length !== 1) return null;
  const [choice] = choices;
  return { id: choice.partId, name: choice.partName, baseUnit: choice.baseUnit };
}

export type ShoppingService = ReturnType<typeof createShoppingService>;

/**
 * The combined shopping list of open projects. It only reads: selecting or excluding projects
 * and components never changes reservations or commitments, and supply that other projects
 * hold is never shown as available.
 */
export function createShoppingService(db: Database) {
  function openProjects(): ShoppingProject[] {
    return listProjects(db)
      .filter((project) => OPEN_PROJECT_STATUSES.includes(project.status))
      .map((project) => ({
        id: project.id,
        name: project.name,
        status: project.status,
        components: listComponents(db, project.id),
      }));
  }

  function suggestions(partIds: number[]): Map<number, Omit<SupplySuggestion, "baseUnit">> {
    const result = new Map(partIds.map((id) => [id, { available: 0, uncommittedIncoming: 0 }]));
    for (const stock of listStorageStock(db, partIds)) {
      result.get(stock.partId)!.available += Math.max(stock.balance - stock.reserved, 0);
    }
    const committed = committedByOrderLine(db);
    for (const incoming of listIncomingLines(db, partIds)) {
      result.get(incoming.partId)!.uncommittedIncoming += Math.max(
        incoming.outstanding - (committed.get(incoming.orderLineId) ?? 0),
        0
      );
    }
    return result;
  }

  return {
    /** Planned, active, and paused projects with their components. */
    openProjects,

    /**
     * Needed-not-ordered quantities of the selected projects' rows. Rows that resolve to the
     * same part and unit are combined with a per-requirement breakdown; other rows stay
     * separate items.
     */
    getShoppingList(selection: ShoppingSelection): ShoppingItem[] {
      const projects = openProjects().filter(
        (p) => selection.projectIds === null || selection.projectIds.includes(p.id)
      );
      const filter = selection.component;
      const items = new Map<string, ShoppingItem>();
      const partUnits = new Map<number, string>();

      for (const project of projects) {
        const componentNames = new Map(project.components.map((c) => [c.id, c.name]));
        const lines = listBomLines(db, project.id).filter((line) =>
          filter === null
            ? true
            : filter === "ungrouped"
              ? line.componentId === null
              : line.componentId === filter
        );
        const ids = lines.map((line) => line.id);
        const allocations = loadAllocations(db, ids);
        const choices = Map.groupBy(listChoices(db, ids), (c) => c.bomLineId);

        for (const line of lines) {
          const coverage = lineCoverage(line, allocations.get(line.id) ?? []);
          if (coverage.neededNotOrdered === 0) continue;
          const lineChoices = choices.get(line.id) ?? [];
          const part = resolvedPart(line, lineChoices);
          const key = part ? `part:${part.id}:${coverage.unit}` : `line:${line.id}`;
          let item = items.get(key);
          if (!item) {
            item = {
              key,
              partId: part?.id ?? null,
              label: part?.name ?? line.description,
              quantity: 0,
              unit: coverage.unit,
              choices: part ? [] : lineChoices.map((c) => c.partName),
              requirements: [],
              suggestion: null,
            };
            items.set(key, item);
          }
          if (part) partUnits.set(part.id, part.baseUnit);
          item.quantity += coverage.neededNotOrdered;
          item.requirements.push({
            projectId: project.id,
            projectName: project.name,
            componentName:
              line.componentId === null ? null : (componentNames.get(line.componentId) ?? null),
            lineId: line.id,
            lineDescription: line.description,
            quantity: coverage.neededNotOrdered,
            unit: coverage.unit,
          });
        }
      }

      const supply = suggestions([...partUnits.keys()]);
      return [...items.values()].map((item) =>
        item.partId === null
          ? item
          : {
              ...item,
              suggestion: { baseUnit: partUnits.get(item.partId)!, ...supply.get(item.partId)! },
            }
      );
    },
  };
}
