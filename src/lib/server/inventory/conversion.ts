import type { Database } from "bun:sqlite";
import { formatAttributeValue } from "#lib/attributes.ts";
import {
  addPartAlias,
  deletePartAttributes,
  getPart,
  listPartAttributes,
  listSupplierParts,
  mergePartInto,
  renamePart,
  setPartTracking,
  setSupplierStockSizes,
  type AttributeDefinition,
  type Part,
  type PartAttribute,
} from "#lib/server/db/catalog.ts";
import {
  countBomLinesOfParts,
  listCommitmentHolders,
  listPickedLineStock,
} from "#lib/server/db/conversion.ts";
import { getLocation } from "#lib/server/db/locations.ts";
import { insertMovement, listLocationBalances } from "#lib/server/db/movements.ts";
import { setPartOrderLinePieceSize } from "#lib/server/db/orders.ts";
import { insertPieceReservation } from "#lib/server/db/piece-reservations.ts";
import {
  listReservationsAt,
  setReservationQuantity,
  type ReservationDetail,
} from "#lib/server/db/reservations.ts";
import { pieceDimensionDefinition } from "./catalog";
import { InventoryError, NotFoundError } from "./errors";
import { insertIncomingPieces, type PieceSizeInput } from "./pieces";

export interface ConversionInput {
  /** The part that becomes the pieces part. */
  destinationId: number;
  /** Parts merged into the destination. Empty converts the destination alone. */
  sourceIds: number[];
  /** Attribute keys of the per-piece dimensions, such as `length` and `width`. */
  lengthKey: string;
  widthKey: string | null;
}

export interface ConvertInput extends ConversionInput {
  kerfMm: number;
  minOffcutMm: number;
  /** New name of the destination, such as without its length. Null keeps the name. */
  name?: string | null;
  /** Prefix of the operation IDs of the conversion movements. */
  operationId: string;
  /** YYYY-MM-DD */
  occurredOn: string;
}

/** One part of a conversion, its piece size, and the pieces its storage stock becomes. */
export interface ConversionPart {
  partId: number;
  name: string;
  role: "destination" | "source";
  /** Size from the part's dimension attributes, or null when a value is missing. */
  size: { lengthMm: number; widthMm: number | null } | null;
  /**
   * Storage stock by location; each unit becomes one piece. Each reserved unit becomes a
   * reservation of one whole piece for the same line.
   */
  stock: { locationId: number; locationName: string; count: number; reserved: number }[];
  /** Stock picked for BOM lines; each unit becomes one piece, still picked for its line. */
  picked: { bomLineId: number; locationId: number; locationName: string; count: number }[];
}

/** An attribute that is not equal on all the parts. */
export interface AttributeDifference {
  key: string;
  label: string;
  values: { partId: number; partName: string; rawValue: string | null; display: string | null }[];
}

/** A supplier SKU after the conversion. */
export interface ConversionSku {
  fromPartId: number;
  supplier: string;
  sku: string;
  stockLengthMm: number | null;
  stockWidthMm: number | null;
  /** False when the destination already has this SKU, so this row is deleted. */
  kept: boolean;
}

export interface ConversionPreview {
  parts: ConversionPart[];
  differences: AttributeDifference[];
  skus: ConversionSku[];
  /** BOM lines whose exact part is one of the parts; they use the destination after conversion. */
  bomLineCount: number;
  /** Reasons the conversion cannot run yet. Empty when it can. */
  blockers: string[];
}

const REASON = "Converted to pieces";

/** The normalized value of an attribute, to compare parts. */
function comparable(attribute: PartAttribute): string {
  return String(
    attribute.valueText ?? attribute.valueNumber ?? attribute.valueBoolean ?? attribute.rawValue
  );
}

export type ConversionService = ReturnType<typeof createConversionService>;

