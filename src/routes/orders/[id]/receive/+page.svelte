<script lang="ts">
  import { enhance } from '$app/forms';
  import ReceiptLineForm from '#lib/components/ReceiptLineForm.svelte';
  import { describePackConversion } from '#lib/orders.ts';
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const order = $derived(data.order);
  // svelte-ignore state_referenced_locally
  let allLocationId = $state(String(data.storageLocations[0]?.id ?? ''));
  const allLocation = $derived(data.storageLocations.find((l) => String(l.id) === allLocationId));

  const feedback = $derived.by(() => {
    if (form?.action !== 'receive') return null;
    if ('success' in form && form.success) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  });
</script>

<svelte:head>
  <title>Receive · {order.supplier} {order.reference ?? ''}</title>
</svelte:head>

<p class="mb-2 text-sm">
  <a href="/orders/{order.id}" class="text-blue-700 hover:underline">← {order.supplier} {order.reference ?? ''}</a>
</p>
<h1 class="mb-2 text-2xl font-semibold">Review and receive items</h1>
<p class="mb-4 text-sm text-gray-600">
  Only accepted usable quantities are added to stock. Damaged items are recorded but not added.
</p>

{#if feedback}<p class="mb-4 {feedback.ok ? 'text-green-700' : 'text-red-700'}">{feedback.text}</p>{/if}

{#if order.status === 'draft'}
  <p class="text-gray-600">Place the order before you receive it.</p>
{:else if data.lines.length === 0}
  <p class="text-gray-600">Nothing is outstanding on this order.</p>
{:else if data.storageLocations.length === 0}
  <p class="text-gray-600">
    <a href="/locations" class="text-blue-700 underline">Create a storage location</a> to receive items into.
  </p>
{:else}
  {#key data.operationId}
    <section class="mb-6 rounded border border-blue-200 bg-blue-50 p-3 text-sm">
      <h2 class="mb-2 font-semibold">Receive all outstanding items</h2>
      <form method="POST" action="?/receiveAll" use:enhance class="space-y-2">
        <input type="hidden" name="operation_id" value={data.operationId} />
        <input type="hidden" name="received_on" value={data.today} />
        <label class="block max-w-xs">
          <span>Destination</span>
          <select name="location_id" bind:value={allLocationId} class="input">
            {#each data.storageLocations as location (location.id)}
              <option value={String(location.id)}>{location.name}</option>
            {/each}
          </select>
        </label>
        <ul class="list-inside list-disc">
          {#each data.lines as line (line.id)}
            <li>
              {line.partName}: {formatQuantity(line.outstanding, line.baseUnit)} → {allLocation?.name}
              <span class="text-gray-600">(ordered {describePackConversion(line)})</span>
            </li>
          {/each}
        </ul>
        <label class="block">
          <span>Receipt notes</span>
          <input name="notes" class="input" />
        </label>
        <button class="btn">Receive all outstanding</button>
      </form>
    </section>

    <h2 class="mb-2 font-semibold">Review each line</h2>
    <div class="space-y-3">
      {#each data.lines as line (line.id)}
        <ReceiptLineForm {line} locations={data.storageLocations} operationId={data.operationId} today={data.today} />
      {/each}
    </div>
  {/key}
{/if}
