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

  // Clearing the search (for example with its X button) shows the list without it.
  const onSearchInput = (event: Event & { currentTarget: HTMLInputElement }) => {
    if (event.currentTarget.value === '' && filters.q) submitForm(event);
  };

  const active = $derived(selectedFilters(filters));
  // On phones the filters start closed, so the results show first.
  let filtersOpen = $state(false);
</script>

<svelte:head>
  <title>Parts</title>
</svelte:head>

<div class="mb-4 flex flex-wrap items-center gap-2">
  <h1 class="page-title">Parts</h1>
  <span class="text-sm text-gray-500">{data.parts.length} shown</span>
  <button
    type="button"
    class="btn-secondary ml-auto md:hidden"
    aria-expanded={filtersOpen}
    aria-controls="part-filters"
    onclick={() => (filtersOpen = !filtersOpen)}
  >
    Filters{active.length > 0 ? ` (${active.length})` : ''}
  </button>
  <a href="/parts/new" class="btn md:ml-auto">New part</a>
</div>

<div class="grid grid-cols-1 gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
  <form
    id="part-filters"
    method="GET"
    class="card space-y-4 self-start text-sm md:sticky md:top-20 md:block md:max-h-[calc(100dvh-6rem)] md:overflow-y-auto {filtersOpen
      ? ''
      : 'hidden'}"
  >
    <label class="block">
      <span>Search</span>
      <input
        name="q"
        type="search"
        value={filters.q}
        placeholder="Name, alias, part number, SKU"
        oninput={onSearchInput}
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

    <button class="btn w-full">Apply filters</button>
  </form>

  <div>
    {#if active.length > 0}
      <ul class="mb-3 flex flex-wrap items-center gap-2 text-sm">
        {#each active as filter (JSON.stringify(filter))}
          <li class="flex items-center rounded-full border border-gray-300 bg-white py-0.5 pr-1 pl-3">
            {filterLabel(filter)}
            <a
              href={partFiltersHref(removeFilter(filters, filter))}
              class="ml-1 rounded-full px-1.5 text-gray-500 hover:bg-red-50 hover:text-red-700"
              aria-label="Remove filter {filterLabel(filter)}">×</a
            >
          </li>
        {/each}
        <li><a href="/parts" class="link">Clear all</a></li>
      </ul>
    {/if}

    {#if data.parts.length === 0}
      <p class="text-gray-600">
        No parts found.
        {#if filters.q}<a href="/parts/new" class="link">Add a new part</a>.{/if}
      </p>
    {:else}
      <table class="data-table stack-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Category</th>
            <th>Attributes</th>
            <th>Manufacturer / part number</th>
            <th class="text-right">Physical stock</th>
          </tr>
        </thead>
        <tbody>
          {#each data.parts as part (part.id)}
            <tr class:text-gray-500={part.archivedAt}>
              <td class="font-medium sm:font-normal">
                <a href="/parts/{part.id}" class="link">{part.name}</a>
                {#if part.archivedAt}<span class="badge ml-1">archived</span>{/if}
              </td>
              <td data-label="Category" class={part.categoryPath ? '' : 'max-sm:hidden'}>{part.categoryPath ?? ''}</td>
              <td class={part.attributes.length > 0 ? '' : 'max-sm:hidden'}>
                <div class="flex flex-wrap gap-x-2">
                  {#each part.attributes as attribute (attribute.key)}
                    <span class="whitespace-nowrap" title="Entered as {attribute.rawValue}">
                      <span class="text-gray-600">{attribute.label}</span>
                      {attribute.display ?? `${attribute.rawValue} (unrecognized)`}
                    </span>
                  {/each}
                </div>
              </td>
              <td data-label="Part number" class={part.manufacturer || part.partNumber ? '' : 'max-sm:hidden'}>{[part.manufacturer, part.partNumber].filter(Boolean).join(' ')}</td>
              <td data-label="Stock" class="text-right whitespace-nowrap">{formatQuantity(part.totalQuantity, part.baseUnit)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
