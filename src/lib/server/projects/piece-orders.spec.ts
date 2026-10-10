import { describe, expect, it } from "vitest";
import { formatMoney } from "#lib/money.ts";
import type { OrderLineInput } from "#lib/schemas/order.ts";
import { opId, partInput } from "#lib/server/inventory/test-helpers.ts";
import { createTestAllocations, lineInput, projectInput } from "./test-helpers";

const DAY = "2026-10-01";

const sku = (code: string, stockLengthMm: number, stockWidthMm: number | null = null) => ({
  id: null,
  supplier: "Misumi",
  sku: code,
  url: null,
  purchaseUnit: "pcs",
  packQuantity: 1,
  stockLengthMm,
  stockWidthMm,
});

/**
 * 2020 extrusion with a kerf of 3 mm, sold as 1000 mm (E-1000) and 2000 mm (E-2000) sticks, a
 * rack, and a project.
 */
function setup() {
  const ctx = createTestAllocations();
  const extrusion = ctx.catalog.createPart(
    partInput({
      name: "2020 extrusion",
      tracking: { mode: "pieces", lengthKey: "length", widthKey: null, kerfMm: 3, minOffcutMm: 20 },
      supplierParts: [sku("E-1000", 1000), sku("E-2000", 2000)],
    })
  );
  const rack = ctx.locations.createLocation({ name: "Rack", notes: null });
  const project = ctx.projects.createProject(projectInput({ name: "Printer frame" }));
  const cutLine = (description: string, lengthMm: number, amount = "1") =>
    ctx.projects.createBomLine(
      project,
      lineInput({ description, partId: extrusion, amount, cutLengthMm: lengthMm })
    );
  return { ...ctx, extrusion, rack, project, cutLine };
}

type Ctx = ReturnType<typeof setup>;

function orderLine(ctx: Ctx, overrides: Partial<OrderLineInput> = {}): OrderLineInput {
  return {
    partId: ctx.extrusion,
    supplierSku: "E-1000",
    purchaseQuantity: 1,
    purchaseUnit: "pcs",
    packQuantity: 1,
    unitPrice: null,
    currency: null,
    notes: null,
    ...overrides,
  };
}

/** A placed order from Misumi. Returns the order and its line IDs. */
function placeOrder(ctx: Ctx, lines: OrderLineInput[]) {
  const { id } = ctx.orders.createOrder(
    { supplier: "Misumi", reference: "M-1", expectedOn: null, trackingUrl: null, notes: null },
    lines
  );
  ctx.orders.markPlaced(id, DAY);
  return { orderId: id, lineIds: ctx.orders.getOrderDetails(id)!.lines.map((l) => l.id) };
}

/** Prices of the stock sizes from a placed order whose supply was then cancelled. */
function priceSticks(ctx: Ctx, prices: Record<string, string>) {
  const { orderId, lineIds } = placeOrder(
    ctx,
    Object.entries(prices).map(([code, unitPrice]) =>
      orderLine(ctx, { supplierSku: code, unitPrice, currency: "USD" })
    )
  );
  for (const lineId of lineIds) ctx.orders.cancelRemainder(orderId, lineId);
}

function shoppingItem(ctx: Ctx) {
  return ctx.shopping
    .getShoppingList({ projectIds: null, component: null })
    .find((item) => item.partId === ctx.extrusion);
}

const planSummary = (item: NonNullable<ReturnType<typeof shoppingItem>>) =>
  item.cutPlan!.pieces.map((piece) => ({
    sku: piece.sku,
    cuts: piece.cuts.map((cut) => `${cut.lineDescription} ${cut.lengthMm}`),
    wasteMm: piece.wasteMm,
  }));

