/**
 * Explicit live check of the model and SDK path. Ordinary test runs skip it; it sends a small
 * order list to OpenAI only when started with `bun run check:live-import`, which needs
 * OPENAI_API_KEY in the environment or in `.env`. It prints the answering model, the token
 * usage, and the extracted lines so the owner can judge the model's behavior.
 */
import { describe, expect, it } from "vitest";
import { getImport } from "#lib/server/db/imports.ts";
import { createOpenAIExtractor, MODEL_ID } from "./openai";
import { createTestImports, inventoryCounts } from "./test-helpers";

describe.skipIf(!process.env.LIVE_IMPORT_CHECK)("live AI extraction", () => {
  it(
    "parses an order list through the Vercel AI SDK with the configured model",
    { timeout: 120_000 },
    async () => {
      const apiKey = process.env.OPENAI_API_KEY;
      expect(apiKey, "Set OPENAI_API_KEY to run the live check").toBeTruthy();

      const ctx = createTestImports();
      const before = inventoryCounts(ctx.db);
      const id = ctx.imports.createImport({
        kind: "order",
        sourceType: "text",
        sourceText: `Order 4471 from Bolt Depot
2 packs of 100 M3x8 stainless pan head screws
50x resistor 4k7 0805 1%`,
      });
      const outcome = await ctx.imports.parse(id, createOpenAIExtractor(apiKey));
      const record = getImport(ctx.db, id)!;
      const lines = ctx.imports.getReview(id)!.lines;
      console.log(
        JSON.stringify(
          {
            outcome,
            requestedModel: MODEL_ID,
            responseModel: record.modelId,
            usage: {
              input: record.inputTokens,
              output: record.outputTokens,
              total: record.totalTokens,
            },
            header: record.header,
            lines: lines.map((l) => ({
              fields: l.fields,
              provenance: l.proposal?.provenance,
              unresolved: l.proposal?.unresolved,
            })),
          },
          null,
          2
        )
      );

      expect(outcome.ok).toBe(true);
      expect(record.modelId).toMatch(new RegExp(`^${MODEL_ID}`));
      expect(lines.length).toBeGreaterThan(0);
      expect(inventoryCounts(ctx.db)).toEqual(before);
    }
  );
});
