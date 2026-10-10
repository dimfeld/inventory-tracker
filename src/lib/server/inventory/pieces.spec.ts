import { describe, expect, it } from "vitest";
import { insertMovement, listPartMovements } from "#lib/server/db/movements.ts";
import {
  createTestAllocations,
  lineInput,
  projectInput,
} from "#lib/server/projects/test-helpers.ts";
import type { TrackingInput } from "#lib/schemas/part.ts";
import { DuplicateOperationError, InventoryError } from "./errors";
import { opId, partInput } from "./test-helpers";

const DAY = "2026-10-01";

function tracking(overrides: Partial<TrackingInput> = {}): TrackingInput {
  return {
    mode: "pieces",
    lengthKey: "length",
    widthKey: null,
    kerfMm: 2,
    minOffcutMm: 50,
    ...overrides,
  };
}

/** 2020 extrusion and POM sheet tracked as pieces, a bulk screw, and two storage locations. */
function setup() {
  const ctx = createTestAllocations();
  const extrusion = ctx.catalog.createPart(
    partInput({ name: "2020 extrusion", tracking: tracking() })
  );
  const sheet = ctx.catalog.createPart(
    partInput({ name: "POM-C sheet 15 mm", tracking: tracking({ widthKey: "width" }) })
  );
  const screw = ctx.catalog.createPart(partInput());
  const rack = ctx.locations.createLocation({ name: "Rack", notes: null });
  const shelf = ctx.locations.createLocation({ name: "Shelf", notes: null });
  return { ...ctx, extrusion, sheet, screw, rack, shelf };
}

type Ctx = ReturnType<typeof setup>;

function addPieces(
  ctx: Ctx,
  partId: number,
  locationId: number,
  pieces: { lengthMm: number; widthMm: number | null; label?: string }[]
) {
  return ctx.pieces.addPieces({ operationId: opId(), occurredOn: DAY, partId, locationId, pieces });
}

describe("piece tracking settings", () => {
  it("saves the dimensions, kerf, and minimum offcut of a pieces part", () => {
    const ctx = setup();
    expect(ctx.catalog.getPartDetails(ctx.sheet)!.part).toMatchObject({
      trackingMode: "pieces",
      kerfMm: 2,
      minOffcutMm: 50,
    });
    const dimensions = ctx.pieces.getDimensions(ctx.sheet)!;
    expect(dimensions.length.key).toBe("length");
    expect(dimensions.width?.key).toBe("width");
    expect(ctx.pieces.getDimensions(ctx.screw)).toBeNull();
    expect(ctx.catalog.getPartDetails(ctx.screw)!.part.trackingMode).toBe("bulk");
  });

  it("keeps the tracking when an update does not include it", () => {
    const ctx = setup();
    ctx.catalog.updatePart(ctx.extrusion, partInput({ name: "2020 extrusion, 6 mm slot" }));
    expect(ctx.catalog.getPartDetails(ctx.extrusion)!.part).toMatchObject({
      name: "2020 extrusion, 6 mm slot",
      trackingMode: "pieces",
      kerfMm: 2,
    });
  });

  it("needs a length dimension in mm and the pcs base unit", () => {
    const ctx = setup();
    expect(() =>
      ctx.catalog.createPart(partInput({ name: "A", tracking: tracking({ lengthKey: null }) }))
    ).toThrow(/length of each piece/);
    expect(() =>
      ctx.catalog.createPart(partInput({ name: "B", tracking: tracking({ lengthKey: "thread" }) }))
    ).toThrow(/number attribute in mm/);
    expect(() =>
      ctx.catalog.createPart(partInput({ name: "C", baseUnit: "m", tracking: tracking() }))
    ).toThrow(/pcs base unit/);
  });

  it("refuses to change the tracking mode of a part with stock", () => {
    const ctx = setup();
    ctx.stock.recordOpeningStock({
      operationId: opId(),
      partId: ctx.screw,
      locationId: ctx.rack,
      amount: "5",
      unit: "pcs",
      occurredOn: DAY,
    });
    expect(() => ctx.catalog.updatePart(ctx.screw, partInput({ tracking: tracking() }))).toThrow(
      /tracking mode cannot change/
    );

    addPieces(ctx, ctx.extrusion, ctx.rack, [{ lengthMm: 1220, widthMm: null }]);
    expect(() =>
      ctx.catalog.updatePart(
        ctx.extrusion,
        partInput({ name: "2020 extrusion", tracking: tracking({ widthKey: "width" }) })
      )
    ).toThrow(/width dimension cannot be added/);
    // Kerf and minimum offcut can change at any time.
    ctx.catalog.updatePart(
      ctx.extrusion,
      partInput({ name: "2020 extrusion", tracking: tracking({ kerfMm: 3 }) })
    );
    expect(ctx.catalog.getPartDetails(ctx.extrusion)!.part.kerfMm).toBe(3);
  });
});

