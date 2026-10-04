import { getDb } from "#lib/server/db/index.ts";
import { bomAllocationGuard } from "./allocations";
import { createProjectService } from "./projects";
import { createAllocationService } from "./stock-allocations";

let service: ReturnType<typeof createProjectService> | undefined;
let allocationService: ReturnType<typeof createAllocationService> | undefined;

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
