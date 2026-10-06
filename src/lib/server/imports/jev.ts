/**
 * Line classification with TypeSafe AI's Jev model. Server-only: the API key never leaves the
 * server. Jev only chooses from the options it is given, so it can only return data.
 */
import {
  choice,
  TypeSafeClient,
  type ChoiceCriteria,
  type ChoiceQuestion,
  type Fetch,
} from "@typesafe-ai/sdk";
import type { CategoryDefinition } from "./context";
import type { CleanupLine, PromptPart } from "./prompt";

/** The model that answers classification questions. */
export const JEV_MODEL_ID = "jev-latest";

/** TypeSafe accepts at most this many options in one choice question. */
export const MAX_CHOICE_OPTIONS = 255;

const NONE = "none";

export interface ClassificationRequest {
  line: CleanupLine;
  categories: CategoryDefinition[];
  parts: PromptPart[];
}

/**
 * The category path and the catalog part that Jev chose, null when none fits. A field is
 * undefined when its question was not asked because it has too many options.
 */
export interface LineClassification {
  category?: string | null;
  partId?: number | null;
}

/** Classifies one order line. The app uses Jev; tests use stored answers. */
export type Classifier = (request: ClassificationRequest) => Promise<LineClassification>;

/** Choice criteria with a "none" option, or null when the options do not fit in one question. */
function criteria<T>(
  items: T[],
  label: (item: T) => string,
  describe: (item: T) => string,
  none: string
): ChoiceCriteria | null {
  if (items.length + 1 > MAX_CHOICE_OPTIONS) return null;
  return {
    ...Object.fromEntries(items.map((item) => [label(item), describe(item)])),
    [NONE]: none,
  };
}

/** A classifier that asks Jev, or null when no API key is set. */
export function createJevClassifier(
  apiKey: string | null | undefined,
  options: { fetch?: Fetch } = {}
): Classifier | null {
  if (!apiKey) return null;
  const client = new TypeSafeClient({ apiKey, defaultModel: JEV_MODEL_ID, fetch: options.fetch });

  return async ({ line, categories, parts }) => {
    const categoryCriteria = criteria(
      categories,
      (c) => `category_${c.id}`,
      (c) => c.path,
      "No category fits the item"
    );
    const partCriteria = criteria(
      parts,
      (p) => `part_${p.id}`,
      (p) => JSON.stringify(p),
      "No catalog part is the same item"
    );
    const questions: Record<string, ChoiceQuestion> = {};
    if (categoryCriteria) {
      questions.category = choice(
        "Which inventory category does this purchased item belong to? The notes can override the title: they hold the variant the buyer chose.",
        categoryCriteria
      );
    }
    if (partCriteria) {
      questions.part = choice(
        "Which catalog part is the same item as this purchased item? Choose a part only when it has the same manufacturer part number or supplier SKU, or is the same kind of item with no conflicting specification. A part that is only similar is not a match.",
        partCriteria
      );
    }
    if (Object.keys(questions).length === 0) return {};

    const { answers } = await client.systemOne({ state: JSON.stringify(line, null, 2), questions });
    const result: LineClassification = {};
    if (questions.category) {
      const id = answers.category.choice.replace(/^category_/, "");
      result.category = categories.find((c) => String(c.id) === id)?.path ?? null;
    }
    if (questions.part) {
      const id = answers.part.choice.replace(/^part_/, "");
      result.partId = parts.find((p) => String(p.id) === id)?.id ?? null;
    }
    return result;
  };
}
