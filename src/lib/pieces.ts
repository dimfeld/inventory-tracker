import { millimetresToInches, normalizeAttributeValue } from "#lib/attributes.ts";

/**
 * Piece tracking. A part tracked as `pieces` keeps each physical piece (a length of extrusion,
 * a sheet) with its own dimensions in mm. A `bulk` part has one fungible quantity per location.
 *
 * Piece dimensions are entered like length attributes: a bare number is mm, and `mm`, `cm`,
 * `in`, or `"` can follow it. They are shown in mm, with inches in the title text.
 */
export const TRACKING_MODES = ["bulk", "pieces"] as const;

export type TrackingMode = (typeof TRACKING_MODES)[number];

/** A length in mm from text such as `1220`, `700 mm`, or `6"`, or null when it is not a length. */
export function parseLengthMm(raw: string): number | null {
  return normalizeAttributeValue("length", raw)?.valueNumber ?? null;
}

/** A length in mm, such as `415.5 mm`. */
export function formatMm(mm: number): string {
  return `${mm} mm`;
}

/** A length in inches, such as `≈48.03 in`, for the title text next to a mm value. */
export function formatInches(mm: number): string {
  const { inches, exact } = millimetresToInches(mm);
  return `${exact ? "" : "≈"}${inches} in`;
}

/** The size of a piece, such as `1220 mm` or `150 × 75 mm`. */
export function formatPieceSize(piece: { lengthMm: number; widthMm: number | null }): string {
  return piece.widthMm === null
    ? formatMm(piece.lengthMm)
    : `${piece.lengthMm} × ${formatMm(piece.widthMm)}`;
}

/** The size of a piece in inches, such as `≈5.91 × ≈2.95 in`. */
export function formatPieceSizeInches(piece: { lengthMm: number; widthMm: number | null }) {
  if (piece.widthMm === null) return formatInches(piece.lengthMm);
  return `${formatInches(piece.lengthMm).replace(" in", "")} × ${formatInches(piece.widthMm)}`;
}

/**
 * An area in mm², shown in m² when it is large, such as `0.0225 m²`. For a part shown in inches,
 * an area in in², such as `42 in²`.
 */
export function formatArea(mm2: number, unit: "mm" | "in" = "mm"): string {
  if (unit === "in") return `${Number((mm2 / 645.16).toPrecision(4))} in²`;
  if (mm2 < 10_000) return `${Math.round(mm2 * 100) / 100} mm²`;
  return `${Number((mm2 / 1_000_000).toPrecision(4))} m²`;
}

/** The unit that a part's piece sizes are shown and entered in. Values are stored in mm. */
export const PIECE_DISPLAY_UNITS = ["mm", "in"] as const;

export type PieceDisplayUnit = (typeof PIECE_DISPLAY_UNITS)[number];

const MM_PER_INCH = 25.4;

/** Differences smaller than this, in mm, are rounding noise. */
const TOLERANCE_MM = 0.001;

/** A calculated length in mm without floating point noise: rounded to 0.0001 mm. */
function roundMm(mm: number): number {
  return Math.round(mm * 10_000) / 10_000;
}

/**
 * A length in mm from text in a part's display unit. A bare number is in `unit`; text with a
 * unit, such as `300 mm` or `12"`, is read as entered. Null when it is not a length.
 */
export function parsePieceLength(raw: string, unit: PieceDisplayUnit): number | null {
  const text = raw.trim();
  if (unit === "in" && /^\d*\.?\d+$/.test(text)) return parseLengthMm(`${text} in`);
  return parseLengthMm(text);
}

/** A length in the display unit, such as `415.5 mm` or `≈16.358 in`. */
export function formatLength(mm: number, unit: PieceDisplayUnit): string {
  if (unit === "mm") return formatMm(roundMm(mm));
  const inches = Math.round((mm / MM_PER_INCH) * 1000) / 1000;
  const exact = Math.abs(inches * MM_PER_INCH - mm) < 1e-6;
  return `${exact ? "" : "≈"}${inches} in`;
}

/** The size of a piece in the display unit, such as `150 × 75 mm` or `6 × 3 in`. */
export function formatSize(
  piece: { lengthMm: number; widthMm: number | null },
  unit: PieceDisplayUnit
): string {
  if (piece.widthMm === null) return formatLength(piece.lengthMm, unit);
  const length = formatLength(piece.lengthMm, unit).replace(` ${unit}`, "");
  return `${length} × ${formatLength(piece.widthMm, unit)}`;
}

export interface CutResult {
  /** Length left after the cuts and the kerf of each cut, in mm. Negative when they do not fit. */
  remainderMm: number;
  fits: boolean;
  /** True when there is a remainder shorter than the minimum offcut. */
  underMinimum: boolean;
}

/**
 * The remainder of a 1D cut: piece length − sum of the cut lengths − kerf × number of cuts. A
 * remainder within 0.001 mm of zero is an exact fit, so it is zero.
 */
export function calculateCut(
  piece: { lengthMm: number },
  settings: { kerfMm: number; minOffcutMm: number },
  cutLengthsMm: number[]
): CutResult {
  const used = cutLengthsMm.reduce((sum, length) => sum + length, 0);
  let remainderMm = roundMm(piece.lengthMm - used - settings.kerfMm * cutLengthsMm.length);
  if (Math.abs(remainderMm) < TOLERANCE_MM) remainderMm = 0;
  return {
    remainderMm,
    fits: remainderMm >= 0,
    underMinimum: remainderMm > 0 && remainderMm < settings.minOffcutMm,
  };
}

export interface SplitCheck {
  parentAreaMm2: number;
  outputAreaMm2: number;
  /** False when the outputs have more area than the parent. This rejects the split. */
  areaFits: boolean;
  /** Positions of outputs with a side longer than the parent's in both orientations. */
  oversized: number[];
}

type Size2D = { lengthMm: number; widthMm: number };

/** True when `size` fits within `parent` as it is or rotated by 90°. */
function fitsWithin(size: Size2D, parent: Size2D): boolean {
  const within = (a: number, b: number) => a <= b + TOLERANCE_MM;
  return (
    (within(size.lengthMm, parent.lengthMm) && within(size.widthMm, parent.widthMm)) ||
    (within(size.lengthMm, parent.widthMm) && within(size.widthMm, parent.lengthMm))
  );
}

/**
 * Check a 2D split. The app does not calculate layouts: the total area of the outputs must not be
 * larger than the parent's, and an output that does not fit in the parent's dimensions is only
 * a warning.
 */
export function checkSplit(parent: Size2D, outputs: Size2D[]): SplitCheck {
  const area = (size: Size2D) => size.lengthMm * size.widthMm;
  const parentAreaMm2 = area(parent);
  const outputAreaMm2 = outputs.reduce((sum, output) => sum + area(output), 0);
  return {
    parentAreaMm2,
    outputAreaMm2,
    areaFits: outputAreaMm2 <= parentAreaMm2 + TOLERANCE_MM,
    oversized: outputs.flatMap((output, index) => (fitsWithin(output, parent) ? [] : [index])),
  };
}
