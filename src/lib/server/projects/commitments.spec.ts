import { describe, expect, it } from "vitest";
import { assignInSequence } from "#lib/commitments.ts";
import { listOrderLineCommitments } from "#lib/server/db/commitments.ts";
import { getHoldingLocation } from "#lib/server/db/locations.ts";
import { getBalance } from "#lib/server/db/movements.ts";
import { getOrderLine } from "#lib/server/db/orders.ts";
import { InventoryError } from "#lib/server/inventory/errors.ts";
import { opId, partInput } from "#lib/server/inventory/test-helpers.ts";
import { createTestAllocations, lineInput, projectInput } from "./test-helpers";

const DAY = "2026-10-01";

/**
 * The worked case: 20 M3 × 8 mm screws in a drawer, A reserves 8 for its row, B needs 15 and
 * reserves 12, and a placed order brings 10 more.
 */
function setup() {
  const ctx = createTestAllocations();
  const screw = ctx.catalog.createPart(partInput());
  const drawer = ctx.locations.createLocation({ name: "Drawer A1", notes: null });
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
  const reserve = (projectId: number, lineId: number, amount: string) =>
    ctx.allocations.reserve({
      projectId,
      lineId,
      partId: screw,
      locationId: drawer,
      amount,
      unit: "pcs",
    });
  reserve(projectA, lineA, "8");
  reserve(projectB, lineB, "12");

  const { id: orderId } = ctx.orders.createOrder(
    { supplier: "Bolt Depot", reference: "BD-1", expectedOn: null, trackingUrl: null, notes: null },
    [
      {
        partId: screw,
        supplierSku: null,
        purchaseQuantity: 1,
        purchaseUnit: "pack",
        packQuantity: 10,
        unitPrice: null,
        currency: null,
        notes: null,
      },
    ]
  );
  ctx.orders.markPlaced(orderId, DAY);
  const orderLineId = ctx.orders.getOrderDetails(orderId)!.lines[0].id;
  return { ...ctx, screw, drawer, projectA, projectB, lineA, lineB, orderId, orderLineId };
}

type Ctx = ReturnType<typeof setup>;

function coverage(ctx: Ctx, projectId: number, lineId: number) {
  const { required, used, picked, reserved, uncovered, ordered, neededNotOrdered, excess } =
    ctx.allocations.getProjectCoverage(projectId)[lineId];
  return { required, used, picked, reserved, uncovered, ordered, neededNotOrdered, excess };
}

function assign(ctx: Ctx, projectId: number, lineId: number, quantity: number) {
  ctx.commitments.assign({ projectId, lineId, orderLineId: ctx.orderLineId, quantity });
}

function receive(
  ctx: Ctx,
  accepted: number,
  options: {
    damaged?: number;
    cancelRemainder?: boolean;
    assignments?: { commitmentId: number; quantity: number }[];
  } = {}
) {
  return ctx.receipts.receive({
    operationId: opId(),
    orderId: ctx.orderId,
    receivedOn: DAY,
    notes: null,
    lines: [
      {
        orderLineId: ctx.orderLineId,
        acceptedQuantity: accepted,
        damagedQuantity: options.damaged ?? 0,
        locationId: ctx.drawer,
        notes: null,
        cancelRemainder: options.cancelRemainder,
        assignments: options.assignments,
      },
    ],
  });
}

const commitmentsOf = (ctx: Ctx) =>
  listOrderLineCommitments(ctx.db, [ctx.orderLineId]).map((c) => ({
    bomLineId: c.bomLineId,
    quantity: c.quantity,
    sequence: c.sequence,
  }));

const uncommitted = (ctx: Ctx, projectId: number, lineId: number) =>
  ctx.commitments
    .listIncomingOptions(projectId, lineId)
    .find((o) => o.orderLineId === ctx.orderLineId)?.uncommitted ?? 0;

/** Physical stock: storage balance plus every project's held stock. */
function physicalStock(ctx: Ctx) {
  const held = [ctx.projectA, ctx.projectB].reduce((sum, projectId) => {
    const holding = getHoldingLocation(ctx.db, projectId);
    return sum + (holding ? getBalance(ctx.db, ctx.screw, holding.id) : 0);
  }, 0);
  return getBalance(ctx.db, ctx.screw, ctx.drawer) + held;
}

