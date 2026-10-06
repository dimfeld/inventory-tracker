import * as devalue from "devalue";
import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import { emptyLineFields, type ImportLineFields } from "#lib/imports.ts";
import ImportLineForm from "./ImportLineForm.svelte";

/**
 * Submissions of the real remote form. They are never answered: reading an answer needs the
 * started SvelteKit app, which a component test does not have. The tests check what each line
 * sends and its state while the request is in flight; the page reload is new props.
 */
const submissions: Record<string, unknown>[] = [];

beforeEach(() => {
  submissions.length = 0;
  vi.spyOn(window, "fetch").mockImplementation(async (_url, init) => {
    // The binary form body: a version byte, the header length, the file table length, the header.
    const bytes = new Uint8Array(await (init!.body as Blob).arrayBuffer());
    const length = new DataView(bytes.buffer).getUint32(1, true);
    submissions.push(devalue.parse(new TextDecoder().decode(bytes.slice(7, 7 + length)))[0]);
    return new Promise<Response>(() => {});
  });
});

const saved: ImportLineFields = {
  ...emptyLineFields("Pull-up resistor"),
  quantity: "4",
  unit: "pcs",
  categoryId: 1,
  attributes: [{ key: "resistance", value: "10k" }],
};

function props(fields: ImportLineFields, id = 7) {
  return {
    importId: 3,
    kind: "project" as const,
    number: 1,
    readonly: false,
    line: {
      id,
      groupId: null,
      sourceRow: null,
      sourceExcerpt: null,
      proposal: null,
      fields,
      resolution: "requirement",
      partId: null,
      createdPartId: null,
      candidates: [] as {
        part: { id: number; name: string };
        status: "match" | "unresolved" | "conflict";
        sourceLabel: string;
        conflicts: string[];
        unresolved: string[];
      }[],
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
  };
}

const orderLine = (fields: ImportLineFields, id: number) => ({
  ...props(fields, id),
  kind: "order" as const,
  cleanupAvailable: true,
});

const description = () => page.getByRole("textbox", { name: "Description" });

describe("ImportLineForm.svelte", () => {
  it("sends the edited fields and shows the stored line after the reload", async () => {
    const screen = render(ImportLineForm, props(saved));
    await expect.element(description()).toHaveValue("Pull-up resistor");
    await expect.element(page.getByRole("radio", { name: /Requirement/ })).toBeChecked();

    await description().fill("10k pull-up resistor");
    await page.getByRole("button", { name: "Save line" }).click();
    await expect.poll(() => submissions.length).toBe(1);
    expect(submissions[0]).toMatchObject({
      id: 7,
      importId: 3,
      intent: "save",
      description: "10k pull-up resistor",
      quantity: "4",
      unit: "pcs",
      categoryId: "1",
      resolution: "requirement",
      attributes: [{ key: "resistance", value: "10k" }, { key: "" }, { key: "" }],
    });
    await expect.element(page.getByRole("button", { name: "Save line" })).toBeDisabled();

    screen.rerender(props({ ...saved, description: "10k pull-up resistor (R1)" }));
    await expect.element(description()).toHaveValue("10k pull-up resistor (R1)");
    await expect.element(page.getByRole("radio", { name: /Requirement/ })).toBeChecked();
  });

  it("keeps unsaved edits when the page reloads with the same stored line", async () => {
    const screen = render(ImportLineForm, props(saved));
    await description().fill("Edited, not saved");
    // Another line's save reloads every line; this one did not change.
    screen.rerender(props({ ...saved }));
    await expect.element(description()).toHaveValue("Edited, not saved");
  });

  it("cleans up several lines at once, each with its own progress", async () => {
    render(ImportLineForm, orderLine(saved, 1));
    render(ImportLineForm, orderLine({ ...saved, description: "M3 knob" }, 2));
    const buttons = page.getByRole("button", { name: "AI clean up" });
    const waiting = page.getByText("Saving the line and sending it to OpenAI");

    await description().first().fill("10k resistor");
    await buttons.nth(0).click();
    await expect.element(waiting).toBeVisible();
    // The second line is not blocked by the first one's request.
    await expect.element(buttons.nth(1)).toBeEnabled();
    await buttons.nth(1).click();
    await expect.poll(() => submissions.length).toBe(2);
    expect(submissions.map((s) => [s.id, s.intent])).toEqual([
      [1, "cleanup"],
      [2, "cleanup"],
    ]);
    // The unsaved edit goes with the request, so the cleanup starts from it.
    expect(submissions[0].description).toBe("10k resistor");
    await expect.element(waiting.nth(1)).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Save line" }).nth(0)).toBeDisabled();
    await expect.element(page.getByRole("button", { name: "Save line" }).nth(1)).toBeDisabled();
  });

  it("asks for notes in a dialog and sends them with a split", async () => {
    render(ImportLineForm, orderLine({ ...saved, description: "LDR assortment" }, 4));
    const dialog = page.getByRole("dialog", { name: "Split line 1 with AI" });
    await expect.element(dialog).not.toBeInTheDocument();

    await page.getByRole("button", { name: "AI split" }).click();
    await expect.element(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: /Notes/ }).fill("5 values, 20 of each");
    await dialog.getByRole("button", { name: "Split" }).click();

    await expect.poll(() => submissions.length).toBe(1);
    expect(submissions[0]).toMatchObject({
      id: 4,
      intent: "split",
      splitNotes: "5 values, 20 of each",
      description: "LDR assortment",
    });
    await expect.element(dialog).not.toBeInTheDocument();
    await expect.element(page.getByText("sending it to OpenAI for a split")).toBeVisible();
  });

  it("searches the catalog candidates and saves the chosen one as the existing part", async () => {
    const candidate = (id: number, name: string, status: "match" | "conflict") => ({
      part: { id, name },
      status,
      sourceLabel: "attributes",
      conflicts: status === "conflict" ? ["package differs"] : [],
      unresolved: [],
    });
    const base = props(saved);
    render(ImportLineForm, {
      ...base,
      line: {
        ...base.line,
        candidates: [
          candidate(1, "10k resistor 0805", "match"),
          candidate(2, "10k resistor 0603", "conflict"),
          candidate(3, "4.7k resistor 0805", "match"),
        ],
      },
    });

    await expect.element(page.getByText("(2 match, 1 conflict)")).toBeInTheDocument();
    const search = page.getByRole("combobox", { name: /Search catalog candidates/ });
    await search.fill("10k 0603");
    await expect
      .element(page.getByRole("listbox").getByRole("option"))
      .toHaveTextContent(/10k resistor 0603/);
    await expect.element(page.getByText("package differs")).toBeInTheDocument();

    await search.fill("10k");
    await page
      .getByRole("listbox")
      .getByRole("option", { name: /10k resistor 0805/ })
      .click();
    await expect.poll(() => submissions.length).toBe(1);
    expect(submissions[0]).toMatchObject({ id: 7, choosePart: "1" });
    expect(submissions[0].intent).toBeUndefined();
  });
});
