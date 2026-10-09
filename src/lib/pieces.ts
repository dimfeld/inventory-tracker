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

/** An area in mm², shown in m² when it is large, such as `0.0225 m²`. */
export function formatArea(mm2: number): string {
  if (mm2 < 10_000) return `${Math.round(mm2 * 100) / 100} mm²`;
  return `${Number((mm2 / 1_000_000).toPrecision(4))} m²`;
}
