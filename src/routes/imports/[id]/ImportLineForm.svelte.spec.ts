import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { ActionResult, SubmitFunction } from "$app/forms";
import { emptyLineFields, type ImportLineFields } from "#lib/imports.ts";
import ImportLineForm from "./ImportLineForm.svelte";

// Stands in for SvelteKit's enhance, including its default handling of a result:
// a successful action resets the form unless the callback asks it not to.
const requests = vi.hoisted(() => [] as { finish: (ok: boolean) => Promise<void> }[]);

vi.mock("$app/forms", () => ({
  enhance(form: HTMLFormElement, submit: SubmitFunction = () => {}) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const after = await submit({
        action: new URL(form.action),
        formData: new FormData(form),
        formElement: form,
        controller: new AbortController(),
        submitter: event.submitter,
        cancel: () => {},
      });
      requests.push({
        finish: async (ok) => {
          const result: ActionResult = ok
            ? { type: "success", status: 200, location: "" }
            : { type: "failure", status: 400, location: "" };
          const update = async ({ reset = true } = {}) => {
            if (result.type === "success" && reset) form.reset();
          };
          if (after) {
            await after({
              action: new URL(form.action),
              formData: new FormData(form),
              formElement: form,
              result,
              update,
            });
          } else {
            await update();
          }
        },
      });
    });
    return {};
  },
}));

const saved: ImportLineFields = {
  ...emptyLineFields("Pull-up resistor"),
  quantity: "4",
  unit: "pcs",
  categoryId: 1,
  attributes: [{ key: "resistance", value: "10k" }],
};

function props(fields: ImportLineFields, feedback: { ok: boolean; text: string } | null = null) {
  return {
    kind: "project" as const,
    number: 1,
    readonly: false,
    line: {
      id: 7,
      groupId: null,
      sourceRow: null,
      sourceExcerpt: null,
      proposal: null,
      fields,
      resolution: "requirement",
      partId: null,
      createdPartId: null,
      candidates: [],
      identifierConflicts: [],
      missingRequired: [],
      conversion: null,
      readings: {},
      problems: [],
    },
    options: {
      categories: [
        { id: 1, path: "Resistors" },
        { id: 2, path: "Capacitors" },
      ],
      definitions: [],
      parts: [],
      units: ["pcs", "m"],
    },
    groups: [],
    feedback,
  };
}

const field = (name: string) =>
  document.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`)!;

describe("ImportLineForm.svelte", () => {
  beforeEach(() => {
    requests.length = 0;
  });

  it("keeps a saved requirement line visible after Save line", async () => {
    const screen = render(ImportLineForm, props(saved));
    const requirement = page.getByRole("radio", { name: /Requirement/ });
    await expect.element(requirement).toBeChecked();

    await page.getByRole("textbox", { name: "Description" }).fill("10k pull-up resistor");
    await page.getByRole("button", { name: "Save line" }).click();
    await requests[0].finish(true);
    // The page reloads its data with the stored line.
    screen.rerender(
      props({ ...saved, description: "10k pull-up resistor" }, { ok: true, text: "Line saved." })
    );

    await expect.element(page.getByText("Line saved.")).toBeInTheDocument();
    await expect.element(requirement).toBeChecked();
    expect(field("description").value).toBe("10k pull-up resistor");
    expect(field("quantity").value).toBe("4");
    expect(field("unit").value).toBe("pcs");
    expect(field("category_id").value).toBe("1");
    expect(field("attribute_key").value).toBe("resistance");
    expect(field("attribute_value").value).toBe("10k");
  });

  it("keeps the entered fields and shows the error when saving fails", async () => {
    const screen = render(ImportLineForm, props(saved));

    await page.getByRole("textbox", { name: "Quantity" }).fill("four");
    await page.getByRole("button", { name: "Save line" }).click();
    await requests[0].finish(false);
    screen.rerender(props(saved, { ok: false, text: "Quantity must be a number" }));

    await expect.element(page.getByText("Quantity must be a number")).toBeInTheDocument();
    await expect.element(page.getByRole("radio", { name: /Requirement/ })).toBeChecked();
    expect(field("quantity").value).toBe("four");
    expect(field("description").value).toBe("Pull-up resistor");
  });

  it("shows a cleanup in progress and blocks other submissions until it finishes", async () => {
    render(ImportLineForm, { ...props(saved), kind: "order" as const, cleanupAvailable: true });

    await page.getByRole("button", { name: "Clean up with GPT-6 Luna" }).click();
    await expect.element(page.getByText("Saving the line and sending it to OpenAI")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Save line" })).toBeDisabled();

    await requests[0].finish(true);
    await expect
      .element(page.getByText("Saving the line and sending it to OpenAI"))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Save line" })).toBeEnabled();
  });
});
