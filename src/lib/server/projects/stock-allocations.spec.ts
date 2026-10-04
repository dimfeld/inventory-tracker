import { describe, expect, it } from "vitest";
import { getBalance, listPartMovements } from "#lib/server/db/movements.ts";
import { getHoldingLocation } from "#lib/server/db/locations.ts";
import { DuplicateOperationError, InventoryError } from "#lib/server/inventory/errors.ts";
import { opId, partInput } from "#lib/server/inventory/test-helpers.ts";
import { createTestAllocations, lineInput, projectInput } from "./test-helpers";

const DAY = "2026-10-01";

/** 20 M3 × 8 mm screws in one drawer, an empty bin, and two projects that need them. */
function setup() {
  const ctx = createTestAllocations();
  const screw = ctx.catalog.createPart(partInput());
  const drawer = ctx.locations.createLocation({ name: "Drawer A1", notes: null });
  const bin = ctx.locations.createLocation({ name: "Bin B2", notes: null });
  ctx.stock.recordOpeningStock({
    operationId: opId(),
    partId: screw,
    locationId: drawer,
    amount: "20",
    unit: "pcs",
    occurredOn: DAY,
  });
  const projectA = ctx.projects.createProject(projectInput({ name: "A" }));
  const projectB = ctx.projects.createProject(projectInput({ name: "B" }));
  const lineA = ctx.projects.createBomLine(projectA, lineInput({ partId: screw, amount: "8" }));
  const lineB = ctx.projects.createBomLine(projectB, lineInput({ partId: screw, amount: "15" }));
  return { ...ctx, screw, drawer, bin, projectA, projectB, lineA, lineB };
}

type Ctx = ReturnType<typeof setup>;

function reserve(ctx: Ctx, projectId: number, lineId: number, amount: string, locationId?: number) {
  ctx.allocations.reserve({
    projectId,
    lineId,
    partId: ctx.screw,
    locationId: locationId ?? ctx.drawer,
    amount,
    unit: "pcs",
  });
}

function pick(ctx: Ctx, projectId: number, lineId: number, amount: string) {
  return ctx.allocations.pick({
    operationId: opId(),
    occurredOn: DAY,
    projectId,
    lineId,
    partId: ctx.screw,
    locationId: ctx.drawer,
    amount,
    unit: "pcs",
  });
}

function use(ctx: Ctx, projectId: number, lineId: number, amount: string) {
  return ctx.allocations.use({
    operationId: opId(),
    occurredOn: DAY,
    projectId,
    lineId,
    partId: ctx.screw,
    amount,
    unit: "pcs",
    reason: null,
  });
}

function returnPicked(
  ctx: Ctx,
  projectId: number,
  lineId: number,
  amount: string,
  reserveAgain: boolean
) {
  return ctx.allocations.returnPicked({
    operationId: opId(),
    occurredOn: DAY,
    projectId,
    lineId,
    partId: ctx.screw,
    toLocationId: ctx.drawer,
    amount,
    unit: "pcs",
    reserveAgain,
  });
}

function coverage(ctx: Ctx, projectId: number, lineId: number) {
  const { unit, required, used, picked, reserved, uncovered, excess } =
    ctx.allocations.getProjectCoverage(projectId)[lineId];
  return { unit, required, used, picked, reserved, uncovered, excess };
}

function available(ctx: Ctx) {
  const stock = ctx.allocations
    .getLineStock(ctx.projectA, ctx.lineA)
    .parts[0].storage.find((s) => s.locationId === ctx.drawer);
  return stock?.available ?? 0;
}