describe("worked case", () => {
  it("covers B with 12 reserved and 3 ordered, converts the receipt, and picks without consuming", () => {
    const ctx = setup();
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({
      reserved: 12,
      uncovered: 3,
      ordered: 0,
      neededNotOrdered: 3,
    });

    assign(ctx, ctx.projectB, ctx.lineB, 3);
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toEqual({
      required: 15,
      used: 0,
      picked: 0,
      reserved: 12,
      uncovered: 3,
      ordered: 3,
      neededNotOrdered: 0,
      excess: 0,
    });
    expect(uncommitted(ctx, ctx.projectB, ctx.lineB)).toBe(7);
    expect(coverage(ctx, ctx.projectA, ctx.lineA)).toMatchObject({ reserved: 8, ordered: 0 });

    receive(ctx, 3);
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({
      reserved: 15,
      ordered: 0,
      neededNotOrdered: 0,
    });
    expect(commitmentsOf(ctx)).toEqual([]);
    expect(getOrderLine(ctx.db, ctx.orderLineId)!.outstanding).toBe(7);
    expect(uncommitted(ctx, ctx.projectB, ctx.lineB)).toBe(7);

    const before = physicalStock(ctx);
    expect(before).toBe(23);
    ctx.allocations.pick({
      operationId: opId(),
      occurredOn: DAY,
      projectId: ctx.projectB,
      lineId: ctx.lineB,
      partId: ctx.screw,
      locationId: ctx.drawer,
      amount: "15",
      unit: "pcs",
    });
    expect(physicalStock(ctx)).toBe(before);
    expect(getBalance(ctx.db, ctx.screw, ctx.drawer)).toBe(8);
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({
      picked: 15,
      reserved: 0,
      used: 0,
      neededNotOrdered: 0,
    });
  });
});

describe("assignment", () => {
  it("does not let two projects claim the same incoming quantity, even from a stale page", () => {
    const ctx = setup();
    const projectC = ctx.projects.createProject(projectInput({ name: "C" }));
    const lineC = ctx.projects.createBomLine(
      projectC,
      lineInput({ partId: ctx.screw, amount: "9" })
    );

    // Both pages showed 10 uncommitted. C commits 9 first; B's stale submission of 3 fails.
    assign(ctx, projectC, lineC, 9);
    expect(() => assign(ctx, ctx.projectB, ctx.lineB, 3)).toThrow(
      "1 pcs of M3 × 8 mm socket-head screw on this order is not committed yet; cannot commit 3 pcs"
    );
    assign(ctx, ctx.projectB, ctx.lineB, 1);
    expect(commitmentsOf(ctx)).toEqual([
      { bomLineId: lineC, quantity: 9, sequence: 1 },
      { bomLineId: ctx.lineB, quantity: 1, sequence: 2 },
    ]);
  });

  it("does not let identical requirements in different components share incoming supply", () => {
    const ctx = setup();
    const project = ctx.projects.createProject(projectInput({ name: "Lamp" }));
    const power = ctx.projects.createComponent(project, { name: "Power supply", notes: null });
    const controller = ctx.projects.createComponent(project, { name: "Controller", notes: null });
    const first = ctx.projects.createBomLine(
      project,
      lineInput({ partId: ctx.screw, amount: "6", componentId: power })
    );
    const second = ctx.projects.createBomLine(
      project,
      lineInput({ partId: ctx.screw, amount: "6", componentId: controller })
    );

    assign(ctx, project, first, 6);
    expect(() => assign(ctx, project, second, 6)).toThrow(InventoryError);
    assign(ctx, project, second, 4);
    expect(coverage(ctx, project, first)).toMatchObject({ ordered: 6, neededNotOrdered: 0 });
    expect(coverage(ctx, project, second)).toMatchObject({ ordered: 4, neededNotOrdered: 2 });

    // Regrouping and removing a group keep the commitments and the demand.
    ctx.projects.setLineComponent(project, second, power);
    ctx.projects.removeComponent(project, power);
    expect(coverage(ctx, project, first)).toMatchObject({ ordered: 6, neededNotOrdered: 0 });
    expect(coverage(ctx, project, second)).toMatchObject({ ordered: 4, neededNotOrdered: 2 });
  });

  it("rejects more than the row still needs, draft orders, and unapproved parts", () => {
    const ctx = setup();
    expect(() => assign(ctx, ctx.projectB, ctx.lineB, 4)).toThrow(
      "This row needs only 3 pcs beyond its stock and orders"
    );

    const nut = ctx.catalog.createPart(partInput({ name: "M3 nut" }));
    const { id: draftId } = ctx.orders.createOrder(
      { supplier: "Bolt Depot", reference: null, expectedOn: null, trackingUrl: null, notes: null },
      [
        {
          partId: ctx.screw,
          supplierSku: null,
          purchaseQuantity: 5,
          purchaseUnit: "each",
          packQuantity: 1,
          unitPrice: null,
          currency: null,
          notes: null,
        },
        {
          partId: nut,
          supplierSku: null,
          purchaseQuantity: 5,
          purchaseUnit: "each",
          packQuantity: 1,
          unitPrice: null,
          currency: null,
          notes: null,
        },
      ]
    );
    const [draftScrew, draftNut] = ctx.orders.getOrderDetails(draftId)!.lines;
    const assignLine = (orderLineId: number) =>
      ctx.commitments.assign({
        projectId: ctx.projectB,
        lineId: ctx.lineB,
        orderLineId,
        quantity: 1,
      });
    expect(() => assignLine(draftScrew.id)).toThrow("Draft orders are not incoming supply");
    ctx.orders.markPlaced(draftId, DAY);
    expect(() => assignLine(draftNut.id)).toThrow("not the row's exact part or an approved choice");
  });

  it("releases a commitment so another project can use the supply", () => {
    const ctx = setup();
    assign(ctx, ctx.projectB, ctx.lineB, 3);
    const [commitment] = listOrderLineCommitments(ctx.db, [ctx.orderLineId]);
    ctx.commitments.release({
      projectId: ctx.projectB,
      lineId: ctx.lineB,
      commitmentId: commitment.id,
      quantity: 2,
    });
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({
      ordered: 1,
      neededNotOrdered: 2,
    });
    expect(uncommitted(ctx, ctx.projectB, ctx.lineB)).toBe(9);
  });
});

