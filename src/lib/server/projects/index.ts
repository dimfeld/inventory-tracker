import { getDb } from "#lib/server/db/index.ts";
import { noBomAllocations } from "./allocations";
import { createProjectService } from "./projects";

let service: ReturnType<typeof createProjectService> | undefined;

/** The project service bound to the app database. */
export function projects() {
  // The reservations plan replaces this guard with one that checks the line's allocations.
  service ??= createProjectService(getDb(), { allocations: noBomAllocations });
  return service;
}
