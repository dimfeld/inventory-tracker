<script lang="ts">
  import { createCategory, deleteCategory, updateCategory } from '../taxonomy.remote';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  type Category = (typeof data.categories)[number];

  /** Categories that may become the parent of `category`: not itself or a descendant. */
  function parentOptions(category: Category) {
    return data.categories.filter(
      (c) => c.id !== category.id && !c.path.startsWith(`${category.path} / `)
    );
  }

  const issueText = (issues: { message: string }[] | undefined) =>
    issues?.map((issue) => issue.message).join('. ');
</script>

<svelte:head>
  <title>Categories · Settings</title>
</svelte:head>

<p class="mb-3 text-sm text-gray-600">
  An attribute assigned to a category also applies to its child categories. Assign attributes on
  the <a href="/settings/attributes" class="link">Attributes</a> tab.
</p>

{#if data.categories.length === 0}
  <p class="mb-4 text-gray-600">No categories yet.</p>
{:else}
  <table class="data-table stack-table mb-6">
    <thead>
      <tr><th>Category</th><th>Name and parent</th><th>Used by</th><th>Attributes</th><th></th></tr>
    </thead>
    <tbody>
      {#each data.categories as category (category.id)}
        {@const edit = updateCategory.for(category.id)}
        {@const remove = deleteCategory.for(category.id)}
        {@const issues = issueText([...(edit.fields.allIssues() ?? []), ...(remove.fields.allIssues() ?? [])])}
        <tr>
          <td><a href="/parts?category={category.id}" class="link font-medium sm:font-normal">{category.path}</a></td>
          <td data-label="Edit">
            <form {...edit} class="flex flex-wrap items-center gap-1">
              <input {...edit.fields.id.as('hidden', category.id)} />
              <input {...edit.fields.name.as('text', category.name)} aria-label="Name" class="input-sm w-36" />
              <select {...edit.fields.parentId.as('select', String(category.parentId ?? ''))} aria-label="Parent" class="input-sm max-w-48">
                <option value="">(top level)</option>
                {#each parentOptions(category) as option (option.id)}
                  <option value={String(option.id)}>{option.path}</option>
                {/each}
              </select>
              <button class="btn-secondary" disabled={edit.pending > 0}>Save</button>
            </form>
            {#if issues}<p class="text-red-700">{issues}</p>{/if}
          </td>
          <td data-label="Used by" class="text-gray-600">
            {category.parts} part{category.parts === 1 ? '' : 's'}{#if category.children > 0}, {category.children} child{category.children === 1 ? '' : 'ren'}{/if}{#if category.bomLines > 0}, {category.bomLines} BOM row{category.bomLines === 1 ? '' : 's'}{/if}
          </td>
          <td data-label="Attributes" class="text-gray-600">
            {category.attributes.map((a) => (a.required ? `${a.key} (required)` : a.key)).join(', ') || '—'}
          </td>
          <td>
            {#if category.parts + category.children + category.bomLines === 0}
              <form {...remove}>
                <input {...remove.fields.id.as('hidden', category.id)} />
                <button class="link-danger" disabled={remove.pending > 0}>Delete</button>
              </form>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<form {...createCategory} class="card max-w-md space-y-3">
  <h2 class="font-semibold">Add category</h2>
  <label class="block">
    <span class="text-sm">Name</span>
    <input {...createCategory.fields.name.as('text')} required class="input" />
  </label>
  <label class="block">
    <span class="text-sm">Parent</span>
    <select {...createCategory.fields.parentId.as('select')} class="input">
      <option value="">(top level)</option>
      {#each data.categories as category (category.id)}
        <option value={String(category.id)}>{category.path}</option>
      {/each}
    </select>
  </label>
  {#if createCategory.fields.allIssues()?.length}
    <p class="msg-error">{issueText(createCategory.fields.allIssues())}</p>
  {:else if createCategory.result}
    <p class="msg-ok">{createCategory.result.text}</p>
  {/if}
  <button class="btn" disabled={createCategory.pending > 0}>Add category</button>
</form>
