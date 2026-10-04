/**
 * A flat CSV BOM with no sections or component column. Rows of different categories must not
 * be grouped. `response` is a stored model answer; `expected` is the normalized result.
 */
import type { ProjectOutput } from "../schema";

export const source = `Qty,Value,Package,Reference
2,10k,0805,"R5,R6"
1,1uF,0805,C3
3,M3x8 pan head screw,,`;

export const response: ProjectOutput = {
  projectName: null,
  groups: [],
  lines: [
    {
      description: "10k resistor 0805",
      category: { value: "Electronics / Passives / Resistors", provenance: "inferred" },
      manufacturer: null,
      partNumber: null,
      supplierSku: null,
      attributes: [
        { key: "resistance", value: "10k", provenance: "source" },
        { key: "package", value: "0805", provenance: "source" },
      ],
      evidence: { row: 2, excerpt: '2,10k,0805,"R5,R6"' },
      unresolved: [],
      notes: null,
      quantity: { value: "2", provenance: "source" },
      unit: { value: "pcs", provenance: "inferred" },
      referenceDesignators: { value: "R5,R6", provenance: "source" },
      group: null,
    },
    {
      description: "1uF capacitor 0805",
      category: { value: "Electronics / Passives / Capacitors", provenance: "inferred" },
      manufacturer: null,
      partNumber: null,
      supplierSku: null,
      attributes: [
        { key: "capacitance", value: "1uF", provenance: "source" },
        { key: "package", value: "0805", provenance: "source" },
      ],
      evidence: { row: 3, excerpt: "1,1uF,0805,C3" },
      unresolved: ["voltage"],
      notes: null,
      quantity: { value: "1", provenance: "source" },
      unit: { value: "pcs", provenance: "inferred" },
      referenceDesignators: { value: "C3", provenance: "source" },
      group: null,
    },
    {
      description: "M3x8 pan head screw",
      category: { value: "Hardware / Fasteners / Screws", provenance: "inferred" },
      manufacturer: null,
      partNumber: null,
      supplierSku: null,
      attributes: [
        { key: "thread", value: "M3x8", provenance: "source" },
        { key: "head", value: "pan", provenance: "source" },
      ],
      evidence: { row: 4, excerpt: "3,M3x8 pan head screw,," },
      unresolved: [],
      notes: null,
      quantity: { value: "3", provenance: "source" },
      unit: { value: "pcs", provenance: "inferred" },
      referenceDesignators: null,
      group: null,
    },
  ],
};

export const expected = {
  groups: [],
  lineGroups: [null, null, null],
  /** The capacitor does not state its voltage, a required attribute. */
  capacitorUnresolved: ["voltage", "Voltage is not specified"],
} as const;
