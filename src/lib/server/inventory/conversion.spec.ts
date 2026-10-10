import { describe, expect, it } from "vitest";
import { getBalance, listPartMovements } from "#lib/server/db/movements.ts";
import {
  createTestAllocations,
  lineInput,
  projectInput,
} from "#lib/server/projects/test-helpers.ts";
import { opId, partInput } from "./test-helpers";

const DAY = "2026-10-01";

const attrs = (values: Record<string, string>) =>
  Object.entries(values).map(([key, value]) => ({ key, label: key, value }));

const sku = (code: string) => ({
  id: null,
  supplier: "Misumi",
  sku: code,
  url: null,
  purchaseUnit: null,
  packQuantity: null,
});

type Ctx = ReturnType<typeof createTestAllocations>;

function addStock(ctx: Ctx, partId: number, locationId: number, amount: string) {
  ctx.stock.recordOpeningStock({
    operationId: opId(),
    partId,
    locationId,
    amount,
    unit: "pcs",
    occurredOn: DAY,
  });
}

/**
 * Three 2020 extrusion parts that differ by length; the 400 mm part has no slot width. Stock
 * at two locations, SKUs on the 1220 and 700 mm parts, BOM lines for both, and an open order
 * of 700 mm sticks.
 */
function setup2020() {
  const ctx = createTestAllocations();
  const extrusion = (length: string, extra: Record<string, string>, skus: string[]) =>
    ctx.catalog.createPart(
      partInput({
        name: `2020 extrusion ${length}`,
        attributes: attrs({ profile: "2020", material: "aluminium", length, ...extra }),
        supplierParts: skus.map(sku),
      })
    );
  const p1220 = extrusion("1220 mm", { slot_width: "6 mm" }, ["HFS5-1220"]);
  const p700 = extrusion("700 mm", { slot_width: "6 mm" }, ["HFS5-700"]);
  const p400 = extrusion("400 mm", {}, []);
  const rack = ctx.locations.createLocation({ name: "Rack", notes: null });
  const shelf = ctx.locations.createLocation({ name: "Shelf", notes: null });
  addStock(ctx, p1220, rack, "3");
  addStock(ctx, p1220, shelf, "1");
  addStock(ctx, p700, rack, "2");
  addStock(ctx, p400, shelf, "1");

  const project = ctx.projects.createProject(projectInput({ name: "Printer frame" }));
  const line1220 = ctx.projects.createBomLine(
    project,
    lineInput({ description: "2020 1220 mm", partId: p1220, amount: "2" })
  );
  const line700 = ctx.projects.createBomLine(
    project,
    lineInput({ description: "2020 700 mm", partId: p700, amount: "1" })
  );
  const { id: orderId } = ctx.orders.createOrder(
    { supplier: "Misumi", reference: null, expectedOn: null, trackingUrl: null, notes: null },
    [
      {
        partId: p700,
        supplierSku: "HFS5-700",
        purchaseQuantity: 2,
        purchaseUnit: "each",
        packQuantity: 1,
        unitPrice: null,
        currency: null,
        notes: null,
      },
    ]
  );
  ctx.orders.markPlaced(orderId, DAY);
  return { ...ctx, p1220, p700, p400, rack, shelf, project, line1220, line700, orderId };
}

