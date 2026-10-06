/**
 * AI extraction through the Vercel AI SDK. Server-only: the API key never leaves the
 * server. No tools are given to the model, so it can only return data.
 */
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { ExtractionError, type Extractor } from "./extractor";
import { lineCleanupSchema, orderOutputSchema, projectOutputSchema } from "./schema";

/** The only model used for LLM calls. */
export const MODEL_ID = "gpt-6-luna";

/** An extractor that sends the source to OpenAI. Without a key it fails with a clear message. */
export function createOpenAIExtractor(apiKey: string | null | undefined): Extractor {
  return async ({ kind, system, prompt }) => {
    if (!apiKey) {
      throw new ExtractionError(
        "OPENAI_API_KEY is not set, so the source cannot be parsed. Enter the lines manually or set the key and try again."
      );
    }
    const openai = createOpenAI({ apiKey });
    const output =
      kind === "order"
        ? Output.object({ schema: orderOutputSchema, name: "order_list" })
        : kind === "project"
          ? Output.object({ schema: projectOutputSchema, name: "project_bom" })
          : Output.object({ schema: lineCleanupSchema, name: "line_cleanup" });
    const result = await generateText({ model: openai(MODEL_ID), system, prompt, output });
    return {
      output: result.output,
      modelId: result.response.modelId,
      usage: {
        inputTokens: result.usage.inputTokens ?? null,
        outputTokens: result.usage.outputTokens ?? null,
        totalTokens: result.usage.totalTokens ?? null,
      },
    };
  };
}