describe("piece stock", () => {
  it("makes 1D pieces and lists them with their location and totals", () => {
    const ctx = setup();
    const made = addPieces(ctx, ctx.extrusion, ctx.rack, [
      { lengthMm: 1220, widthMm: null },
      { lengthMm: 700, widthMm: null, label: "  " },
    ]);
    addPieces(ctx, ctx.extrusion, ctx.shelf, [{ lengthMm: 415.5, widthMm: null, label: "A" }]);

    expect(made.map((p) => [p.lengthMm, p.widthMm, p.label])).toEqual([
      [1220, null, null],
      [700, null, null],
    ]);
    const movements = listPartMovements(ctx.db, ctx.extrusion);
    expect(movements).toHaveLength(3);
    expect(movements.every((m) => m.quantity === 1 && m.movementType === "opening")).toBe(true);

    const { pieces, totals } = ctx.pieces.listPartPieces(ctx.extrusion);
    expect(pieces.map((p) => [p.locationName, p.lengthMm, p.label])).toEqual([
      ["Rack", 1220, null],
      ["Rack", 700, null],
      ["Shelf", 415.5, "A"],
    ]);
    expect(totals).toEqual([
      {
        locationId: ctx.rack,
        locationName: "Rack",
        pieceCount: 2,
        totalLengthMm: 1920,
        totalAreaMm2: null,
      },
      {
        locationId: ctx.shelf,
        locationName: "Shelf",
        pieceCount: 1,
        totalLengthMm: 415.5,
        totalAreaMm2: null,
      },
    ]);
  });

  it("totals the area of 2D pieces and lists the pieces at a location", () => {
    const ctx = setup();
    addPieces(ctx, ctx.sheet, ctx.shelf, [
      { lengthMm: 150, widthMm: 150 },
      { lengthMm: 75, widthMm: 25.4 },
    ]);
    addPieces(ctx, ctx.extrusion, ctx.shelf, [{ lengthMm: 400, widthMm: null }]);

    expect(ctx.pieces.listPartPieces(ctx.sheet).totals).toEqual([
      {
        locationId: ctx.shelf,
        locationName: "Shelf",
        pieceCount: 2,
        totalLengthMm: 225,
        totalAreaMm2: 150 * 150 + 75 * 25.4,
      },
    ]);
    expect(
      ctx.pieces.listLocationPieces(ctx.shelf).map((p) => [p.partName, p.lengthMm, p.widthMm])
    ).toEqual([
      ["2020 extrusion", 400, null],
      ["POM-C sheet 15 mm", 150, 150],
      ["POM-C sheet 15 mm", 75, 25.4],
    ]);
  });

  it("rejects sizes that do not fit the part's dimensions without writing", () => {
    const ctx = setup();
    expect(() => addPieces(ctx, ctx.extrusion, ctx.rack, [{ lengthMm: 500, widthMm: 20 }])).toThrow(
      /no width/
    );
    expect(() => addPieces(ctx, ctx.sheet, ctx.rack, [{ lengthMm: 150, widthMm: null }])).toThrow(
      /Width must be greater than zero/
    );
    expect(() =>
      addPieces(ctx, ctx.extrusion, ctx.rack, [
        { lengthMm: 500, widthMm: null },
        { lengthMm: 0, widthMm: null },
      ])
    ).toThrow(/Length must be greater than zero/);
    expect(() => addPieces(ctx, ctx.screw, ctx.rack, [{ lengthMm: 5, widthMm: null }])).toThrow(
      /not tracked as pieces/
    );
    expect(ctx.pieces.listPartPieces(ctx.extrusion).pieces).toEqual([]);
    expect(listPartMovements(ctx.db, ctx.extrusion)).toEqual([]);
  });

  it("moves a piece to another location", () => {
    const ctx = setup();
    const [piece] = addPieces(ctx, ctx.extrusion, ctx.rack, [{ lengthMm: 1220, widthMm: null }]);
    const movement = ctx.pieces.movePiece({
      operationId: opId(),
      occurredOn: DAY,
      pieceId: piece.id,
      toLocationId: ctx.shelf,
    });
    expect(movement).toMatchObject({
      pieceId: piece.id,
      quantity: 1,
      fromLocationId: ctx.rack,
      toLocationId: ctx.shelf,
      movementType: "transfer",
    });
    expect(ctx.pieces.listPartPieces(ctx.extrusion).pieces.map((p) => p.locationName)).toEqual([
      "Shelf",
    ]);
    expect(() =>
      ctx.pieces.movePiece({
        operationId: opId(),
        occurredOn: DAY,
        pieceId: piece.id,
        toLocationId: ctx.shelf,
      })
    ).toThrow(/already in Shelf/);
  });

  it("removes a piece, which retires it", () => {
    const ctx = setup();
    const [piece, kept] = addPieces(ctx, ctx.extrusion, ctx.rack, [
      { lengthMm: 300, widthMm: null },
      { lengthMm: 700, widthMm: null },
    ]);
    const input = { operationId: opId(), occurredOn: DAY, pieceId: piece.id, reason: "bent" };
    ctx.pieces.removePiece(input);
    expect(() => ctx.pieces.removePiece(input)).toThrow(DuplicateOperationError);

    const { pieces, totals } = ctx.pieces.listPartPieces(ctx.extrusion);
    expect(pieces.map((p) => p.id)).toEqual([kept.id]);
    expect(totals).toMatchObject([{ pieceCount: 1, totalLengthMm: 700 }]);
    expect(() => ctx.pieces.removePiece({ ...input, operationId: opId() })).toThrow(
      /no longer in stock/
    );
    expect(() =>
      ctx.pieces.movePiece({
        operationId: opId(),
        occurredOn: DAY,
        pieceId: piece.id,
        toLocationId: ctx.shelf,
      })
    ).toThrow(/no longer in stock/);
  });

  it("does not let the database record a movement without a piece for a pieces part", () => {
    const ctx = setup();
    const movement = {
      operationId: opId(),
      quantity: 1,
      fromLocationId: null,
      toLocationId: ctx.rack,
      movementType: "opening" as const,
      occurredOn: DAY,
      reason: null,
    };
    expect(() => insertMovement(ctx.db, { ...movement, partId: ctx.extrusion })).toThrow(
      /must move one piece/
    );
    const [piece] = addPieces(ctx, ctx.extrusion, ctx.rack, [{ lengthMm: 500, widthMm: null }]);
    expect(() =>
      insertMovement(ctx.db, { ...movement, partId: ctx.screw, pieceId: piece.id })
    ).toThrow(/must move one piece/);
  });
});

