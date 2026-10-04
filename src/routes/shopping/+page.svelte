<script lang="ts">
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const componentValue = $derived(data.component === null ? '' : String(data.component));
  const resolved = $derived(data.items.filter((item) => item.partId !== null));
  const unresolved = $derived(data.items.filter((item) => item.partId === null));
</script>

<svelte:head>
  <title>Shopping list</title>
</svelte:head>

{#snippet breakdown(item: (typeof data.items)[number])}
  <ul class="text-xs text-gray-700">
    {#each item.requirements as requirement (requirement.lineId)}
      <li>
        {formatQuantity(requirement.quantity, requirement.unit)} ·
        <a href="/projects/{requirement.projectId}/lines/{requirement.lineId}" class="text-blue-700 hover:underline">
          {requirement.projectName}{requirement.componentName ? ` · ${requirement.componentName}` : ''} ·
          {requirement.lineDescription}
        </a>
      </li>
    {/each}
  </ul>
{/snippet}

<h1 class="mb-2 text-2xl font-semibold">Shopping list</h1>
<p class="mb-4 text-sm text-gray-600">
  What the selected projects need beyond their used, picked, and reserved stock and committed orders.
  Excluding a project only hides its rows; its reservations and commitments stay. Unreserved stock
  and uncommitted orders are suggestions; reserve or commit them on a row to count them.
</p>

<form method="GET" class="mb-6 space-y-2 rounded border p-3 text-sm">
  <input type="hidden" name="select" value="1" />
  {#if data.projects.length === 0}
    <p class="text-gray-600">No planned, active, or paused projects.</p>
  {/if}
  <div class="flex flex-wrap gap-3">
    {#each data.projects as project (project.id)}
      <label class="flex items-center gap-1">
        <input type="checkbox" name="project" value={project.id} checked={data.selected.includes(project.id)} />
        {project.name} <span class="text-gray-500">({project.status})</span>
      </label>
    {/each}
  </div>
  <label class="flex items-center gap-2">
    <span>Rows</span>
    <select name="component" value={componentValue} class="rounded border border-gray-300 px-1">
      <option value="">All rows</option>
      <option value="ungrouped">Ungrouped rows</option>
      {#each data.projects.filter((p) => p.components.length > 0) as project (project.id)}
        <optgroup label={project.name}>
          {#each project.components as component (component.id)}
            <option value={String(component.id)}>{component.name}</option>
          {/each}
        </optgroup>
      {/each}
    </select>
  </label>
  <button class="btn-secondary">Show</button>
</form>

{#if data.items.length === 0}
  <p class="text-gray-600">Nothing is needed beyond stock and committed orders.</p>
{/if}

{#if resolved.length > 0}
  <section class="mb-6">
    <h2 class="mb-2 font-semibold">Parts to buy</h2>
    <table class="w-full text-left text-sm">
      <thead class="border-b text-gray-600">
        <tr>
          <th class="py-1">Part</th>
          <th class="text-right">Needed, not ordered</th>
          <th class="text-right">Unreserved stock</th>
          <th class="text-right">Uncommitted orders</th>
          <th class="pl-4">Requirements</th>
        </tr>
      </thead>
      <tbody>
        {#each resolved as item (item.key)}
          <tr class="border-b border-gray-100 align-top">
            <td class="py-1"><a href="/parts/{item.partId}" class="text-blue-700 hover:underline">{item.label}</a></td>
            <td class="text-right font-medium">{formatQuantity(item.quantity, item.unit)}</td>
            <td class="text-right">{item.suggestion ? formatQuantity(item.suggestion.available, item.suggestion.baseUnit) : '—'}</td>
            <td class="text-right">
              {item.suggestion ? formatQuantity(item.suggestion.uncommittedIncoming, item.suggestion.baseUnit) : '—'}
            </td>
            <td class="pl-4">{@render breakdown(item)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

{#if unresolved.length > 0}
  <section class="mb-6">
    <h2 class="mb-1 font-semibold">Requirements without one chosen part</h2>
    <p class="mb-2 text-sm text-gray-600">
      These are not combined, because they could be different parts. Approve one part for a row to
      combine it with identical requirements.
    </p>
    <table class="w-full text-left text-sm">
      <thead class="border-b text-gray-600">
        <tr><th class="py-1">Requirement</th><th class="text-right">Needed, not ordered</th><th class="pl-4">Approved parts</th><th class="pl-4">Row</th></tr>
      </thead>
      <tbody>
        {#each unresolved as item (item.key)}
          <tr class="border-b border-gray-100 align-top">
            <td class="py-1">{item.label}</td>
            <td class="text-right font-medium">{formatQuantity(item.quantity, item.unit)}</td>
            <td class="pl-4">{item.choices.join(', ') || 'None yet'}</td>
            <td class="pl-4">{@render breakdown(item)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}
