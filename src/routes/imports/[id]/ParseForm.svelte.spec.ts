import { page } from "vitest/browser";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type { ActionResult, SubmitFunction } from "$app/forms";
import ParseForm from "./ParseForm.svelte";

// Stands in for SvelteKit's enhance: each submission that is not cancelled becomes a
// request the test finishes by hand, so the response is as slow as the test wants.
const requests = vi.hoisted(() => [] as { finish: (ok: boolean) => Promise<void> }[]);

vi.mock("$app/forms", () => ({
  enhance(form: HTMLFormElement, submit: SubmitFunction) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      let cancelled = false;
      const after = await submit({
        action: new URL(form.action),
        formData: new FormData(form),
        formElement: form,
        controller: new AbortController(),
        submitter: event.submitter,
        cancel: () => (cancelled = true),
      });
      if (cancelled) return;
      requests.push({
        finish: async (ok) => {
          const result: ActionResult = ok
            ? { type: "success", status: 200, location: "" }
            : { type: "error", status: 500, error: { status: 500, message: "failed" } };
          await after?.({
            action: new URL(form.action),
            formData: new FormData(form),
            formElement: form,
            result,
            update: async () => {},
          });
        },
      });
    });
    return {};
  },
}));

const status = () => page.getByRole("status");
const button = () => page.getByRole("button", { name: "Parse with AI" });
const waiting = /Parsing with AI… This can take a minute/;

describe("ParseForm.svelte", () => {
  beforeEach(() => {
    requests.length = 0;
  });

  for (const ok of [true, false]) {
    it(`shows progress until the request ${ok ? "succeeds" : "fails"}`, async () => {
      render(ParseForm, { parsed: false, parsingAvailable: true, hasCsv: false });
      await expect.element(status()).toHaveTextContent("");

      await button().click();
      await expect.element(status()).toHaveTextContent(waiting);
      await expect.element(button()).toBeDisabled();

      // Another submission while waiting does not start a second request.
      document.querySelector("form")!.requestSubmit();
      await new Promise((resolve) => setTimeout(resolve));
      expect(requests).toHaveLength(1);

      await requests[0].finish(ok);
      await expect.element(status()).toHaveTextContent("");
      await expect.element(button()).toBeEnabled();

      await button().click();
      expect(requests).toHaveLength(2);
    });
  }
});
