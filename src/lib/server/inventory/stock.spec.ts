import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "#lib/server/db/connection.ts";
import { getBalance, listLocationBalances, listPartMovements } from "#lib/server/db/movements.ts";
import { UnitError } from "#lib/units.ts";
import { DuplicateOperationError, InsufficientStockError, InventoryError } from "./errors";
import type { ReservationGuard } from "./reservations";
import { createTestInventory, opId, partInput } from "./test-helpers";

const DAY = "2026-10-01";

function setup(options?: Parameters<typeof createTestInventory>[1]) {
  const inv = createTestInventory(undefined, options);
  const partId = inv.catalog.createPart(partInput());
  const drawer = inv.locations.createLocation({ name: "Drawer A1", notes: null });
  const bin = inv.locations.createLocation({ name: "Bin B2", notes: null });
  return { ...inv, partId, drawer, bin };
}

function movementCount(inv: ReturnType<typeof setup>) {
  return listPartMovements(inv.db, inv.partId).length;
}

describe("stock service", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
    ctx.stock.recordOpeningStock({
      operationId: opId(),
      partId: ctx.partId,
      locationId: ctx.drawer,
      amount: "20",
      unit: "pcs",
      occurredOn: DAY,
    });
  });

  it("records opening stock from an external source", () => {
    const [movement] = listPartMovements(ctx.db, ctx.partId);
    expect(movement).toMatchObject({
      movementType: "opening",
      fromLocationId: null,
      toLocationId: ctx.drawer,
      quantity: 20,
    });
    expect(getBalance(ctx.db, ctx.partId, ctx.drawer)).toBe(20);
  });

  it("transfers stock between locations and preserves the total", () => {
    ctx.stock.transfer({
      operationId: opId(),
      partId: ctx.partId,
      fromLocationId: ctx.drawer,
      toLocationId: ctx.bin,
      amount: "8",
      unit: "pcs",
      occurredOn: DAY,
    });

    const balances = listLocationBalances(ctx.db, ctx.partId);
    expect(balances).toEqual([
      { locationId: ctx.bin, locationName: "Bin B2", quantity: 8 },
      { locationId: ctx.drawer, locationName: "Drawer A1", quantity: 12 },
    ]);
    expect(balances.reduce((sum, b) => sum + b.quantity, 0)).toBe(20);
  });

  it("rejects a negative balance without writing", () => {
    const before = movementCount(ctx);
    expect(() =>
      ctx.stock.transfer({
        operationId: opId(),
        partId: ctx.partId,
        fromLocationId: ctx.drawer,
        toLocationId: ctx.bin,
        amount: "21",
        unit: "pcs",
        occurredOn: DAY,
      })
    ).toThrow(InsufficientStockError);
    expect(() =>
      ctx.stock.recordLoss({
        operationId: opId(),
        partId: ctx.partId,
        locationId: ctx.bin,
        amount: "1",
        unit: "pcs",
        occurredOn: DAY,
        reason: "dropped",
      })
    ).toThrow(InsufficientStockError);

    expect(movementCount(ctx)).toBe(before);
    expect(getBalance(ctx.db, ctx.partId, ctx.drawer)).toBe(20);
    expect(getBalance(ctx.db, ctx.partId, ctx.bin)).toBe(0);
  });

  it("rejects incompatible units without writing", () => {
    const before = movementCount(ctx);
    expect(() =>
      ctx.stock.recordOpeningStock({
        operationId: opId(),
        partId: ctx.partId,
        locationId: ctx.bin,
        amount: "2",
        unit: "m",
        occurredOn: DAY,
      })
    ).toThrow(UnitError);
    expect(movementCount(ctx)).toBe(before);
  });

  it("rejects a repeated operation ID without writing", () => {
    const operationId = opId();
    const input = {
      operationId,
      partId: ctx.partId,
      locationId: ctx.drawer,
      amount: "1",
      unit: "pcs" as const,
      occurredOn: DAY,
      reason: "lost",
    };
    ctx.stock.recordLoss(input);
    expect(() => ctx.stock.recordLoss(input)).toThrow(DuplicateOperationError);
    expect(getBalance(ctx.db, ctx.partId, ctx.drawer)).toBe(19);
  });

  it("records loss and supplier return as distinct external removals", () => {
    ctx.stock.recordLoss({
      operationId: opId(),
      partId: ctx.partId,
      locationId: ctx.drawer,
      amount: "2",
      unit: "pcs",
      occurredOn: DAY,
      reason: "stripped threads",
    });
    ctx.stock.recordSupplierReturn({
      operationId: opId(),
      partId: ctx.partId,
      locationId: ctx.drawer,
      amount: "3",
      unit: "pcs",
      occurredOn: DAY,
      reason: "wrong length shipped",
    });

    const [ret, loss] = listPartMovements(ctx.db, ctx.partId);
    expect(loss).toMatchObject({ movementType: "loss", toLocationId: null, quantity: 2 });
    expect(ret).toMatchObject({ movementType: "supplier_return", toLocationId: null, quantity: 3 });
    expect(getBalance(ctx.db, ctx.partId, ctx.drawer)).toBe(15);
  });

  it("appends a dated count correction and keeps the original history", () => {
    const original = listPartMovements(ctx.db, ctx.partId);

    const down = ctx.stock.recordStockCount({
      operationId: opId(),
      partId: ctx.partId,
      locationId: ctx.drawer,
      countedAmount: "17",
      unit: "pcs",
      occurredOn: "2026-10-02",
      reason: "annual count",
    });
    expect(down).toMatchObject({ previousQuantity: 20, countedQuantity: 17 });
    expect(down.movement).toMatchObject({
      movementType: "count_correction",
      fromLocationId: ctx.drawer,
      toLocationId: null,
      quantity: 3,
      occurredOn: "2026-10-02",
      reason: "annual count",
    });

    const up = ctx.stock.recordStockCount({
      operationId: opId(),
      partId: ctx.partId,
      locationId: ctx.drawer,
      countedAmount: "18",
      unit: "pcs",
      occurredOn: "2026-10-03",
      reason: "found one",
    });
    expect(up.movement).toMatchObject({
      fromLocationId: null,
      toLocationId: ctx.drawer,
      quantity: 1,
    });

    const same = ctx.stock.recordStockCount({
      operationId: opId(),
      partId: ctx.partId,
      locationId: ctx.drawer,
      countedAmount: "18",
      unit: "pcs",
      occurredOn: "2026-10-03",
      reason: "recount",
    });
    expect(same.movement).toBeNull();

    const history = listPartMovements(ctx.db, ctx.partId);
    expect(history).toHaveLength(3);
    expect(history.at(-1)).toEqual(original[0]);
    expect(getBalance(ctx.db, ctx.partId, ctx.drawer)).toBe(18);
  });

  it("keeps archived parts readable in history and blocks new stock changes", () => {
    ctx.catalog.archivePart(ctx.partId);

    const details = ctx.catalog.getPartDetails(ctx.partId)!;
    expect(details.part.archivedAt).not.toBeNull();
    expect(details.movements).toHaveLength(1);
    expect(details.balances[0].quantity).toBe(20);

    expect(() =>
      ctx.stock.recordOpeningStock({
        operationId: opId(),
        partId: ctx.partId,
        locationId: ctx.drawer,
        amount: "1",
        unit: "pcs",
        occurredOn: DAY,
      })
    ).toThrow(InventoryError);

    ctx.catalog.restorePart(ctx.partId);
    expect(ctx.catalog.getPartDetails(ctx.partId)!.part.archivedAt).toBeNull();
  });
});

