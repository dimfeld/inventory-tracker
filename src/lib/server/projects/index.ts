import { getDb } from "#lib/server/db/index.ts";
import { bomAllocationGuard } from "./allocations";
import { createCommitmentService } from "./commitments";
import { createEstimateService } from "./estimates";
import { createPieceAllocationService } from "./piece-allocations";
import { createProjectService } from "./projects";
import { createShoppingService } from "./shopping";
import { createAllocationService } from "./stock-allocations";

let service: ReturnType<typeof createProjectService> | undefined;
let allocationService: ReturnType<typeof createAllocationService> | undefined;
let pieceAllocationService: ReturnType<typeof createPieceAllocationService> | undefined;
let commitmentService: ReturnType<typeof createCommitmentService> | undefined;
let shoppingService: ReturnType<typeof createShoppingService> | undefined;
let estimateService: ReturnType<typeof createEstimateService> | undefined;

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

/** Reservations, picks, use, and returns of stock pieces (cut pieces) for project BOM lines. */
export function pieceAllocations() {
  pieceAllocationService ??= createPieceAllocationService(getDb());
  return pieceAllocationService;
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

/** Read-only project cost estimates from recorded purchase prices. */
export function estimates() {
  estimateService ??= createEstimateService(getDb());
  return estimateService;
}
