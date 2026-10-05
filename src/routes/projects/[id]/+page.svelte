<script lang="ts">
  import { enhance } from '$app/forms';
  import { describeConstraint, PROJECT_STATUSES } from '#lib/projects.ts';
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const project = $derived(data.project);
  const base = $derived(`/projects/${project.id}`);

  function feedback(action: string) {
    if (form?.action !== action) return null;
    if ('success' in form && form.success) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  }

  const filters = $derived([
    { value: null, label: 'All' },
    ...data.components.map((c) => ({ value: String(c.id), label: c.name })),
    { value: 'ungrouped', label: 'Ungrouped' },
  ]);
  const activeFilter = $derived(data.filter === null ? null : String(data.filter));
</script>

<svelte:head>
  <title>{project.name}</title>
</svelte:head>

{#snippet message(action: string)}
  {@const fb = feedback(action)}
  {#if fb}<p class={fb.ok ? 'text-green-700' : 'text-red-700'}>{fb.text}</p>{/if}
{/snippet}

{#snippet totalsTable(totals: typeof data.totals)}
  <table class="text-sm">
    <tbody>
      {#each totals as total (total.lineIds[0])}
        <tr>
          <td class="pr-4">
            {#if total.partId !== null}
              <a href="/parts/{total.partId}" class="text-blue-700 hover:underline">{total.label}</a>
            {:else}
              {total.label} <span class="text-gray-500">(generic)</span>
            {/if}
          </td>
          <td class="pr-4 text-right">{formatQuantity(total.quantity, total.unit)}</td>
          <td class="text-gray-500">{total.lineIds.length} row{total.lineIds.length === 1 ? '' : 's'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet stockCell(coverage: (typeof data.coverage)[number])}
  {@const fmt = (quantity: number) => formatQuantity(quantity, coverage.unit)}
  <div>Used {fmt(coverage.used)}</div>
  <div>Picked {fmt(coverage.picked)}</div>
  <div>Reserved {fmt(coverage.reserved)}</div>
  <div>Ordered {fmt(coverage.ordered)}</div>
  <div class={coverage.neededNotOrdered > 0 ? 'font-semibold text-amber-700' : 'text-gray-600'}>
    Needed, not ordered {fmt(coverage.neededNotOrdered)}
  </div>
  {#if coverage.excess > 0}<div class="text-red-700">Excess {fmt(coverage.excess)}</div>{/if}
  {#each coverage.parts as part (part.partId)}
    <div class="text-xs text-gray-600">
      {part.partName}{#if part.reservations.length + part.commitments.length > 0}: {[
          ...part.reservations.map((r) => `${formatQuantity(r.quantity, part.baseUnit)} at ${r.locationName}`),
          ...part.commitments.map((c) => `${formatQuantity(c.quantity, part.baseUnit)} ordered from ${c.supplier}`),
        ].join(', ')}{/if}
    </div>
  {/each}
{/snippet}

<p class="mb-2 text-sm"><a href="/projects" class="text-blue-700 hover:underline">← Projects</a></p>

<div class="mb-4 flex flex-wrap items-center gap-3">
  <h1 class="text-2xl font-semibold">{project.name}</h1>
  <span class="rounded bg-gray-200 px-2 py-0.5 text-xs uppercase">{project.status}</span>
</div>

{#if data.links.length > 0 || project.notes}
  <section class="mb-4 text-sm">
    {#if project.notes}<p class="mb-1 whitespace-pre-line">{project.notes}</p>{/if}
    {#each data.links as link (link)}
      <a href={link} class="block text-blue-700 hover:underline" rel="noreferrer">{link}</a>
    {/each}
  </section>
{/if}

<details class="mb-6 rounded border p-3">
  <summary class="cursor-pointer font-semibold">Edit project</summary>
  <form method="POST" action="?/update" use:enhance class="mt-3 grid max-w-xl gap-3">
    <label class="block">
      <span class="text-sm">Name</span>
      <input name="name" required value={project.name} class="input" />
    </label>
    <p class="text-sm text-gray-600">
      Cancelling releases reservations and incoming commitments; picked stock stays until you use or
      return it. A project
      with picked stock cannot be completed.
    </p>
    <label class="block">
      <span class="text-sm">Status</span>
      <select name="status" class="input">
        {#each PROJECT_STATUSES as status (status)}
          <option value={status} selected={status === project.status}>{status}</option>
        {/each}
      </select>
    </label>
    <label class="block">
      <span class="text-sm">Links (one per line)</span>
      <textarea name="links" rows="2" class="input">{data.links.join('\n')}</textarea>
    </label>
    <label class="block">
      <span class="text-sm">Notes</span>
      <textarea name="notes" rows="3" class="input">{project.notes ?? ''}</textarea>
    </label>
    {@render message('update')}
    <div><button class="btn">Save project</button></div>
  </form>
</details>

<section class="mb-6 rounded border p-3">
  <h2 class="mb-2 font-semibold">Components</h2>
  <p class="mb-2 text-sm text-gray-600">
    Optional groups of related rows. A row in a group is still part of the build. Removing a group
    moves its rows to the ungrouped section.
  </p>
  {#each data.components as component, index (component.id)}
    <div class="mb-2 flex flex-wrap items-end gap-2">
      <form method="POST" action="?/renameComponent" use:enhance class="flex flex-wrap items-end gap-2">
        <input type="hidden" name="component_id" value={component.id} />
        <label>
          <span class="text-xs text-gray-600">Name</span>
          <input name="name" required value={component.name} class="input" />
        </label>
        <label>
          <span class="text-xs text-gray-600">Notes</span>
          <input name="notes" value={component.notes ?? ''} class="input" />
        </label>
        <button class="btn-secondary">Save</button>
      </form>
      <form method="POST" action="?/moveComponent" use:enhance class="flex gap-1">
        <input type="hidden" name="component_id" value={component.id} />
        <button name="direction" value="up" class="btn-secondary" disabled={index === 0} title="Move up">↑</button>
        <button
          name="direction"
          value="down"
          class="btn-secondary"
          disabled={index === data.components.length - 1}
          title="Move down">↓</button
        >
      </form>
      <form method="POST" action="?/removeComponent" use:enhance>
        <input type="hidden" name="component_id" value={component.id} />
        <button class="btn-secondary">Remove</button>
      </form>
    </div>
  {/each}
  <form method="POST" action="?/createComponent" use:enhance class="mt-3 flex flex-wrap items-end gap-2">
    <label>
      <span class="text-xs text-gray-600">New component</span>
      <input name="name" required placeholder="e.g. Power supply" class="input" />
    </label>
    <label>
      <span class="text-xs text-gray-600">Notes</span>
      <input name="notes" class="input" />
    </label>
    <button class="btn-secondary">Add component</button>
  </form>
  {@render message('component')}
</section>

<section class="mb-6">
  <h2 class="mb-2 font-semibold">Project totals</h2>
  {#if data.totals.length === 0}
    <p class="text-gray-600">No BOM rows yet.</p>
  {:else}
    <p class="mb-1 text-sm text-gray-600">
      Every row counts once. Generic requirements and different parts or units are not added together.
    </p>
    {@render totalsTable(data.totals)}
  {/if}
</section>

<div class="mb-3 flex flex-wrap items-center gap-2">
  <h2 class="font-semibold">BOM</h2>
  {#if data.components.length > 0}
    <nav class="flex flex-wrap gap-1 text-sm">
      {#each filters as filter (filter.value)}
        <a
          href={filter.value === null ? base : `${base}?component=${filter.value}`}
          class={filter.value === activeFilter ? 'rounded bg-blue-700 px-2 py-0.5 text-white' : 'rounded border px-2 py-0.5'}
        >
          {filter.label}
        </a>
      {/each}
    </nav>
  {/if}
  <a href="/shopping?select=1&project={project.id}" class="btn-secondary ml-auto">Shopping list</a>
  <a href="{base}/estimate" class="btn-secondary">Cost estimate</a>
  <a
    href="{base}/pick{data.filter === null ? '' : `?component=${data.filter}`}"
    class="btn-secondary"
  >
    Pick list
  </a>
  <a
    href="{base}/lines/new{typeof data.filter === 'number' ? `?component=${data.filter}` : ''}"
    class="btn"
  >
    Add BOM row
  </a>
</div>
{@render message('line')}

{#each data.sections as section (section.component?.id ?? 'ungrouped')}
  <section class="mb-6">
    {#if data.components.length > 0}
      <h3 class="mb-1 text-lg font-semibold">{section.component?.name ?? 'Ungrouped'}</h3>
      {#if section.component?.notes}<p class="mb-1 text-sm text-gray-600">{section.component.notes}</p>{/if}
    {/if}
    {#if section.lines.length === 0}
      <p class="text-sm text-gray-600">No rows.</p>
    {:else}
      <table class="mb-2 w-full text-left text-sm">
        <thead class="border-b text-gray-600">
          <tr>
            <th class="py-1">Description</th>
            <th>Quantity</th>
            <th>Stock</th>
            <th>Requirement</th>
            <th>Approved parts</th>
            <th>Group</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {#each section.lines as line (line.id)}
            <tr class="border-b border-gray-100 align-top">
              <td class="py-1">
                {line.description}
                {#if line.referenceDesignators}
                  <div class="text-gray-600">{line.referenceDesignators}</div>
                {/if}
                {#if line.notes}<div class="text-gray-500">{line.notes}</div>{/if}
              </td>
              <td class="whitespace-nowrap">{formatQuantity(line.quantity, line.unit)}</td>
              <td class="whitespace-nowrap">
                {@render stockCell(data.coverage[line.id])}
              </td>
              <td>
                {#if line.partId !== null}
                  Exact: <a href="/parts/{line.partId}" class="text-blue-700 hover:underline">{line.partName}</a>
                {:else}
                  {#if line.categoryName}<div>{line.categoryName}</div>{/if}
                  {#if line.manufacturer || line.partNumber}
                    <div>{[line.manufacturer, line.partNumber].filter(Boolean).join(' ')}</div>
                  {/if}
                {/if}
                {#each line.constraints as constraint (constraint.attributeId)}
                  <div class="text-gray-600">{describeConstraint(constraint)}</div>
                {/each}
              </td>
              <td>
                {#each line.choices as choice (choice.id)}
                  <div>
                    <a href="/parts/{choice.partId}" class="text-blue-700 hover:underline">{choice.partName}</a>
                    {#if choice.substitute}
                      <span class="rounded bg-amber-100 px-1 text-xs">substitute</span>
                      <div class="text-gray-600">{choice.note}</div>
                    {/if}
                  </div>
                {:else}
                  <span class="text-gray-500">None yet</span>
                {/each}
              </td>
              <td>
                <form method="POST" action="?/assignLine" use:enhance class="flex gap-1">
                  <input type="hidden" name="line_id" value={line.id} />
                  <select name="component_id" class="rounded border border-gray-300 px-1">
                    <option value="" selected={line.componentId === null}>Ungrouped</option>
                    {#each data.components as component (component.id)}
                      <option value={component.id} selected={component.id === line.componentId}>
                        {component.name}
                      </option>
                    {/each}
                  </select>
                  <button class="btn-secondary">Move</button>
                </form>
              </td>
              <td class="whitespace-nowrap">
                <a href="{base}/lines/{line.id}" class="text-blue-700 hover:underline">Stock &amp; parts</a>
                <a href="{base}/lines/{line.id}/edit" class="ml-2 text-blue-700 hover:underline">Edit</a>
                <form method="POST" action="?/deleteLine" use:enhance class="inline">
                  <input type="hidden" name="line_id" value={line.id} />
                  <button class="ml-2 text-red-700 hover:underline">Delete</button>
                </form>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if data.components.length > 0}
        <details class="text-sm">
          <summary class="cursor-pointer text-gray-600">Section totals</summary>
          {@render totalsTable(section.totals)}
        </details>
      {/if}
    {/if}
  </section>
{/each}
