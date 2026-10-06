import { OPENAI_API_KEY, TYPESAFE_API_KEY } from "$app/env/private";
import { getDb } from "#lib/server/db/index.ts";
import { createImportService } from "./imports";
import { createJevClassifier } from "./jev";
import { createOpenAIExtractor } from "./openai";

let service: ReturnType<typeof createImportService> | undefined;

/** The import service bound to the app database. */
export function imports() {
  service ??= createImportService(getDb());
  return service;
}

/** The AI extractor with the server's API key, if one is configured. */
export function extractor() {
  return createOpenAIExtractor(OPENAI_API_KEY);
}

/** True when parsing can call the model. Manual entry works either way. */
export const parsingAvailable = () => Boolean(OPENAI_API_KEY);

/** The Jev classifier for cleanup, or null when TYPESAFE_API_KEY is not set. */
export function classifier() {
  return createJevClassifier(TYPESAFE_API_KEY);
}