describe("partial receipts", () => {
  /** B (sequence 1) has 3 committed and C (sequence 2) has 5 committed of the 10 ordered. */
  function twoCommitments() {
    const ctx = setup();
    const projectC = ctx.projects.createProject(projectInput({ name: "C" }));
    const lineC = ctx.projects.createBomLine(
      projectC,
      lineInput({ partId: ctx.screw, amount: "5" })
    );
    assign(ctx, ctx.projectB, ctx.lineB, 3);
    assign(ctx, projectC, lineC, 5);
    return { ...ctx, projectC, lineC };
  }

  it("previews the assignment in commitment sequence order", () => {
    expect(
      assignInSequence(
        [
          { id: 1, quantity: 3 },
          { id: 2, quantity: 5 },
        ],
        4
      )
    ).toEqual([
      { commitmentId: 1, quantity: 3 },
      { commitmentId: 2, quantity: 1 },
    ]);
  });

  it("converts only accepted assigned quantities in sequence order and keeps the remainder", () => {
    const ctx = twoCommitments();
    receive(ctx, 4);
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({ reserved: 15, ordered: 0 });
    expect(coverage(ctx, ctx.projectC, ctx.lineC)).toMatchObject({
      reserved: 1,
      ordered: 4,
      neededNotOrdered: 0,
    });
    expect(commitmentsOf(ctx)).toEqual([{ bomLineId: ctx.lineC, quantity: 4, sequence: 2 }]);
  });

  it("follows the owner's changed assignment", () => {
    const ctx = twoCommitments();
    const [b, c] = listOrderLineCommitments(ctx.db, [ctx.orderLineId]);
    receive(ctx, 4, {
      assignments: [
        { commitmentId: b.id, quantity: 0 },
        { commitmentId: c.id, quantity: 4 },
      ],
    });
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({ reserved: 12, ordered: 3 });
    expect(coverage(ctx, ctx.projectC, ctx.lineC)).toMatchObject({ reserved: 4, ordered: 1 });
    // 4 screws arrived; the drawer has 24, and 12 + 8 + 4 of them are reserved.
    expect(getBalance(ctx.db, ctx.screw, ctx.drawer)).toBe(24);
  });

  it("rejects a stale assignment without writing", () => {
    const ctx = twoCommitments();
    const [b] = listOrderLineCommitments(ctx.db, [ctx.orderLineId]);
    expect(() => receive(ctx, 4, { assignments: [{ commitmentId: b.id, quantity: 4 }] })).toThrow(
      "has 3 pcs committed; cannot assign 4 pcs"
    );
    ctx.commitments.release({
      projectId: ctx.projectB,
      lineId: ctx.lineB,
      commitmentId: b.id,
      quantity: 3,
    });
    expect(() => receive(ctx, 3, { assignments: [{ commitmentId: b.id, quantity: 3 }] })).toThrow(
      "no longer exists"
    );
    expect(getBalance(ctx.db, ctx.screw, ctx.drawer)).toBe(20);
    expect(getOrderLine(ctx.db, ctx.orderLineId)!.outstanding).toBe(10);
  });
});