describe("bulk-only actions", () => {
  it("refuse a part tracked as pieces", () => {
    const ctx = setup();
    addPieces(ctx, ctx.extrusion, ctx.rack, [{ lengthMm: 1220, widthMm: null }]);
    const amount = { amount: "1", unit: "pcs" as const, occurredOn: DAY };

    expect(() =>
      ctx.stock.recordOpeningStock({
        ...amount,
        operationId: opId(),
        partId: ctx.extrusion,
        locationId: ctx.rack,
      })
    ).toThrow(/tracked as pieces/);
    expect(() =>
      ctx.stock.recordLoss({
        ...amount,
        operationId: opId(),
        partId: ctx.extrusion,
        locationId: ctx.rack,
        reason: "lost",
      })
    ).toThrow(/tracked as pieces/);

    const project = ctx.projects.createProject(projectInput());
    const lineId = ctx.projects.createBomLine(
      project,
      lineInput({ description: "2020 extrusion", partId: ctx.extrusion, amount: "1" })
    );
    const reservation = {
      projectId: project,
      lineId,
      partId: ctx.extrusion,
      locationId: ctx.rack,
      amount: "1",
      unit: "pcs" as const,
    };
    expect(() => ctx.allocations.reserve(reservation)).toThrow(InventoryError);
    expect(() => ctx.allocations.reserve(reservation)).toThrow(/tracked as pieces/);
    expect(() =>
      ctx.allocations.pick({ ...reservation, operationId: opId(), occurredOn: DAY })
    ).toThrow(/tracked as pieces/);

    expect(() => ctx.catalog.mergePart(ctx.screw, ctx.extrusion)).toThrow(/cannot be merged/);
    expect(listPartMovements(ctx.db, ctx.extrusion)).toHaveLength(1);
  });
});