describe("conversion to pieces", () => {
  it("merges three extrusion lengths into one pieces part", () => {
    const ctx = setup2020();
    const input = {
      destinationId: ctx.p1220,
      sourceIds: [ctx.p700, ctx.p400],
      lengthKey: "length",
      widthKey: null,
    };

    const before = ctx.conversion.previewConversion(input);
    expect(before.differences).toEqual([
      {
        key: "slot_width",
        label: "slot_width",
        values: [
          {
            partId: ctx.p1220,
            partName: "2020 extrusion 1220 mm",
            rawValue: "6 mm",
            display: "6 mm",
          },
          {
            partId: ctx.p700,
            partName: "2020 extrusion 700 mm",
            rawValue: "6 mm",
            display: "6 mm",
          },
          { partId: ctx.p400, partName: "2020 extrusion 400 mm", rawValue: null, display: null },
        ],
      },
    ]);
    expect(before.blockers).toEqual([
      "These attributes differ: slot_width. Make them equal first.",
    ]);
    expect(() =>
      ctx.conversion.convertToPieces({
        ...input,
        kerfMm: 2,
        minOffcutMm: 50,
        operationId: opId(),
        occurredOn: DAY,
      })
    ).toThrow(/attributes differ/);

    ctx.taxonomy.setPartsValue([ctx.p400], "slot_width", "6 mm");
    const preview = ctx.conversion.previewConversion(input);
    expect(preview.blockers).toEqual([]);
    expect(preview.bomLineCount).toBe(2);
    expect(
      preview.parts.map((p) => [p.name, p.size?.lengthMm, p.stock.map((s) => s.count)])
    ).toEqual([
      ["2020 extrusion 1220 mm", 1220, [3, 1]],
      ["2020 extrusion 700 mm", 700, [2]],
      ["2020 extrusion 400 mm", 400, [1]],
    ]);

    const result = ctx.conversion.convertToPieces({
      ...input,
      name: "2020 extrusion, 6 mm slot",
      kerfMm: 2,
      minOffcutMm: 50,
      operationId: opId(),
      occurredOn: DAY,
    });
    expect(result).toEqual({ destinationId: ctx.p1220, pieceCount: 7 });

    const details = ctx.catalog.getPartDetails(ctx.p1220)!;
    expect(details.part).toMatchObject({
      name: "2020 extrusion, 6 mm slot",
      trackingMode: "pieces",
      kerfMm: 2,
      minOffcutMm: 50,
    });
    expect(details.pieceDimensions?.length.key).toBe("length");
    expect(details.attributes.map((a) => a.key).toSorted()).toEqual([
      "material",
      "profile",
      "slot_width",
    ]);
    expect(details.aliases.toSorted()).toEqual([
      "2020 extrusion 1220 mm",
      "2020 extrusion 400 mm",
      "2020 extrusion 700 mm",
    ]);
    expect(ctx.catalog.getPartDetails(ctx.p700)).toBeNull();
    expect(ctx.catalog.getPartDetails(ctx.p400)).toBeNull();

    // Pieces per location, and part balances equal to the piece counts.
    expect(details.pieceTotals).toMatchObject([
      { locationName: "Rack", pieceCount: 5, totalLengthMm: 3 * 1220 + 2 * 700 },
      { locationName: "Shelf", pieceCount: 2, totalLengthMm: 1220 + 400 },
    ]);
    expect(getBalance(ctx.db, ctx.p1220, ctx.rack)).toBe(5);
    expect(getBalance(ctx.db, ctx.p1220, ctx.shelf)).toBe(2);
    expect(
      listPartMovements(ctx.db, ctx.p1220).filter((m) => m.movementType === "conversion")
    ).toHaveLength(4 + 7);

    expect(
      details.supplierParts.map((s) => [s.sku, s.stockLengthMm, s.stockWidthMm]).toSorted()
    ).toEqual([
      ["HFS5-1220", 1220, null],
      ["HFS5-700", 700, null],
    ]);
    expect(
      ctx.db.query("SELECT id, part_id AS partId, quantity FROM bom_lines ORDER BY id").all()
    ).toEqual([
      { id: ctx.line1220, partId: ctx.p1220, quantity: 2 },
      { id: ctx.line700, partId: ctx.p1220, quantity: 1 },
    ]);

    // The open order of 700 mm sticks now makes 700 mm pieces.
    ctx.receipts.receiveAllOutstanding({
      operationId: opId(),
      orderId: ctx.orderId,
      receivedOn: DAY,
      locationId: ctx.rack,
      notes: null,
    });
    const rack = ctx.pieces
      .listPartPieces(ctx.p1220)
      .pieces.filter((p) => p.locationName === "Rack" && p.lengthMm === 700);
    expect(rack).toHaveLength(4);
  });

  it("converts a single sheet part with its length and width", () => {
    const ctx = createTestAllocations();
    const sheet = ctx.catalog.createPart(
      partInput({
        name: "Neoprene 200 × 100 × 1.5",
        attributes: attrs({ length: "200 mm", width: "100 mm", thickness: "1.5 mm" }),
      })
    );
    const drawer = ctx.locations.createLocation({ name: "Drawer", notes: null });
    addStock(ctx, sheet, drawer, "3");

    ctx.conversion.convertToPieces({
      destinationId: sheet,
      sourceIds: [],
      lengthKey: "length",
      widthKey: "width",
      kerfMm: 0,
      minOffcutMm: 20,
      operationId: opId(),
      occurredOn: DAY,
    });

    const { pieces, totals } = ctx.pieces.listPartPieces(sheet);
    expect(pieces.map((p) => [p.lengthMm, p.widthMm])).toEqual([
      [200, 100],
      [200, 100],
      [200, 100],
    ]);
    expect(totals).toMatchObject([{ pieceCount: 3, totalAreaMm2: 3 * 200 * 100 }]);
    expect(ctx.catalog.getPartDetails(sheet)!.attributes.map((a) => a.key)).toEqual(["thickness"]);
  });

  it("turns reservations into whole-piece reservations and keeps picked stock picked", () => {
    const ctx = setup2020();
    ctx.taxonomy.setPartsValue([ctx.p400], "slot_width", "6 mm");
    const reserve = (lineId: number, partId: number, amount: string) =>
      ctx.allocations.reserve({
        projectId: ctx.project,
        lineId,
        partId,
        locationId: ctx.rack,
        amount,
        unit: "pcs",
      });
    reserve(ctx.line700, ctx.p700, "1");
    reserve(ctx.line1220, ctx.p1220, "2");
    ctx.allocations.pick({
      operationId: opId(),
      occurredOn: DAY,
      projectId: ctx.project,
      lineId: ctx.line1220,
      partId: ctx.p1220,
      locationId: ctx.rack,
      amount: "1",
      unit: "pcs",
    });
    const input = {
      destinationId: ctx.p1220,
      sourceIds: [ctx.p700, ctx.p400],
      lengthKey: "length",
      widthKey: null,
    };

    const preview = ctx.conversion.previewConversion(input);
    expect(preview.blockers).toEqual([]);
    expect(preview.parts.map((p) => [p.name, p.stock, p.picked.map((s) => s.count)])).toEqual([
      [
        "2020 extrusion 1220 mm",
        [
          { locationId: ctx.rack, locationName: "Rack", count: 2, reserved: 1 },
          { locationId: ctx.shelf, locationName: "Shelf", count: 1, reserved: 0 },
        ],
        [1],
      ],
      [
        "2020 extrusion 700 mm",
        [{ locationId: ctx.rack, locationName: "Rack", count: 2, reserved: 1 }],
        [],
      ],
      [
        "2020 extrusion 400 mm",
        [{ locationId: ctx.shelf, locationName: "Shelf", count: 1, reserved: 0 }],
        [],
      ],
    ]);

    const result = ctx.conversion.convertToPieces({
      ...input,
      kerfMm: 2,
      minOffcutMm: 50,
      operationId: opId(),
      occurredOn: DAY,
    });
    expect(result.pieceCount).toBe(7);
    expect(ctx.db.query("SELECT count(*) AS count FROM reservations").get()).toEqual({
      count: 0,
    });

    const coverage = ctx.allocations.getProjectCoverage(ctx.project);
    const pieceReservations = (lineId: number) =>
      coverage[lineId].parts.flatMap((a) =>
        a.pieceReservations.map((r) => [r.partId, r.locationName, r.lengthMm, r.pieceLengthMm])
      );
    expect(pieceReservations(ctx.line700)).toEqual([[ctx.p1220, "Rack", 700, 700]]);
    expect(pieceReservations(ctx.line1220)).toEqual([[ctx.p1220, "Rack", 1220, 1220]]);
    expect(coverage[ctx.line1220]).toMatchObject({ reserved: 1, picked: 1, uncovered: 0 });
    expect(coverage[ctx.line700]).toMatchObject({ reserved: 1, uncovered: 0 });

    // The picked stick is a piece at the project's holding location.
    const holding = ctx.pieces
      .listPartPieces(ctx.p1220)
      .pieces.filter((p) => p.locationKind === "project");
    expect(holding.map((p) => p.lengthMm)).toEqual([1220]);
  });

  it("reports parts that cannot be converted", () => {
    const ctx = setup2020();
    const wire = ctx.catalog.createPart(partInput({ name: "Wire", baseUnit: "m" }));
    const blockers = ctx.conversion.previewConversion({
      destinationId: ctx.p1220,
      sourceIds: [wire],
      lengthKey: "length",
      widthKey: null,
    }).blockers;
    expect(blockers).toContain("Wire is counted in m. Only pcs parts can become pieces.");
    expect(blockers).toContain("Wire has no length in mm.");
  });
});
