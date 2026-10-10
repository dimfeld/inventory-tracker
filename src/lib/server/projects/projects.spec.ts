import { describe, expect, it } from "vitest";
import { insertBomLine } from "#lib/server/db/projects.ts";
import { InventoryError } from "#lib/server/inventory/errors.ts";
import { categoryIdByPath } from "#lib/server/inventory/fixtures.ts";
import { partInput } from "#lib/server/inventory/test-helpers.ts";
import { UnitError } from "#lib/units.ts";
import type { BomChange } from "./allocations";
import { createTestProjects, equal, lineInput, projectInput } from "./test-helpers";

describe("projects and BOM lines", () => {
  it("creates and updates a project and its BOM without an LLM", () => {
    const { catalog, projects } = createTestProjects();
    const wire = catalog.createPart(partInput({ name: "22 AWG wire", baseUnit: "mm" }));
    const screws = categoryIdByPath(catalog, "Hardware / Fasteners / Screws");

    const projectId = projects.createProject(projectInput());
    projects.updateProject(
      projectId,
      projectInput({ status: "active", notes: "Bench build", links: ["https://example.com/lamp"] })
    );

    const wireLine = projects.createBomLine(
      projectId,
      lineInput({ description: "Hookup wire", amount: "1.5", unit: "m", partId: wire })
    );
    const screwLine = projects.createBomLine(
      projectId,
      lineInput({
        description: "M3x8 pan head screws",
        amount: "6",
        categoryId: screws,
        referenceDesignators: "H1-H6",
        constraints: [equal("thread", "M3x8"), equal("head", "Pan")],
      })
    );
    projects.updateBomLine(
      projectId,
      screwLine,
      lineInput({
        description: "M3x8 pan head screws",
        amount: "8",
        categoryId: screws,
        referenceDesignators: "H1-H8",
        notes: "Two spares",
        constraints: [equal("thread", "M3x8"), equal("head", "Pan")],
      })
    );

    const details = projects.getProjectDetails(projectId)!;
    expect(details.project).toMatchObject({ status: "active", notes: "Bench build" });
    expect(details.links).toEqual(["https://example.com/lamp"]);
    const [wireRow, screwRow] = details.sections[0].lines;
    // The exact part's requirement is stored in the part's base unit.
    expect(wireRow).toMatchObject({
      id: wireLine,
      quantity: 1500,
      unit: "mm",
      partName: "22 AWG wire",
    });
    expect(screwRow).toMatchObject({
      id: screwLine,
      description: "M3x8 pan head screws",
      quantity: 8,
      unit: "pcs",
      referenceDesignators: "H1-H8",
      notes: "Two spares",
    });
    // The combined thread designation also sets the length.
    expect(screwRow.constraints.map((c) => [c.key, c.valueText ?? c.valueNumber])).toEqual([
      ["head", "pan"],
      ["length", 8],
      ["thread", "M3"],
    ]);
  });

  it("rejects incompatible units, inexact amounts, and unreadable constraint values", () => {
    const { catalog, projects } = createTestProjects();
    const screw = catalog.createPart(partInput());
    const projectId = projects.createProject(projectInput());

    expect(() =>
      projects.createBomLine(projectId, lineInput({ partId: screw, unit: "m" }))
    ).toThrow(UnitError);
    expect(() => projects.createBomLine(projectId, lineInput({ amount: "1.5" }))).toThrow(
      UnitError
    );
    expect(() =>
      projects.createBomLine(projectId, lineInput({ constraints: [equal("length", "long")] }))
    ).toThrow(InventoryError);
    expect(() =>
      projects.createBomLine(
        projectId,
        lineInput({
          constraints: [{ key: "head", comparison: "at_least", value: "pan", maxValue: null }],
        })
      )
    ).toThrow(InventoryError);
    expect(projects.getProjectDetails(projectId)!.lineCount).toBe(0);
  });

  it("passes updates, deletions, and approval removals to the allocation guard", () => {
    const changes: BomChange[] = [];
    let reject = false;
    const { catalog, projects } = createTestProjects({
      allocations: {
        applyChange(_db, change) {
          changes.push(change);
          if (reject) throw new InventoryError("2 pcs are already picked for this line");
        },
        applyStatusChange: () => ({ releasedReservations: 0, releasedCommitments: 0 }),
      },
    });
    const screw = catalog.createPart(partInput());
    const projectId = projects.createProject(projectInput());
    const lineId = projects.createBomLine(projectId, lineInput({ partId: screw }));
    const choiceId = projects.approveChoice(projectId, lineId, {
      partId: screw,
      substitute: false,
      note: null,
    });

    reject = true;
    expect(() =>
      projects.updateBomLine(projectId, lineId, lineInput({ partId: screw, amount: "1" }))
    ).toThrow("already picked");
    expect(() => projects.removeChoice(projectId, lineId, choiceId)).toThrow("already picked");
    expect(() => projects.deleteBomLine(projectId, lineId)).toThrow("already picked");

    // Rejected changes roll back.
    const line = projects.getLine(projectId, lineId)!;
    expect(line.quantity).toBe(4);
    expect(line.choices).toHaveLength(1);
    expect(changes.map((c) => c.kind)).toEqual(["update", "remove_choice", "delete"]);
    const update = changes[0] as Extract<BomChange, { kind: "update" }>;
    expect([update.before.line.quantity, update.after.line.quantity]).toEqual([4, 1]);

    reject = false;
    projects.deleteBomLine(projectId, lineId);
    expect(projects.getLine(projectId, lineId)).toBeNull();
  });
});