const sku = (code: string, stockLengthMm: number | null, stockWidthMm: number | null = null) => ({
  id: null,
  supplier: "Misumi",
  sku: code,
  url: null,
  purchaseUnit: null,
  packQuantity: null,
  stockLengthMm,
  stockWidthMm,
});

describe("supplier stock sizes", () => {
  it("are saved for pieces parts and must fit the part's dimensions", () => {
    const ctx = setup();
    ctx.catalog.updatePart(
      ctx.extrusion,
      partInput({ name: "2020 extrusion", supplierParts: [sku("HFS5-1220", 1220)] })
    );
    expect(ctx.catalog.getPartDetails(ctx.extrusion)!.supplierParts).toMatchObject([
      { sku: "HFS5-1220", stockLengthMm: 1220, stockWidthMm: null },
    ]);
    expect(() =>
      ctx.catalog.updatePart(ctx.screw, partInput({ supplierParts: [sku("SCR", 10)] }))
    ).toThrow(/only for parts tracked as pieces/);
    expect(() =>
      ctx.catalog.updatePart(
        ctx.extrusion,
        partInput({ name: "2020 extrusion", supplierParts: [sku("HFS5", 1220, 20)] })
      )
    ).toThrow(/no width/);
    expect(() =>
      ctx.catalog.updatePart(
        ctx.sheet,
        partInput({ name: "POM-C sheet 15 mm", supplierParts: [sku("POM", 150)] })
      )
    ).toThrow(/both the length and the width/);
  });
});

