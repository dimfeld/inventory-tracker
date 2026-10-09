/**
 * Piece tracking. A part tracked as `pieces` keeps each physical piece (a length of extrusion,
 * a sheet) with its own dimensions in mm. A `bulk` part has one fungible quantity per location.
 */
export const TRACKING_MODES = ["bulk", "pieces"] as const;

export type TrackingMode = (typeof TRACKING_MODES)[number];
