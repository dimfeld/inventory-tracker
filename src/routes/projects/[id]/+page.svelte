<script lang="ts">
  import { enhance } from '$app/forms';
  import { formatSize } from '#lib/pieces.ts';
  import { describeConstraint, formatLineQuantity, PROJECT_STATUSES } from '#lib/projects.ts';
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';
  import { approvePart, commitIncoming, reserveStock } from './lines.remote';

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

  /** Each different text once, with its count when it repeats, such as `3 × 711 mm ordered from Amazon`. */
  function countSame(texts: string[]): string[] {
    const counts = new Map<string, number>();
    for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1);
    return [...counts].map(([text, count]) => (count > 1 ? `${count} × ${text}` : text));
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
  {#if fb}<p class="my-2 {fb.ok ? 'msg-ok' : 'msg-error'}">{fb.text}</p>{/if}
{/snippet}

{#snippet totalsTable(totals: typeof data.totals)}
  <table class="data-table max-w-2xl">
    <tbody>
      {#each totals as total (total.lineIds[0])}
        <tr>
          <td>
            {#if total.partId !== null}
              <a href="/parts/{total.partId}" class="link">{total.label}</a>
            {:else}
              {total.label} <span class="text-gray-500">(generic)</span>
            {/if}
          </td>
          <td class="text-right whitespace-nowrap">{formatQuantity(total.quantity, total.unit)}</td>
          <td class="whitespace-nowrap text-gray-500">{total.lineIds.length} row{total.lineIds.length === 1 ? '' : 's'}</td>
        </tr>
      {/each}
    </tbody>
  </table>
{/snippet}

{#snippet approveExactPart(line: (typeof data.sections)[number]['lines'][number])}
  {@const approve = approvePart.for(line.id)}
  {@const issues = approve.fields.allIssues()}
  <form {...approve} class="flex items-center gap-2">
    <input {...approve.fields.projectId.as('hidden', project.id)} />
    <input {...approve.fields.lineId.as('hidden', line.id)} />
    <input {...approve.fields.partId.as('hidden', line.partId!)} />
    <button class="btn-secondary" aria-label="Approve {line.partName}" disabled={approve.pending > 0}>Approve</button>
  </form>
  {#if issues?.length}<p class="text-red-700">{issues.map((issue) => issue.message).join('. ')}</p>{/if}
{/snippet}

{#snippet supplyActions(line: (typeof data.sections)[number]['lines'][number])}
  {@const supply = data.supply[line.id]}
  {#each supply.reserve as option (`${option.partId}-${option.locationId}`)}
    {@const reserve = reserveStock.for(`${line.id}-${option.partId}-${option.locationId}`)}
    {@const issues = reserve.fields.allIssues()}
    <form {...reserve} class="mt-1 flex flex-wrap items-center gap-x-2">
      <input {...reserve.fields.projectId.as('hidden', project.id)} />
      <input {...reserve.fields.lineId.as('hidden', line.id)} />
      <input {...reserve.fields.partId.as('hidden', option.partId)} />
      <input {...reserve.fields.locationId.as('hidden', option.locationId)} />
      <input {...reserve.fields.quantity.as('hidden', option.quantity)} />
      <input {...reserve.fields.unit.as('hidden', option.baseUnit)} />
      <button class="btn-secondary" disabled={reserve.pending > 0}>
        Reserve {formatQuantity(option.quantity, option.baseUnit)}
      </button>
      <span class="text-xs text-gray-600">
        {option.partId === line.partId ? '' : `${option.partName}, `}at {option.locationName}
      </span>
    </form>
    {#if issues?.length}<p class="text-red-700">{issues.map((issue) => issue.message).join('. ')}</p>{/if}
  {/each}
  {#each supply.commit as option (option.orderLineId)}
    {@const commit = commitIncoming.for(`${line.id}-${option.orderLineId}`)}
    {@const issues = commit.fields.allIssues()}
    <form {...commit} class="mt-1 flex flex-wrap items-center gap-x-2">
      <input {...commit.fields.projectId.as('hidden', project.id)} />
      <input {...commit.fields.lineId.as('hidden', line.id)} />
      <input {...commit.fields.orderLineId.as('hidden', option.orderLineId)} />
      <input {...commit.fields.quantity.as('hidden', option.quantity)} />
      <button class="btn-secondary" disabled={commit.pending > 0}>
        Commit {formatQuantity(option.quantity, option.baseUnit)}
      </button>
      <span class="text-xs text-gray-600">
        {option.partId === line.partId ? '' : `${option.partName}, `}from
        <a href="/orders/{option.orderId}" class="link">{option.supplier} {option.reference ?? ''}</a>
        {#if option.expectedOn}(expected {option.expectedOn}){/if}
      </span>
    </form>
    {#if issues?.length}<p class="text-red-700">{issues.map((issue) => issue.message).join('. ')}</p>{/if}
  {/each}
{/snippet}

{#snippet stockCell(coverage: (typeof data.coverage)[number], free: (typeof data.supply)[number]['uncommitted'])}
  {@const fmt = (quantity: number) => formatQuantity(quantity, coverage.unit)}
  {@const counts = [
    ['Used', coverage.used],
    ['Picked', coverage.picked],
    ['Reserved', coverage.reserved],
    ['Ordered, committed', coverage.ordered],
  ].filter(([, quantity]) => Number(quantity) > 0)}
  {#each counts as [label, quantity] (label)}
    <div>{label} {fmt(Number(quantity))}</div>
  {/each}
  {#if free.inStock > 0}<div class="text-amber-700">In stock, not reserved {fmt(free.inStock)}</div>{/if}
  {#if free.ordered > 0}<div class="text-amber-700">Ordered, not committed {fmt(free.ordered)}</div>{/if}
  {#if free.notOrdered > 0}
    <div class="font-semibold text-red-700">Not ordered {fmt(free.notOrdered)}</div>
  {/if}
  {#if coverage.neededNotOrdered === 0}
    {#if counts.length === 0}
      <div class="text-gray-500">Nothing needed</div>
    {:else}
      <div class="text-green-700">Covered</div>
    {/if}
  {/if}
  {#if coverage.excess > 0}<div class="text-red-700">Excess {fmt(coverage.excess)}</div>{/if}
  {#each coverage.parts as part (part.partId)}
    {#if part.reservations.length + part.commitments.length + part.pieceCommitments.length > 0}
      <div class="text-xs text-gray-600">
        {part.partName}: {countSame([
          ...part.reservations.map((r) => `${formatQuantity(r.quantity, part.baseUnit)} at ${r.locationName}`),
          ...part.commitments.map((c) => `${formatQuantity(c.quantity, part.baseUnit)} ordered from ${c.supplier}`),
          ...part.pieceCommitments.map((c) => `${formatSize(c, c.displayUnit)} ordered from ${c.supplier}`),
        ]).join(', ')}
      </div>
    {/if}
  {/each}
{/snippet}

<a href="/projects" class="back-link">← Projects</a>

<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
  <h1 class="page-title">{project.name}</h1>
  <span class="badge">{project.status}</span>
  <div class="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
    <a href="{base}/lines/new{typeof data.filter === 'number' ? `?component=${data.filter}` : ''}" class="btn">
      Add BOM row
    </a>
    <a href="{base}/pick{data.filter === null ? '' : `?component=${data.filter}`}" class="btn-secondary">Pick list</a>
    <a href="/shopping?project={project.id}" class="btn-secondary">Shopping list</a>
    <a href="{base}/estimate" class="btn-secondary">Cost estimate</a>
  </div>
</div>

{#if data.links.length > 0 || project.notes}
  <section class="mb-4 text-sm">
    {#if project.notes}<p class="mb-1 whitespace-pre-line">{project.notes}</p>{/if}
    {#each data.links as link (link)}
      <a href={link} class="link block truncate" rel="noreferrer" target="_blank">{link}</a>
    {/each}
  </section>
{/if}

<div class="mb-6 space-y-2">
  <details class="card" open={form?.action === 'update'}>
    <summary class="cursor-pointer font-semibold">Edit project</summary>
    <form method="POST" action="?/update" use:enhance class="mt-3 grid max-w-xl gap-3">
      <label class="block">
        <span class="text-sm">Name</span>
        <input name="name" required value={project.name} class="input" />
      </label>
      <label class="block">
        <span class="text-sm">Status</span>
        <select name="status" class="input">
          {#each PROJECT_STATUSES as status (status)}
            <option value={status} selected={status === project.status}>{status}</option>
          {/each}
        </select>
        <span class="hint">
          Cancelling releases reservations and incoming commitments; picked stock stays until you use or
          return it. A project with picked stock cannot be completed.
        </span>
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

  <details class="card" open={form?.action === 'component'}>
    <summary class="cursor-pointer font-semibold">
      Components <span class="font-normal text-gray-500">({data.components.length})</span>
    </summary>
    <p class="hint my-2">
      Optional groups of related rows. A row in a group is still part of the build. Removing a group
      moves its rows to the ungrouped section.
    </p>
    <ul class="divide-y divide-gray-100">
      {#each data.components as component, index (component.id)}
        <li class="flex flex-wrap items-end gap-2 py-2">
          <form method="POST" action="?/renameComponent" use:enhance class="flex grow flex-wrap items-end gap-2">
            <input type="hidden" name="component_id" value={component.id} />
            <label class="grow basis-40">
              <span class="text-xs text-gray-600">Name</span>
              <input name="name" required value={component.name} class="input" />
            </label>
            <label class="grow basis-56">
              <span class="text-xs text-gray-600">Notes</span>
              <textarea name="notes" rows="1" class="input">{component.notes ?? ''}</textarea>
            </label>
            <button class="btn-secondary">Save</button>
          </form>
          <form method="POST" action="?/moveComponent" use:enhance class="flex gap-1">
            <input type="hidden" name="component_id" value={component.id} />
            <button name="direction" value="up" class="btn-secondary" disabled={index === 0} aria-label="Move {component.name} up">↑</button>
            <button
              name="direction"
              value="down"
              class="btn-secondary"
              disabled={index === data.components.length - 1}
              aria-label="Move {component.name} down">↓</button
            >
          </form>
          <form method="POST" action="?/removeComponent" use:enhance>
            <input type="hidden" name="component_id" value={component.id} />
            <button class="btn-danger">Remove</button>
          </form>
        </li>
      {/each}
    </ul>
    <form method="POST" action="?/createComponent" use:enhance class="mt-2 flex flex-wrap items-end gap-2 border-t border-gray-200 pt-3">
      <label class="grow basis-40">
        <span class="text-xs text-gray-600">New component</span>
        <input name="name" required placeholder="e.g. Power supply" class="input" />
      </label>
      <label class="grow basis-56">
        <span class="text-xs text-gray-600">Notes</span>
        <textarea name="notes" rows="1" class="input"></textarea>
      </label>
      <button class="btn-secondary">Add component</button>
    </form>
    {@render message('component')}
  </details>

  {#if data.totals.length > 0}
    <details class="card">
      <summary class="cursor-pointer font-semibold">
        Project totals <span class="font-normal text-gray-500">({data.totals.length})</span>
      </summary>
      <p class="hint my-2">
        Every row counts once. Generic requirements and different parts or units are not added together.
      </p>
      {@render totalsTable(data.totals)}
    </details>
  {/if}
</div>

<div class="mb-3 flex flex-wrap items-center gap-2">
  <h2 class="section-title mb-0">BOM</h2>
  {#if data.components.length > 0}
    <nav aria-label="Component filter" class="-mx-4 flex w-full gap-1 overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:flex-wrap sm:px-0">
      {#each filters as filter (filter.value)}
        <a
          href={filter.value === null ? base : `${base}?component=${filter.value}`}
          aria-current={filter.value === activeFilter ? 'true' : undefined}
          class={filter.value === activeFilter ? 'pill-active' : 'pill'}
        >
          {filter.label}
        </a>
      {/each}
    </nav>
  {/if}
</div>
{@render message('line')}

{#if data.totals.length === 0}
  <p class="text-gray-600">No BOM rows yet. <a href="{base}/lines/new" class="link">Add the first row</a> or <a href="/imports" class="link">import a BOM</a>.</p>
{/if}

{#each data.sections as section (section.component?.id ?? 'ungrouped')}
  <section class="mb-6">
    {#if data.components.length > 0}
      <h3 class="mb-1 text-lg font-semibold">{section.component?.name ?? 'Ungrouped'}</h3>
      {#if section.component?.notes}<p class="hint mb-1">{section.component.notes}</p>{/if}
    {/if}
    {#if section.lines.length === 0}
      <p class="hint">No rows.</p>
    {:else}
      <table class="data-table stack-table mb-2">
        <thead>
          <tr>
            <th>Description</th>
            <th>Quantity</th>
            <th>Stock</th>
            <th>Requirement</th>
            <th>Approved parts</th>
            {#if data.components.length > 0}<th>Group</th>{/if}
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each section.lines as line (line.id)}
            <!-- No quick approval once the exact part or a substitute is approved. -->
            {@const approveExact =
              line.partId !== null &&
              !line.choices.some((choice) => choice.partId === line.partId || choice.substitute)}
            <tr>
              <td>
                <a href="{base}/lines/{line.id}" class="link font-medium">{line.description}</a>
                {#if line.referenceDesignators}
                  <div class="text-gray-600">{line.referenceDesignators}</div>
                {/if}
                {#if line.notes}<div class="text-gray-500">{line.notes}</div>{/if}
              </td>
              <td data-label="Quantity" class="whitespace-nowrap">{formatLineQuantity(line)}</td>
              <td data-label="Stock" class="sm:whitespace-nowrap">
                <div>{@render stockCell(data.coverage[line.id], data.supply[line.id].uncommitted)}</div>
                {@render supplyActions(line)}
              </td>
              <td data-label="Requirement">
                <div>
                  {#if line.partId !== null}
                    Exact: <a href="/parts/{line.partId}" class="link">{line.partName}</a>
                  {:else}
                    {#if line.categoryName}<div>{line.categoryName}</div>{/if}
                    {#if line.manufacturer || line.partNumber}
                      <div>{[line.manufacturer, line.partNumber].filter(Boolean).join(' ')}</div>
                    {/if}
                  {/if}
                  {#each line.constraints as constraint (constraint.attributeId)}
                    <div class="text-gray-600">{describeConstraint(constraint)}</div>
                  {/each}
                </div>
              </td>
              <td data-label="Approved">
                <div>
                  {#if approveExact}
                    {@render approveExactPart(line)}
                  {/if}
                  {#each line.choices as choice (choice.id)}
                    <div>
                      <a href="/parts/{choice.partId}" class="link">{choice.partName}</a>
                      {#if choice.substitute}
                        <span class="rounded bg-amber-100 px-1 text-xs">substitute</span>
                        <div class="text-gray-600">{choice.note}</div>
                      {/if}
                    </div>
                  {:else}
                    {#if !approveExact}
                      <a href="{base}/lines/{line.id}" class="text-amber-700 hover:underline">Choose a part</a>
                    {/if}
                  {/each}
                </div>
              </td>
              {#if data.components.length > 0}
                <td data-label="Group">
                  <form method="POST" action="?/assignLine" use:enhance>
                    <input type="hidden" name="line_id" value={line.id} />
                    <!-- A change moves the row at once. -->
                    <select
                      name="component_id"
                      aria-label="Group of {line.description}"
                      class="input-sm max-w-40"
                      onchange={(e) => e.currentTarget.form?.requestSubmit()}
                    >
                      <option value="" selected={line.componentId === null}>Ungrouped</option>
                      {#each data.components as component (component.id)}
                        <option value={component.id} selected={component.id === line.componentId}>
                          {component.name}
                        </option>
                      {/each}
                    </select>
                  </form>
                </td>
              {/if}
              <td class="whitespace-nowrap">
                <div class="mt-1 flex items-center gap-3 sm:mt-0">
                  <a href="{base}/lines/{line.id}/edit" class="link">Edit</a>
                  <form
                    method="POST"
                    action="?/deleteLine"
                    use:enhance={({ cancel }) => {
                      if (!confirm(`Delete the row "${line.description}"?`)) cancel();
                    }}
                  >
                    <input type="hidden" name="line_id" value={line.id} />
                    <button class="link-danger">Delete</button>
                  </form>
                </div>
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