describe("receipts of pieces parts", () => {
  /** A placed order for 3 extrusions with the given SKU, and 100 screws. */
  function order(ctx: Ctx, supplierSku: string | null) {
    const line = (partId: number, packQuantity: number, code: string | null) => ({
      partId,
      supplierSku: code,
      purchaseQuantity: 1,
      purchaseUnit: "pack",
      packQuantity,
      unitPrice: null,
      currency: null,
      notes: null,
    });
    const { id } = ctx.orders.createOrder(
      { supplier: "Misumi", reference: null, expectedOn: null, trackingUrl: null, notes: null },
      [line(ctx.extrusion, 3, supplierSku), line(ctx.screw, 100, null)]
    );
    ctx.orders.markPlaced(id, DAY);
    const [extrusionLine, screwLine] = ctx.orders.getOrderDetails(id)!.lines.map((l) => l.id);
    return { orderId: id, extrusionLine, screwLine };
  }

  function receiveExtrusion(
    ctx: Ctx,
    o: ReturnType<typeof order>,
    pieceSize?: { lengthMm: number; widthMm: number | null }
  ) {
    return ctx.receipts.receive({
      operationId: opId(),
      orderId: o.orderId,
      receivedOn: DAY,
      notes: null,
      lines: [
        {
          orderLineId: o.extrusionLine,
          acceptedQuantity: 3,
          damagedQuantity: 0,
          locationId: ctx.rack,
          notes: null,
          pieceSize,
        },
      ],
    });
  }

  it("make one piece of the SKU's stock size per accepted unit", () => {
    const ctx = setup();
    ctx.catalog.updatePart(
      ctx.extrusion,
      partInput({ name: "2020 extrusion", supplierParts: [sku("HFS5-1220", 1220)] })
    );
    const o = order(ctx, "HFS5-1220");
    const result = receiveExtrusion(ctx, o);

    expect(result.lines).toMatchObject([{ acceptedQuantity: 3 }]);
    expect(
      ctx.pieces.listPartPieces(ctx.extrusion).pieces.map((p) => [p.locationName, p.lengthMm])
    ).toEqual([
      ["Rack", 1220],
      ["Rack", 1220],
      ["Rack", 1220],
    ]);
    const movements = listPartMovements(ctx.db, ctx.extrusion);
    expect(movements).toHaveLength(3);
    expect(
      movements.every((m) => m.movementType === "receipt" && m.quantity === 1 && m.pieceId !== null)
    ).toBe(true);
    expect(ctx.orders.getOrderDetails(o.orderId)!.lines[0].outstanding).toBe(0);
  });

  it("use the given size when the SKU has no stock size, and fail without one", () => {
    const ctx = setup();
    const o = order(ctx, null);
    expect(() => receiveExtrusion(ctx, o)).toThrow(/no stock size/);
    expect(() => receiveExtrusion(ctx, o, { lengthMm: 700, widthMm: 20 })).toThrow(/no width/);
    expect(listPartMovements(ctx.db, ctx.extrusion)).toEqual([]);

    receiveExtrusion(ctx, o, { lengthMm: 700, widthMm: null });
    expect(ctx.pieces.listPartPieces(ctx.extrusion).totals).toMatchObject([
      { pieceCount: 3, totalLengthMm: 2100 },
    ]);
  });

  it("receive bulk lines of the same order as before", () => {
    const ctx = setup();
    const o = order(ctx, null);
    ctx.receipts.receive({
      operationId: opId(),
      orderId: o.orderId,
      receivedOn: DAY,
      notes: null,
      lines: [
        {
          orderLineId: o.screwLine,
          acceptedQuantity: 100,
          damagedQuantity: 0,
          locationId: ctx.shelf,
          notes: null,
        },
      ],
    });
    expect(listPartMovements(ctx.db, ctx.screw)).toMatchObject([
      { quantity: 100, pieceId: null, movementType: "receipt" },
    ]);
  });
});