describe("lost supply", () => {
  it("reduces the latest commitments when items arrive damaged and exposes the shortage", () => {
    const ctx = setup();
    const projectC = ctx.projects.createProject(projectInput({ name: "C" }));
    const lineC = ctx.projects.createBomLine(
      projectC,
      lineInput({ partId: ctx.screw, amount: "7" })
    );
    assign(ctx, ctx.projectB, ctx.lineB, 3);
    assign(ctx, projectC, lineC, 7);

    // 2 usable go to B; 6 damaged leave 2 outstanding for C's 7.
    receive(ctx, 2, { damaged: 6 });
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({
      reserved: 14,
      ordered: 1,
      neededNotOrdered: 0,
    });
    expect(coverage(ctx, projectC, lineC)).toMatchObject({ ordered: 1, neededNotOrdered: 6 });
    expect(getOrderLine(ctx.db, ctx.orderLineId)!.outstanding).toBe(2);
  });

  it("removes commitments when the remainder is cancelled", () => {
    const ctx = setup();
    assign(ctx, ctx.projectB, ctx.lineB, 3);
    expect(ctx.orders.cancelRemainder(ctx.orderId, ctx.orderLineId)).toBe(1);
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({
      ordered: 0,
      neededNotOrdered: 3,
    });
  });

  it("fits commitments to a corrected quantity and releases them when the line is removed", () => {
    const ctx = setup();
    const projectC = ctx.projects.createProject(projectInput({ name: "C" }));
    const lineC = ctx.projects.createBomLine(
      projectC,
      lineInput({ partId: ctx.screw, amount: "7" })
    );
    assign(ctx, ctx.projectB, ctx.lineB, 3);
    assign(ctx, projectC, lineC, 7);
    const line = getOrderLine(ctx.db, ctx.orderLineId)!;

    ctx.orders.updateLine(ctx.orderId, ctx.orderLineId, { ...line, packQuantity: 5 });
    expect(commitmentsOf(ctx)).toEqual([
      { bomLineId: ctx.lineB, quantity: 3, sequence: 1 },
      { bomLineId: lineC, quantity: 2, sequence: 2 },
    ]);

    ctx.orders.removeLine(ctx.orderId, ctx.orderLineId);
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({ neededNotOrdered: 3 });
    expect(coverage(ctx, projectC, lineC)).toMatchObject({ ordered: 0, neededNotOrdered: 7 });
  });
});