/**
 * Conversion of bulk `pcs` parts into one part tracked as pieces, such as three lengths of the
 * same extrusion. The other parts are merged into the destination; each unit of storage stock
 * becomes one piece of its part's size, and supplier SKUs and order lines get that size.
 *
 * Storage reservations become reservations of whole pieces for the same lines, and picked
 * stock becomes pieces that are still picked for their lines. Incoming commitments block a
 * conversion, because they count bulk quantities and a piece commitment needs a cut size on an
 * incoming stock piece. After the conversion, the incoming pieces can be committed again.
 */
export function createConversionService(db: Database) {
  function requirePart(id: number): Part {
    const part = getPart(db, id);
    if (!part) throw new NotFoundError(`Part ${id} does not exist`);
    return part;
  }

  function dimension(key: string, blockers: string[]): AttributeDefinition | null {
    try {
      return pieceDimensionDefinition(db, key);
    } catch (error) {
      if (!(error instanceof InventoryError)) throw error;
      blockers.push(error.message);
      return null;
    }
  }

  function buildPreview(input: ConversionInput) {
    const blockers: string[] = [];
    const sourceIds = [...new Set(input.sourceIds)];
    if (sourceIds.includes(input.destinationId)) {
      throw new InventoryError("The destination cannot also be a part to merge");
    }
    const parts = [input.destinationId, ...sourceIds].map(requirePart);
    const length = dimension(input.lengthKey, blockers);
    const width = input.widthKey ? dimension(input.widthKey, blockers) : null;
    if (length && width && length.id === width.id) {
      blockers.push("The length and width of a piece must be different attributes");
    }
    const dimensionKeys = new Set([input.lengthKey, input.widthKey]);
    const attributes = new Map(parts.map((p) => [p.id, listPartAttributes(db, p.id)]));

    const conversionParts = parts.map((part, index): ConversionPart => {
      if (part.trackingMode === "pieces")
        blockers.push(`${part.name} is already tracked as pieces.`);
      if (part.archivedAt) blockers.push(`${part.name} is archived. Restore it first.`);
      if (part.baseUnit !== "pcs") {
        blockers.push(
          `${part.name} is counted in ${part.baseUnit}. Only pcs parts can become pieces.`
        );
      }

      const valueOf = (definition: AttributeDefinition | null) => {
        if (!definition) return null;
        const value = attributes.get(part.id)!.find((a) => a.key === definition.key)?.valueNumber;
        if (value == null || value <= 0) {
          blockers.push(`${part.name} has no ${definition.label.toLowerCase()} in mm.`);
          return null;
        }
        return value;
      };
      const lengthMm = valueOf(length);
      const widthMm = valueOf(width);
      const sizeKnown = lengthMm !== null && (width === null || widthMm !== null);

      const stock: ConversionPart["stock"] = [];
      for (const balance of listLocationBalances(db, part.id)) {
        // Project holding stock is converted by line, as picked stock.
        if (balance.quantity <= 0 || getLocation(db, balance.locationId)?.kind === "project") {
          continue;
        }
        stock.push({
          locationId: balance.locationId,
          locationName: balance.locationName,
          count: balance.quantity,
          reserved: listReservationsAt(db, part.id, balance.locationId).reduce(
            (sum, r) => sum + r.quantity,
            0
          ),
        });
      }
      return {
        partId: part.id,
        name: part.name,
        role: index === 0 ? "destination" : "source",
        size: sizeKnown && lengthMm !== null ? { lengthMm, widthMm } : null,
        stock,
        picked: listPickedLineStock(db, [part.id]).map(
          ({ bomLineId, locationId, locationName, count }) => ({
            bomLineId,
            locationId,
            locationName,
            count,
          })
        ),
      };
    });

    const names = new Map(parts.map((p) => [p.id, p.name]));
    for (const holder of listCommitmentHolders(db, [...names.keys()])) {
      blockers.push(
        `${names.get(holder.partId)} has incoming supply committed to ` +
          `${holder.projectNames.join(", ")}. Release the commitments before conversion, ` +
          "then commit the incoming pieces again after it."
      );
    }

    // Every other attribute must have the same value on all the parts.
    const differences: AttributeDifference[] = [];
    const keys = new Map<string, string>();
    for (const list of attributes.values()) {
      for (const a of list) if (!dimensionKeys.has(a.key)) keys.set(a.key, a.label);
    }
    for (const [key, label] of keys) {
      const values = parts.map((part) => {
        const attribute = attributes.get(part.id)!.find((a) => a.key === key) ?? null;
        return { part, attribute };
      });
      const distinct = new Set(values.map((v) => (v.attribute ? comparable(v.attribute) : null)));
      if (distinct.size <= 1) continue;
      differences.push({
        key,
        label,
        values: values.map(({ part, attribute }) => ({
          partId: part.id,
          partName: part.name,
          rawValue: attribute?.rawValue ?? null,
          display: attribute
            ? (formatAttributeValue(attribute.normalization, attribute) ?? attribute.rawValue)
            : null,
        })),
      });
    }
    if (differences.length > 0) {
      blockers.push(
        `These attributes differ: ${differences.map((d) => d.label).join(", ")}. Make them equal first.`
      );
    }

    // The merge keeps the destination's row when it already has a source's SKU.
    const skus: ConversionSku[] = [];
    const seen = new Set<string>();
    for (const part of conversionParts) {
      for (const row of listSupplierParts(db, part.partId)) {
        const id = `${row.supplier}\u0000${row.sku}`;
        skus.push({
          fromPartId: part.partId,
          supplier: row.supplier,
          sku: row.sku,
          stockLengthMm: part.size?.lengthMm ?? null,
          stockWidthMm: part.size?.widthMm ?? null,
          kept: !seen.has(id),
        });
        seen.add(id);
      }
    }

    return {
      preview: {
        parts: conversionParts,
        differences,
        skus,
        bomLineCount: countBomLinesOfParts(db, [...names.keys()]),
        blockers,
      } satisfies ConversionPreview,
      length,
      width,
    };
  }

  return {
    /** What a conversion would do, and what blocks it. Nothing is written. */
    previewConversion(input: ConversionInput): ConversionPreview {
      return buildPreview(input).preview;
    },

    /**
     * Convert the parts in one transaction:
     * 1. End the bulk reservations of the parts. Close the bulk balance of every part at each
     *    storage location, and its picked stock for each BOM line, with a 'conversion'
     *    movement to outside, while the parts are still bulk.
     * 2. Give each part's supplier SKUs its piece size as their stock size, and its order lines
     *    the same piece size. The lines keep their size when sources share a SKU.
     * 3. Merge the sources into the destination (stock history, SKUs, aliases, orders, BOM
     *    lines, import lines), and keep their names as aliases.
     * 4. Make the destination a pieces part and remove its dimension attribute values.
     * 5. Add one piece per former unit of stock, of its part's size, at the same location.
     *    Each reserved unit becomes a reservation of one whole piece for the same line, and
     *    picked pieces come in for the same line, so they stay picked.
     *
     * The merge moves the old bulk movements to the destination with UPDATE. They have no
     * piece and sum to zero at every location after step 1, so the destination's balances are
     * its pieces. The movement trigger only checks new rows, so it does not reject them.
     */
    convertToPieces(input: ConvertInput): { destinationId: number; pieceCount: number } {
      return db
        .transaction(() => {
          for (const [label, value] of [
            ["Kerf", input.kerfMm],
            ["Minimum offcut", input.minOffcutMm],
          ] as const) {
            if (!Number.isFinite(value) || value < 0) {
              throw new InventoryError(`${label} must be zero or more mm`);
            }
          }
          const { preview, length, width } = buildPreview(input);
          if (preview.blockers.length > 0) throw new InventoryError(preview.blockers.join(" "));
          const [destination, ...sources] = preview.parts;
          const op = input.operationId;

          // Bulk reservations end here; they come back as piece reservations below.
          const reservations = new Map<string, ReservationDetail[]>();
          for (const part of preview.parts) {
            for (const stock of part.stock) {
              const held = listReservationsAt(db, part.partId, stock.locationId);
              reservations.set(`${part.partId}:${stock.locationId}`, held);
              for (const reservation of held) setReservationQuantity(db, reservation.id, 0);
            }
          }

          for (const part of preview.parts) {
            for (const picked of part.picked) {
              insertMovement(db, {
                operationId: `${op}:close:${part.partId}:line:${picked.bomLineId}`,
                partId: part.partId,
                quantity: picked.count,
                fromLocationId: picked.locationId,
                toLocationId: null,
                movementType: "conversion",
                occurredOn: input.occurredOn,
                reason: REASON,
                bomLineId: picked.bomLineId,
              });
            }
            for (const stock of part.stock) {
              insertMovement(db, {
                operationId: `${op}:close:${part.partId}:${stock.locationId}`,
                partId: part.partId,
                quantity: stock.count,
                fromLocationId: stock.locationId,
                toLocationId: null,
                movementType: "conversion",
                occurredOn: input.occurredOn,
                reason: REASON,
              });
            }
            setSupplierStockSizes(db, part.partId, part.size!.lengthMm, part.size!.widthMm);
            setPartOrderLinePieceSize(db, part.partId, part.size!.lengthMm, part.size!.widthMm);
          }

          for (const source of sources) {
            mergePartInto(db, source.partId, destination.partId);
            addPartAlias(db, destination.partId, source.name);
          }

          const name = input.name?.trim();
          if (name && name !== destination.name) {
            renamePart(db, destination.partId, name);
            addPartAlias(db, destination.partId, destination.name);
          }
          setPartTracking(db, destination.partId, {
            trackingMode: "pieces",
            pieceLengthAttributeId: length!.id,
            pieceWidthAttributeId: width?.id ?? null,
            kerfMm: input.kerfMm,
            minOffcutMm: input.minOffcutMm,
            pieceDisplayUnit: getPart(db, destination.partId)!.pieceDisplayUnit,
          });
          deletePartAttributes(
            db,
            destination.partId,
            [length!.id, width?.id].filter((id) => id !== undefined)
          );

          const piecesPart = getPart(db, destination.partId)!;
          let pieceCount = 0;
          for (const part of preview.parts) {
            const size: PieceSizeInput = { ...part.size!, label: null };
            const sizes = (count: number) => Array.from({ length: count }, () => size);
            for (const stock of part.stock) {
              const pieces = insertIncomingPieces(db, piecesPart, sizes(stock.count), {
                operationId: `${op}:pieces:${part.partId}:${stock.locationId}`,
                toLocationId: stock.locationId,
                movementType: "conversion",
                occurredOn: input.occurredOn,
                reason: REASON,
              });
              pieceCount += stock.count;
              // Each reserved unit becomes a reservation of one whole piece.
              const free = pieces.values();
              for (const reservation of reservations.get(`${part.partId}:${stock.locationId}`)!) {
                for (let i = 0; i < reservation.quantity; i += 1) {
                  const piece = free.next().value!;
                  insertPieceReservation(db, {
                    bomLineId: reservation.bomLineId,
                    pieceId: piece.id,
                    lengthMm: piece.lengthMm,
                    widthMm: piece.widthMm,
                  });
                }
              }
            }
            for (const picked of part.picked) {
              insertIncomingPieces(db, piecesPart, sizes(picked.count), {
                operationId: `${op}:pieces:${part.partId}:line:${picked.bomLineId}`,
                toLocationId: picked.locationId,
                movementType: "conversion",
                occurredOn: input.occurredOn,
                reason: REASON,
                bomLineId: picked.bomLineId,
              });
              pieceCount += picked.count;
            }
          }
          return { destinationId: destination.partId, pieceCount };
        })
        .immediate();
    },
  };
}
