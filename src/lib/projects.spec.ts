import { describe, expect, it } from "vitest";
import { describeConstraint } from "./projects";

describe("describeConstraint", () => {
  const constraint = {
    label: "Length",
    normalization: "length",
    comparison: "equal" as const,
    rawValue: "1 in",
    valueNumber: 25.4,
    rawMaxValue: null,
    maxValueNumber: null,
  };

  it("keeps the entered text and shows a length in mm and inches", () => {
    expect(describeConstraint(constraint)).toBe("Length equals 1 in (25.4 mm · 1 in)");
    expect(
      describeConstraint({
        ...constraint,
        comparison: "range",
        rawValue: "8",
        valueNumber: 8,
        rawMaxValue: "12 mm",
        maxValueNumber: 12,
      })
    ).toBe("Length between 8 (8 mm · ≈0.31 in) and 12 mm (12 mm · ≈0.47 in)");
  });

  it("shows other attributes as entered", () => {
    expect(
      describeConstraint({
        ...constraint,
        label: "Head",
        normalization: "keyword",
        rawValue: "pan",
        valueNumber: null,
      })
    ).toBe("Head equals pan");
  });
});