describe("reservation guard", () => {
  it("is called for outgoing stock and can reject the change", () => {
    const calls: unknown[] = [];
    const guard: ReservationGuard = {
      assertOutgoingAllowed(_db, change) {
        calls.push(change);
        if (change.balanceAfter < 5) throw new InventoryError("5 are reserved");
      },
    };
    const ctx = setup({ reservations: guard });
    ctx.stock.recordOpeningStock({
      operationId: opId(),
      partId: ctx.partId,
      locationId: ctx.drawer,
      amount: "10",
      unit: "pcs",
      occurredOn: DAY,
    });
    expect(calls).toHaveLength(0);

    expect(() =>
      ctx.stock.transfer({
        operationId: opId(),
        partId: ctx.partId,
        fromLocationId: ctx.drawer,
        toLocationId: ctx.bin,
        amount: "6",
        unit: "pcs",
        occurredOn: DAY,
      })
    ).toThrow("5 are reserved");
    expect(calls).toEqual([
      {
        partId: ctx.partId,
        locationId: ctx.drawer,
        quantity: 6,
        movementType: "transfer",
        balanceBefore: 10,
        balanceAfter: 4,
      },
    ]);
    expect(getBalance(ctx.db, ctx.partId, ctx.bin)).toBe(0);
  });
});

describe("persistence", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "inventory-test-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps parts and opening stock after reopening the database", () => {
    const path = join(dir, "nested", "inventory.sqlite");
    const first = createTestInventory(openDatabase(path));
    const partId = first.catalog.createPart(partInput({ baseUnit: "mm", name: "Hookup wire" }));
    const reel = first.locations.createLocation({ name: "Wire rack", notes: null });
    first.stock.recordOpeningStock({
      operationId: opId(),
      partId,
      locationId: reel,
      amount: "2.5",
      unit: "m",
      occurredOn: DAY,
    });
    first.db.close();

    const second = createTestInventory(openDatabase(path));
    const details = second.catalog.getPartDetails(partId)!;
    expect(details.part.name).toBe("Hookup wire");
    expect(details.balances).toEqual([
      { locationId: reel, locationName: "Wire rack", quantity: 2500 },
    ]);
    second.db.close();
  });
});
