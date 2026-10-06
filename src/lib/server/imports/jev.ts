/**
 * Line classification with TypeSafe AI's Jev model. Server-only: the API key never leaves the
 * server. Jev only chooses from the options it is given, so it can only return data.
 */
import { choice, TypeSafeClient, type ChoiceQuestion, type Fetch } from "@typesafe-ai/sdk";
import type { CategoryDefinition } from "./context";
import type { CleanupLine, PromptPart } from "./prompt";

/** The model that answers classification questions. */
export const JEV_MODEL_ID = "jev-latest";

/** TypeSafe accepts at most this many options in one choice question. */
export const MAX_CHOICE_OPTIONS = 255;

/** Options in one chunk, leaving room for the "none" option. */
const CHUNK_SIZE = MAX_CHOICE_OPTIONS - 1;

const NONE = "none";

export interface ClassificationRequest {
  line: CleanupLine;
  categories: CategoryDefinition[];
  parts: PromptPart[];
}

/** The category path and the catalog part that Jev chose, null when none fits. */
export interface LineClassification {
  category: string | null;
  partId: number | null;
}

/** Classifies one order line. The app uses Jev; tests use stored answers. */
export type Classifier = (request: ClassificationRequest) => Promise<LineClassification>;

interface Selection {
  instructions: string;
  /** Option labels mapped to their descriptions. */
  options: Map<string, string>;
  none: string;
}

function chunks<T>(items: T[]): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) result.push(items.slice(i, i + CHUNK_SIZE));
  return result;
}

/**
 * Choose one option, or none, for each selection. Each round asks one question per chunk of a
 * selection's remaining options, and all questions of a round go in one request. When the
 * chunks of a selection give more than one choice, the next round chooses between those
 * choices only.
 */
async function choose(
  client: TypeSafeClient,
  state: string,
  selections: Record<string, Selection>
): Promise<Record<string, string | null>> {
  const chosen: Record<string, string | null> = {};
  const remaining = new Map<string, string[]>();
  for (const [name, selection] of Object.entries(selections)) {
    if (selection.options.size === 0) chosen[name] = null;
    else remaining.set(name, [...selection.options.keys()]);
  }

  while (remaining.size > 0) {
    const questions: Record<string, ChoiceQuestion> = {};
    for (const [name, labels] of remaining) {
      const { instructions, options, none } = selections[name];
      chunks(labels).forEach((chunk, index) => {
        questions[`${name}_${index}`] = choice(instructions, {
          ...Object.fromEntries(chunk.map((label) => [label, options.get(label)!])),
          [NONE]: none,
        });
      });
    }
    const { answers } = await client.systemOne({ state, questions });

    for (const [name, labels] of remaining) {
      const choices = chunks(labels)
        .map((_, index) => answers[`${name}_${index}`].choice)
        .filter((label) => label !== NONE && selections[name].options.has(label));
      if (choices.length > 1) {
        remaining.set(name, choices);
      } else {
        chosen[name] = choices[0] ?? null;
        remaining.delete(name);
      }
    }
  }
  return chosen;
}

/** A classifier that asks Jev, or null when no API key is set. */
export function createJevClassifier(
  apiKey: string | null | undefined,
  options: { fetch?: Fetch } = {}
): Classifier | null {
  if (!apiKey) return null;
  const client = new TypeSafeClient({ apiKey, defaultModel: JEV_MODEL_ID, fetch: options.fetch });

  return async ({ line, categories, parts }) => {
    const chosen = await choose(client, JSON.stringify(line, null, 2), {
      category: {
        instructions:
          "Which inventory category does this purchased item belong to? The notes can override the title: they hold the variant the buyer chose.",
        options: new Map(categories.map((c) => [`category_${c.id}`, c.path])),
        none: "No category fits the item",
      },
      part: {
        instructions:
          "Which catalog part is the same item as this purchased item? Choose a part only when it has the same manufacturer part number or supplier SKU, or is the same kind of item with no conflicting specification. A part that is only similar is not a match.",
        options: new Map(parts.map((p) => [`part_${p.id}`, JSON.stringify(p)])),
        none: "No catalog part is the same item",
      },
    });
    return {
      category: categories.find((c) => `category_${c.id}` === chosen.category)?.path ?? null,
      partId: parts.find((p) => `part_${p.id}` === chosen.part)?.id ?? null,
    };
  };
}