describe("reservations", () => {
  it("shares 20 screws: A reserves 8, B can reserve only the remaining 12 of its 15", () => {
    const ctx = setup();
    reserve(ctx, ctx.projectA, ctx.lineA, "8");
    expect(available(ctx)).toBe(12);

    expect(() => reserve(ctx, ctx.projectB, ctx.lineB, "15")).toThrow(
      "Drawer A1 has 12 pcs of M3 × 8 mm socket-head screw available"
    );
    reserve(ctx, ctx.projectB, ctx.lineB, "12");

    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toEqual({
      unit: "pcs",
      required: 15,
      used: 0,
      picked: 0,
      reserved: 12,
      uncovered: 3,
      excess: 0,
    });
    // Reservation does not move physical stock.
    expect(getBalance(ctx.db, ctx.screw, ctx.drawer)).toBe(20);
    expect(available(ctx)).toBe(0);
  });

  it("rechecks availability at write time, so a stale form cannot over-reserve", () => {
    const ctx = setup();
    // Both forms were loaded while 20 were available.
    const staleSubmissions = ["8", "15"];
    reserve(ctx, ctx.projectA, ctx.lineA, staleSubmissions[0]);
    expect(() => reserve(ctx, ctx.projectB, ctx.lineB, staleSubmissions[1])).toThrow(
      InventoryError
    );
    // A repeated submission cannot reserve more than the row needs.
    expect(() => reserve(ctx, ctx.projectA, ctx.lineA, "8")).toThrow("needs only 0 pcs more");
    expect(coverage(ctx, ctx.projectA, ctx.lineA).reserved).toBe(8);
    expect(coverage(ctx, ctx.projectB, ctx.lineB).reserved).toBe(0);
  });

  it("reserves only the row's exact part or approved choices", () => {
    const ctx = setup();
    const other = ctx.catalog.createPart(partInput({ name: "M3 × 10 mm screw" }));
    ctx.stock.recordOpeningStock({
      operationId: opId(),
      partId: other,
      locationId: ctx.drawer,
      amount: "5",
      unit: "pcs",
      occurredOn: DAY,
    });
    const reserveOther = () =>
      ctx.allocations.reserve({
        projectId: ctx.projectA,
        lineId: ctx.lineA,
        partId: other,
        locationId: ctx.drawer,
        amount: "2",
        unit: "pcs",
      });
    expect(reserveOther).toThrow("Approve it first");
    ctx.projects.approveChoice(ctx.projectA, ctx.lineA, {
      partId: other,
      substitute: true,
      note: "Two mm longer is fine",
    });
    reserveOther();
    expect(coverage(ctx, ctx.projectA, ctx.lineA)).toMatchObject({ reserved: 2, uncovered: 6 });
  });

  it("releases part of a reservation", () => {
    const ctx = setup();
    reserve(ctx, ctx.projectA, ctx.lineA, "8");
    ctx.allocations.release({
      projectId: ctx.projectA,
      lineId: ctx.lineA,
      partId: ctx.screw,
      locationId: ctx.drawer,
      amount: "3",
      unit: "pcs",
    });
    expect(coverage(ctx, ctx.projectA, ctx.lineA).reserved).toBe(5);
    expect(available(ctx)).toBe(15);
  });
});

