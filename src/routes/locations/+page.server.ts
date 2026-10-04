import { fail } from "@sveltejs/kit";
import { parseLocationForm } from "#lib/schemas/location.ts";
import { runAction } from "#lib/server/forms.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({
  locations: inventory().locations.listLocations(),
});

export const actions: Actions = {
  create: async ({ request }) => {
    const parsed = parseLocationForm(await request.formData());
    if (!parsed.success) return fail(400, { action: "create", errors: parsed.errors });
    return runAction("create", () => {
      inventory().locations.createLocation(parsed.data);
      return { action: "create", created: parsed.data.name };
    });
  },
};
