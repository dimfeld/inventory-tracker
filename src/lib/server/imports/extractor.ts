import type { ImportKind } from "#lib/imports.ts";

/** An import kind to extract, or the cleanup of one line. Each has its own output schema. */
export type ExtractionKind = ImportKind | "line_cleanup";

export interface ExtractionRequest {
  kind: ExtractionKind;
  system: string;
  prompt: string;
}

export interface ExtractionUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface ExtractionResult {
  /** The structured answer. The import service validates it again before use. */
  output: unknown;
  /** The model that answered, as reported by the provider. */
  modelId: string;
  usage: ExtractionUsage;
}

/**
 * Turns a source into structured output. The app uses the OpenAI model in openai.ts; tests use
 * stored fixture answers. An extractor only returns data; it has no access to the inventory.
 */
export type Extractor = (request: ExtractionRequest) => Promise<ExtractionResult>;

/** An error whose message explains to the owner why parsing could not run. */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}