describe("picking, use, and returns", () => {
  it("picks part of a reservation, credits use to the line, and returns to storage", () => {
    const ctx = setup();
    reserve(ctx, ctx.projectB, ctx.lineB, "12");

    pick(ctx, ctx.projectB, ctx.lineB, "5");
    const holding = getHoldingLocation(ctx.db, ctx.projectB)!;
    expect(getBalance(ctx.db, ctx.screw, ctx.drawer)).toBe(15);
    expect(getBalance(ctx.db, ctx.screw, holding.id)).toBe(5);
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({
      picked: 5,
      reserved: 7,
      uncovered: 3,
    });
    // Picking cannot take more than is reserved.
    expect(() => pick(ctx, ctx.projectB, ctx.lineB, "8")).toThrow("cannot pick 8 pcs");

    use(ctx, ctx.projectB, ctx.lineB, "3");
    expect(getBalance(ctx.db, ctx.screw, holding.id)).toBe(2);
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({
      used: 3,
      picked: 2,
      reserved: 7,
      uncovered: 3,
    });
    expect(() => use(ctx, ctx.projectB, ctx.lineB, "3")).toThrow("2 pcs");

    returnPicked(ctx, ctx.projectB, ctx.lineB, "1", false);
    expect(getBalance(ctx.db, ctx.screw, ctx.drawer)).toBe(16);
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({
      used: 3,
      picked: 1,
      reserved: 7,
      uncovered: 4,
    });

    returnPicked(ctx, ctx.projectB, ctx.lineB, "1", true);
    expect(getBalance(ctx.db, ctx.screw, ctx.drawer)).toBe(17);
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({
      used: 3,
      picked: 0,
      reserved: 8,
      uncovered: 4,
    });

    const types = listPartMovements(ctx.db, ctx.screw).map((m) => [m.movementType, m.bomLineId]);
    expect(types).toEqual(
      expect.arrayContaining([
        ["pick", ctx.lineB],
        ["project_use", ctx.lineB],
        ["project_return", ctx.lineB],
      ])
    );
  });

  it("keeps identical parts on different lines of one project separate", () => {
    const ctx = setup();
    const second = ctx.projects.createBomLine(
      ctx.projectA,
      lineInput({ partId: ctx.screw, amount: "4" })
    );
    reserve(ctx, ctx.projectA, ctx.lineA, "8");
    reserve(ctx, ctx.projectA, second, "4");
    pick(ctx, ctx.projectA, ctx.lineA, "8");
    pick(ctx, ctx.projectA, second, "4");
    use(ctx, ctx.projectA, second, "4");

    expect(coverage(ctx, ctx.projectA, ctx.lineA)).toMatchObject({ used: 0, picked: 8 });
    expect(coverage(ctx, ctx.projectA, second)).toMatchObject({ used: 4, picked: 0 });
    // Stock picked for the first line cannot be recorded as used by the second.
    expect(() => use(ctx, ctx.projectA, second, "1")).toThrow("0 pcs");
  });

  it("rejects a repeated submission of the same pick", () => {
    const ctx = setup();
    reserve(ctx, ctx.projectA, ctx.lineA, "8");
    const input = {
      operationId: opId(),
      occurredOn: DAY,
      projectId: ctx.projectA,
      lineId: ctx.lineA,
      partId: ctx.screw,
      locationId: ctx.drawer,
      amount: "2",
      unit: "pcs" as const,
    };
    ctx.allocations.pick(input);
    expect(() => ctx.allocations.pick(input)).toThrow(DuplicateOperationError);
    expect(coverage(ctx, ctx.projectA, ctx.lineA)).toMatchObject({ picked: 2, reserved: 6 });
  });

  it("keeps ordinary stock actions away from project holding locations", () => {
    const ctx = setup();
    reserve(ctx, ctx.projectA, ctx.lineA, "8");
    pick(ctx, ctx.projectA, ctx.lineA, "8");
    const holding = getHoldingLocation(ctx.db, ctx.projectA)!;
    expect(() =>
      ctx.stock.recordLoss({
        operationId: opId(),
        partId: ctx.screw,
        locationId: holding.id,
        amount: "1",
        unit: "pcs",
        occurredOn: DAY,
        reason: "Dropped",
      })
    ).toThrow("holds picked stock");
  });
});

describe("project status", () => {
  it("cancellation releases reservations and keeps picked stock until it is returned", () => {
    const ctx = setup();
    reserve(ctx, ctx.projectA, ctx.lineA, "8");
    pick(ctx, ctx.projectA, ctx.lineA, "3");

    const result = ctx.projects.updateProject(
      ctx.projectA,
      projectInput({ name: "A", status: "cancelled" })
    );
    expect(result.releasedReservations).toBe(1);
    expect(coverage(ctx, ctx.projectA, ctx.lineA)).toMatchObject({ picked: 3, reserved: 0 });
    expect(getBalance(ctx.db, ctx.screw, getHoldingLocation(ctx.db, ctx.projectA)!.id)).toBe(3);
    expect(available(ctx)).toBe(17);
    expect(() => reserve(ctx, ctx.projectA, ctx.lineA, "1")).toThrow("cancelled");

    // Picked stock is resolved explicitly.
    returnPicked(ctx, ctx.projectA, ctx.lineA, "3", false);
    expect(getBalance(ctx.db, ctx.screw, ctx.drawer)).toBe(20);
  });

  it("does not complete a project while picked stock remains", () => {
    const ctx = setup();
    reserve(ctx, ctx.projectA, ctx.lineA, "8");
    pick(ctx, ctx.projectA, ctx.lineA, "6");
    const complete = () =>
      ctx.projects.updateProject(ctx.projectA, projectInput({ name: "A", status: "complete" }));

    expect(complete).toThrow("before completing the project: 6 pcs");
    expect(ctx.projects.getProjectDetails(ctx.projectA)!.project.status).toBe("planned");

    use(ctx, ctx.projectA, ctx.lineA, "6");
    expect(complete().releasedReservations).toBe(1);
    expect(coverage(ctx, ctx.projectA, ctx.lineA)).toMatchObject({ used: 6, reserved: 0 });
  });
});

