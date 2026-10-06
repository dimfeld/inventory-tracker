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

/** A fetch that records the request body and answers each question with the given label. */
function fakeFetch(choices: Record<string, string>) {
  const bodies: { model: string; state: unknown; questions: Record<string, any> }[] = [];
  const fetch = async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    bodies.push(body);
    const answers = Object.fromEntries(
      Object.keys(body.questions).map((key) => [
        key,
        { type: "choice", choice: choices[key], confidence: 1, probabilities: {} },
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

describe("Jev classifier", () => {
  it("is not available without an API key", () => {
    expect(createJevClassifier(null)).toBeNull();
  });

  it("asks for the category and the part in one request and maps the labels back", async () => {
    const fetch = fakeFetch({ category: "category_7", part: "part_3" });
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
    expect(Object.keys(questions.category.criteria)).toEqual(["category_5", "category_7", "none"]);
    expect(Object.keys(questions.part.criteria)).toEqual(["part_2", "part_3", "none"]);
  });

  it("gives null when Jev chooses none", async () => {
    const fetch = fakeFetch({ category: "none", part: "none" });
    const classify = createJevClassifier("key", { fetch })!;
    expect(
      await classify({
        line,
        categories: [category(5, "Electronics")],
        parts: [part(2, "M2 screw")],
      })
    ).toEqual({ category: null, partId: null });
  });

  it("does not ask a question with more options than TypeSafe accepts", async () => {
    const fetch = fakeFetch({ category: "category_5" });
    const classify = createJevClassifier("key", { fetch })!;
    const parts = Array.from({ length: MAX_CHOICE_OPTIONS }, (_, i) => part(i + 1, `Part ${i}`));
    const result = await classify({ line, categories: [category(5, "Electronics")], parts });

    expect(result).toEqual({ category: "Electronics" });
    expect(Object.keys(fetch.bodies[0].questions)).toEqual(["category"]);
  });
});
