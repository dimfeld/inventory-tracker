<script lang="ts">
  import { enhance } from '$app/forms';
  import { KIND_LABELS } from '#lib/imports.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const STATE_LABELS = {
    draft: 'Draft',
    parsing: 'Parsing',
    parsed: 'Parsed',
    failed: 'Parse failed',
  } as const;
</script>

<svelte:head>
  <title>Imports</title>
</svelte:head>

<h1 class="mb-4 text-2xl font-semibold">Imports</h1>

<section class="mb-8 max-w-2xl">
  <h2 class="mb-2 font-semibold">New import</h2>
  <p class="mb-2 text-sm text-gray-600">
    Paste an order list or a project BOM. It is saved as a draft; nothing is sent anywhere until you choose to
    parse it. You can also enter lines by hand or map CSV columns without parsing.
  </p>
  <form method="POST" use:enhance class="space-y-3">
    <div class="flex flex-wrap gap-6">
      <fieldset>
        <legend class="text-sm">Kind</legend>
        <label class="mr-3"><input type="radio" name="kind" value="order" checked /> Order list</label>
        <label><input type="radio" name="kind" value="project" /> Project BOM</label>
      </fieldset>
      <fieldset>
        <legend class="text-sm">Format</legend>
        <label class="mr-3"><input type="radio" name="source_type" value="text" checked /> Text</label>
        <label><input type="radio" name="source_type" value="csv" /> CSV</label>
      </fieldset>
    </div>
    <label class="block">
      <span class="text-sm">Source</span>
      <textarea name="source_text" rows="10" required class="input font-mono text-sm"></textarea>
    </label>
    {#if form?.errors}<p class="text-red-700">{Object.values(form.errors).join('. ')}</p>{/if}
    <button class="btn">Save draft</button>
  </form>
</section>

{#if data.imports.length > 0}
  <table class="w-full text-left text-sm">
    <thead class="border-b text-gray-600">
      <tr><th class="py-1">Source</th><th>Kind</th><th>State</th><th class="text-right">Lines</th><th>Result</th></tr>
    </thead>
    <tbody>
      {#each data.imports as item (item.id)}
        <tr class="border-b border-gray-100">
          <td class="py-1">
            <a href="/imports/{item.id}" class="text-blue-700 hover:underline">{item.title || `Import ${item.id}`}</a>
          </td>
          <td>{KIND_LABELS[item.kind]} ({item.sourceType})</td>
          <td>{item.commitState === 'committed' ? 'Committed' : STATE_LABELS[item.parseState]}</td>
          <td class="text-right">{item.lineCount}</td>
          <td>
            {#if item.orderId}<a href="/orders/{item.orderId}" class="text-blue-700 hover:underline">Order</a>{/if}
            {#if item.projectId}<a href="/projects/{item.projectId}" class="text-blue-700 hover:underline">Project</a>{/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
