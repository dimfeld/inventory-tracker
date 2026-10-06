import { describe, expect, it } from "vitest";
import type { CategoryDefinition } from "./context";
import { createJevClassifier, MAX_CHOICE_OPTIONS } from "./jev";
import type { CleanupLine, PromptPart } from "./prompt";

const line: CleanupLine = {
  supplier: "DigiKey",
  sourceExcerpt: null,
  description: "M3 x 8 pan head screw",
  category: null,
  manufacturer: null,
  partNumber: null,
  supplierSku: null,
  attributes: [],
  notes: null,
  purchaseUnit: null,
  packQuantity: null,
  baseUnit: null,
};

const category = (id: number, path: string): CategoryDefinition => ({
  id,
  path,
  attributeKeys: [],
  requiredKeys: [],
});

const part = (id: number, name: string): PromptPart => ({
  id,
  name,
  category: null,
  manufacturer: null,
  partNumber: null,
  baseUnit: "pcs",
  attributes: [],
});

/**
 * A fetch that records each request body. `answer` gives the label chosen for each question
 * from the question's options.
 */
function fakeFetch(answer: (question: string, labels: string[]) => string) {
  const bodies: { model: string; state: unknown; questions: Record<string, any> }[] = [];
  const fetch = async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const answers = Object.fromEntries(
      Object.entries(body.questions).map(([key, question]: [string, any]) => [
        key,
        {
          type: "choice",
          choice: answer(key, Object.keys(question.criteria)),
          confidence: 1,
          probabilities: {},
        },
      ])
    );
    return new Response(
      JSON.stringify({
        model: "jev-latest",
        answers,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };
  return Object.assign(fetch, { bodies });
}

/** Answer each question with the first of the given labels that it offers, or none. */
const prefer =
  (...labels: string[]) =>
  (_question: string, options: string[]) =>
    labels.find((label) => options.includes(label)) ?? "none";

describe("Jev classifier", () => {
  it("is not available without an API key", () => {
    expect(createJevClassifier(null)).toBeNull();
  });

  it("asks for the category and the part in one request and maps the labels back", async () => {
    const fetch = fakeFetch(prefer("category_7", "part_3"));
    const classify = createJevClassifier("key", { fetch })!;
    const result = await classify({
      line,
      categories: [category(5, "Electronics"), category(7, "Hardware / Fasteners / Screws")],
      parts: [part(2, "M2 screw"), part(3, "M3 × 8 pan head screw")],
    });

    expect(result).toEqual({ category: "Hardware / Fasteners / Screws", partId: 3 });
    expect(fetch.bodies).toHaveLength(1);
    const { model, questions } = fetch.bodies[0];
    expect(model).toBe("jev-latest");
    expect(Object.keys(questions.category_0.criteria)).toEqual([
      "category_5",
      "category_7",
      "none",
    ]);
    expect(Object.keys(questions.part_0.criteria)).toEqual(["part_2", "part_3", "none"]);
  });

  it("gives null when Jev chooses none", async () => {
    const fetch = fakeFetch(prefer());
    const classify = createJevClassifier("key", { fetch })!;
    expect(
      await classify({
        line,
        categories: [category(5, "Electronics")],
        parts: [part(2, "M2 screw")],
      })
    ).toEqual({ category: null, partId: null });
  });

  it("splits a long option list into chunks and chooses between the chunks' choices", async () => {
    // Three chunks of parts. The first and third chunks each choose a part, and the final
    // round chooses part 600.
    const fetch = fakeFetch(prefer("category_5", "part_600", "part_10"));
    const classify = createJevClassifier("key", { fetch })!;
    const parts = Array.from({ length: 600 }, (_, i) => part(i + 1, `Part ${i + 1}`));
    const result = await classify({ line, categories: [category(5, "Electronics")], parts });

    expect(result).toEqual({ category: "Electronics", partId: 600 });
    expect(fetch.bodies).toHaveLength(2);
    const [first, final] = fetch.bodies.map((body) => body.questions);
    expect(Object.keys(first)).toEqual(["category_0", "part_0", "part_1", "part_2"]);
    for (const question of Object.values(first)) {
      expect(Object.keys(question.criteria).length).toBeLessThanOrEqual(MAX_CHOICE_OPTIONS);
      expect(question.criteria).toHaveProperty("none");
    }
    expect(Object.keys(final)).toEqual(["part_0"]);
    expect(Object.keys(final.part_0.criteria)).toEqual(["part_10", "part_600", "none"]);
  });

  it("needs no final round when only one chunk chooses an option", async () => {
    const fetch = fakeFetch(prefer("part_300"));
    const classify = createJevClassifier("key", { fetch })!;
    const parts = Array.from({ length: 600 }, (_, i) => part(i + 1, `Part ${i + 1}`));
    expect(await classify({ line, categories: [], parts })).toEqual({
      category: null,
      partId: 300,
    });
    expect(fetch.bodies).toHaveLength(1);
  });
});
