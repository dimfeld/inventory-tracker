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
