import { describe, expect, it } from "vitest";
import { lineFormSchema } from "./import";

const line = (fields: Record<string, string>) => ({
  id: 1,
  importId: 2,
  choosePart: "",
  copyFrom: "",
  splitNotes: "",
  description: "2020 extrusion",
  quantity: "2",
  unit: "pcs",
  purchaseUnit: "each",
  packQuantity: "1",
  unitPrice: "",
  currency: "",
  referenceDesignators: "",
  cutLength: "",
  cutWidth: "",
  pieceTracking: "",
  kerf: "",
  minOffcut: "",
  categoryId: "",
  manufacturer: "",
  partNumber: "",
  supplierSku: "",
  notes: "",
  groupId: "",
  resolution: "new",
  partId: "",
  ...fields,
});

describe("import line form piece tracking", () => {
  it("is null for a bulk part", () => {
    const parsed = lineFormSchema.parse(line({}));
    expect(parsed.edit.fields.pieceTracking).toBeNull();
  });

  it("reads the dimensions, and the kerf and minimum offcut as lengths, empty as zero", () => {
    expect(
      lineFormSchema.parse(line({ pieceTracking: "1d", kerf: "0.1 in" })).edit.fields.pieceTracking
    ).toEqual({ twoD: false, kerfMm: 2.54, minOffcutMm: 0 });
    expect(
      lineFormSchema.parse(line({ pieceTracking: "2d", kerf: "3", minOffcut: "50" })).edit.fields
        .pieceTracking
    ).toEqual({ twoD: true, kerfMm: 3, minOffcutMm: 50 });
  });

  it("rejects a kerf that is not a length", () => {
    const result = lineFormSchema.safeParse(line({ pieceTracking: "1d", kerf: "thin" }));
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((i) => i.message)).toEqual(["Enter the kerf as a length"]);
  });
});
