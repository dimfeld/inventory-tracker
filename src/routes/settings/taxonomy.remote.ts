import { invalid, redirect } from "@sveltejs/kit";
import { form } from "$app/server";
import {
  applicabilitySchema,
  attributeCreateSchema,
  attributeKeySchema,
  attributeUpdateSchema,
  categoryIdSchema,
  categorySchema,
  categoryUpdateSchema,
  replaceValueSchema,
} from "#lib/schemas/taxonomy.ts";
import { inventory, isUserError } from "#lib/server/inventory/index.ts";

/** Run a service call and return its message. A rejected request becomes a form issue. */
function attempt(fn: () => string): { text: string } {
  try {
    return { text: fn() };
  } catch (error) {
    if (!isUserError(error)) throw error;
    invalid(error.message);
  }
}

export const createCategory = form(categorySchema, ({ name, parentId }) =>
  attempt(() => {
    inventory().catalog.createCategory(name, parentId);
    return `Added ${name}.`;
  })
);

/** Rename or move a category. Use one instance per category with `.for(id)`. */
export const updateCategory = form(categoryUpdateSchema, ({ id, ...fields }) =>
  attempt(() => {
    inventory().taxonomy.updateCategory(id, fields);
    return "Saved.";
  })
);

export const deleteCategory = form(categoryIdSchema, ({ id }) =>
  attempt(() => {
    inventory().taxonomy.deleteCategory(id);
    return "Category removed.";
  })
);

export const createAttribute = form(attributeCreateSchema, ({ key, ...fields }) =>
  attempt(() => {
    inventory().taxonomy.createAttribute(key, fields);
    return `Added ${fields.label}.`;
  })
);

export const updateAttribute = form(attributeUpdateSchema, ({ key, ...fields }) =>
  attempt(() => {
    inventory().taxonomy.updateAttribute(key, fields);
    return "Saved.";
  })
);

/** Remove an unused attribute and go back to the attribute list. */
export const deleteAttribute = form(attributeKeySchema, ({ key }) => {
  attempt(() => {
    inventory().taxonomy.deleteAttribute(key);
    return "Attribute removed.";
  });
  redirect(303, "/settings/attributes");
});

/** Assign an attribute to a category as optional or required, or remove the assignment. */
export const setApplicability = form(applicabilitySchema, ({ key, categoryId, mode }) =>
  attempt(() => {
    inventory().taxonomy.setApplicability(
      key,
      categoryId,
      mode === "remove" ? null : mode === "required"
    );
    return mode === "remove" ? "Removed from the category." : "Saved.";
  })
);

/** Change one raw value on every part. Use one instance per value with `.for(value)`. */
export const replaceValue = form(replaceValueSchema, ({ key, from, to }) =>
  attempt(() => {
    const count = inventory().taxonomy.replaceValue(key, from, to);
    return `Changed ${count} part(s).`;
  })
);
