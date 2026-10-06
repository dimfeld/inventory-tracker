<script lang="ts">
  import AttributeFields from './AttributeFields.svelte';
  import { createAttribute } from '../taxonomy.remote';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const issues = $derived(createAttribute.fields.allIssues());
</script>

<svelte:head>
  <title>Attributes · Settings</title>
</svelte:head>

<p class="mb-3 text-sm text-gray-600">
  Attributes describe parts, such as thread or length. Assign an attribute to a category to show it
  for that category's parts and to use it when BOM rows are matched.
</p>

<table class="data-table stack-table mb-6">
  <thead>
    <tr><th>Attribute</th><th>Key</th><th>Type</th><th class="text-right">Parts</th><th>Categories</th></tr>
  </thead>
  <tbody>
    {#each data.attributes as attribute (attribute.id)}
      <tr>
        <td><a href="/settings/attributes/{attribute.key}" class="link font-medium sm:font-normal">{attribute.label}</a></td>
        <td data-label="Key"><code class="text-xs">{attribute.key}</code></td>
        <td data-label="Type" class="text-gray-600">
          {attribute.valueType}{attribute.normalization ? ` · ${attribute.normalization}` : ''}{attribute.canonicalUnit
            ? ` · ${attribute.canonicalUnit}`
            : ''}
        </td>
        <td data-label="Parts" class="text-right">{attribute.partCount}</td>
        <td data-label="Categories" class="text-gray-600">
          {attribute.categories.map((c) => (c.required ? `${c.path} (required)` : c.path)).join(', ') || '—'}
        </td>
      </tr>
    {/each}
  </tbody>
</table>

<form {...createAttribute} class="card max-w-2xl space-y-3">
  <h2 class="font-semibold">Add attribute</h2>
  <label class="block">
    <span class="text-sm">Key</span>
    <input {...createAttribute.fields.key.as('text')} required placeholder="shank_diameter" class="input" />
    <span class="hint">Lowercase letters, digits, and _. The key cannot change later.</span>
  </label>
  <AttributeFields fields={createAttribute.fields} />
  {#if issues?.length}
    <p class="msg-error">{issues.map((issue) => issue.message).join('. ')}</p>
  {:else if createAttribute.result}
    <p class="msg-ok">{createAttribute.result.text}</p>
  {/if}
  <button class="btn" disabled={createAttribute.pending > 0}>Add attribute</button>
</form>
