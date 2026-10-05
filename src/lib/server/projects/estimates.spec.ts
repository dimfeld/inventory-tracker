import { describe, expect, it } from "vitest";
import { formatMoney, type MoneyTotals } from "#lib/money.ts";
import type { OrderLineInput } from "#lib/schemas/order.ts";
import { insertChoice } from "#lib/server/db/projects.ts";
import { opId, partInput } from "#lib/server/inventory/test-helpers.ts";
import {
  createTestAllocations,
  lineInput,
  projectInput,
  stockAndCommitments,
} from "./test-helpers";

const DAY = "2026-10-01";

type Ctx = ReturnType<typeof createTestAllocations>;

function orderLine(partId: number, overrides: Partial<OrderLineInput> = {}): OrderLineInput {
  return {
    partId,
    supplierSku: null,
    purchaseQuantity: 1,
    purchaseUnit: "pack",
    packQuantity: 100,
    unitPrice: null,
    currency: null,
    notes: null,
    ...overrides,
  };
}

function order(ctx: Ctx, lines: OrderLineInput[], placedOn: string | null = DAY): number {
  const { id } = ctx.orders.createOrder(
    { supplier: "Bolt Depot", reference: "BD-1", expectedOn: null, trackingUrl: null, notes: null },
    lines
  );
  if (placedOn) ctx.orders.markPlaced(id, placedOn);
  return id;
}

const show = (totals: MoneyTotals) => ({
  totals: totals.totals.map(formatMoney),
  unknownCount: totals.unknownCount,
});

/**
 * Screws bought at 5.00 USD per pack of 100, nuts at 3.00 EUR per bag of 9, a project with a
 * Frame component, and stock with a reservation and an incoming commitment.
 */
function setup() {
  const ctx = createTestAllocations();
  const screw = ctx.catalog.createPart(partInput());
  const nut = ctx.catalog.createPart(partInput({ name: "M3 nut" }));
  const drawer = ctx.locations.createLocation({ name: "Drawer A1", notes: null });
  ctx.stock.recordOpeningStock({
    operationId: opId(),
    partId: screw,
    locationId: drawer,
    amount: "20",
    unit: "pcs",
    occurredOn: DAY,
  });
  const orderId = order(ctx, [
    orderLine(screw, { unitPrice: "5.00", currency: "USD" }),
    orderLine(nut, { purchaseUnit: "bag", packQuantity: 9, unitPrice: "3.00", currency: "EUR" }),
  ]);
  const project = ctx.projects.createProject(projectInput());
  const frame = ctx.projects.createComponent(project, { name: "Frame", notes: null });
  const screws = ctx.projects.createBomLine(
    project,
    lineInput({ partId: screw, amount: "8", componentId: frame })
  );
  const nuts = ctx.projects.createBomLine(
    project,
    lineInput({ description: "M3 nut", partId: nut, amount: "4" })
  );
  ctx.allocations.reserve({
    projectId: project,
    lineId: screws,
    partId: screw,
    locationId: drawer,
    amount: "8",
    unit: "pcs",
  });
  const orderLineId = ctx.orders.getOrderDetails(orderId)!.lines[1].id;
  ctx.commitments.assign({ projectId: project, lineId: nuts, orderLineId, quantity: 4 });
  return { ...ctx, screw, nut, orderId, project, frame, screws, nuts };
}

const estimate = (ctx: ReturnType<typeof setup>) => ctx.estimates.getProjectEstimate(ctx.project)!;

