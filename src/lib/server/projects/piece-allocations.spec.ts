import { describe, expect, it } from "vitest";
import type { TrackingInput } from "#lib/schemas/part.ts";
import { listStorageStock } from "#lib/server/db/reservations.ts";
import { InsufficientStockError } from "#lib/server/inventory/errors.ts";
import { opId, partInput } from "#lib/server/inventory/test-helpers.ts";
import { createTestAllocations, equal, lineInput, projectInput } from "./test-helpers";

const DAY = "2026-10-01";

function tracking(overrides: Partial<TrackingInput> = {}): TrackingInput {
  return {
    mode: "pieces",
    lengthKey: "length",
    widthKey: null,
    kerfMm: 3,
    minOffcutMm: 20,
    ...overrides,
  };
}

/** 2020 extrusion with a kerf of 3 mm, one 1000 mm stick in a rack, and a project. */
function setup() {
  const ctx = createTestAllocations();
  const extrusion = ctx.catalog.createPart(
    partInput({ name: "2020 extrusion", tracking: tracking() })
  );
  const rack = ctx.locations.createLocation({ name: "Rack", notes: null });
  const [stick] = addPieces(ctx, extrusion, rack, [1000]);
  const project = ctx.projects.createProject(projectInput({ name: "Printer frame" }));
  const cutLine = (description: string, lengthMm: number, amount = "1") =>
    ctx.projects.createBomLine(
      project,
      lineInput({ description, partId: extrusion, amount, cutLengthMm: lengthMm })
    );
  return { ...ctx, extrusion, rack, stick: stick.id, project, cutLine };
}

type Ctx = ReturnType<typeof setup>;

function addPieces(
  ctx: ReturnType<typeof createTestAllocations>,
  partId: number,
  locationId: number,
  lengths: number[],
  widthMm: number | null = null
) {
  return ctx.pieces.addPieces({
    operationId: opId(),
    occurredOn: DAY,
    partId,
    locationId,
    pieces: lengths.map((lengthMm) => ({ lengthMm, widthMm })),
  });
}

function reserve(ctx: Ctx, lineId: number, pieceId: number, count = 1) {
  return ctx.pieceAllocations.reservePieces({
    projectId: ctx.project,
    lineId,
    pieces: Array.from({ length: count }, () => ({ pieceId })),
  });
}

function coverage(ctx: Ctx, lineId: number) {
  return ctx.allocations.getProjectCoverage(ctx.project)[lineId];
}

function freeLength(ctx: Ctx, lineId: number, pieceId: number) {
  return ctx.allocations
    .getLineStock(ctx.project, lineId)
    .parts.flatMap((p) => p.storagePieces)
    .find((p) => p.id === pieceId)!.freeLengthMm;
}

