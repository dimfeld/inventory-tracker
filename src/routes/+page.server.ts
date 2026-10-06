import { OPEN_PROJECT_STATUSES } from "#lib/projects.ts";
import { imports } from "#lib/server/imports/index.ts";
import { inventory } from "#lib/server/inventory/index.ts";
import { projects } from "#lib/server/projects/index.ts";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => {
  const orders = inventory().orders.listOrders();
  return {
    openProjects: projects()
      .listProjects()
      .filter((p) => OPEN_PROJECT_STATUSES.includes(p.status)),
    incomingOrders: orders.filter((o) => o.status !== "draft" && o.openLineCount > 0),
    draftOrders: orders.filter((o) => o.status === "draft"),
    pendingImports: imports()
      .listImports()
      .filter((i) => i.commitState !== "committed"),
  };
};
