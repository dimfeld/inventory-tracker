import { getDb } from "#lib/server/db/index.ts";
import { bomAllocationGuard } from "./allocations";
import { createCommitmentService } from "./commitments";
import { createProjectService } from "./projects";
import { createShoppingService } from "./shopping";
import { createAllocationService } from "./stock-allocations";

let service: ReturnType<typeof createProjectService> | undefined;
let allocationService: ReturnType<typeof createAllocationService> | undefined;
let commitmentService: ReturnType<typeof createCommitmentService> | undefined;
let shoppingService: ReturnType<typeof createShoppingService> | undefined;

/** The project service bound to the app database. */
export function projects() {
  service ??= createProjectService(getDb(), { allocations: bomAllocationGuard });
  return service;
}

/** Reservations, picking, use, and returns for project BOM lines. */
export function allocations() {
  allocationService ??= createAllocationService(getDb());
  return allocationService;
}

/** Assignment and release of incoming order supply for project BOM lines. */
export function commitments() {
  commitmentService ??= createCommitmentService(getDb());
  return commitmentService;
}

/** The combined shopping list of open projects. */
export function shopping() {
  shoppingService ??= createShoppingService(getDb());
  return shoppingService;
}