describe("piece reservations", () => {
  it("lets two lines share one stick with kerf, and refuses a third that does not fit", () => {
    const ctx = setup();
    const rail = ctx.cutLine("Rail", 600);
    const post = ctx.cutLine("Post", 390);
    const brace = ctx.cutLine("Brace", 10);

    reserve(ctx, rail, ctx.stick);
    reserve(ctx, post, ctx.stick);
    expect(coverage(ctx, rail)).toMatchObject({ required: 1, reserved: 1, uncovered: 0 });
    expect(coverage(ctx, post)).toMatchObject({ reserved: 1, uncovered: 0 });
    // 600 + 3 + 390 + 3 = 996 mm of 1000 mm.
    expect(freeLength(ctx, brace, ctx.stick)).toBe(4);

    // 10 mm + kerf needs 13 mm, but only 4 mm is free.
    expect(() => reserve(ctx, brace, ctx.stick)).toThrow(InsufficientStockError);
    expect(() => reserve(ctx, brace, ctx.stick)).toThrow(
      "10 mm does not fit on piece #1 (1000 mm). 4 mm is free, and each cut loses a kerf of 3 mm."
    );
    expect(coverage(ctx, brace)).toMatchObject({ reserved: 0, uncovered: 1 });
  });

  it("puts several cut pieces of one line on one stick, up to the line quantity", () => {
    const ctx = setup();
    const legs = ctx.cutLine("Legs", 300, "4");
    reserve(ctx, legs, ctx.stick, 3);
    expect(coverage(ctx, legs)).toMatchObject({ reserved: 3, uncovered: 1 });
    expect(freeLength(ctx, legs, ctx.stick)).toBe(91);
    expect(() => reserve(ctx, legs, ctx.stick)).toThrow("does not fit");
    expect(() => reserve(ctx, legs, ctx.stick, 2)).toThrow("This row needs only 1 pcs more");
  });

  it("changes a reserved length within the free length of the piece", () => {
    const ctx = setup();
    const rail = ctx.cutLine("Rail", 600);
    const post = ctx.cutLine("Post", 390);
    const brace = ctx.cutLine("Brace", 10);
    const [railReservation] = reserve(ctx, rail, ctx.stick).reservationIds;
    reserve(ctx, post, ctx.stick);
    const resize = (lengthMm: number) =>
      ctx.pieceAllocations.resizePieceReservation({
        projectId: ctx.project,
        reservationId: railReservation,
        size: { lengthMm, widthMm: null },
      });

    // The rail may grow by the 4 mm that are free, not more.
    expect(() => resize(605)).toThrow("605 mm does not fit");
    resize(604);
    expect(freeLength(ctx, rail, ctx.stick)).toBe(0);

    // Shrinking frees space for the brace.
    resize(500);
    expect(freeLength(ctx, rail, ctx.stick)).toBe(104);
    reserve(ctx, brace, ctx.stick);
    expect(
      coverage(ctx, rail).parts[0].pieceReservations.map((r) => [r.lengthMm, r.pieceId])
    ).toEqual([[500, ctx.stick]]);
  });

  it("reserves whole pieces for a line without a cut size, and lets the user cut them down", () => {
    const ctx = setup();
    const line = ctx.projects.createBomLine(
      ctx.project,
      lineInput({ description: "2020 1000 mm, cut to 415 mm", partId: ctx.extrusion, amount: "1" })
    );
    const other = ctx.cutLine("Other", 100);
    const [reservation] = reserve(ctx, line, ctx.stick).reservationIds;
    expect(coverage(ctx, line).parts[0].pieceReservations[0]).toMatchObject({ lengthMm: 1000 });
    // The whole piece needs no cut, so it has no kerf, and nothing else fits.
    expect(freeLength(ctx, line, ctx.stick)).toBe(0);
    expect(() => reserve(ctx, other, ctx.stick)).toThrow("does not fit");

    ctx.projects.updateBomLine(
      ctx.project,
      line,
      lineInput({
        description: "2020 1000 mm, cut to 415 mm",
        partId: ctx.extrusion,
        amount: "1",
        cutLengthMm: 415,
      })
    );
    ctx.pieceAllocations.resizePieceReservation({
      projectId: ctx.project,
      reservationId: reservation,
      size: { lengthMm: 415, widthMm: null },
    });
    reserve(ctx, other, ctx.stick);
    expect(freeLength(ctx, line, ctx.stick)).toBe(1000 - 418 - 103);
  });

  it("releases a reservation, and a cancelled project releases them all", () => {
    const ctx = setup();
    const rail = ctx.cutLine("Rail", 300, "2");
    const [first] = reserve(ctx, rail, ctx.stick).reservationIds;
    reserve(ctx, rail, ctx.stick);
    ctx.pieceAllocations.releasePieceReservation({ projectId: ctx.project, reservationId: first });
    expect(coverage(ctx, rail)).toMatchObject({ reserved: 1 });

    const result = ctx.projects.updateProject(
      ctx.project,
      projectInput({ name: "Printer frame", status: "cancelled" })
    );
    expect(result.releasedReservations).toBe(1);
    expect(coverage(ctx, rail)).toMatchObject({ reserved: 0 });
  });

  it("refuses pieces that are not in storage, or of a part the line does not accept", () => {
    const ctx = setup();
    const rail = ctx.cutLine("Rail", 600);
    const rod = ctx.catalog.createPart(partInput({ name: "Steel rod", tracking: tracking() }));
    const [rodPiece] = addPieces(ctx, rod, ctx.rack, [1000]);
    expect(() => reserve(ctx, rail, rodPiece.id)).toThrow("not the row's exact part");

    ctx.pieces.removePiece({
      operationId: opId(),
      occurredOn: DAY,
      pieceId: ctx.stick,
      reason: "Bent",
    });
    expect(() => reserve(ctx, rail, ctx.stick)).toThrow("no longer in stock");
  });

  it("keeps reserved pieces from being cut or removed outside the project", () => {
    const ctx = setup();
    reserve(ctx, ctx.cutLine("Rail", 600), ctx.stick);
    expect(() =>
      ctx.pieces.removePiece({
        operationId: opId(),
        occurredOn: DAY,
        pieceId: ctx.stick,
        reason: "Bent",
      })
    ).toThrow("reserved for Printer frame");
    expect(() =>
      ctx.pieces.cutPiece({
        operationId: opId(),
        occurredOn: DAY,
        pieceId: ctx.stick,
        cuts: [{ lengthMm: 100, destination: { kind: "keep", locationId: ctx.rack } }],
        remainder: { destination: { kind: "keep", locationId: ctx.rack } },
      })
    ).toThrow("reserved for Printer frame");
  });

  it("counts reserved pieces as not free storage stock", () => {
    const ctx = setup();
    addPieces(ctx, ctx.extrusion, ctx.rack, [450]);
    reserve(ctx, ctx.cutLine("Rail", 600), ctx.stick);
    expect(listStorageStock(ctx.db, [ctx.extrusion])).toMatchObject([
      { locationName: "Rack", balance: 2, reserved: 1 },
    ]);
  });
});

