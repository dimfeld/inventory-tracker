import { defineEnvVars } from "@sveltejs/kit/env";

export const variables = defineEnvVars({
  DATABASE_PATH: {
    description:
      "Path to the SQLite database file. Keep it on local disk, outside the build output.",
    schema: (value) => value || "./data/inventory.sqlite",
  },
  OPENAI_API_KEY: {
    description:
      "OpenAI API key for parsing imports with GPT-6 Luna. Optional: without it, imports use manual entry or CSV column mapping.",
    schema: (value) => value || null,
  },
});