describe("shopping for cut-size rows", () => {
  it("packs the uncovered cuts into the two stock lengths, after free offcuts", () => {
    const ctx = setup();
    ctx.cutLine("Top rail", 1500);
    ctx.cutLine("Post", 600);
    ctx.cutLine("Brace", 300, "3");
    // A free 400 mm offcut covers one brace.
    ctx.pieces.addPieces({
      operationId: opId(),
      occurredOn: DAY,
      partId: ctx.extrusion,
      locationId: ctx.rack,
      pieces: [{ lengthMm: 400, widthMm: null }],
    });

    const item = shoppingItem(ctx)!;
    expect(item.quantity).toBe(5);
    expect(item.coverage).toEqual({
      reserved: 0,
      freeStock: 1,
      committed: 0,
      freeOrdered: 0,
      toBuy: 2,
    });
    // Without prices, the plan with the least stock length wins: a 2000 mm stick for the rail
    // and a brace (1500 + 3 + 300 + 3 = 1806 mm), and a 1000 mm stick for the post and a brace.
    expect(planSummary(item)).toEqual([
      { sku: "E-2000", cuts: ["Top rail 1500", "Brace 300"], wasteMm: 194 },
      { sku: "E-1000", cuts: ["Post 600", "Brace 300"], wasteMm: 94 },
    ]);
    expect(item.cutPlan!.unplaced).toEqual([]);
  });

  it("chooses the cheapest stock length when prices are known, and lists cuts that fit none", () => {
    const ctx = setup();
    ctx.cutLine("Side", 900, "2");
    ctx.cutLine("Mast", 2500);
    // Two 1000 mm sticks cost 10.00; one 2000 mm stick costs 7.00.
    priceSticks(ctx, { "E-1000": "5.00", "E-2000": "7.00" });

    const item = shoppingItem(ctx)!;
    expect(planSummary(item)).toEqual([
      { sku: "E-2000", cuts: ["Side 900", "Side 900"], wasteMm: 194 },
    ]);
    expect(formatMoney(item.cutPlan!.pieces[0].price!)).toBe("7.00 USD");
    expect(item.cutPlan!.unplaced).toMatchObject([{ lineDescription: "Mast", lengthMm: 2500 }]);
    expect(item.coverage.toBuy).toBe(2);
  });

  it("buys one sheet per 2D cut, or the cuts per sheet the row gives", () => {
    const ctx = createTestAllocations();
    const pom = ctx.catalog.createPart(
      partInput({
        name: "POM-C sheet 15 mm",
        tracking: {
          mode: "pieces",
          lengthKey: "length",
          widthKey: "width",
          kerfMm: 0,
          minOffcutMm: 0,
        },
        supplierParts: [sku("POM-300", 300, 300)],
      })
    );
    const project = ctx.projects.createProject(projectInput());
    const line = ctx.projects.createBomLine(
      project,
      lineInput({
        description: "Foot",
        partId: pom,
        amount: "3",
        cutLengthMm: 100,
        cutWidthMm: 100,
      })
    );
    const sheets = () =>
      ctx.shopping
        .getShoppingList({ projectIds: null, component: null })[0]
        .cutPlan!.pieces.map((p) => p.cuts.length);
    expect(sheets()).toEqual([1, 1, 1]);
    ctx.projects.setCutsPerSheet(project, line, 2);
    expect(sheets()).toEqual([2, 1]);
  });
});

describe("estimates of cut-size rows", () => {
  it("splits the price of a shared stick by length plus kerf", () => {
    const ctx = setup();
    const rail = ctx.cutLine("Rail", 600);
    const post = ctx.cutLine("Post", 390);
    priceSticks(ctx, { "E-1000": "9.96" });

    const estimate = ctx.estimates.getProjectEstimate(ctx.project)!;
    const row = (id: number) => estimate.groups[0].rows.find((r) => r.line.id === id)!;
    // 600 + 3 = 603 and 390 + 3 = 393 of 996 mm of cuts on one 9.96 USD stick.
    expect(formatMoney(row(rail).estimate!)).toBe("6.03 USD");
    expect(formatMoney(row(post).estimate!)).toBe("3.93 USD");
    expect(row(rail).stockPieces).toBe(1);
    expect(estimate.totals.totals.map(formatMoney)).toEqual(["9.96 USD"]);
  });

  it("keeps a row unknown without a priced stock size", () => {
    const ctx = setup();
    const rail = ctx.cutLine("Rail", 600);
    const estimate = ctx.estimates.getProjectEstimate(ctx.project)!;
    expect(estimate.groups[0].rows.find((r) => r.line.id === rail)).toMatchObject({
      estimate: null,
      unknownReason: "No priced stock size",
    });
  });
});

