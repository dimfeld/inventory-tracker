/**
 * A BOM of material cut from stock pieces. `response` is a stored model answer: it gives the
 * first cut size as a length attribute too, puts the second in the quantity, and gives the
 * sheet size as one value. Normalization reads each into a cut size.
 */
import type { ProjectOutput } from "../schema";

export const source = `2020 aluminium extrusion, 6 mm T-slot, 415 mm
2 × 300 mm 2020 extrusion
150 × 150 mm POM-C sheet 15 mm`;

const line = (
  row: number,
  fields: Partial<ProjectOutput["lines"][number]>
): ProjectOutput["lines"][number] => ({
  description: "",
  category: null,
  manufacturer: null,
  partNumber: null,
  supplierSku: null,
  attributes: [],
  evidence: { row, excerpt: source.split("\n")[row - 1] },
  unresolved: [],
  notes: null,
  quantity: { value: "1", provenance: "inferred" },
  unit: { value: "pcs", provenance: "inferred" },
  referenceDesignators: null,
  cutLength: null,
  cutWidth: null,
  group: null,
  ...fields,
});

export const response: ProjectOutput = {
  projectName: null,
  groups: [],
  lines: [
    line(1, {
      description: "2020 aluminium extrusion, 6 mm T-slot",
      attributes: [{ key: "length", value: "415 mm", provenance: "source" }],
      cutLength: { value: "415 mm", provenance: "source" },
    }),
    line(2, {
      description: "2020 extrusion",
      quantity: { value: "2 × 300 mm", provenance: "source" },
      unit: null,
    }),
    line(3, {
      description: "POM-C sheet 15 mm",
      cutLength: { value: "150 × 150 mm", provenance: "source" },
    }),
  ],
};
