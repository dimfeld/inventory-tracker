/**
 * A project BOM with explicit section headings and an ungrouped row before the first heading.
 * `response` is a stored model answer; `expected` is the normalized result.
 */
import type { ProjectOutput } from "../schema";

export const source = `Desk lamp
4x M3x8 pan head screw (enclosure)
Power supply:
2x 100nF 50V 0805 capacitor C1, C2
1x AMS1117-3.3 regulator U1
Controller:
4x 4k7 0805 resistor R1-R4`;

export const response: ProjectOutput = {
  projectName: { value: "Desk lamp", provenance: "source" },
  groups: [
    { name: "Power supply", evidence: { row: 3, excerpt: "Power supply:" } },
    { name: "Controller", evidence: { row: 6, excerpt: "Controller:" } },
  ],
  lines: [
    {
      description: "M3x8 pan head screw (enclosure)",
      category: { value: "Hardware / Fasteners / Screws", provenance: "inferred" },
      manufacturer: null,
      partNumber: null,
      supplierSku: null,
      attributes: [
        { key: "thread", value: "M3x8", provenance: "source" },
        { key: "head", value: "pan", provenance: "source" },
      ],
      evidence: { row: 2, excerpt: "4x M3x8 pan head screw (enclosure)" },
      unresolved: [],
      notes: null,
      quantity: { value: "4", provenance: "source" },
      unit: { value: "pcs", provenance: "inferred" },
      referenceDesignators: null,
      // Before the first heading: ungrouped. "(enclosure)" is not a heading.
      group: null,
    },
    {
      description: "100nF 50V 0805 capacitor",
      category: { value: "Electronics / Passives / Capacitors", provenance: "inferred" },
      manufacturer: null,
      partNumber: null,
      supplierSku: null,
      attributes: [
        { key: "capacitance", value: "100nF", provenance: "source" },
        { key: "voltage", value: "50V", provenance: "source" },
        { key: "package", value: "0805", provenance: "source" },
      ],
      evidence: { row: 4, excerpt: "2x 100nF 50V 0805 capacitor C1, C2" },
      unresolved: [],
      notes: null,
      quantity: { value: "2", provenance: "source" },
      unit: { value: "pcs", provenance: "inferred" },
      referenceDesignators: { value: "C1, C2", provenance: "source" },
      group: { value: "Power supply", provenance: "source" },
    },
    {
      description: "AMS1117-3.3 regulator",
      category: null,
      manufacturer: null,
      partNumber: { value: "AMS1117-3.3", provenance: "source" },
      supplierSku: null,
      attributes: [],
      evidence: { row: 5, excerpt: "1x AMS1117-3.3 regulator U1" },
      unresolved: [],
      notes: null,
      quantity: { value: "1", provenance: "source" },
      unit: { value: "pcs", provenance: "inferred" },
      referenceDesignators: { value: "U1", provenance: "source" },
      group: { value: "Power supply", provenance: "source" },
    },
    {
      description: "4k7 0805 resistor",
      category: { value: "Electronics / Passives / Resistors", provenance: "inferred" },
      manufacturer: null,
      partNumber: null,
      supplierSku: null,
      attributes: [
        { key: "resistance", value: "4k7", provenance: "source" },
        { key: "package", value: "0805", provenance: "source" },
      ],
      evidence: { row: 7, excerpt: "4x 4k7 0805 resistor R1-R4" },
      unresolved: [],
      notes: null,
      quantity: { value: "4", provenance: "source" },
      unit: { value: "pcs", provenance: "inferred" },
      referenceDesignators: { value: "R1-R4", provenance: "source" },
      group: { value: "Controller", provenance: "source" },
    },
  ],
};

export const expected = {
  header: { projectName: "Desk lamp" },
  groups: [
    { name: "Power supply", sourceRow: 3, sourceExcerpt: "Power supply:" },
    { name: "Controller", sourceRow: 6, sourceExcerpt: "Controller:" },
  ],
  /** Group of each line in order; null is ungrouped. */
  lineGroups: [null, "Power supply", "Power supply", "Controller"],
} as const;
