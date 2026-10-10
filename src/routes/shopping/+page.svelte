<script lang="ts">
  import { formatMoney } from '#lib/money.ts';
  import { formatLength, formatSize } from '#lib/pieces.ts';
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';

  let { data }: PageProps = $props();

  const componentValue = $derived(data.component === null ? '' : String(data.component));
  const resolved = $derived(data.items.filter((item) => item.partId !== null));
  const unresolved = $derived(data.items.filter((item) => item.partId === null));

  // A change to the selection shows the new list at once.
  const submitForm = (event: Event & { currentTarget: HTMLElement }) =>
    event.currentTarget.closest('form')?.requestSubmit();
</script>

<svelte:head>
  <title>Shopping list</title>
</svelte:head>

{#snippet coveredBy(item: (typeof data.items)[number])}
  {@const fmt = (quantity: number) => formatQuantity(quantity, item.unit)}
  {@const parts = [
    ['Reserved', item.coverage.reserved],
    ['In stock, not reserved', item.coverage.freeStock],
    ['Ordered, committed', item.coverage.committed],
    ['Ordered, not committed', item.coverage.freeOrdered],
  ].filter(([, quantity]) => Number(quantity) > 0)}
  <div class="text-gray-600">Need {fmt(item.quantity)}</div>
  {#each parts as [label, quantity] (label)}
    <div class="text-gray-600">{label} {fmt(Number(quantity))}</div>
  {/each}
{/snippet}

{#snippet cutPlan(plan: NonNullable<(typeof data.items)[number]['cutPlan']>)}
  {@const size = (s: { lengthMm: number; widthMm: number | null }) => formatSize(s, plan.displayUnit)}
  <div class="mt-1 text-xs text-gray-700">
    <div class="text-gray-500">
      Cut plan{plan.kerfMm > 0 ? `, kerf ${formatLength(plan.kerfMm, plan.displayUnit)} per cut` : ''}:
    </div>
    <ol class="list-decimal space-y-0.5 pl-5">
      {#each plan.pieces as piece, index (index)}
        <li>
          <span class="font-medium">{size(piece)}</span>
          <span class="text-gray-500">
            ({piece.supplier} {piece.sku}{piece.price ? `, ${formatMoney(piece.price)}` : ''})
          </span>
          → {piece.cuts.map((cut) => `${size(cut)} ${cut.lineDescription}`).join(', ')}
          {#if piece.wasteMm !== null && piece.wasteMm > 0}
            <span class="text-gray-500">· {formatLength(piece.wasteMm, plan.displayUnit)} left over</span>
          {/if}
        </li>
      {/each}
    </ol>
  </div>
{/snippet}

{#snippet breakdown(item: (typeof data.items)[number])}
  <ul class="text-xs text-gray-700">
    {#each item.requirements as requirement (requirement.lineId)}
      <li>
        {formatQuantity(requirement.quantity, requirement.unit)} ·
        <a href="/projects/{requirement.projectId}/lines/{requirement.lineId}" class="link">
          {requirement.projectName}{requirement.componentName ? ` · ${requirement.componentName}` : ''} ·
          {requirement.lineDescription}
        </a>
      </li>
    {/each}
  </ul>
{/snippet}

<h1 class="page-title mb-2">Shopping list</h1>
<p class="mb-4 text-sm text-gray-600">
  What to buy so that the selected projects are covered by stock and orders, committed or not.
  Stock and orders that no project holds count once, stock first. Excluding a project only hides
  its rows; its reservations and commitments stay and are not counted for other projects.
</p>

<form method="GET" class="card mb-6 space-y-3 text-sm">
  <input type="hidden" name="select" value="1" />
  {#if data.projects.length === 0}
    <p class="text-gray-600">No planned, active, or paused projects.</p>
  {/if}
  <div class="flex flex-wrap gap-3">
    {#each data.projects as project (project.id)}
      <label class="flex min-h-8 items-center gap-1.5">
        <input
          type="checkbox"
          name="project"
          value={project.id}
          checked={data.selected.includes(project.id)}
          onchange={submitForm}
        />
        {project.name} <span class="text-gray-500">({project.status})</span>
      </label>
    {/each}
  </div>
  <label class="flex items-center gap-2">
    <span>Rows</span>
    <select name="component" value={componentValue} class="input-sm" onchange={submitForm}>
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
  <noscript><button class="btn-secondary">Show</button></noscript>
</form>

{#if data.items.length === 0}
  <p class="text-gray-600">Nothing to buy. Stock and orders cover the selected projects.</p>
{/if}

{#if resolved.length > 0}
  <section class="mb-6">
    <h2 class="section-title">Parts to buy</h2>
    <table class="data-table stack-table">
      <thead>
        <tr>
          <th>Part</th>
          <th class="text-right">To buy</th>
          <th>Covered by</th>
          <th>Requirements</th>
        </tr>
      </thead>
      <tbody>
        {#each resolved as item (item.key)}
          <tr>
            <td>
              <a href="/parts/{item.partId}" class="link font-medium sm:font-normal">{item.label}</a>
              {#if item.cutPlan && item.cutPlan.pieces.length > 0}{@render cutPlan(item.cutPlan)}{/if}
            </td>
            <td data-label="To buy" class="text-right text-lg font-semibold whitespace-nowrap text-red-700">
              {formatQuantity(item.coverage.toBuy, item.unit)}
              {#if item.cutPlan}<div class="text-xs font-normal text-gray-600">stock pieces</div>{/if}
            </td>
            <td data-label="Covered by" class="whitespace-nowrap"><div>{@render coveredBy(item)}</div></td>
            <td data-label="For"><div>{@render breakdown(item)}</div></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}

{#if unresolved.length > 0}
  <section class="mb-6">
    <h2 class="section-title mb-1">Requirements without one chosen part</h2>
    <p class="mb-2 text-sm text-gray-600">
      These are not combined, because they could be different parts. Free stock and orders are not
      counted, because the part is not known. Approve one part for a row to combine it with
      identical requirements and count them.
    </p>
    <table class="data-table stack-table">
      <thead>
        <tr><th>Requirement</th><th class="text-right">To buy</th><th>Covered by</th><th>Approved parts</th><th>Row</th></tr>
      </thead>
      <tbody>
        {#each unresolved as item (item.key)}
          <tr>
            <td class="font-medium sm:font-normal">{item.label}</td>
            <td data-label="To buy" class="text-right text-lg font-semibold whitespace-nowrap text-red-700">
              {formatQuantity(item.coverage.toBuy, item.unit)}
            </td>
            <td data-label="Covered by" class="whitespace-nowrap"><div>{@render coveredBy(item)}</div></td>
            <td data-label="Approved">{item.choices.join(', ') || 'None yet'}</td>
            <td data-label="Row"><div>{@render breakdown(item)}</div></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </section>
{/if}
