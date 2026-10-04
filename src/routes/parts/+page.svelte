<script lang="ts">
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();
</script>

<svelte:head>
  <title>Parts</title>
</svelte:head>

<div class="mb-4 flex items-center justify-between">
  <h1 class="text-2xl font-semibold">Parts</h1>
  <a href="/parts/new" class="btn">New part</a>
</div>

<p class="mb-3 text-sm">
  {#if data.includeArchived}
    <a href="/parts" class="text-blue-700 hover:underline">Hide archived parts</a>
  {:else}
    <a href="/parts?archived=1" class="text-blue-700 hover:underline">Show archived parts</a>
  {/if}
</p>

{#if data.parts.length === 0}
  <p class="text-gray-600">No parts yet.</p>
{:else}
  <table class="w-full text-left">
    <thead class="border-b text-sm text-gray-600">
      <tr>
        <th class="py-1">Name</th>
        <th>Category</th>
        <th>Manufacturer / part number</th>
        <th class="text-right">Physical stock</th>
      </tr>
    </thead>
    <tbody>
      {#each data.parts as part (part.id)}
        <tr class="border-b border-gray-100" class:text-gray-500={part.archivedAt}>
          <td class="py-1">
            <a href="/parts/{part.id}" class="text-blue-700 hover:underline">{part.name}</a>
            {#if part.archivedAt}<span class="ml-1 text-xs uppercase">archived</span>{/if}
          </td>
          <td>{part.categoryName ?? ''}</td>
          <td>{[part.manufacturer, part.partNumber].filter(Boolean).join(' ')}</td>
          <td class="text-right">{formatQuantity(part.totalQuantity, part.baseUnit)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}
