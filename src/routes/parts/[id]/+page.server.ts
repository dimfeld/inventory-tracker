import { error, fail, type RequestEvent } from "@sveltejs/kit";
import {
  parseStockForm,
  today,
  type StockAction,
  type StockFormInput,
} from "#lib/schemas/stock.ts";
import { runAction } from "#lib/server/forms.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import { compatibleUnits, formatQuantity, isUnit } from "#lib/units.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params }) => {
  const { catalog, locations } = inventory();
  const details = catalog.getPartDetails(Number(params.id));
  if (!details) error(404, "Part not found");
  const { baseUnit } = details.part;
  return {
    ...details,
    locations: locations.listStorageLocations(),
    mergeTargets: catalog
      .partOptions()
      .filter((p) => p.id !== details.part.id && p.baseUnit === baseUnit),
    units: isUnit(baseUnit) ? compatibleUnits(baseUnit) : [],
    /** Number attributes in mm, which can be piece dimensions. */
    dimensionOptions: catalog
      .attributeOptions()
      .definitions.filter((d) => d.valueType === "number" && d.canonicalUnit === "mm")
      .map(({ key, label }) => ({ key, label })),
    today: today(),
    // One ID per page load; a repeated submission of the same form is rejected.
    operationId: crypto.randomUUID(),
  };
};

function performStockAction(action: StockAction, partId: number, input: StockFormInput): string {
  const { stock } = inventory();
  const base = { operationId: input.operationId, partId, occurredOn: input.occurredOn };
  const amount = { amount: input.amount, unit: input.unit };
  switch (action) {
    case "opening":
      stock.recordOpeningStock({
        ...base,
        ...amount,
        locationId: input.locationId,
        reason: input.reason,
      });
      return "Opening stock recorded.";
    case "transfer":
      stock.transfer({
        ...base,
        ...amount,
        fromLocationId: input.locationId,
        toLocationId: input.toLocationId!,
        reason: input.reason,
      });
      return "Transfer recorded.";
    case "loss":
      stock.recordLoss({ ...base, ...amount, locationId: input.locationId, reason: input.reason! });
      return "Loss recorded.";
    case "supplier_return":
      stock.recordSupplierReturn({
        ...base,
        ...amount,
        locationId: input.locationId,
        reason: input.reason!,
      });
      return "Supplier return recorded.";
    case "count": {
      const result = stock.recordStockCount({
        ...base,
        countedAmount: input.amount,
        unit: input.unit,
        locationId: input.locationId,
        reason: input.reason!,
      });
      const note = result.movement ? "" : " It matched, so no correction was needed.";
      const from = formatQuantity(result.previousQuantity, result.baseUnit);
      const to = formatQuantity(result.countedQuantity, result.baseUnit);
      const released = result.releasedReservations.map(
        (r) =>
          ` Reduced the reservation of ${r.projectName} (${r.lineDescription}) by ` +
          `${formatQuantity(r.released, r.baseUnit)}.`
      );
      return `Count recorded: ${from} → ${to}.${note}${released.join("")}`;
    }
  }
}

function stockAction(action: StockAction) {
  return async ({ request, params }: RequestEvent<{ id: string }>) => {
    const parsed = parseStockForm(action, await request.formData());
    if (!parsed.success) return fail(400, { action, errors: parsed.errors });
    return runAction(action, () => ({
      action,
      success: performStockAction(action, Number(params.id), parsed.data),
    }));
  };
}

export const actions: Actions = {
  opening: stockAction("opening"),
  transfer: stockAction("transfer"),
  loss: stockAction("loss"),
  supplier_return: stockAction("supplier_return"),
  count: stockAction("count"),
  archive: ({ params }) =>
    runAction("archive", () => {
      inventory().catalog.archivePart(Number(params.id));
      return { action: "archive", success: "Part archived." };
    }),
  restore: ({ params }) =>
    runAction("restore", () => {
      inventory().catalog.restorePart(Number(params.id));
      return { action: "restore", success: "Part restored." };
    }),
};
