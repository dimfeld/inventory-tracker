import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
  DATABASE_PATH: {
    description:
      "Path to the SQLite database file. Keep it on local disk, outside the build output.",
    schema: (value) => value || "./data/inventory.sqlite",
  },
  OPENAI_API_KEY: {
    description:
      "OpenAI API key for AI parsing and clean up of imports. Optional: without it, imports use manual entry or CSV column mapping.",
    schema: (value) => value || null,
  },
  TYPESAFE_API_KEY: {
    description:
      "TypeSafe AI API key. Optional: with it, AI clean up of an order line uses the Jev model to choose the category and the matching catalog part.",
    schema: (value) => value || null,
  },
});
