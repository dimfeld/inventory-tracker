<script lang="ts">
  import { enhance } from '$app/forms';
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const base = $derived(`/projects/${data.project.id}`);
  const filters = $derived([
    { value: null, label: 'All' },
    ...data.components.map((c) => ({ value: String(c.id), label: c.name })),
    { value: 'ungrouped', label: 'Ungrouped' },
  ]);
  const activeFilter = $derived(data.filter === null ? null : String(data.filter));

  const feedback = $derived.by(() => {
    if (form?.action !== 'pick') return null;
    if ('success' in form) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  });
</script>

<svelte:head>
  <title>Pick list · {data.project.name}</title>
</svelte:head>

<a href={base} class="back-link">← {data.project.name}</a>

<h1 class="page-title mb-2">Pick list</h1>
<p class="hint mb-3">
  Reserved stock to take from storage, by location. Picking moves it to the project's holding
  location. A component filter changes only this view; it does not release any reservation.
</p>

{#if data.components.length > 0}
  <nav aria-label="Component filter" class="-mx-4 mb-4 flex gap-1 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
    {#each filters as filter (filter.value)}
      <a
        href={filter.value === null ? `${base}/pick` : `${base}/pick?component=${filter.value}`}
        aria-current={filter.value === activeFilter ? 'true' : undefined}
        class={filter.value === activeFilter ? 'pill-active' : 'pill'}
      >
        {filter.label}
      </a>
    {/each}
  </nav>
{/if}

{#if feedback}<p class="mb-3 {feedback.ok ? 'msg-ok' : 'msg-error'}">{feedback.text}</p>{/if}

{#each data.stops as stop (stop.locationId)}
  <section class="card mb-4">
    <h2 class="mb-2 text-lg font-semibold">{stop.locationName}</h2>
    <ul class="divide-y divide-gray-100 text-sm">
      {#each stop.items as item (item.reservationId)}
        <li class="flex flex-wrap items-center gap-2 py-2">
          <span class="font-semibold">{formatQuantity(item.quantity, item.baseUnit)}</span>
          <a href="/parts/{item.partId}" class="link">{item.partName}</a>
          <span class="text-gray-600">
            for <a href="{base}/lines/{item.lineId}" class="hover:underline">{item.lineDescription}</a>
            {#if data.components.length > 0}({item.componentName ?? 'Ungrouped'}){/if}
          </span>
          <form method="POST" action="?/pick" use:enhance class="ml-auto flex items-center gap-1">
            <input type="hidden" name="line_id" value={item.lineId} />
            <input type="hidden" name="part_id" value={item.partId} />
            <input type="hidden" name="location_id" value={stop.locationId} />
            <input type="hidden" name="unit" value={item.baseUnit} />
            <input type="hidden" name="operation_id" value={data.operationId} />
            <input type="hidden" name="occurred_on" value={data.today} />
            <input
              name="amount"
              required
              inputmode="decimal"
              value={item.quantity}
              aria-label="Quantity to pick"
              class="input-sm w-20"
            />
            <button class="btn-secondary">Pick</button>
          </form>
        </li>
      {/each}
    </ul>
  </section>
{:else}
  <p class="text-gray-600">Nothing reserved to pick.</p>
{/each}