describe("project estimates", () => {
  it("prices each row from its pack price with the source and currency", () => {
    const ctx = setup();
    const rows = estimate(ctx).groups.flatMap((group) => group.rows);
    const screws = rows.find((row) => row.line.id === ctx.screws)!;
    expect(formatMoney(screws.source!.baseUnitPrice)).toBe("0.05 USD");
    expect(formatMoney(screws.estimate!)).toBe("0.40 USD");
    expect(screws.source).toMatchObject({
      orderId: ctx.orderId,
      supplier: "Bolt Depot",
      purchaseUnit: "pack",
      packQuantity: 100,
      unitPrice: "5.00",
    });
    const nuts = rows.find((row) => row.line.id === ctx.nuts)!;
    expect(formatMoney(nuts.source!.baseUnitPrice)).toBe("≈0.33 EUR");
    expect(formatMoney(nuts.estimate!)).toBe("≈1.33 EUR");
  });

  it("keeps currencies separate and groups rows once per component", () => {
    const ctx = setup();
    const result = estimate(ctx);
    expect(result.groups.map((g) => [g.component?.name ?? null, show(g.totals)])).toEqual([
      ["Frame", { totals: ["0.40 USD"], unknownCount: 0 }],
      [null, { totals: ["≈1.33 EUR"], unknownCount: 0 }],
    ]);
    expect(show(result.totals)).toEqual({ totals: ["0.40 USD", "≈1.33 EUR"], unknownCount: 0 });
  });

  it("leaves the project total unchanged when a row moves between groups", () => {
    const ctx = setup();
    const before = estimate(ctx).totals;
    ctx.projects.setLineComponent(ctx.project, ctx.nuts, ctx.frame);
    const after = estimate(ctx);
    expect(after.totals).toEqual(before);
    expect(after.groups.map((g) => [g.component?.name ?? null, show(g.totals)])).toEqual([
      ["Frame", { totals: ["0.40 USD", "≈1.33 EUR"], unknownCount: 0 }],
    ]);
  });

  it("converts a row unit to the part's base unit exactly", () => {
    const ctx = setup();
    const wire = ctx.catalog.createPart(partInput({ name: "Hookup wire", baseUnit: "m" }));
    order(ctx, [
      orderLine(wire, {
        purchaseUnit: "spool",
        packQuantity: 10,
        unitPrice: "10.00",
        currency: "USD",
      }),
    ]);
    const line = ctx.projects.createBomLine(
      ctx.project,
      lineInput({ description: "Wire", amount: "500", unit: "mm" })
    );
    ctx.projects.approveChoice(ctx.project, line, { partId: wire, substitute: true, note: "Any" });
    const row = estimate(ctx)
      .groups.flatMap((g) => g.rows)
      .find((r) => r.line.id === line)!;
    expect(formatMoney(row.estimate!)).toBe("0.50 USD");
  });

  it("uses the most recent placed purchase and ignores drafts", () => {
    const ctx = setup();
    order(ctx, [orderLine(ctx.screw, { unitPrice: "1.00", currency: "USD" })], null);
    order(ctx, [orderLine(ctx.screw, { unitPrice: "6.00", currency: "USD" })], "2026-10-02");
    const row = estimate(ctx).groups[0].rows[0];
    expect(formatMoney(row.estimate!)).toBe("0.48 USD");
  });

  it("reports unknown rows with a reason and never counts them as zero", () => {
    const ctx = setup();
    const draftOnly = ctx.catalog.createPart(partInput({ name: "Spacer" }));
    order(ctx, [orderLine(draftOnly, { unitPrice: "1.00", currency: "USD" })], null);
    const spacer = ctx.projects.createBomLine(
      ctx.project,
      lineInput({ description: "Spacer", partId: draftOnly })
    );
    const generic = ctx.projects.createBomLine(ctx.project, lineInput({ description: "Any M3" }));
    const glue = ctx.catalog.createPart(partInput({ name: "Glue", baseUnit: "mL" }));
    order(ctx, [orderLine(glue, { packQuantity: 50, unitPrice: "4.00", currency: "USD" })]);
    const mismatch = ctx.projects.createBomLine(ctx.project, lineInput({ description: "Glue" }));
    insertChoice(ctx.db, { bomLineId: mismatch, partId: glue, substitute: true, note: "Test" });

    const result = estimate(ctx);
    const reasons = new Map(
      result.groups.flatMap((g) => g.rows).map((r) => [r.line.id, r.unknownReason])
    );
    expect(reasons.get(spacer)).toBe("No priced purchase of the part");
    expect(reasons.get(generic)).toBe("No single chosen part");
    expect(reasons.get(mismatch)).toBe("Unit mismatch: pcs and mL");
    expect(show(result.totals)).toEqual({ totals: ["0.40 USD", "≈1.33 EUR"], unknownCount: 3 });
  });

  it("does not change stock, reservations, or commitments", () => {
    const ctx = setup();
    const before = stockAndCommitments(ctx.db);
    estimate(ctx);
    expect(stockAndCommitments(ctx.db)).toEqual(before);
  });
});

describe("order price edits", () => {
  it("changing only the price and currency leaves stock and commitments unchanged", () => {
    const ctx = setup();
    ctx.orders.markShipped(ctx.orderId, DAY);
    const line = ctx.orders.getOrderDetails(ctx.orderId)!.lines[1];
    const before = stockAndCommitments(ctx.db);
    const reduced = ctx.orders.updateLine(ctx.orderId, line.id, {
      partId: line.partId,
      supplierSku: line.supplierSku,
      purchaseQuantity: line.purchaseQuantity,
      purchaseUnit: line.purchaseUnit,
      packQuantity: line.packQuantity,
      unitPrice: "2.70",
      currency: "GBP",
      notes: line.notes,
    });
    expect(reduced).toBe(0);
    expect(stockAndCommitments(ctx.db)).toEqual(before);
    const updated = ctx.orders.getOrderDetails(ctx.orderId)!.lines[1];
    expect(formatMoney(updated.cost!)).toBe("2.70 GBP");
  });
});