describe("cuts of 1D pieces", () => {
  const keep = (locationId: number) => ({ kind: "keep" as const, locationId });

  it("cuts lengths with kerf, keeps the remainder, and retires the parent", () => {
    const ctx = setup();
    const [stick] = addPieces(ctx, ctx.extrusion, ctx.rack, [{ lengthMm: 1220, widthMm: null }]);
    const result = ctx.pieces.cutPiece({
      operationId: "cut-1",
      occurredOn: DAY,
      pieceId: stick.id,
      cuts: [
        { lengthMm: 415, destination: keep(ctx.shelf), label: "frame" },
        { lengthMm: 300, destination: keep(ctx.rack) },
      ],
      remainder: { destination: keep(ctx.rack) },
    });

    // 1220 − 415 − 300 − 2 × 2 mm kerf
    expect(result.pieces.map((p) => [p.lengthMm, p.parentPieceId, p.label])).toEqual([
      [415, stick.id, "frame"],
      [300, stick.id, null],
      [501, stick.id, null],
    ]);
    const { pieces, totals } = ctx.pieces.listPartPieces(ctx.extrusion);
    expect(pieces.map((p) => [p.locationName, p.lengthMm])).toEqual([
      ["Rack", 501],
      ["Rack", 300],
      ["Shelf", 415],
    ]);
    expect(totals.map((t) => [t.locationName, t.pieceCount, t.totalLengthMm])).toEqual([
      ["Rack", 2, 801],
      ["Shelf", 1, 415],
    ]);
    expect(
      listPartMovements(ctx.db, ctx.extrusion)
        .filter((m) => m.movementType === "cut")
        .map((m) => m.operationId)
        .sort()
    ).toEqual(["cut-1:1", "cut-1:2", "cut-1:3", "cut-1:4"]);

    const history = ctx.pieces.getPieceHistory(result.pieces[0].id)!;
    expect(history.parent?.id).toBe(stick.id);
    expect(history.parent?.retiredBy).toBe("cut");
    expect(history.siblings.map((p) => p.lengthMm).sort()).toEqual([300, 501]);
    expect(ctx.pieces.getPieceHistory(stick.id)!.children).toHaveLength(3);
    expect(ctx.pieces.listRetiredPieces(ctx.extrusion).map((p) => p.id)).toEqual([stick.id]);
  });

  it("scraps or keeps a remainder under the minimum offcut", () => {
    const ctx = setup();
    const [a, b] = addPieces(ctx, ctx.extrusion, ctx.rack, [
      { lengthMm: 400, widthMm: null },
      { lengthMm: 400, widthMm: null },
    ]);
    const cut = (
      pieceId: number,
      destination: { kind: "scrap" } | { kind: "keep"; locationId: number }
    ) =>
      ctx.pieces.cutPiece({
        operationId: opId(),
        occurredOn: DAY,
        pieceId,
        cuts: [{ lengthMm: 368, destination: keep(ctx.rack) }],
        remainder: { destination },
      });

    // 400 − 368 − 2 = 30 mm, under the 50 mm minimum.
    const scrapped = cut(a.id, { kind: "scrap" });
    expect(scrapped.pieces.map((p) => p.lengthMm)).toEqual([368, 30]);
    expect(ctx.pieces.getPieceHistory(scrapped.pieces[1].id)!.piece).toMatchObject({
      locationId: null,
      retiredBy: "scrap",
    });
    expect(
      ctx.pieces.getPieceHistory(scrapped.pieces[1].id)!.movements.map((m) => m.movementType)
    ).toEqual(["scrap", "cut"]);

    cut(b.id, keep(ctx.shelf));
    const { pieces } = ctx.pieces.listPartPieces(ctx.extrusion);
    expect(pieces.map((p) => [p.locationName, p.lengthMm])).toEqual([
      ["Rack", 368],
      ["Rack", 368],
      ["Shelf", 30],
    ]);
  });

  it("makes no remainder for an exact fit, and refuses cuts that do not fit", () => {
    const ctx = setup();
    const [stick] = addPieces(ctx, ctx.extrusion, ctx.rack, [{ lengthMm: 1220, widthMm: null }]);
    const input = (lengthMm: number) => ({
      operationId: opId(),
      occurredOn: DAY,
      pieceId: stick.id,
      cuts: [{ lengthMm, destination: keep(ctx.rack) }],
      remainder: { destination: keep(ctx.rack) },
    });
    expect(() => ctx.pieces.cutPiece(input(1219))).toThrow(/do not fit/);
    expect(listPartMovements(ctx.db, ctx.extrusion)).toHaveLength(1);

    const result = ctx.pieces.cutPiece(input(1218));
    expect(result.pieces.map((p) => p.lengthMm)).toEqual([1218]);
  });

  it("rejects a repeated operation ID without writing", () => {
    const ctx = setup();
    const [a, b] = addPieces(ctx, ctx.extrusion, ctx.rack, [
      { lengthMm: 1220, widthMm: null },
      { lengthMm: 700, widthMm: null },
    ]);
    const input = {
      operationId: "repeat",
      occurredOn: DAY,
      pieceId: a.id,
      cuts: [{ lengthMm: 500, destination: keep(ctx.rack) }],
      remainder: { destination: keep(ctx.rack) },
    };
    ctx.pieces.cutPiece(input);
    const before = listPartMovements(ctx.db, ctx.extrusion).length;
    expect(() => ctx.pieces.cutPiece({ ...input, pieceId: b.id })).toThrow(DuplicateOperationError);
    expect(listPartMovements(ctx.db, ctx.extrusion)).toHaveLength(before);
    expect(ctx.pieces.listPartPieces(ctx.extrusion).pieces).toHaveLength(3);
  });

  it("uses part of a piece outside a project, which needs a reason", () => {
    const ctx = setup();
    const [stick] = addPieces(ctx, ctx.extrusion, ctx.rack, [{ lengthMm: 700, widthMm: null }]);
    const input = {
      operationId: opId(),
      occurredOn: DAY,
      pieceId: stick.id,
      cuts: [{ lengthMm: 200, destination: { kind: "use" as const } }],
      remainder: { destination: keep(ctx.rack) },
    };
    expect(() => ctx.pieces.cutPiece(input)).toThrow(/reason/);

    const result = ctx.pieces.cutPiece({ ...input, reason: "Shelf repair" });
    expect(ctx.pieces.getPieceHistory(result.pieces[0].id)!.piece.retiredBy).toBe("use");
    expect(ctx.pieces.listPartPieces(ctx.extrusion).pieces.map((p) => p.lengthMm)).toEqual([498]);
  });

  it("refuses a 2D piece", () => {
    const ctx = setup();
    const [sheet] = addPieces(ctx, ctx.sheet, ctx.rack, [{ lengthMm: 150, widthMm: 150 }]);
    expect(() =>
      ctx.pieces.cutPiece({
        operationId: opId(),
        occurredOn: DAY,
        pieceId: sheet.id,
        cuts: [{ lengthMm: 50, destination: keep(ctx.rack) }],
        remainder: { destination: keep(ctx.rack) },
      })
    ).toThrow(/has a width/);
  });
});