describe("piece suggestions", () => {
  it("uses offcuts first and the smallest piece that fits each cut", () => {
    const ctx = setup();
    const [offcut] = addPieces(ctx, ctx.extrusion, ctx.rack, [450, 300]);
    const legs = ctx.cutLine("Legs", 400, "3");
    // Another project's reservation leaves 397 mm free on the stick, too short for 400 + 3.
    const other = ctx.projects.createProject(projectInput({ name: "Shelf" }));
    const otherLine = ctx.projects.createBomLine(
      other,
      lineInput({ partId: ctx.extrusion, amount: "1", cutLengthMm: 600 })
    );
    ctx.pieceAllocations.reservePieces({
      projectId: other,
      lineId: otherLine,
      pieces: [{ pieceId: ctx.stick }],
    });

    const suggestion = ctx.pieceAllocations.suggestPieces(ctx.project, legs);
    expect(suggestion.cuts.map((c) => [c.piece.id, c.size.lengthMm])).toEqual([[offcut.id, 400]]);
    expect(suggestion.unplaced).toBe(2);

    // Accepting the suggestion reserves the cuts.
    ctx.pieceAllocations.reservePieces({
      projectId: ctx.project,
      lineId: legs,
      pieces: suggestion.cuts.map((c) => ({ pieceId: c.piece.id, size: c.size })),
    });
    expect(coverage(ctx, legs)).toMatchObject({ reserved: 1, uncovered: 2 });
    expect(ctx.pieceAllocations.suggestPieces(ctx.project, legs)).toMatchObject({
      cuts: [],
      unplaced: 2,
    });
  });
});

describe("2D piece reservations", () => {
  function setupSheet() {
    const ctx = setup();
    const sheet = ctx.catalog.createPart(
      partInput({ name: "POM-C sheet 15 mm", tracking: tracking({ widthKey: "width" }) })
    );
    const [piece] = addPieces(ctx, sheet, ctx.rack, [200], 100);
    const line = (cutLengthMm: number, cutWidthMm: number) =>
      ctx.projects.createBomLine(
        ctx.project,
        lineInput({ partId: sheet, amount: "1", cutLengthMm, cutWidthMm })
      );
    return { ...ctx, sheet, piece: piece.id, line };
  }

  it("holds the whole piece, or a size the user confirms, with an area warning", () => {
    const ctx = setupSheet();
    const pad = ctx.line(50, 50);
    expect(() => reserve(ctx, pad, ctx.piece)).toThrow(
      "Confirm that 50 × 50 mm fits in piece #2 (200 × 100 mm)"
    );
    const confirm = (lineId: number, size: { lengthMm: number; widthMm: number }) =>
      ctx.pieceAllocations.reservePieces({
        projectId: ctx.project,
        lineId,
        pieces: [{ pieceId: ctx.piece, size, confirmFit: true }],
      });
    expect(confirm(pad, { lengthMm: 50, widthMm: 50 }).warnings).toEqual([]);

    // A 2D piece has one reservation.
    const other = ctx.line(20, 20);
    expect(() => confirm(other, { lengthMm: 20, widthMm: 20 })).toThrow(
      "already reserved for Printer frame"
    );

    const strip = ctx.line(250, 10);
    ctx.pieceAllocations.releasePieceReservation({
      projectId: ctx.project,
      reservationId: coverage(ctx, pad).parts[0].pieceReservations[0].id,
    });
    expect(confirm(strip, { lengthMm: 250, widthMm: 10 }).warnings).toEqual([
      "250 × 10 mm is larger than piece #2 (200 × 100 mm) in one dimension",
    ]);
  });

  it("needs no confirmation for the whole piece, as it is or rotated", () => {
    const ctx = setupSheet();
    expect(reserve(ctx, ctx.line(100, 200), ctx.piece).warnings).toEqual([]);
  });
});

