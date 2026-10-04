import { fail, type RequestEvent } from "@sveltejs/kit";
import { parseAllocationForm, type AllocationAction } from "#lib/schemas/allocation.ts";
import { runAction } from "#lib/server/forms.ts";
import { allocations } from "./index";

const SUCCESS: Record<AllocationAction, string> = {
  reserve: "Reserved. No stock moved.",
  release: "Reservation released.",
  pick: "Picked to the project's holding location.",
  use: "Use recorded.",
  return: "Returned to storage.",
};

/** A form action that runs one allocation action for the project in the route's `id`. */
export function allocationAction(action: AllocationAction) {
  return async ({ request, params }: RequestEvent<{ id: string }>) => {
    const parsed = parseAllocationForm(action, await request.formData());
    if (!parsed.success) return fail(400, { action, errors: parsed.errors });
    const { locationId, ...input } = parsed.data;
    const target = { ...input, projectId: Number(params.id) };
    return runAction(action, () => {
      const service = allocations();
      switch (action) {
        case "reserve":
          service.reserve({ ...target, locationId: locationId! });
          break;
        case "release":
          service.release({ ...target, locationId: locationId! });
          break;
        case "pick":
          service.pick({ ...target, locationId: locationId! });
          break;
        case "use":
          service.use(target);
          break;
        case "return":
          service.returnPicked({ ...target, toLocationId: locationId! });
          break;
      }
      return { action, success: SUCCESS[action] };
    });
  };
}
