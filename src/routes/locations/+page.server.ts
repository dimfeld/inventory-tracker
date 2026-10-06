import { redirect } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

/** The page moved to Settings. */
export const load: PageServerLoad = () => redirect(308, "/settings/locations");