describe("cut-size BOM lines", () => {
  it("read and show a cut size in the exact part's display unit, else mm", () => {
    const ctx = setup();
    const rod = ctx.catalog.createPart(
      partInput({ name: "Steel rod", tracking: tracking({ displayUnit: "in" }) })
    );
    expect(ctx.projects.cutSizeUnit(rod)).toBe("in");
    expect(ctx.projects.cutSizeUnit(ctx.extrusion)).toBe("mm");
    expect(ctx.projects.cutSizeUnit(null)).toBe("mm");
    const line = ctx.projects.createBomLine(
      ctx.project,
      lineInput({ partId: rod, amount: "2", cutLengthMm: 304.8 })
    );
    expect(ctx.projects.getLine(ctx.project, line)).toMatchObject({ pieceDisplayUnit: "in" });
  });

  it("allow a cut size only for pieces parts, counted in pcs, with matching dimensions", () => {
    const ctx = setup();
    const screw = ctx.catalog.createPart(partInput());
    const create = (overrides: Parameters<typeof lineInput>[0]) =>
      ctx.projects.createBomLine(ctx.project, lineInput(overrides));
    expect(() => create({ partId: screw, cutLengthMm: 415 })).toThrow("not tracked as pieces");
    expect(() => create({ partId: ctx.extrusion, cutLengthMm: 415, cutWidthMm: 20 })).toThrow(
      "pieces have no width"
    );
    expect(() => create({ cutWidthMm: 20 })).toThrow("Enter the cut length");
    expect(() => create({ cutLengthMm: 415, unit: "m", amount: "1" })).toThrow("Use pcs");
    const line = create({ partId: ctx.extrusion, amount: "2", cutLengthMm: 415 });
    expect(ctx.projects.getLine(ctx.project, line)).toMatchObject({
      quantity: 2,
      cutLengthMm: 415,
      cutWidthMm: null,
    });
  });

  it("match on fixed attributes only; the cut size is checked against pieces", () => {
    const ctx = setup();
    const category = ctx.catalog.createCategory("Extrusion", null);
    const attrs = [
      { key: "profile", label: "Profile", value: "2020" },
      { key: "slot_width", label: "Slot width", value: "6 mm" },
    ];
    const pieces = ctx.catalog.createPart(
      partInput({
        name: "2020 extrusion, 6 mm slot",
        categoryId: category,
        attributes: attrs,
        tracking: tracking(),
      })
    );
    const bulk = ctx.catalog.createPart(
      partInput({
        name: "2020 extrusion 415 mm",
        categoryId: category,
        attributes: [...attrs, { key: "length", label: "Length", value: "415 mm" }],
      })
    );
    const line = ctx.projects.createBomLine(
      ctx.project,
      lineInput({
        description: "2020 aluminium extrusion, 6 mm T-slot, 415 mm",
        categoryId: category,
        amount: "2",
        cutLengthMm: 415,
        constraints: [
          equal("profile", "2020"),
          equal("slot_width", "6 mm"),
          equal("length", "415 mm"),
        ],
      })
    );

    const { candidates } = ctx.projects.findCandidates(ctx.project, line);
    const byPart = (id: number) => candidates.find((c) => c.part.id === id);
    expect(byPart(pieces)).toMatchObject({ status: "match", conflicts: [], unresolved: [] });
    expect(byPart(pieces)!.evidence).toContain(
      "Tracked as pieces; cut size 415 mm is checked against pieces"
    );
    expect(byPart(pieces)!.evidence).toContain(
      "Length is a piece dimension, checked against pieces"
    );
    // A bulk part cannot give cut pieces, so it is not listed as a category candidate.
    expect(byPart(bulk)).toBeUndefined();
  });
});

function pick(ctx: Ctx, ...reservationIds: number[]) {
  return ctx.pieceAllocations.pickPieces({
    projectId: ctx.project,
    operationId: opId(),
    occurredOn: DAY,
    picks: reservationIds.map((reservationId) => ({ reservationId })),
  });
}