describe("BOM component groups", () => {
  it("supports flat, grouped, and ungrouped rows without changing quantities", () => {
    const { catalog, projects } = createTestProjects();
    const screw = catalog.createPart(partInput());
    const projectId = projects.createProject(projectInput());
    const first = projects.createBomLine(projectId, lineInput({ partId: screw, amount: "4" }));
    const second = projects.createBomLine(projectId, lineInput({ partId: screw, amount: "6" }));

    const flat = projects.getProjectDetails(projectId)!;
    expect(flat.sections).toHaveLength(1);
    expect(flat.sections[0]).toMatchObject({ component: null });
    expect(flat.totals).toMatchObject([{ partId: screw, quantity: 10, unit: "pcs" }]);

    const power = projects.createComponent(projectId, { name: "Power supply", notes: null });
    const controller = projects.createComponent(projectId, { name: "Controller", notes: null });
    projects.setLineComponent(projectId, first, power);

    const grouped = projects.getProjectDetails(projectId)!;
    expect(
      grouped.sections.map((s) => [s.component?.name ?? null, s.lines.map((l) => l.id)])
    ).toEqual([
      ["Power supply", [first]],
      ["Controller", []],
      [null, [second]],
    ]);
    expect(grouped.totals).toEqual(flat.totals);

    // Filters limit sections, not project totals.
    const filtered = projects.getProjectDetails(projectId, power)!;
    expect(filtered.sections.map((s) => s.component?.id)).toEqual([power]);
    expect(filtered.sections[0].totals).toMatchObject([{ quantity: 4 }]);
    expect(filtered.totals).toEqual(flat.totals);
    expect(
      projects.getProjectDetails(projectId, "ungrouped")!.sections[0].lines.map((l) => l.id)
    ).toEqual([second]);

    projects.setLineComponent(projectId, first, controller);
    projects.setLineComponent(projectId, second, null);
    const moved = projects.getProjectDetails(projectId)!;
    expect(moved.sections.map((s) => s.lines.map((l) => [l.id, l.quantity]))).toEqual([
      [],
      [[first, 4]],
      [[second, 6]],
    ]);
  });

  it("rejects assigning a row to another project's component", () => {
    const { db, catalog, projects } = createTestProjects();
    const screw = catalog.createPart(partInput());
    const lamp = projects.createProject(projectInput());
    const robot = projects.createProject(projectInput({ name: "Robot" }));
    const robotGroup = projects.createComponent(robot, { name: "Chassis", notes: null });
    const lineId = projects.createBomLine(lamp, lineInput({ partId: screw }));

    expect(() => projects.setLineComponent(lamp, lineId, robotGroup)).toThrow(
      "belongs to another project"
    );
    expect(() =>
      projects.createBomLine(lamp, lineInput({ partId: screw, componentId: robotGroup }))
    ).toThrow("belongs to another project");
    // The schema enforces the same rule.
    expect(() =>
      insertBomLine(db, lamp, {
        componentId: robotGroup,
        description: "Screw",
        quantity: 1,
        unit: "pcs",
        partId: screw,
        categoryId: null,
        manufacturer: null,
        partNumber: null,
        referenceDesignators: null,
        notes: null,
        cutLengthMm: null,
        cutWidthMm: null,
      })
    ).toThrow(/FOREIGN KEY/);
    expect(projects.getLine(lamp, lineId)!.componentId).toBeNull();
  });

  it("removing a component ungroups its rows and keeps their IDs, requirements, and approvals", () => {
    const { catalog, projects } = createTestProjects();
    const screw = catalog.createPart(partInput());
    const projectId = projects.createProject(projectInput());
    const enclosure = projects.createComponent(projectId, { name: "Enclosure", notes: "Printed" });
    const lineId = projects.createBomLine(
      projectId,
      lineInput({
        partId: screw,
        componentId: enclosure,
        referenceDesignators: "H1-H4",
        constraints: [equal("head", "socket")],
      })
    );
    projects.approveChoice(projectId, lineId, {
      partId: screw,
      substitute: true,
      note: "Head type not recorded on the part; checked by hand",
    });
    const before = projects.getLine(projectId, lineId)!;

    projects.removeComponent(projectId, enclosure);

    const details = projects.getProjectDetails(projectId)!;
    expect(details.components).toEqual([]);
    expect(details.sections).toHaveLength(1);
    expect(details.sections[0].lines).toEqual([{ ...before, componentId: null }]);
  });

  it("renames and reorders components", () => {
    const { projects } = createTestProjects();
    const projectId = projects.createProject(projectInput());
    const a = projects.createComponent(projectId, { name: "Power", notes: null });
    const b = projects.createComponent(projectId, { name: "Controller", notes: null });
    const c = projects.createComponent(projectId, { name: "Enclosure", notes: null });

    projects.updateComponent(projectId, a, { name: "Power supply", notes: "12 V" });
    projects.moveComponent(projectId, c, "up");
    projects.moveComponent(projectId, a, "up");

    const names = projects.getProjectDetails(projectId)!.components.map((x) => x.name);
    expect(names).toEqual(["Power supply", "Enclosure", "Controller"]);
    expect(b).toBeGreaterThan(0);
  });

  it("totals count each row once and keep parts and units apart", () => {
    const { catalog, projects } = createTestProjects();
    const screw = catalog.createPart(partInput());
    const wire = catalog.createPart(partInput({ name: "Wire", baseUnit: "mm" }));
    const projectId = projects.createProject(projectInput());
    const group = projects.createComponent(projectId, { name: "Power supply", notes: null });
    const a = projects.createBomLine(
      projectId,
      lineInput({ partId: screw, amount: "4", componentId: group })
    );
    const b = projects.createBomLine(projectId, lineInput({ partId: screw, amount: "2" }));
    const c = projects.createBomLine(
      projectId,
      lineInput({ partId: wire, amount: "0.5", unit: "m" })
    );
    const d = projects.createBomLine(
      projectId,
      lineInput({ description: "Generic M3 screw", amount: "3" })
    );
    const e = projects.createBomLine(
      projectId,
      lineInput({ description: "Heat shrink", amount: "20", unit: "mm" })
    );

    expect(projects.getProjectDetails(projectId)!.totals).toEqual([
      {
        partId: screw,
        label: "M3 × 8 mm socket-head screw",
        quantity: 6,
        unit: "pcs",
        lineIds: [a, b],
      },
      { partId: wire, label: "Wire", quantity: 500, unit: "mm", lineIds: [c] },
      { partId: null, label: "Generic M3 screw", quantity: 3, unit: "pcs", lineIds: [d] },
      { partId: null, label: "Heat shrink", quantity: 20, unit: "mm", lineIds: [e] },
    ]);
  });
});
