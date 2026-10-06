import { describe, expect, it } from "vitest";
import { getBalance, listPartMovements } from "#lib/server/db/movements.ts";
import {
  createTestAllocations,
  lineInput,
  projectInput,
} from "#lib/server/projects/test-helpers.ts";
import { InventoryError, NotFoundError } from "./errors";
import { opId, partInput } from "./test-helpers";

const DAY = "2026-10-01";

/** Two records of the same screw, each with stock, details, an order line, and a BOM row. */
function setup() {
  const ctx = createTestAllocations();
  const keep = ctx.catalog.createPart(
    partInput({
      name: "M3x8 screw",
      attributes: [{ key: "head", label: "Head", value: "Socket head" }],
      aliases: ["M3 SHCS"],
      tags: ["metric"],
      supplierParts: [
        {
          id: null,
          supplier: "Bolt Depot",
          sku: "BD-1",
          url: null,
          purchaseUnit: null,
          packQuantity: null,
        },
      ],
    })
  );
  const duplicate = ctx.catalog.createPart(
    partInput({
      name: "M3 x 8 screw",
      attributes: [{ key: "head", label: "Head", value: "Button head" }],
      aliases: ["M3x8", "M3 SHCS"],
      tags: ["dupe"],
      supplierParts: [
        {
          id: null,
          supplier: "Bolt Depot",
          sku: "BD-2",
          url: null,
          purchaseUnit: null,
          packQuantity: null,
        },
      ],
    })
  );
  const drawer = ctx.locations.createLocation({ name: "Drawer A1", notes: null });
  for (const [partId, amount] of [
    [keep, "10"],
    [duplicate, "5"],
  ] as const) {
    ctx.stock.recordOpeningStock({
      operationId: opId(),
      partId,
      locationId: drawer,
      amount,
      unit: "pcs",
      occurredOn: DAY,
    });
  }
  const { id: orderId } = ctx.orders.createOrder(
    { supplier: "Bolt Depot", reference: "BD-1", expectedOn: null, trackingUrl: null, notes: null },
    [
      {
        partId: duplicate,
        supplierSku: "BD-2",
        purchaseQuantity: 1,
        purchaseUnit: "pack",
        packQuantity: 100,
        unitPrice: null,
        currency: null,
        notes: null,
      },
    ]
  );
  const project = ctx.projects.createProject(projectInput());
  const line = ctx.projects.createBomLine(project, lineInput({ partId: duplicate, amount: "4" }));
  return { ...ctx, keep, duplicate, drawer, orderId, project, line };
}

const partIdsOf = (ctx: ReturnType<typeof setup>, table: string) =>
  ctx.db.query<{ partId: number }, []>(`SELECT part_id AS partId FROM ${table}`).all();

describe("part merge", () => {
  it("moves stock, orders, and BOM rows to the destination and deletes the source", () => {
    const ctx = setup();
    ctx.catalog.mergePart(ctx.duplicate, ctx.keep);

    expect(ctx.catalog.getPartDetails(ctx.duplicate)).toBeNull();
    expect(getBalance(ctx.db, ctx.keep, ctx.drawer)).toBe(15);
    expect(listPartMovements(ctx.db, ctx.keep)).toHaveLength(2);
    expect(ctx.orders.getOrderDetails(ctx.orderId)!.lines[0].partId).toBe(ctx.keep);
    expect(partIdsOf(ctx, "bom_lines")).toEqual([{ partId: ctx.keep }]);

    // Aliases and supplier SKUs move without duplicates; attributes and tags stay the destination's.
    const details = ctx.catalog.getPartDetails(ctx.keep)!;
    expect(details.attributes.map((a) => a.rawValue)).toEqual(["Socket head"]);
    expect(details.aliases.toSorted()).toEqual(["M3 SHCS", "M3x8"]);
    expect(details.tags).toEqual(["metric"]);
    expect(details.supplierParts.map((s) => s.sku).toSorted()).toEqual(["BD-1", "BD-2"]);
  });

  it("combines reservations and part choices that the destination already has", () => {
    const ctx = setup();
    ctx.db.run("INSERT INTO bom_part_choices (bom_line_id, part_id) VALUES (?, ?), (?, ?)", [
      ctx.line,
      ctx.keep,
      ctx.line,
      ctx.duplicate,
    ]);
    ctx.db.run(
      "INSERT INTO reservations (bom_line_id, part_id, location_id, quantity) VALUES (?, ?, ?, 2), (?, ?, ?, 3)",
      [ctx.line, ctx.keep, ctx.drawer, ctx.line, ctx.duplicate, ctx.drawer]
    );

    ctx.catalog.mergePart(ctx.duplicate, ctx.keep);

    expect(partIdsOf(ctx, "bom_part_choices")).toEqual([{ partId: ctx.keep }]);
    expect(ctx.db.query("SELECT part_id AS partId, quantity FROM reservations").all()).toEqual([
      { partId: ctx.keep, quantity: 5 },
    ]);
  });

  it("rejects a merge into itself, a missing part, and a different base unit", () => {
    const ctx = setup();
    const meters = ctx.catalog.createPart(partInput({ name: "Wire", baseUnit: "m" }));
    expect(() => ctx.catalog.mergePart(ctx.keep, ctx.keep)).toThrow(InventoryError);
    expect(() => ctx.catalog.mergePart(ctx.duplicate, 9999)).toThrow(NotFoundError);
    expect(() => ctx.catalog.mergePart(ctx.duplicate, meters)).toThrow("same base unit");
    // A rejected merge changes nothing.
    expect(ctx.catalog.getPartDetails(ctx.duplicate)).not.toBeNull();
  });
});
