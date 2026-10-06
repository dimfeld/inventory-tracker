import * as z from "zod";
import { NORMALIZATION_RULES } from "#lib/attributes.ts";
import { formId, formText, optionalFormText } from "./form";

const requiredText = (message: string) => formText.pipe(z.string().min(1, message));

export const categorySchema = z.object({
  name: requiredText("Enter a name"),
  parentId: formId("Choose a valid parent"),
});

export const categoryUpdateSchema = categorySchema.extend({ id: z.number().int() });

export const categoryIdSchema = z.object({ id: z.number().int() });

const attributeFields = {
  label: requiredText("Enter a label"),
  valueType: z.enum(["text", "number", "boolean"]),
  /** Empty for none: the value is stored as typed. */
  normalization: z
    .union([z.enum(NORMALIZATION_RULES), z.literal("")])
    .transform((value) => value || null),
  canonicalUnit: optionalFormText,
};

export const attributeCreateSchema = z.object({
  key: requiredText("Enter a key"),
  ...attributeFields,
});

export const attributeUpdateSchema = z.object({ key: z.string(), ...attributeFields });

export const attributeKeySchema = z.object({ key: z.string() });

export const APPLICABILITY_MODES = ["optional", "required", "remove"] as const;

export const applicabilitySchema = z.object({
  key: z.string(),
  categoryId: formId("Choose a category").pipe(z.number({ message: "Choose a category" })),
  mode: z.enum(APPLICABILITY_MODES),
});

export const replaceValueSchema = z.object({
  key: z.string(),
  from: z.string(),
  to: requiredText("Enter the new value"),
});
