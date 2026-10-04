<script lang="ts">
  import { formatQuantity } from '#lib/units.ts';
  import {
    ATTRIBUTE_PREFIX,
    isSelected,
    partFiltersHref,
    removeFilter,
    selectedFilters,
    type SelectedFilter,
  } from './filters';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const filters = $derived(data.filters);
  const facetsByKey = $derived(new Map(data.facets.map((f) => [f.key, f])));

  function filterLabel(filter: SelectedFilter): string {
    switch (filter.kind) {
      case 'q':
        return `Search: ${filter.value}`;
      case 'category':
        return `Category: ${data.categories.find((c) => c.id === filter.value)?.path ?? filter.value}`;
      case 'tag':
        return `Tag: ${filter.value}`;
      case 'attribute': {
        const facet = facetsByKey.get(filter.key);
        const value = facet?.values.find((v) => v.value === filter.value)?.label ?? filter.value;
        return `${facet?.label ?? filter.key}: ${value}`;
      }
    }
  }

  // Selected values that have no checkbox in the current scope still need to be submitted.
  const hiddenSelections = $derived(
    Object.entries(filters.attributes).flatMap(([key, values]) =>
      values
        .filter((value) => !facetsByKey.get(key)?.values.some((v) => v.value === value))
        .map((value) => ({ key, value }))
    )
  );

  const submitForm = (event: Event & { currentTarget: HTMLElement }) =>
    event.currentTarget.closest('form')?.requestSubmit();
</script>

<svelte:head>
  <title>Parts</title>
</svelte:head>

<div class="mb-4 flex items-center justify-between">
  <h1 class="text-2xl font-semibold">Parts</h1>
  <a href="/parts/new" class="btn">New part</a>
</div>

<div class="grid gap-6 md:grid-cols-[16rem_1fr]">
  <form method="GET" class="space-y-4 text-sm">
    <label class="block">
      <span>Search</span>
      <input
        name="q"
        type="search"
        value={filters.q}
        placeholder="Name, alias, part number, SKU"
        class="input"
      />
    </label>

    <label class="block">
      <span>Category</span>
      <select name="category" class="input" onchange={submitForm}>
        <option value="">(all)</option>
        {#each data.categories as category (category.id)}
          <option value={category.id} selected={category.id === filters.category}>{category.path}</option>
        {/each}
      </select>
    </label>

    {#each data.facets as facet (facet.key)}
      <fieldset>
        <legend class="font-semibold">{facet.label}</legend>
        {#each facet.values as value (value.value)}
          <label class="flex items-center gap-2">
            <input
              type="checkbox"
              name="{ATTRIBUTE_PREFIX}{facet.key}"
              value={value.value}
              checked={isSelected(filters, facet.key, value.value)}
              onchange={submitForm}
            />
            {value.label}
            <span class="text-gray-500">({value.partCount})</span>
          </label>
        {:else}
          <p class="text-gray-500">No values recorded</p>
        {/each}
      </fieldset>
    {/each}
    {#each hiddenSelections as selection (`${selection.key}=${selection.value}`)}
      <input type="hidden" name="{ATTRIBUTE_PREFIX}{selection.key}" value={selection.value} />
    {/each}

    {#if data.tags.length > 0}
      <fieldset>
        <legend class="font-semibold">Tags</legend>
        {#each data.tags as tag (tag)}
          <label class="flex items-center gap-2">
            <input type="checkbox" name="tag" value={tag} checked={filters.tags.includes(tag)} onchange={submitForm} />
            {tag}
          </label>
        {/each}
      </fieldset>
    {/if}

    <label class="flex items-center gap-2">
      <input type="checkbox" name="archived" value="1" checked={filters.archived} onchange={submitForm} />
      Show archived parts
    </label>

    <button class="btn">Apply filters</button>
  </form>

  <div>
    {#if selectedFilters(filters).length > 0}
      <ul class="mb-3 flex flex-wrap gap-2 text-sm">
        {#each selectedFilters(filters) as filter (JSON.stringify(filter))}
          <li class="rounded bg-gray-100 px-2 py-0.5">
            {filterLabel(filter)}
            <a
              href={partFiltersHref(removeFilter(filters, filter))}
              class="ml-1 text-gray-600 hover:text-red-700"
              aria-label="Remove filter {filterLabel(filter)}">×</a
            >
          </li>
        {/each}
        <li><a href="/parts" class="text-blue-700 hover:underline">Clear all</a></li>
      </ul>
    {/if}

    {#if data.parts.length === 0}
      <p class="text-gray-600">No parts found.</p>
    {:else}
      <table class="w-full text-left">
        <thead class="border-b text-sm text-gray-600">
          <tr>
            <th class="py-1">Name</th>
            <th>Category</th>
            <th>Attributes</th>
            <th>Manufacturer / part number</th>
            <th class="text-right">Physical stock</th>
          </tr>
        </thead>
        <tbody>
          {#each data.parts as part (part.id)}
            <tr class="border-b border-gray-100 align-top" class:text-gray-500={part.archivedAt}>
              <td class="py-1">
                <a href="/parts/{part.id}" class="text-blue-700 hover:underline">{part.name}</a>
                {#if part.archivedAt}<span class="ml-1 text-xs uppercase">archived</span>{/if}
              </td>
              <td class="text-sm">{part.categoryPath ?? ''}</td>
              <td class="text-sm">
                {#each part.attributes as attribute (attribute.key)}
                  <span class="mr-2 whitespace-nowrap" title="Entered as {attribute.rawValue}">
                    <span class="text-gray-600">{attribute.label}</span>
                    {attribute.display ?? `${attribute.rawValue} (unrecognized)`}
                  </span>
                {/each}
              </td>
              <td>{[part.manufacturer, part.partNumber].filter(Boolean).join(' ')}</td>
              <td class="text-right">{formatQuantity(part.totalQuantity, part.baseUnit)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
