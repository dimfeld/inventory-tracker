import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
  DATABASE_PATH: {
    description:
      "Path to the SQLite database file. Keep it on local disk, outside the build output.",
    schema: (value) => value || "./data/inventory.sqlite",
  },
});