/** Lengths (and widths) of the part's pieces in storage and at the holding location. */
function piecesOf(ctx: Ctx, partId: number) {
  const { pieces } = ctx.pieces.listPartPieces(partId);
  const sizes = (kind: string) =>
    pieces
      .filter((p) => p.locationKind === kind)
      .map((p) => (p.widthMm === null ? p.lengthMm : [p.lengthMm, p.widthMm]));
  return { storage: sizes("storage"), holding: sizes("project") };
}

describe("picking pieces", () => {
  it("cuts the piece and keeps the other reservations on the remainder", () => {
    const ctx = setup();
    const rail = ctx.cutLine("Rail", 600);
    const post = ctx.cutLine("Post", 390);
    const [railReservation] = reserve(ctx, rail, ctx.stick).reservationIds;
    const [postReservation] = reserve(ctx, post, ctx.stick).reservationIds;

    const [picked] = pick(ctx, railReservation).pieceIds;
    expect(coverage(ctx, rail)).toMatchObject({ picked: 1, reserved: 0, uncovered: 0 });
    // 1000 − 600 − 3 mm kerf.
    expect(piecesOf(ctx, ctx.extrusion)).toEqual({ storage: [397], holding: [600] });
    const [remainder] = ctx.allocations
      .getLineStock(ctx.project, post)
      .parts.flatMap((p) => p.storagePieces);
    expect(remainder.reservations.map((r) => [r.id, r.lengthMm])).toEqual([[postReservation, 390]]);
    expect(remainder.freeLengthMm).toBe(4);
    expect(ctx.pieceAllocations.listPickedPieces(ctx.project, rail)).toMatchObject([
      { pieceId: picked, lengthMm: 600 },
    ]);
    expect(ctx.pieces.getPieceHistory(picked)!.parent?.id).toBe(ctx.stick);

    // The second pick cuts the remainder. Its 4 mm offcut is under the 20 mm minimum and no
    // reservation uses it, so it is scrapped.
    pick(ctx, postReservation);
    expect(coverage(ctx, post)).toMatchObject({ picked: 1, reserved: 0 });
    expect(piecesOf(ctx, ctx.extrusion)).toEqual({ storage: [], holding: [600, 390] });
  });

  it("picks several reservations of one piece in one action", () => {
    const ctx = setup();
    const legs = ctx.cutLine("Legs", 300, "3");
    const { reservationIds } = reserve(ctx, legs, ctx.stick, 3);
    pick(ctx, ...reservationIds);
    expect(coverage(ctx, legs)).toMatchObject({ picked: 3, reserved: 0 });
    // 1000 − 3 × 303 = 91 mm stays in storage.
    expect(piecesOf(ctx, ctx.extrusion)).toEqual({ storage: [91], holding: [300, 300, 300] });
  });

  it("keeps a short remainder that other reservations use", () => {
    const ctx = setup();
    const [long] = reserve(ctx, ctx.cutLine("Long", 980), ctx.stick).reservationIds;
    reserve(ctx, ctx.cutLine("Tab", 10), ctx.stick);
    pick(ctx, long);
    // 17 mm is under the 20 mm minimum offcut, but the tab is still reserved on it.
    expect(piecesOf(ctx, ctx.extrusion).storage).toEqual([17]);
  });

  it("moves a piece reserved whole without a cut", () => {
    const ctx = setup();
    const line = ctx.projects.createBomLine(
      ctx.project,
      lineInput({ description: "Whole stick", partId: ctx.extrusion, amount: "1" })
    );
    const [reservation] = reserve(ctx, line, ctx.stick).reservationIds;
    expect(pick(ctx, reservation).pieceIds).toEqual([ctx.stick]);
    expect(coverage(ctx, line)).toMatchObject({ picked: 1, reserved: 0 });
    expect(piecesOf(ctx, ctx.extrusion)).toEqual({ storage: [], holding: [1000] });
  });

  it("splits a 2D piece into the reserved size and the leftovers the user measured", () => {
    const ctx = setup();
    const sheet = ctx.catalog.createPart(
      partInput({ name: "POM-C sheet", tracking: tracking({ widthKey: "width" }) })
    );
    const [piece] = addPieces(ctx, sheet, ctx.rack, [200], 100);
    const pad = ctx.projects.createBomLine(
      ctx.project,
      lineInput({ partId: sheet, amount: "1", cutLengthMm: 50, cutWidthMm: 50 })
    );
    const {
      reservationIds: [reservation],
    } = ctx.pieceAllocations.reservePieces({
      projectId: ctx.project,
      lineId: pad,
      pieces: [{ pieceId: piece.id, confirmFit: true }],
    });
    const pickSheet = (leftovers?: { lengthMm: number; widthMm: number }[]) =>
      ctx.pieceAllocations.pickPieces({
        projectId: ctx.project,
        operationId: opId(),
        occurredOn: DAY,
        picks: [{ reservationId: reservation, leftovers }],
      });

    expect(() => pickSheet()).toThrow("Enter the leftover pieces of piece #2");
    pickSheet([
      { lengthMm: 150, widthMm: 100 },
      { lengthMm: 50, widthMm: 50 },
    ]);
    expect(coverage(ctx, pad)).toMatchObject({ picked: 1, reserved: 0 });
    expect(piecesOf(ctx, sheet)).toEqual({
      storage: [
        [150, 100],
        [50, 50],
      ],
      holding: [[50, 50]],
    });
  });

  it("uses a picked piece, and returns one to storage with its size so it can be reserved", () => {
    const ctx = setup();
    const rail = ctx.cutLine("Rail", 600);
    const post = ctx.cutLine("Post", 390);
    const [railReservation] = reserve(ctx, rail, ctx.stick).reservationIds;
    const [postReservation] = reserve(ctx, post, ctx.stick).reservationIds;
    const [railPiece, postPiece] = pick(ctx, railReservation, postReservation).pieceIds;

    ctx.pieceAllocations.usePiece({
      projectId: ctx.project,
      lineId: rail,
      pieceId: railPiece,
      operationId: opId(),
      occurredOn: DAY,
      reason: null,
    });
    expect(coverage(ctx, rail)).toMatchObject({ used: 1, picked: 0, uncovered: 0 });
    expect(() =>
      ctx.pieceAllocations.usePiece({
        projectId: ctx.project,
        lineId: rail,
        pieceId: postPiece,
        operationId: opId(),
        occurredOn: DAY,
        reason: null,
      })
    ).toThrow(`Piece #${postPiece} is not picked for this row`);

    ctx.pieceAllocations.returnPiece({
      projectId: ctx.project,
      lineId: post,
      pieceId: postPiece,
      toLocationId: ctx.rack,
      reserveAgain: false,
      operationId: opId(),
      occurredOn: DAY,
    });
    expect(coverage(ctx, post)).toMatchObject({ picked: 0, reserved: 0, uncovered: 1 });
    expect(piecesOf(ctx, ctx.extrusion)).toEqual({ storage: [390], holding: [] });
    reserve(ctx, post, postPiece);
    expect(coverage(ctx, post)).toMatchObject({ reserved: 1, uncovered: 0 });
  });

  it("can reserve a returned piece again for the same line", () => {
    const ctx = setup();
    const rail = ctx.cutLine("Rail", 600);
    const [piece] = pick(ctx, ...reserve(ctx, rail, ctx.stick).reservationIds).pieceIds;
    ctx.pieceAllocations.returnPiece({
      projectId: ctx.project,
      lineId: rail,
      pieceId: piece,
      toLocationId: ctx.rack,
      reserveAgain: true,
      operationId: opId(),
      occurredOn: DAY,
    });
    expect(coverage(ctx, rail)).toMatchObject({ picked: 0, reserved: 1 });
    expect(coverage(ctx, rail).parts[0].pieceReservations).toMatchObject([
      { pieceId: piece, lengthMm: 600 },
    ]);
  });

  it("lists reserved pieces with their cuts in the pick list", () => {
    const ctx = setup();
    reserve(ctx, ctx.cutLine("Rail", 600), ctx.stick);
    reserve(ctx, ctx.cutLine("Post", 390), ctx.stick);
    expect(ctx.pieceAllocations.getPiecePickList(ctx.project)).toMatchObject([
      {
        locationName: "Rack",
        pieces: [
          {
            pieceId: ctx.stick,
            lengthMm: 1000,
            cuts: [
              { lineDescription: "Rail", lengthMm: 600, whole: false },
              { lineDescription: "Post", lengthMm: 390, whole: false },
            ],
          },
        ],
      },
    ]);
  });

  it("points bulk actions on a pieces part to the piece actions", () => {
    const ctx = setup();
    expect(() =>
      ctx.allocations.use({
        projectId: ctx.project,
        lineId: ctx.cutLine("Rail", 600),
        partId: ctx.extrusion,
        amount: "1",
        unit: "pcs",
        operationId: opId(),
        occurredOn: DAY,
        reason: null,
      })
    ).toThrow("Reserve, pick, use, and return its pieces one by one");
  });
});