describe("requirement changes", () => {
  it("releases excess commitments when a requirement is reduced, without changing stock", () => {
    const ctx = setup();
    assign(ctx, ctx.projectB, ctx.lineB, 3);
    ctx.projects.updateBomLine(
      ctx.projectB,
      ctx.lineB,
      lineInput({ partId: ctx.screw, amount: "13" })
    );
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({
      reserved: 12,
      ordered: 1,
      neededNotOrdered: 0,
    });
    expect(getBalance(ctx.db, ctx.screw, ctx.drawer)).toBe(20);
  });

  it("releases commitments that a new reservation makes unnecessary", () => {
    const ctx = setup();
    ctx.allocations.release({
      projectId: ctx.projectA,
      lineId: ctx.lineA,
      partId: ctx.screw,
      locationId: ctx.drawer,
      amount: "2",
      unit: "pcs",
    });
    assign(ctx, ctx.projectB, ctx.lineB, 3);
    ctx.allocations.reserve({
      projectId: ctx.projectB,
      lineId: ctx.lineB,
      partId: ctx.screw,
      locationId: ctx.drawer,
      amount: "2",
      unit: "pcs",
    });
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({ reserved: 14, ordered: 1 });
  });

  it("releases incoming commitments on project cancellation and keeps picked stock", () => {
    const ctx = setup();
    assign(ctx, ctx.projectB, ctx.lineB, 3);
    ctx.allocations.pick({
      operationId: opId(),
      occurredOn: DAY,
      projectId: ctx.projectB,
      lineId: ctx.lineB,
      partId: ctx.screw,
      locationId: ctx.drawer,
      amount: "5",
      unit: "pcs",
    });
    const before = physicalStock(ctx);

    const result = ctx.projects.updateProject(
      ctx.projectB,
      projectInput({ name: "B", status: "cancelled" })
    );
    expect(result).toEqual({ releasedReservations: 1, releasedCommitments: 1 });
    expect(commitmentsOf(ctx)).toEqual([]);
    expect(physicalStock(ctx)).toBe(before);
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({ picked: 5, ordered: 0 });
  });

  it("releases the commitments of a deleted row", () => {
    const ctx = setup();
    const lineB2 = ctx.projects.createBomLine(
      ctx.projectB,
      lineInput({ partId: ctx.screw, amount: "4" })
    );
    assign(ctx, ctx.projectB, lineB2, 4);
    ctx.projects.deleteBomLine(ctx.projectB, lineB2);
    expect(commitmentsOf(ctx)).toEqual([]);
  });
});

describe("shopping list", () => {
  it("combines identical resolved requirements and keeps ambiguous ones separate", () => {
    const ctx = setup();
    const resistor = ctx.catalog.createPart(partInput({ name: "10k resistor" }));
    const projectC = ctx.projects.createProject(projectInput({ name: "C", status: "active" }));
    const component = ctx.projects.createComponent(projectC, { name: "Controller", notes: null });
    const lineC = ctx.projects.createBomLine(
      projectC,
      lineInput({ partId: ctx.screw, amount: "4", componentId: component })
    );
    const generic = ctx.projects.createBomLine(
      projectC,
      lineInput({ description: "10k resistor, any package", amount: "2" })
    );
    const otherGeneric = ctx.projects.createBomLine(
      ctx.projectB,
      lineInput({ description: "10k resistor, any package", amount: "3" })
    );

    const items = ctx.shopping.getShoppingList({ projectIds: null, component: null });
    const screws = items.find((item) => item.partId === ctx.screw)!;
    expect(screws).toMatchObject({
      quantity: 7,
      unit: "pcs",
      suggestion: { baseUnit: "pcs", available: 0, uncommittedIncoming: 10 },
    });
    expect(screws.requirements).toEqual([
      expect.objectContaining({ projectName: "B", lineId: ctx.lineB, quantity: 3 }),
      expect.objectContaining({
        projectName: "C",
        componentName: "Controller",
        lineId: lineC,
        quantity: 4,
      }),
    ]);
    // Unresolved requirements stay separate items, even with the same description.
    const unresolved = items.filter((item) => item.partId === null);
    expect(unresolved.map((item) => item.requirements.map((r) => r.lineId))).toEqual([
      [otherGeneric],
      [generic],
    ]);
    expect(items.some((item) => item.partId === resistor)).toBe(false);
  });

  it("does not reclaim an excluded project's reservations or commitments", () => {
    const ctx = setup();
    assign(ctx, ctx.projectB, ctx.lineB, 3);
    const only = (projectIds: number[]) =>
      ctx.shopping.getShoppingList({ projectIds, component: null });

    expect(only([ctx.projectA])).toEqual([]);
    ctx.projects.updateBomLine(
      ctx.projectA,
      ctx.lineA,
      lineInput({ partId: ctx.screw, amount: "30" })
    );
    expect(only([ctx.projectA])).toMatchObject([
      {
        partId: ctx.screw,
        quantity: 22,
        suggestion: { available: 0, uncommittedIncoming: 7 },
      },
    ]);
    expect(coverage(ctx, ctx.projectB, ctx.lineB)).toMatchObject({ reserved: 12, ordered: 3 });
  });
});
