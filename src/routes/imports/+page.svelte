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

<h1 class="page-title mb-4">Imports</h1>

{#if data.batch}
  <p class="mb-4 rounded bg-blue-50 p-3 text-sm text-blue-900">
    Created {data.batch.created} new order {data.batch.created === 1 ? 'import' : 'imports'}.
    {#if data.batch.skipped > 0}
      Skipped {data.batch.skipped} {data.batch.skipped === 1 ? 'order' : 'orders'} that already exist.
    {/if}
  </p>
{/if}

<section class="card mb-8 max-w-2xl">
  <h2 class="section-title">New import</h2>
  <p class="mb-2 text-sm text-gray-600">
    Paste an order list or a project BOM. It is saved as a draft; nothing is sent anywhere until you choose to
    parse it. You can also enter lines by hand or map CSV columns without parsing.
  </p>
  <form method="POST" use:enhance class="space-y-3">
    <div class="flex flex-wrap gap-6">
      <fieldset>
        <legend class="text-sm">Kind</legend>
        <label class="mr-3 inline-flex min-h-8 items-center gap-1"><input type="radio" name="kind" value="order" checked /> Order list</label>
        <label class="inline-flex min-h-8 items-center gap-1"><input type="radio" name="kind" value="project" /> Project BOM</label>
      </fieldset>
      <fieldset>
        <legend class="text-sm">Format</legend>
        <label class="mr-3 inline-flex min-h-8 items-center gap-1"><input type="radio" name="source_type" value="text" checked /> Text</label>
        <label class="inline-flex min-h-8 items-center gap-1"><input type="radio" name="source_type" value="csv" /> CSV</label>
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
  <h2 class="section-title">Earlier imports</h2>
  <table class="data-table stack-table">
    <thead>
      <tr><th>Source</th><th>Kind</th><th>State</th><th class="text-right">Lines</th><th>Result</th></tr>
    </thead>
    <tbody>
      {#each data.imports as item (item.id)}
        <tr>
          <td class="max-w-md truncate">
            <a href="/imports/{item.id}" class="link font-medium sm:font-normal">{item.title || `Import ${item.id}`}</a>
          </td>
          <td data-label="Kind">{KIND_LABELS[item.kind]} ({item.sourceType})</td>
          <td data-label="State">
            {item.commitState !== 'committed'
              ? STATE_LABELS[item.parseState]
              : item.kind === 'order' && !item.orderId
                ? 'Skipped'
                : 'Committed'}
          </td>
          <td data-label="Lines" class="text-right">{item.lineCount}</td>
          <td data-label="Result">
            {#if item.orderId}<a href="/orders/{item.orderId}" class="link">Order</a>{/if}
            {#if item.projectId}<a href="/projects/{item.projectId}" class="link">Project</a>{/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
