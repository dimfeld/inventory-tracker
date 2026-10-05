import { describe, expect, it } from "vitest";
import { listLocationBalances } from "#lib/server/db/movements.ts";
import { createFilterFixtures } from "#lib/server/inventory/fixtures.ts";
import { opId, partInput } from "#lib/server/inventory/test-helpers.ts";
import type { Candidate } from "./matching";
import { createTestProjects, equal, lineInput, projectInput } from "./test-helpers";

function setup() {
  const context = createTestProjects();
  const fixtures = createFilterFixtures(context.catalog);
  const projectId = context.projects.createProject(projectInput());
  const addLine = (overrides: Parameters<typeof lineInput>[0]) =>
    context.projects.createBomLine(projectId, lineInput(overrides));
  const candidates = (lineId: number) => context.projects.findCandidates(projectId, lineId);
  return { ...context, ...fixtures, projectId, addLine, candidates };
}

const byPart = (candidates: Candidate[], partId: number) =>
  candidates.find((c) => c.part.id === partId);

describe("candidate matching", () => {
  it("keeps an M3 screw requirement without length and head unresolved", () => {
    const { projects, projectId, ids, categories, addLine, candidates } = setup();
    const lineId = addLine({
      description: "M3 screw",
      categoryId: categories.screws,
      constraints: [equal("thread", "M3")],
    });

    const result = candidates(lineId);
    expect(result.requirement.missingRequired.map((m) => m.key)).toEqual(["head", "length"]);
    expect(result.candidates.map((c) => [c.part.id, c.status])).toEqual([
      [ids.m3x12SocketScrew, "unresolved"],
      [ids.m3x8PanScrew, "unresolved"],
      [ids.unknownScrew, "unresolved"],
    ]);
    expect(byPart(result.candidates, ids.m3x8PanScrew)!.unresolved).toEqual([
      "Requirement does not specify Head",
      "Requirement does not specify Length",
    ]);
    expect(() =>
      projects.approveChoice(projectId, lineId, {
        partId: ids.m3x8PanScrew,
        substitute: false,
        note: null,
      })
    ).toThrow("not a confirmed match");

    // Supplying the missing dimensions resolves the requirement to the one fitting screw.
    projects.updateBomLine(
      projectId,
      lineId,
      lineInput({
        categoryId: categories.screws,
        constraints: [equal("thread", "M3"), equal("length", "8mm"), equal("head", "pan")],
      })
    );
    const resolved = candidates(lineId).candidates;
    expect(resolved.map((c) => [c.part.id, c.status])).toEqual([
      [ids.m3x8PanScrew, "match"],
      [ids.unknownScrew, "unresolved"],
    ]);
    expect(resolved[0].evidence).toContain("Length is 8 mm · ≈0.31 in");
  });

  it("does not accept an exact identifier with a conflicting manufacturer, package, pitch, or voltage", () => {
    const { catalog, projects, projectId, ids, categories, addLine, candidates } = setup();
    const header = catalog.createPart(
      partInput({
        name: "JST B4B-XH-A",
        categoryId: categories.connectors,
        manufacturer: "JST",
        partNumber: "B4B-XH-A",
        attributes: [
          { key: "pitch", label: "Pitch", value: "2.5mm" },
          { key: "pin_count", label: "Pin count", value: "4" },
        ],
      })
    );

    const exact = byPart(candidates(addLine({ partNumber: "b4b-xh-a" })).candidates, header)!;
    expect(exact).toMatchObject({ source: "part_number", status: "match" });

    const wrongMaker = byPart(
      candidates(addLine({ partNumber: "B4B-XH-A", manufacturer: "Molex" })).candidates,
      header
    )!;
    expect(wrongMaker.status).toBe("conflict");
    expect(wrongMaker.conflicts).toEqual(["Manufacturer is JST; requirement names Molex"]);

    const pitchLine = addLine({ partNumber: "B4B-XH-A", constraints: [equal("pitch", "2.54 mm")] });
    const wrongPitch = byPart(candidates(pitchLine).candidates, header)!;
    expect(wrongPitch.status).toBe("conflict");
    expect(wrongPitch.conflicts).toEqual([
      "Pitch is 2.5 mm · ≈0.098 in; requirement needs 2.54 mm · 0.1 in",
    ]);
    expect(() =>
      projects.approveChoice(projectId, pitchLine, {
        partId: header,
        substitute: false,
        note: null,
      })
    ).toThrow("not a confirmed match");

    // An exact catalog part with a conflicting package or voltage is not a match either.
    const capLine = addLine({
      partId: ids.capacitor100n,
      constraints: [equal("package", "0603"), equal("voltage", "25V")],
    });
    const [cap] = candidates(capLine).candidates;
    expect(cap).toMatchObject({ source: "exact_part", status: "conflict" });
    expect(cap.conflicts).toEqual([
      "Package is 0805; requirement needs 0603",
      "Voltage is 50 V; requirement needs 25 V",
    ]);
  });

  it("matches the same requirement whether a length is written in mm or inches", () => {
    const { catalog, categories, addLine, candidates } = setup();
    const inchScrew = catalog.createPart(
      partInput({
        name: "M3 screw, 1 inch",
        categoryId: categories.screws,
        attributes: [
          { key: "thread", label: "Thread", value: "M3" },
          { key: "head", label: "Head", value: "pan" },
          { key: "length", label: "Length", value: '1"' },
        ],
      })
    );
    for (const length of ["25.4 mm", "1 in"]) {
      const lineId = addLine({
        categoryId: categories.screws,
        constraints: [equal("thread", "M3"), equal("head", "pan"), equal("length", length)],
      });
      const match = byPart(candidates(lineId).candidates, inchScrew);
      expect(match, length).toMatchObject({ status: "match" });
      expect(match!.evidence).toContain("Length is 25.4 mm · 1 in");
    }
  });

  it("finds parts by alias or supplier SKU and checks them like any candidate", () => {
    const { projects, projectId, ids, addLine, candidates } = setup();
    const skuLine = addLine({ description: "McMaster 91290A117", partNumber: "91290A117" });
    expect(candidates(skuLine).candidates).toMatchObject([
      { part: { id: ids.m3x12SocketScrew }, source: "supplier_sku", status: "match" },
    ]);
    projects.approveChoice(projectId, skuLine, {
      partId: ids.m3x12SocketScrew,
      substitute: false,
      note: null,
    });

    const aliasLine = addLine({ partNumber: "M3x12 SHCS", constraints: [equal("length", "10")] });
    expect(candidates(aliasLine).candidates).toMatchObject([
      {
        source: "alias",
        status: "conflict",
        conflicts: ["Length is 12 mm · ≈0.47 in; requirement needs 10 mm · ≈0.39 in"],
      },
    ]);
  });

  it("applies a minimum rating only when the requirement permits it", () => {
    const { ids, categories, addLine, candidates } = setup();
    const base = {
      categoryId: categories.capacitors,
      constraints: [equal("capacitance", "100n"), equal("package", "0805")],
    };

    const exactVoltage = addLine({
      ...base,
      constraints: [...base.constraints, equal("voltage", "25V")],
    });
    expect(byPart(candidates(exactVoltage).candidates, ids.capacitor100n)).toBeUndefined();

    const minimum = addLine({
      ...base,
      constraints: [
        ...base.constraints,
        { key: "voltage", comparison: "at_least", value: "25V", maxValue: null },
      ],
    });
    const cap = byPart(candidates(minimum).candidates, ids.capacitor100n)!;
    expect(cap.status).toBe("match");
    expect(cap.evidence).toContain("Voltage 50 V meets the permitted minimum of 25 V");

    const range = addLine({
      ...base,
      constraints: [
        ...base.constraints,
        { key: "voltage", comparison: "range", value: "10V", maxValue: "35V" },
      ],
    });
    expect(byPart(candidates(range).candidates, ids.capacitor100n)).toBeUndefined();
  });

  it("shows approved substitutes with their note", () => {
    const { projects, projectId, ids, categories, addLine, candidates } = setup();
    const lineId = addLine({
      description: "4.7k 0805 resistor",
      categoryId: categories.resistors,
      referenceDesignators: "R1, R2",
      constraints: [equal("resistance", "4k7"), equal("package", "0805")],
    });

    const before = candidates(lineId).candidates;
    expect(before.map((c) => [c.part.id, c.status])).toEqual([
      [ids.resistor4k7Smd, "match"],
      [ids.resistor4k7Tht, "unresolved"],
    ]);

    expect(() =>
      projects.approveChoice(projectId, lineId, {
        partId: ids.resistor4k7Tht,
        substitute: true,
        note: null,
      })
    ).toThrow("Enter a note");
    projects.approveChoice(projectId, lineId, {
      partId: ids.resistor4k7Smd,
      substitute: false,
      note: null,
    });
    projects.approveChoice(projectId, lineId, {
      partId: ids.resistor4k7Tht,
      substitute: true,
      note: "Through-hole fits the 0805 pads bent over",
    });
    // A conflicting part found by the owner can also be a substitute.
    projects.approveChoice(projectId, lineId, {
      partId: ids.resistor10k,
      substitute: true,
      note: "Pull-up value is not critical",
    });

    const after = candidates(lineId).candidates;
    expect(byPart(after, ids.resistor4k7Tht)!.choice).toMatchObject({
      substitute: true,
      note: "Through-hole fits the 0805 pads bent over",
    });
    expect(byPart(after, ids.resistor10k)).toMatchObject({
      status: "conflict",
      choice: { substitute: true, note: "Pull-up value is not critical" },
    });

    const line = projects.getLine(projectId, lineId)!;
    expect(line.referenceDesignators).toBe("R1, R2");
    expect(line.choices.map((c) => [c.partName, c.substitute, c.note])).toEqual([
      ["4.7k resistor 0805", false, null],
      ["4.7k resistor axial", true, "Through-hole fits the 0805 pads bent over"],
      ["10k resistor 0805", true, "Pull-up value is not critical"],
    ]);

    const choice = line.choices[2];
    projects.removeChoice(projectId, lineId, choice.id);
    expect(projects.getLine(projectId, lineId)!.choices).toHaveLength(2);
  });

  it("never approves a part with an incompatible unit, even as a substitute", () => {
    const { catalog, projects, projectId, addLine } = setup();
    const wire = catalog.createPart(partInput({ name: "Wire", baseUnit: "mm" }));
    const lineId = addLine({ description: "Screws", amount: "4" });
    expect(() =>
      projects.approveChoice(projectId, lineId, { partId: wire, substitute: true, note: "Close" })
    ).toThrow("cannot convert");
  });

  it("does not change physical stock or available quantities", () => {
    const { db, locations, stock, projects, projectId, ids, categories, addLine, candidates } =
      setup();
    const drawer = locations.createLocation({ name: "Drawer A", notes: null });
    stock.recordOpeningStock({
      operationId: opId(),
      partId: ids.m3x8PanScrew,
      occurredOn: "2026-10-01",
      amount: "20",
      unit: "pcs",
      locationId: drawer,
    });
    const balances = () => listLocationBalances(db, ids.m3x8PanScrew);
    const movementCount = () =>
      db.query<{ n: number }, []>("SELECT count(*) AS n FROM stock_movements").get()!.n;
    const before = { balances: balances(), movements: movementCount() };

    const lineId = addLine({
      categoryId: categories.screws,
      amount: "15",
      constraints: [equal("thread", "M3x8"), equal("head", "pan")],
    });
    expect(byPart(candidates(lineId).candidates, ids.m3x8PanScrew)!.status).toBe("match");
    projects.approveChoice(projectId, lineId, {
      partId: ids.m3x8PanScrew,
      substitute: false,
      note: null,
    });

    expect({ balances: balances(), movements: movementCount() }).toEqual(before);
    expect(before.balances).toMatchObject([{ locationName: "Drawer A", quantity: 20 }]);
  });
});
