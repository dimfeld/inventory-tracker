import * as z from "zod";

/** Text from a form field, trimmed. A missing field is empty text. */
export const formText = z
  .string()
  .optional()
  .transform((value) => value?.trim() ?? "");
export const optionalFormText = formText.transform((value) => value || null);

/** A positive integer ID from a form field, or null when it is empty. */
export const formId = (message: string) =>
  formText.transform((value, ctx) => {
    if (value === "") return null;
    if (/^\d+$/.test(value) && Number(value) > 0) return Number(value);
    ctx.addIssue({ code: "custom", message });
    return z.NEVER;
  });
