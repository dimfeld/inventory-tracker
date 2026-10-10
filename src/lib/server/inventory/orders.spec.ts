import { describe, expect, it } from "vitest";
import { formatMoney } from "#lib/money.ts";
import { describePackConversion, packConversion } from "#lib/orders.ts";
import { getBalance, listPartMovements } from "#lib/server/db/movements.ts";
import { getOrderLine } from "#lib/server/db/orders.ts";
import { InventoryError } from "./errors";
import type { OrderLineInput } from "#lib/schemas/order.ts";
import { createReceiptService, type ReceivedStock } from "./receipts";
import { createTestInventory, opId, partInput } from "./test-helpers";

const DAY = "2026-10-01";

function lineInput(partId: number, overrides: Partial<OrderLineInput> = {}): OrderLineInput {
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

/** A screw part, a storage drawer, and a placed order for one pack of 100 screws. */
function setup(lines: (partId: number) => OrderLineInput[] = (id) => [lineInput(id)]) {
  const ctx = createTestInventory();
  const screw = ctx.catalog.createPart(partInput());
  const drawer = ctx.locations.createLocation({ name: "Drawer A1", notes: null });
  const { id: orderId } = ctx.orders.createOrder(
    { supplier: "Bolt Depot", reference: "BD-1", expectedOn: null, trackingUrl: null, notes: null },
    lines(screw)
  );
  ctx.orders.markPlaced(orderId, DAY);
  const lineIds = ctx.orders.getOrderDetails(orderId)!.lines.map((l) => l.id);
  return { ...ctx, screw, drawer, orderId, lineId: lineIds[0], lineIds };
}

type Ctx = ReturnType<typeof setup>;

function receive(
  ctx: Ctx,
  accepted: number,
  options: { damaged?: number; operationId?: string; cancelRemainder?: boolean } = {}
) {
  return ctx.receipts.receive({
    operationId: options.operationId ?? opId(),
    orderId: ctx.orderId,
    receivedOn: DAY,
    notes: null,
    lines: [
      {
        orderLineId: ctx.lineId,
        acceptedQuantity: accepted,
        damagedQuantity: options.damaged ?? 0,
        locationId: ctx.drawer,
        notes: null,
        cancelRemainder: options.cancelRemainder,
      },
    ],
  });
}

const stock = (ctx: Ctx) => getBalance(ctx.db, ctx.screw, ctx.drawer);
const line = (ctx: Ctx) => getOrderLine(ctx.db, ctx.lineId)!;
const incoming = (ctx: Ctx) => ctx.orders.incomingByPart([ctx.screw]);

describe("pack conversion", () => {
  it("converts a pack of 100 to 100 pieces and shows the conversion", () => {
    expect(packConversion(1, 100)).toBe(100);
    expect(
      describePackConversion({
        purchaseQuantity: 2,
        purchaseUnit: "pack",
        packQuantity: 100,
        baseUnit: "pcs",
      })
    ).toBe("2 pack × 100 pcs = 200 pcs");
  });

  it("rejects a missing or fractional pack size", () => {
    expect(() => packConversion(1, 0)).toThrow(/Pack size/);
    expect(() => packConversion(1, 2.5)).toThrow(/Pack size/);
    expect(() => setup((id) => [lineInput(id, { packQuantity: 0 })])).toThrow(/Pack size/);
  });

  it("receiving a pack of 100 adds 100 pieces", () => {
    const ctx = setup();
    expect(line(ctx).quantity).toBe(100);
    const result = ctx.receipts.receiveAllOutstanding({
      operationId: opId(),
      orderId: ctx.orderId,
      receivedOn: DAY,
      locationId: ctx.drawer,
      notes: null,
    });
    expect(result.lines).toMatchObject([{ acceptedQuantity: 100, locationName: "Drawer A1" }]);
    expect(stock(ctx)).toBe(100);
    expect(listPartMovements(ctx.db, ctx.screw)).toMatchObject([
      { movementType: "receipt", quantity: 100, receiptLineId: result.lines[0].id },
    ]);
    expect(line(ctx).outstanding).toBe(0);
  });
});

describe("repeat-safe receipts", () => {
  it("adds stock once for a repeated operation ID and returns the same receipt", () => {
    const ctx = setup();
    const operationId = opId();
    const first = receive(ctx, 30, { operationId });
    const again = receive(ctx, 30, { operationId });
    expect(first.repeated).toBe(false);
    expect(again.repeated).toBe(true);
    expect(again.receipt.id).toBe(first.receipt.id);
    expect(stock(ctx)).toBe(30);
    expect(line(ctx).receivedQuantity).toBe(30);

    // A repeated receive-all with the same ID also changes nothing.
    const all = ctx.receipts.receiveAllOutstanding({
      operationId,
      orderId: ctx.orderId,
      receivedOn: DAY,
      locationId: ctx.drawer,
      notes: null,
    });
    expect(all.receipt.id).toBe(first.receipt.id);
    expect(stock(ctx)).toBe(30);
  });

  it("records a distinct receipt with the same quantity", () => {
    const ctx = setup();
    const first = receive(ctx, 30);
    const second = receive(ctx, 30);
    expect(second.receipt.id).not.toBe(first.receipt.id);
    expect(stock(ctx)).toBe(60);
    expect(ctx.orders.getOrderDetails(ctx.orderId)!.receipts).toHaveLength(2);
  });
});

describe("outstanding supply", () => {
  it("does not count draft orders as incoming", () => {
    const ctx = createTestInventory();
    const screw = ctx.catalog.createPart(partInput());
    ctx.orders.createOrder(
      { supplier: "Bolt Depot", reference: null, expectedOn: null, trackingUrl: null, notes: null },
      [lineInput(screw)]
    );
    expect(ctx.orders.incomingByPart([screw])).toEqual([]);
  });

  it("reports placed and shipped supply separately", () => {
    const ctx = setup();
    const { id: second } = ctx.orders.createOrder(
      { supplier: "Bolt Depot", reference: null, expectedOn: null, trackingUrl: null, notes: null },
      [lineInput(ctx.screw, { purchaseQuantity: 3, packQuantity: 10 })]
    );
    ctx.orders.markPlaced(second, DAY);
    ctx.orders.markShipped(second, DAY);
    expect(incoming(ctx)).toMatchObject([
      {
        placed: 100,
        shipped: 30,
        lines: [
          { orderLineId: ctx.lineId, status: "placed", outstanding: 100 },
          { orderId: second, status: "shipped", outstanding: 30 },
        ],
      },
    ]);
  });

  it("leaves the remainder after a partial receipt and drops fully received lines", () => {
    const ctx = setup((id) => [lineInput(id), lineInput(id, { packQuantity: 50 })]);
    receive(ctx, 40);
    expect(line(ctx).outstanding).toBe(60);
    expect(incoming(ctx)).toMatchObject([{ placed: 110 }]);

    receive(ctx, 60);
    expect(line(ctx).outstanding).toBe(0);
    expect(stock(ctx)).toBe(100);
    // The order stays open for its other line, but the received line is not incoming.
    expect(ctx.orders.listIncomingLines([ctx.screw])).toMatchObject([
      { orderLineId: ctx.lineIds[1], outstanding: 50 },
    ]);
    expect(incoming(ctx)).toMatchObject([{ placed: 50 }]);
  });
});

describe("delivery review", () => {
  const LATER = "2026-10-05";
  const delivery = (ctx: Ctx) => ctx.orders.getOrderDetails(ctx.orderId)!.delivery;
  const lineAt = (ctx: Ctx, i: number) => getOrderLine(ctx.db, ctx.lineIds[i])!;

  it("marking delivered does not change stock or outstanding supply", () => {
    const ctx = setup();
    expect(ctx.orders.markLinesDelivered(ctx.orderId, [ctx.lineId], DAY)).toBe(1);
    expect(line(ctx)).toMatchObject({ deliveryState: "awaiting_review", deliveredOn: DAY });
    expect(delivery(ctx)).toBe("awaiting_review");
    expect(stock(ctx)).toBe(0);
    expect(listPartMovements(ctx.db, ctx.screw)).toEqual([]);
    expect(line(ctx).outstanding).toBe(100);
  });

  it("marks only the selected lines delivered and receives the selected lines", () => {
    const ctx = setup((id) => [lineInput(id), lineInput(id), lineInput(id)]);
    expect(delivery(ctx)).toBe("not_delivered");
    ctx.orders.markLinesDelivered(ctx.orderId, [ctx.lineIds[0], ctx.lineIds[2]], DAY);
    expect(ctx.lineIds.map((_, i) => lineAt(ctx, i).deliveryState)).toEqual([
      "awaiting_review",
      "not_delivered",
      "awaiting_review",
    ]);
    expect(lineAt(ctx, 1).deliveredOn).toBeNull();

    const receiveLines = (ids: number[]) =>
      ctx.receipts.receiveAllOutstanding({
        operationId: opId(),
        orderId: ctx.orderId,
        receivedOn: LATER,
        locationId: ctx.drawer,
        notes: null,
        orderLineIds: ids,
      });
    receiveLines([ctx.lineIds[0], ctx.lineIds[2]]);
    expect(lineAt(ctx, 0)).toMatchObject({ deliveryState: "reviewed", deliveredOn: DAY });
    expect(lineAt(ctx, 1)).toMatchObject({ deliveryState: "not_delivered", outstanding: 100 });
    expect(stock(ctx)).toBe(200);
    expect(delivery(ctx)).toBe("partly_delivered");
    expect(() => receiveLines([ctx.lineIds[0]])).toThrow(/nothing outstanding/);

    // The rest of the order arrives in a later parcel.
    expect(ctx.orders.markOutstandingDelivered(ctx.orderId, LATER)).toBe(1);
    expect(lineAt(ctx, 1)).toMatchObject({ deliveryState: "awaiting_review", deliveredOn: LATER });
    expect(lineAt(ctx, 0).deliveredOn).toBe(DAY);
    expect(() => ctx.orders.markOutstandingDelivered(ctx.orderId, LATER)).toThrow(
      /No outstanding line/
    );
    receiveLines([ctx.lineIds[1]]);
    expect(stock(ctx)).toBe(300);
    expect(delivery(ctx)).toBe("reviewed");
  });

  it("does not mark lines of a draft order or lines with nothing outstanding delivered", () => {
    const ctx = createTestInventory();
    const screw = ctx.catalog.createPart(partInput());
    const { id } = ctx.orders.createOrder(
      { supplier: "Bolt Depot", reference: null, expectedOn: null, trackingUrl: null, notes: null },
      [lineInput(screw)]
    );
    const lineId = ctx.orders.getOrderDetails(id)!.lines[0].id;
    expect(() => ctx.orders.markLinesDelivered(id, [lineId], DAY)).toThrow(/Place the order/);

    const placed = setup();
    receive(placed, 100);
    expect(() => placed.orders.markLinesDelivered(placed.orderId, [placed.lineId], DAY)).toThrow(
      /no outstanding quantity/
    );
  });

  it("a receipt of a line that was not marked delivered counts as delivery and review", () => {
    const ctx = setup((id) => [lineInput(id), lineInput(id)]);
    receive(ctx, 100);
    expect(line(ctx)).toMatchObject({ deliveryState: "reviewed", deliveredOn: DAY });
    expect(delivery(ctx)).toBe("partly_delivered");
  });

  it("a receipt of a line awaiting review keeps the earlier delivery date", () => {
    const ctx = setup();
    ctx.orders.markLinesDelivered(ctx.orderId, [ctx.lineId], DAY);
    ctx.receipts.receiveAllOutstanding({
      operationId: opId(),
      orderId: ctx.orderId,
      receivedOn: LATER,
      locationId: ctx.drawer,
      notes: null,
    });
    expect(line(ctx)).toMatchObject({ deliveryState: "reviewed", deliveredOn: DAY });
    expect(delivery(ctx)).toBe("reviewed");
  });

  it("a partial receipt leaves the rest expected and keeps the date of that delivery", () => {
    const ctx = setup();
    ctx.orders.markLinesDelivered(ctx.orderId, [ctx.lineId], DAY);
    receive(ctx, 40);
    expect(line(ctx)).toMatchObject({
      deliveryState: "not_delivered",
      deliveredOn: DAY,
      outstanding: 60,
    });
    expect(delivery(ctx)).toBe("partly_delivered");

    // The rest arrives later and is received without being marked delivered first.
    ctx.receipts.receiveAllOutstanding({
      operationId: opId(),
      orderId: ctx.orderId,
      receivedOn: LATER,
      locationId: ctx.drawer,
      notes: null,
    });
    expect(line(ctx)).toMatchObject({ deliveryState: "reviewed", deliveredOn: LATER });
    expect(delivery(ctx)).toBe("reviewed");
  });

  it("a cancelled remainder after a partial receipt makes the line reviewed", () => {
    const ctx = setup();
    receive(ctx, 40);
    ctx.orders.cancelRemainder(ctx.orderId, ctx.lineId);
    expect(line(ctx)).toMatchObject({ deliveryState: "reviewed", deliveredOn: DAY });
    expect(delivery(ctx)).toBe("reviewed");
  });

  it("ignores lines whose whole quantity is cancelled", () => {
    const ctx = setup((id) => [lineInput(id), lineInput(id)]);
    ctx.orders.cancelRemainder(ctx.orderId, ctx.lineIds[1]);
    expect(lineAt(ctx, 1).deliveryState).toBe("not_delivered");
    expect(delivery(ctx)).toBe("not_delivered");
    receive(ctx, 100);
    expect(delivery(ctx)).toBe("reviewed");
    expect(ctx.orders.listOrders().find((o) => o.id === ctx.orderId)!.delivery).toBe("reviewed");
  });
});

describe("damaged, cancelled, and over-receipt", () => {
  it("records damaged items without adding them to stock", () => {
    const ctx = setup();
    receive(ctx, 90, { damaged: 10 });
    expect(stock(ctx)).toBe(90);
    expect(line(ctx)).toMatchObject({ receivedQuantity: 90, damagedQuantity: 10, outstanding: 0 });
  });

  it("cancels the remainder without adding stock", () => {
    const ctx = setup();
    receive(ctx, 30, { damaged: 5, cancelRemainder: true });
    expect(stock(ctx)).toBe(30);
    expect(line(ctx)).toMatchObject({ cancelledQuantity: 65, outstanding: 0 });
    expect(incoming(ctx)).toEqual([]);

    const other = setup();
    receive(other, 20);
    other.orders.cancelRemainder(other.orderId, other.lineId);
    expect(line(other)).toMatchObject({ receivedQuantity: 20, cancelledQuantity: 80 });
    expect(stock(other)).toBe(20);
  });

  it("rejects an over-receipt without changes until the order is corrected", () => {
    const ctx = setup();
    receive(ctx, 60);
    expect(() => receive(ctx, 50)).toThrow(/40 pcs is outstanding.*Correct the order line/);
    expect(() => receive(ctx, 30, { damaged: 20 })).toThrow(InventoryError);
    expect(stock(ctx)).toBe(60);
    expect(line(ctx)).toMatchObject({ receivedQuantity: 60, damagedQuantity: 0, outstanding: 40 });
    expect(ctx.orders.getOrderDetails(ctx.orderId)!.receipts).toHaveLength(1);

    // The supplier sent a bigger pack: correct the line to 1 × 110, then receive 50.
    ctx.orders.updateLine(ctx.orderId, ctx.lineId, lineInput(ctx.screw, { packQuantity: 110 }));
    receive(ctx, 50);
    expect(stock(ctx)).toBe(110);
    expect(line(ctx).outstanding).toBe(0);
  });

  it("does not correct a line below what already arrived", () => {
    const ctx = setup();
    receive(ctx, 60);
    expect(() =>
      ctx.orders.updateLine(ctx.orderId, ctx.lineId, lineInput(ctx.screw, { packQuantity: 50 }))
    ).toThrow(/60 pcs of this line already arrived/);
    expect(() => ctx.orders.removeLine(ctx.orderId, ctx.lineId)).toThrow(/Cancel its remainder/);
  });

  it("does not receive a draft order", () => {
    const ctx = createTestInventory();
    const screw = ctx.catalog.createPart(partInput());
    const drawer = ctx.locations.createLocation({ name: "Drawer A1", notes: null });
    const { id } = ctx.orders.createOrder(
      { supplier: "Bolt Depot", reference: null, expectedOn: null, trackingUrl: null, notes: null },
      [lineInput(screw)]
    );
    expect(() =>
      ctx.receipts.receiveAllOutstanding({
        operationId: opId(),
        orderId: id,
        receivedOn: DAY,
        locationId: drawer,
        notes: null,
      })
    ).toThrow(/Place the order/);
    expect(getBalance(ctx.db, screw, drawer)).toBe(0);
  });
});

describe("receipt hooks", () => {
  it("calls the hook inside the transaction and rolls back when it throws", () => {
    const ctx = setup();
    const received: ReceivedStock[] = [];
    const recording = createReceiptService(ctx.db, {
      hooks: {
        onLineReceived: (_db, stock) => void received.push(stock),
        onPiecesReceived() {},
      },
    });
    recording.receive({
      operationId: opId(),
      orderId: ctx.orderId,
      receivedOn: DAY,
      notes: null,
      lines: [
        {
          orderLineId: ctx.lineId,
          acceptedQuantity: 25,
          damagedQuantity: 0,
          locationId: ctx.drawer,
          notes: null,
        },
      ],
    });
    expect(received).toMatchObject([
      { orderLineId: ctx.lineId, partId: ctx.screw, locationId: ctx.drawer, quantity: 25 },
    ]);

    const rejecting = createReceiptService(ctx.db, {
      hooks: {
        onLineReceived() {
          throw new InventoryError("rejected");
        },
        onPiecesReceived() {},
      },
    });
    expect(() =>
      rejecting.receiveAllOutstanding({
        operationId: opId(),
        orderId: ctx.orderId,
        receivedOn: DAY,
        locationId: ctx.drawer,
        notes: null,
      })
    ).toThrow("rejected");
    expect(stock(ctx)).toBe(25);
    expect(line(ctx).outstanding).toBe(75);
  });
});

describe("supplier reference warning", () => {
  it("saves a repeated supplier reference and reports the other order", () => {
    const ctx = setup();
    const repeat = ctx.orders.createOrder({
      supplier: "bolt depot",
      reference: "bd-1",
      expectedOn: null,
      trackingUrl: null,
      notes: null,
    });
    expect(repeat.sameReference.map((o) => o.id)).toEqual([ctx.orderId]);
    expect(ctx.orders.getOrderDetails(repeat.id)).not.toBeNull();
  });
});

describe("actual purchase costs", () => {
  it("totals each currency separately and counts unpriced lines as unknown", () => {
    const ctx = createTestInventory();
    const screw = ctx.catalog.createPart(partInput());
    const nut = ctx.catalog.createPart(partInput({ name: "M3 nut" }));
    const { id } = ctx.orders.createOrder(
      { supplier: "Mixed", reference: null, expectedOn: null, trackingUrl: null, notes: null },
      [
        lineInput(screw, { purchaseQuantity: 2, unitPrice: "5.00", currency: "USD" }),
        lineInput(nut, { purchaseQuantity: 1, unitPrice: "3.5", currency: "EUR" }),
        lineInput(nut, { purchaseQuantity: 3, unitPrice: "0.25", currency: "USD" }),
        lineInput(screw),
      ]
    );
    const details = ctx.orders.getOrderDetails(id)!;
    expect(details.lines.map((l) => l.cost && formatMoney(l.cost))).toEqual([
      "10.00 USD",
      "3.5 EUR",
      "0.75 USD",
      null,
    ]);
    expect(details.costs.totals.map(formatMoney)).toEqual(["10.75 USD", "3.5 EUR"]);
    expect(details.costs.unknownCount).toBe(1);
    const listed = ctx.orders.listOrders().find((o) => o.id === id)!;
    expect(listed.costs).toEqual(details.costs);
  });

  it("does not charge cancelled quantity but still charges damaged stock", () => {
    const ctx = setup((id) => [
      lineInput(id, { purchaseQuantity: 3, unitPrice: "4.00", currency: "USD" }),
    ]);
    receive(ctx, 90, { damaged: 10 });
    ctx.orders.cancelRemainder(ctx.orderId, ctx.lineId);
    const details = ctx.orders.getOrderDetails(ctx.orderId)!;
    expect(formatMoney(details.lines[0].cost!)).toBe("4.00 USD");
  });

  it("rejects a currency that is not a three-letter code", () => {
    const ctx = setup();
    expect(() =>
      ctx.orders.addLine(ctx.orderId, lineInput(ctx.screw, { unitPrice: "1", currency: "$" }))
    ).toThrow(InventoryError);
  });
});