describe("incoming piece commitments", () => {
  it("commits one incoming stick to two rows, and the receipt makes piece reservations", () => {
    const ctx = setup();
    const rail = ctx.cutLine("Rail", 600);
    const post = ctx.cutLine("Post", 390);
    const { orderId, lineIds } = placeOrder(ctx, [orderLine(ctx)]);
    const [orderLineId] = lineIds;

    const options = ctx.commitments.listIncomingOptions(ctx.project, rail);
    expect(options).toMatchObject([
      { orderLineId, outstanding: 1, committed: 0, uncommitted: 1, stockSize: { lengthMm: 1000 } },
    ]);
    ctx.commitments.assign({ projectId: ctx.project, lineId: rail, orderLineId, quantity: 1 });
    ctx.commitments.assign({ projectId: ctx.project, lineId: post, orderLineId, quantity: 1 });
    // 600 + 3 + 390 + 3 = 996 mm: a third cut does not fit.
    const brace = ctx.cutLine("Brace", 10);
    expect(() =>
      ctx.commitments.assign({ projectId: ctx.project, lineId: brace, orderLineId, quantity: 1 })
    ).toThrow("Only 0 pcs of 10 mm fit");

    const coverage = ctx.allocations.getProjectCoverage(ctx.project);
    expect(coverage[rail]).toMatchObject({ ordered: 1, neededNotOrdered: 0 });
    expect(coverage[post]).toMatchObject({ ordered: 1, neededNotOrdered: 0 });
    // Shopping buys only for the brace.
    const item = shoppingItem(ctx)!;
    expect(item.coverage).toMatchObject({ committed: 2, toBuy: 1 });
    expect(planSummary(item)).toEqual([{ sku: "E-1000", cuts: ["Brace 10"], wasteMm: 987 }]);

    ctx.receipts.receiveAllOutstanding({
      operationId: opId(),
      orderId,
      receivedOn: DAY,
      locationId: ctx.rack,
      notes: null,
    });
    const [piece] = ctx.pieces.listPartPieces(ctx.extrusion).pieces;
    const reservations = ctx.db
      .query<{ bom_line_id: number; piece_id: number; length_mm: number }, []>(
        "SELECT bom_line_id, piece_id, length_mm FROM piece_reservations ORDER BY id"
      )
      .all();
    expect(reservations).toEqual([
      { bom_line_id: rail, piece_id: piece.id, length_mm: 600 },
      { bom_line_id: post, piece_id: piece.id, length_mm: 390 },
    ]);
    expect(ctx.db.query("SELECT * FROM incoming_piece_commitments").all()).toEqual([]);
    expect(ctx.allocations.getProjectCoverage(ctx.project)[rail]).toMatchObject({
      reserved: 1,
      ordered: 0,
      uncovered: 0,
    });
  });

  it("uses the order line's piece size, and a size change releases its piece commitments", () => {
    const ctx = setup();
    const rail = ctx.cutLine("Rail", 600);
    const line = orderLine(ctx, { pieceLengthMm: 500 });
    const { orderId, lineIds } = placeOrder(ctx, [line]);
    const [orderLineId] = lineIds;

    // The 500 mm piece of the line, not the 1000 mm stock size of E-1000, is too short.
    expect(ctx.commitments.listIncomingOptions(ctx.project, rail)).toMatchObject([
      { orderLineId, uncommitted: 0, stockSize: { lengthMm: 500, widthMm: null } },
    ]);

    ctx.orders.updateLine(orderId, orderLineId, { ...line, pieceLengthMm: 700 });
    ctx.commitments.assign({ projectId: ctx.project, lineId: rail, orderLineId, quantity: 1 });
    expect(ctx.db.query("SELECT * FROM incoming_piece_commitments").all()).toHaveLength(1);

    // An unchanged size keeps the commitment; a new size releases it.
    expect(ctx.orders.updateLine(orderId, orderLineId, { ...line, pieceLengthMm: 700 })).toBe(0);
    expect(ctx.orders.updateLine(orderId, orderLineId, { ...line, pieceLengthMm: 650 })).toBe(1);
    expect(ctx.db.query("SELECT * FROM incoming_piece_commitments").all()).toEqual([]);
  });

  it("fills the lowest sticks on a partial receipt, and drops commitments of cancelled sticks", () => {
    const ctx = setup();
    const rail = ctx.cutLine("Rail", 900, "3");
    const { orderId, lineIds } = placeOrder(ctx, [orderLine(ctx, { purchaseQuantity: 3 })]);
    const [orderLineId] = lineIds;
    ctx.commitments.assign({ projectId: ctx.project, lineId: rail, orderLineId, quantity: 3 });
    const sticks = () =>
      ctx.db
        .query<{ stick_index: number }, []>(
          "SELECT stick_index FROM incoming_piece_commitments ORDER BY stick_index"
        )
        .all()
        .map((row) => row.stick_index);
    expect(sticks()).toEqual([0, 1, 2]);

    ctx.receipts.receive({
      operationId: opId(),
      orderId,
      receivedOn: DAY,
      notes: null,
      lines: [
        { orderLineId, acceptedQuantity: 1, damagedQuantity: 0, locationId: ctx.rack, notes: null },
      ],
    });
    expect(sticks()).toEqual([0, 1]);
    expect(ctx.allocations.getProjectCoverage(ctx.project)[rail]).toMatchObject({
      reserved: 1,
      ordered: 2,
    });

    ctx.orders.cancelRemainder(orderId, orderLineId);
    expect(sticks()).toEqual([]);
    expect(ctx.allocations.getProjectCoverage(ctx.project)[rail]).toMatchObject({
      reserved: 1,
      ordered: 0,
      neededNotOrdered: 2,
    });
  });

  it("releases a piece commitment, and a reservation releases commitments it makes unnecessary", () => {
    const ctx = setup();
    const rail = ctx.cutLine("Rail", 600);
    const { lineIds } = placeOrder(ctx, [orderLine(ctx)]);
    ctx.commitments.assign({
      projectId: ctx.project,
      lineId: rail,
      orderLineId: lineIds[0],
      quantity: 1,
    });
    const [commitment] = ctx.allocations.getProjectCoverage(ctx.project)[rail].parts[0]
      .pieceCommitments;
    ctx.commitments.releasePiece({
      projectId: ctx.project,
      lineId: rail,
      commitmentId: commitment.id,
    });
    expect(ctx.allocations.getProjectCoverage(ctx.project)[rail].ordered).toBe(0);

    ctx.commitments.assign({
      projectId: ctx.project,
      lineId: rail,
      orderLineId: lineIds[0],
      quantity: 1,
    });
    const [stick] = ctx.pieces.addPieces({
      operationId: opId(),
      occurredOn: DAY,
      partId: ctx.extrusion,
      locationId: ctx.rack,
      pieces: [{ lengthMm: 1000, widthMm: null }],
    });
    ctx.pieceAllocations.reservePieces({
      projectId: ctx.project,
      lineId: rail,
      pieces: [{ pieceId: stick.id }],
    });
    expect(ctx.allocations.getProjectCoverage(ctx.project)[rail]).toMatchObject({
      reserved: 1,
      ordered: 0,
    });
  });
});