describe("BOM and stock count changes", () => {
  it("rejects a reduced quantity that reservations exceed, and keeps excess picked stock", () => {
    const ctx = setup();
    reserve(ctx, ctx.projectA, ctx.lineA, "8");
    pick(ctx, ctx.projectA, ctx.lineA, "5");
    use(ctx, ctx.projectA, ctx.lineA, "1");

    const reduce = (amount: string) =>
      ctx.projects.updateBomLine(ctx.projectA, ctx.lineA, lineInput({ partId: ctx.screw, amount }));
    expect(() => reduce("6")).toThrow("release 2 pcs");
    expect(ctx.projects.getLine(ctx.projectA, ctx.lineA)!.quantity).toBe(8);

    ctx.allocations.release({
      projectId: ctx.projectA,
      lineId: ctx.lineA,
      partId: ctx.screw,
      locationId: ctx.drawer,
      amount: "3",
      unit: "pcs",
    });
    // Picked and used stock beyond the new quantity is a visible excess, not deleted stock.
    reduce("2");
    expect(coverage(ctx, ctx.projectA, ctx.lineA)).toEqual({
      unit: "pcs",
      required: 2,
      used: 1,
      picked: 4,
      reserved: 0,
      uncovered: 0,
      excess: 3,
    });
    expect(getBalance(ctx.db, ctx.screw, getHoldingLocation(ctx.db, ctx.projectA)!.id)).toBe(4);
  });

  it("rejects changing the part or deleting a row with allocations", () => {
    const ctx = setup();
    const other = ctx.catalog.createPart(partInput({ name: "M3 × 10 mm screw" }));
    reserve(ctx, ctx.projectA, ctx.lineA, "2");
    expect(() =>
      ctx.projects.updateBomLine(ctx.projectA, ctx.lineA, lineInput({ partId: other }))
    ).toThrow("2 pcs reserved at Drawer A1 (no longer fits this row)");
    expect(() => ctx.projects.deleteBomLine(ctx.projectA, ctx.lineA)).toThrow(
      "This row has allocated stock"
    );

    pick(ctx, ctx.projectA, ctx.lineA, "2");
    returnPicked(ctx, ctx.projectA, ctx.lineA, "2", false);
    // History is kept even when nothing is allocated now.
    expect(() => ctx.projects.deleteBomLine(ctx.projectA, ctx.lineA)).toThrow("stock history");
    expect(ctx.projects.getLine(ctx.projectA, ctx.lineA)).not.toBeNull();
  });

  it("rejects withdrawing approval of a reserved substitute", () => {
    const ctx = setup();
    const genericLine = ctx.projects.createBomLine(ctx.projectA, lineInput({ amount: "2" }));
    const choice = ctx.projects.approveChoice(ctx.projectA, genericLine, {
      partId: ctx.screw,
      substitute: true,
      note: "Same screw",
    });
    reserve(ctx, ctx.projectA, genericLine, "2");
    expect(() => ctx.projects.removeChoice(ctx.projectA, genericLine, choice)).toThrow(
      "Release or return first"
    );
  });

  it("a stock count below the reserved total reduces the newest reservations", () => {
    const ctx = setup();
    reserve(ctx, ctx.projectA, ctx.lineA, "8");
    reserve(ctx, ctx.projectB, ctx.lineB, "12");

    const result = ctx.stock.recordStockCount({
      operationId: opId(),
      partId: ctx.screw,
      locationId: ctx.drawer,
      countedAmount: "15",
      unit: "pcs",
      occurredOn: DAY,
      reason: "Recount",
    });
    expect(result.releasedReservations).toMatchObject([
      { projectName: "B", bomLineId: ctx.lineB, released: 5, remaining: 7 },
    ]);
    expect(coverage(ctx, ctx.projectA, ctx.lineA).reserved).toBe(8);
    expect(coverage(ctx, ctx.projectB, ctx.lineB).reserved).toBe(7);
    expect(available(ctx)).toBe(0);
  });

  it("rejects a transfer or loss that would take reserved stock", () => {
    const ctx = setup();
    reserve(ctx, ctx.projectA, ctx.lineA, "8");
    expect(() =>
      ctx.stock.transfer({
        operationId: opId(),
        partId: ctx.screw,
        fromLocationId: ctx.drawer,
        toLocationId: ctx.bin,
        amount: "13",
        unit: "pcs",
        occurredOn: DAY,
      })
    ).toThrow("only 12 pcs can be removed");
    expect(getBalance(ctx.db, ctx.screw, ctx.drawer)).toBe(20);
  });
});