describe("splits of 2D pieces", () => {
  it("makes the measured pieces and warns about a dimension larger than the parent", () => {
    const ctx = setup();
    const [sheet] = addPieces(ctx, ctx.sheet, ctx.rack, [{ lengthMm: 150, widthMm: 100 }]);
    const result = ctx.pieces.splitPiece({
      operationId: opId(),
      occurredOn: DAY,
      pieceId: sheet.id,
      outputs: [
        // Rotated, it fits.
        { lengthMm: 60, widthMm: 140, destination: { kind: "use" } },
        { lengthMm: 160, widthMm: 20, destination: { kind: "keep", locationId: ctx.shelf } },
      ],
      reason: "Bracket",
    });
    expect(result.pieces.map((p) => [p.lengthMm, p.widthMm, p.parentPieceId])).toEqual([
      [60, 140, sheet.id],
      [160, 20, sheet.id],
    ]);
    expect(result.warnings).toEqual(["Piece 2 is larger than this piece in one dimension"]);
    expect(ctx.pieces.listPartPieces(ctx.sheet).totals).toEqual([
      {
        locationId: ctx.shelf,
        locationName: "Shelf",
        pieceCount: 1,
        totalLengthMm: 160,
        totalAreaMm2: 3200,
      },
    ]);
  });

  it("refuses outputs with more area than the parent without writing", () => {
    const ctx = setup();
    const [sheet] = addPieces(ctx, ctx.sheet, ctx.rack, [{ lengthMm: 150, widthMm: 100 }]);
    expect(() =>
      ctx.pieces.splitPiece({
        operationId: opId(),
        occurredOn: DAY,
        pieceId: sheet.id,
        outputs: [
          { lengthMm: 100, widthMm: 100, destination: { kind: "scrap" } },
          { lengthMm: 60, widthMm: 100, destination: { kind: "scrap" } },
        ],
      })
    ).toThrow(/total area/);
    expect(ctx.pieces.listPartPieces(ctx.sheet).pieces.map((p) => p.id)).toEqual([sheet.id]);
  });
});

describe("whole pieces out of inventory", () => {
  it("scraps or uses a piece with a reason, which retires it", () => {
    const ctx = setup();
    const [a, b, c] = addPieces(ctx, ctx.extrusion, ctx.rack, [
      { lengthMm: 300, widthMm: null },
      { lengthMm: 200, widthMm: null },
      { lengthMm: 100, widthMm: null },
    ]);
    const remove = (pieceId: number, kind: "scrap" | "use") =>
      ctx.pieces.removePiece({ operationId: opId(), occurredOn: DAY, pieceId, reason: "x", kind });
    remove(a.id, "scrap");
    remove(b.id, "use");

    expect(ctx.pieces.listPartPieces(ctx.extrusion).totals).toMatchObject([
      { pieceCount: 1, totalLengthMm: 100 },
    ]);
    expect(
      ctx.pieces.listRetiredPieces(ctx.extrusion).map((p) => [p.lengthMm, p.retiredBy])
    ).toEqual([
      [200, "use"],
      [300, "scrap"],
    ]);
    expect(ctx.pieces.getPieceHistory(c.id)!.piece.locationName).toBe("Rack");
  });
});
