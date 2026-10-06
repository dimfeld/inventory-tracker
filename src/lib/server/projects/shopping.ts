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
import { absoluteQuantity, lineCoverage, loadAllocations } from "./coverage";
import type { ComponentFilter } from "./projects";

/** Which open projects and rows the list covers. */
export interface ShoppingSelection {
  /** Projects to include, or null for every planned, active, and paused project. */
  projectIds: number[] | null;
  component: ComponentFilter;
}

/** One requirement's remaining need (required minus used), in `unit`. */
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
 * How an item's need is covered, in the item's `unit`. The parts add up to the need:
 * need = reserved + freeStock + committed + freeOrdered + toBuy.
 */
export interface ShoppingCoverage {
  /** Stock picked or reserved for the requirements. */
  reserved: number;
  /** Unreserved storage stock of the part or its approved parts, as much as the item can use. */
  freeStock: number;
  /** Order supply committed to the requirements. */
  committed: number;
  /** Uncommitted order supply of the part or its approved parts, as much as the item can use. */
  freeOrdered: number;
  /** The need that no stock or order covers: what to buy. */
  toBuy: number;
}

export interface ShoppingItem {
  key: string;
  /** The resolved part, or null for a requirement without one, which is never combined. */
  partId: number | null;
  label: string;
  /** Total remaining need of the requirements, in `unit`. */
  quantity: number;
  unit: string;
  /** For an item without a resolved part: the approved choices, if there are several. */
  choices: string[];
  requirements: ShoppingRequirement[];
  /**
   * For an item without a resolved part, free stock and orders are not known, so they stay 0
   * and `toBuy` is the need that the requirements' own stock and commitments do not cover.
   */
  coverage: ShoppingCoverage;
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

  /** Storage stock and order supply of each part that no project holds, in the base unit. */
  function freeSupply(partIds: number[]): Map<number, { stock: number; ordered: number }> {
    const result = new Map(partIds.map((id) => [id, { stock: 0, ordered: 0 }]));
    for (const stock of listStorageStock(db, partIds)) {
      result.get(stock.partId)!.stock += Math.max(stock.balance - stock.reserved, 0);
    }
    const committed = committedByOrderLine(db);
    for (const incoming of listIncomingLines(db, partIds)) {
      result.get(incoming.partId)!.ordered += Math.max(
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
     * What the selected projects' rows need to buy beyond all stock and orders, committed or
     * not. Rows that resolve to the same part and unit are combined with a per-requirement
     * breakdown; other rows stay separate items. Free stock and orders of a row's resolved part
     * and its approved parts count once across items, stock first. Only items with something
     * to buy are listed.
     */
    getShoppingList(selection: ShoppingSelection): ShoppingItem[] {
      const projects = openProjects().filter(
        (p) => selection.projectIds === null || selection.projectIds.includes(p.id)
      );
      const filter = selection.component;
      const items = new Map<string, ShoppingItem>();
      const partUnits = new Map<number, string>();
      // Parts whose free supply may cover each resolved item: the resolved part first, then
      // the other parts approved for its rows.
      const supplyParts = new Map<string, number[]>();

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
          const remaining = Math.max(coverage.required - coverage.used, 0);
          if (remaining === 0) continue;
          const reserved = Math.min(coverage.picked + coverage.reserved, remaining);
          const committed = Math.min(coverage.ordered, remaining - reserved);

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
              coverage: { reserved: 0, freeStock: 0, committed: 0, freeOrdered: 0, toBuy: 0 },
            };
            items.set(key, item);
          }
          if (part) {
            partUnits.set(part.id, part.baseUnit);
            const ids = supplyParts.get(key) ?? [part.id];
            for (const choice of lineChoices) {
              partUnits.set(choice.partId, choice.baseUnit);
              if (!ids.includes(choice.partId)) ids.push(choice.partId);
            }
            supplyParts.set(key, ids);
          }
          item.quantity += remaining;
          item.coverage.reserved += reserved;
          item.coverage.committed += committed;
          item.coverage.toBuy += coverage.neededNotOrdered;
          item.requirements.push({
            projectId: project.id,
            projectName: project.name,
            componentName:
              line.componentId === null ? null : (componentNames.get(line.componentId) ?? null),
            lineId: line.id,
            lineDescription: line.description,
            quantity: remaining,
            unit: coverage.unit,
          });
        }
      }

      // Free supply of each part not yet counted against an item, in the smallest unit.
      const free = new Map(
        [...freeSupply([...partUnits.keys()])].map(([partId, supply]) => {
          const baseUnit = partUnits.get(partId)!;
          return [
            partId,
            {
              stock: absoluteQuantity(supply.stock, baseUnit),
              ordered: absoluteQuantity(supply.ordered, baseUnit),
            },
          ];
        })
      );
      for (const item of items.values()) {
        if (item.partId === null) continue;
        const size = absoluteQuantity(1, item.unit);
        let open = item.coverage.toBuy * size;
        let fromStock = 0;
        let fromOrders = 0;
        // Stock of every allowed part first, then orders.
        for (const kind of ["stock", "ordered"] as const) {
          for (const partId of supplyParts.get(item.key)!) {
            const supply = free.get(partId)!;
            const taken = Math.min(supply[kind], open);
            supply[kind] -= taken;
            open -= taken;
            if (kind === "stock") fromStock += taken;
            else fromOrders += taken;
          }
        }
        item.coverage.freeStock = fromStock / size;
        item.coverage.freeOrdered = fromOrders / size;
        item.coverage.toBuy = open / size;
      }
      return [...items.values()].filter((item) => item.coverage.toBuy > 0);
    },
  };
}