describe("component groups", () => {
  it("identical parts in different components compete for the same storage", () => {
    const ctx = setup();
    const power = ctx.projects.createComponent(ctx.projectB, { name: "Power", notes: null });
    const case_ = ctx.projects.createComponent(ctx.projectB, { name: "Case", notes: null });
    ctx.projects.setLineComponent(ctx.projectB, ctx.lineB, power);
    const caseLine = ctx.projects.createBomLine(
      ctx.projectB,
      lineInput({ partId: ctx.screw, amount: "10", componentId: case_ })
    );
    reserve(ctx, ctx.projectB, ctx.lineB, "15");
    expect(() => reserve(ctx, ctx.projectB, caseLine, "10")).toThrow("5 pcs");
    reserve(ctx, ctx.projectB, caseLine, "5");

    // Filtering the pick list to one component does not free the other's stock.
    const powerList = ctx.allocations.getPickList(ctx.projectB, power);
    expect(powerList).toMatchObject([
      { locationName: "Drawer A1", items: [{ lineId: ctx.lineB, componentName: "Power" }] },
    ]);
    expect(() => reserve(ctx, ctx.projectA, ctx.lineA, "1")).toThrow("0 pcs");
    expect(available(ctx)).toBe(0);
  });

  it("regrouping and removing a group keep the row ID and all quantity states", () => {
    const ctx = setup();
    const power = ctx.projects.createComponent(ctx.projectB, { name: "Power", notes: null });
    const controller = ctx.projects.createComponent(ctx.projectB, {
      name: "Controller",
      notes: null,
    });
    ctx.projects.setLineComponent(ctx.projectB, ctx.lineB, power);
    reserve(ctx, ctx.projectB, ctx.lineB, "12");
    pick(ctx, ctx.projectB, ctx.lineB, "6");
    use(ctx, ctx.projectB, ctx.lineB, "2");
    const before = coverage(ctx, ctx.projectB, ctx.lineB);
    const movementLines = () => listPartMovements(ctx.db, ctx.screw).map((m) => m.bomLineId);
    const movementsBefore = movementLines();

    ctx.projects.setLineComponent(ctx.projectB, ctx.lineB, controller);
    ctx.projects.moveComponent(ctx.projectB, controller, "up");
    ctx.projects.updateComponent(ctx.projectB, controller, { name: "Logic", notes: null });
    ctx.projects.removeComponent(ctx.projectB, controller);

    const line = ctx.projects.getLine(ctx.projectB, ctx.lineB)!;
    expect(line).toMatchObject({ id: ctx.lineB, componentId: null });
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toEqual(before);
    expect(before).toMatchObject({ used: 2, picked: 4, reserved: 6, uncovered: 3 });
    expect(movementLines()).toEqual(movementsBefore);
    expect(ctx.allocations.getPickList(ctx.projectB, "ungrouped")).toMatchObject([
      { items: [{ lineId: ctx.lineB, componentName: null, quantity: 6 }] },
    ]);
  });
});
