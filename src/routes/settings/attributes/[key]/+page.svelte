<script lang="ts">
  import AttributeFields from '../AttributeFields.svelte';
  import { deleteAttribute, replaceValue, setApplicability, updateAttribute } from '../../taxonomy.remote';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const attribute = $derived(data.attribute);
  const assigned = $derived(new Set(attribute.categories.map((c) => c.categoryId)));
  const unassigned = $derived(data.categories.filter((c) => !assigned.has(c.id)));

  const addCategory = setApplicability.for('add');

  const issueText = (issues: { message: string }[] | undefined) =>
    issues?.map((issue) => issue.message).join('. ');
</script>

<svelte:head>
  <title>{attribute.label} · Attributes</title>
</svelte:head>

<a href="/settings/attributes" class="back-link">← Attributes</a>
<h2 class="mb-1 text-xl font-semibold">{attribute.label}</h2>
<p class="mb-4 text-sm text-gray-600">
  Key <code>{attribute.key}</code> · {attribute.partCount} part{attribute.partCount === 1 ? '' : 's'}
  {#if attribute.constraintCount > 0}· {attribute.constraintCount} BOM row constraint{attribute.constraintCount === 1 ? '' : 's'}{/if}
</p>

<form {...updateAttribute} class="card mb-6 max-w-2xl space-y-3">
  <h3 class="font-semibold">Definition</h3>
  <input {...updateAttribute.fields.key.as('hidden', attribute.key)} />
  <AttributeFields fields={updateAttribute.fields} initial={attribute} />
  {#if attribute.partCount > 0}
    <p class="hint">A new type, rule, or unit types the {attribute.partCount} stored value(s) again.</p>
  {/if}
  {#if updateAttribute.fields.allIssues()?.length}
    <p class="msg-error">{issueText(updateAttribute.fields.allIssues())}</p>
  {:else if updateAttribute.result}
    <p class="msg-ok">{updateAttribute.result.text}</p>
  {/if}
  <button class="btn" disabled={updateAttribute.pending > 0}>Save</button>
</form>

<section class="mb-6 max-w-2xl">
  <h3 class="section-title">Categories</h3>
  <p class="mb-2 text-sm text-gray-600">
    The attribute applies to these categories and their children. A required attribute must be set
    on a generic BOM row of the category before parts can match it.
  </p>
  {#if attribute.categories.length > 0}
    <ul class="mb-3 divide-y divide-gray-100 text-sm">
      {#each attribute.categories as category (category.categoryId)}
        {@const toggle = setApplicability.for(`toggle-${category.categoryId}`)}
        {@const remove = setApplicability.for(`remove-${category.categoryId}`)}
        <li class="flex flex-wrap items-center gap-3 py-1.5">
          <span class="grow">{category.path}</span>
          <form {...toggle} class="flex items-center gap-1">
            <input {...toggle.fields.key.as('hidden', attribute.key)} />
            <input {...toggle.fields.categoryId.as('hidden', String(category.categoryId))} />
            <input {...toggle.fields.mode.as('hidden', category.required ? 'optional' : 'required')} />
            <span class={category.required ? 'font-medium' : 'text-gray-600'}>{category.required ? 'Required' : 'Optional'}</span>
            <button class="link" disabled={toggle.pending > 0}>Make {category.required ? 'optional' : 'required'}</button>
          </form>
          <form {...remove}>
            <input {...remove.fields.key.as('hidden', attribute.key)} />
            <input {...remove.fields.categoryId.as('hidden', String(category.categoryId))} />
            <input {...remove.fields.mode.as('hidden', 'remove')} />
            <button class="link-danger" disabled={remove.pending > 0}>Remove</button>
          </form>
        </li>
      {/each}
    </ul>
  {/if}
  <form {...addCategory} class="flex flex-wrap items-center gap-2 text-sm">
    <input {...addCategory.fields.key.as('hidden', attribute.key)} />
    <select {...addCategory.fields.categoryId.as('select')} aria-label="Category" class="input-sm max-w-72">
      <option value="">Choose a category…</option>
      {#each unassigned as category (category.id)}
        <option value={String(category.id)}>{category.path}</option>
      {/each}
    </select>
    <select {...addCategory.fields.mode.as('select', 'optional')} aria-label="Optional or required" class="input-sm">
      <option value="optional">Optional</option>
      <option value="required">Required</option>
    </select>
    <button class="btn-secondary" disabled={addCategory.pending > 0}>Add to category</button>
  </form>
  {#if addCategory.fields.allIssues()?.length}<p class="msg-error mt-1">{issueText(addCategory.fields.allIssues())}</p>{/if}
</section>

<section class="mb-6">
  <h3 class="section-title">Values</h3>
  <p class="mb-2 text-sm text-gray-600">
    Change a value to make it the same as another, such as <code>socket-head</code> to
    <code>Socket head</code>. The change applies to every part with that exact value.
  </p>
  {#if data.values.length === 0}
    <p class="text-sm text-gray-600">No part has a value yet.</p>
  {:else}
    <table class="data-table stack-table">
      <thead>
        <tr><th>Value</th><th>Reads as</th><th class="text-right">Parts</th><th>Change to</th></tr>
      </thead>
      <tbody>
        {#each data.values as value (value.rawValue)}
          {@const replace = replaceValue.for(value.rawValue)}
          <tr>
            <td><a href="/parts?attr.{attribute.key}={encodeURIComponent(value.rawValue)}" class="link">{value.rawValue}</a></td>
            <td data-label="Reads as" class={value.display === null ? 'text-red-700' : 'text-gray-600'}>
              {value.display ?? 'not readable'}
            </td>
            <td data-label="Parts" class="text-right">{value.partCount}</td>
            <td>
              <form {...replace} class="flex items-center gap-1">
                <input {...replace.fields.key.as('hidden', attribute.key)} />
                <input {...replace.fields.from.as('hidden', value.rawValue)} />
                <input {...replace.fields.to.as('text', value.rawValue)} aria-label="New value for {value.rawValue}" class="input-sm w-40" />
                <button class="btn-secondary" disabled={replace.pending > 0}>Change</button>
              </form>
              {#if replace.fields.allIssues()?.length}<p class="text-red-700">{issueText(replace.fields.allIssues())}</p>{/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

{#if attribute.partCount + attribute.constraintCount === 0}
  <form
    {...deleteAttribute.enhance(async ({ submit }) => {
      if (confirm(`Delete the attribute ${attribute.label}?`)) await submit();
    })}
  >
    <input {...deleteAttribute.fields.key.as('hidden', attribute.key)} />
    <button class="btn-danger" disabled={deleteAttribute.pending > 0}>Delete attribute</button>
  </form>
  {#if deleteAttribute.fields.allIssues()?.length}<p class="msg-error mt-1">{issueText(deleteAttribute.fields.allIssues())}</p>{/if}
{/if}
