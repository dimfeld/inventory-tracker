<script lang="ts">
  import { enhance } from '$app/forms';
  import OrderFields from '#lib/components/OrderFields.svelte';
  import MoneyTotals from '#lib/components/MoneyTotals.svelte';
  import OrderLineFields from '#lib/components/OrderLineFields.svelte';
  import { formatMoney } from '#lib/money.ts';
  import { DELIVERY_LABELS, describePackConversion } from '#lib/orders.ts';
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const order = $derived(data.order);
  const outstandingLines = $derived(data.lines.filter((l) => l.outstanding > 0));
  const commitmentsByLine = $derived(Map.groupBy(data.commitments, (c) => c.orderLineId));

  function feedback(action: string) {
    if (form?.action !== action) return null;
    if ('success' in form && form.success) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  }
</script>

<svelte:head>
  <title>{order.supplier} {order.reference ?? ''} · Orders</title>
</svelte:head>

{#snippet message(action: string)}
  {@const fb = feedback(action)}
  {#if fb}<p class={fb.ok ? 'text-green-700' : 'text-red-700'}>{fb.text}</p>{/if}
{/snippet}

{#snippet stateButton(action: string, label: string, withDate = true)}
  <form method="POST" action="?/{action}" use:enhance class="flex items-end gap-1">
    {#if withDate}
      <input type="date" name="date" value={data.today} aria-label="Date" class="rounded border border-gray-300 px-1" />
    {/if}
    <button class="btn-secondary">{label}</button>
  </form>
{/snippet}

<p class="mb-2 text-sm"><a href="/orders" class="text-blue-700 hover:underline">← Orders</a></p>

<div class="mb-4 flex flex-wrap items-center gap-3">
  <h1 class="text-2xl font-semibold">{order.supplier} {order.reference ?? ''}</h1>
  <span class="rounded bg-gray-100 px-2 text-sm">{order.status}</span>
  <span class="rounded bg-gray-100 px-2 text-sm">{DELIVERY_LABELS[order.deliveryState]}</span>
  {#if order.status !== 'draft' && outstandingLines.length > 0}
    <a href="/orders/{order.id}/receive" class="btn ml-auto">Review and receive items</a>
  {/if}
</div>

{#if data.sameReference.length > 0}
  <p class="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
    Other orders from {order.supplier} have the reference {order.reference}:
    {#each data.sameReference as other, i (other.id)}{i > 0 ? ', ' : ''}<a
        href="/orders/{other.id}"
        class="text-blue-700 underline">#{other.id}</a
      >{/each}. If this is a repeat purchase, you can keep both.
  </p>
{/if}

<section class="mb-6">
  <h2 class="mb-2 font-semibold">Status</h2>
  <dl class="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
    <dt class="text-gray-600">Placed</dt><dd>{order.placedOn ?? '—'}</dd>
    <dt class="text-gray-600">Shipped</dt><dd>{order.shippedOn ?? '—'}</dd>
    <dt class="text-gray-600">Expected</dt><dd>{order.expectedOn ?? '—'}</dd>
    <dt class="text-gray-600">Delivered</dt><dd>{order.deliveredOn ?? '—'}</dd>
    <dt class="text-gray-600">Tracking</dt>
    <dd>
      {#if order.trackingUrl}
        <a href={order.trackingUrl} rel="noreferrer" target="_blank" class="text-blue-700 hover:underline">{order.trackingUrl}</a>
      {:else}—{/if}
    </dd>
  </dl>
  <div class="flex flex-wrap gap-3">
    {#if order.status === 'draft'}
      {@render stateButton('place', 'Mark placed')}
    {:else}
      {#if order.status === 'placed'}{@render stateButton('ship', 'Mark shipped')}{/if}
      {@render stateButton('deliver', 'Mark parcel delivered')}
      {#if order.deliveryState === 'awaiting_review'}{@render stateButton('finishReview', 'Finish review', false)}{/if}
    {/if}
  </div>
  {#if order.status === 'draft'}
    <p class="mt-2 text-sm text-gray-600">Draft orders are not incoming supply.</p>
  {:else if order.deliveryState === 'awaiting_review'}
    <p class="mt-2 text-sm text-gray-600">
      The parcel is delivered. Only items you accept on the review page are added to stock.
    </p>
  {/if}
  {@render message('state')}
</section>

<section class="mb-6">
  <h2 class="mb-2 font-semibold">Lines</h2>
  {@render message('line')}
  {#if data.lines.length === 0}
    <p class="text-sm text-gray-600">No lines yet.</p>
  {:else}
    <table class="mb-3 w-full text-left text-sm">
      <thead class="border-b text-gray-600">
        <tr>
          <th class="py-1">Part</th>
          <th>Purchase</th>
          <th class="text-right">Received</th>
          <th class="text-right">Damaged</th>
          <th class="text-right">Cancelled</th>
          <th class="text-right">Outstanding</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each data.lines as line (line.id)}
          <tr class="border-b border-gray-100 align-top">
            <td class="py-1">
              <a href="/parts/{line.partId}" class="text-blue-700 hover:underline">{line.partName}</a>
              {#if line.supplierSku}<div class="text-xs text-gray-600">SKU {line.supplierSku}</div>{/if}
              {#if line.cost}
                <div class="text-xs text-gray-600">
                  {line.unitPrice} {line.currency} per {line.purchaseUnit} · actual cost {formatMoney(line.cost)}
                </div>
              {:else}
                <div class="text-xs text-gray-500">No price</div>
              {/if}
              {#if line.notes}<div class="text-xs text-gray-600">{line.notes}</div>{/if}
              {#each commitmentsByLine.get(line.id) ?? [] as commitment (commitment.id)}
                <div class="text-xs">
                  Committed {formatQuantity(commitment.quantity, commitment.baseUnit)} to
                  <a href="/projects/{commitment.projectId}/lines/{commitment.bomLineId}" class="text-blue-700 hover:underline">
                    {commitment.projectName} · {commitment.lineDescription}
                  </a>
                </div>
              {/each}
            </td>
            <td>{describePackConversion(line)}</td>
            <td class="text-right">{formatQuantity(line.receivedQuantity, line.baseUnit)}</td>
            <td class="text-right">{formatQuantity(line.damagedQuantity, line.baseUnit)}</td>
            <td class="text-right">{formatQuantity(line.cancelledQuantity, line.baseUnit)}</td>
            <td class="text-right font-medium">{formatQuantity(line.outstanding, line.baseUnit)}</td>
            <td class="pl-3">
              <details>
                <summary class="cursor-pointer text-blue-700">Correct</summary>
                <form method="POST" action="?/updateLine" use:enhance class="mt-2 w-80 space-y-2">
                  <input type="hidden" name="line_id" value={line.id} />
                  <OrderLineFields parts={data.parts} {line} />
                  <button class="btn-secondary">Save correction</button>
                </form>
              </details>
              {#if line.outstanding > 0 && order.status !== 'draft'}
                <form method="POST" action="?/cancelRemainder" use:enhance>
                  <input type="hidden" name="line_id" value={line.id} />
                  <button class="text-red-700 hover:underline">Cancel outstanding</button>
                </form>
              {/if}
              {#if line.receivedQuantity + line.damagedQuantity === 0}
                <form method="POST" action="?/removeLine" use:enhance>
                  <input type="hidden" name="line_id" value={line.id} />
                  <button class="text-red-700 hover:underline">Remove</button>
                </form>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
    <p class="mb-3 text-sm">
      <span class="text-gray-600">Actual purchase cost (goods only, excludes shipping and tax):</span>
      <MoneyTotals costs={data.costs} unknownLabel="no price" />
    </p>
  {/if}

  <details class="max-w-xl rounded border p-3" open={data.lines.length === 0}>
    <summary class="cursor-pointer font-semibold">Add line</summary>
    <form method="POST" action="?/addLine" use:enhance class="mt-2 space-y-2">
      <OrderLineFields parts={data.parts} />
      {@render message('addLine')}
      <button class="btn">Add line</button>
    </form>
  </details>
</section>

<section class="mb-6">
  <h2 class="mb-2 font-semibold">Receipts</h2>
  {#if data.receipts.length === 0}
    <p class="text-sm text-gray-600">Nothing received yet.</p>
  {:else}
    <ul class="space-y-2 text-sm">
      {#each data.receipts as receipt (receipt.id)}
        <li class="rounded border p-2">
          <div class="font-medium">{receipt.receivedOn}{receipt.notes ? ` · ${receipt.notes}` : ''}</div>
          <ul>
            {#each receipt.lines as line (line.id)}
              <li>
                {line.partName}: {formatQuantity(line.acceptedQuantity, line.baseUnit)} usable{line.locationName
                  ? ` → ${line.locationName}`
                  : ''}{line.damagedQuantity > 0
                  ? `, ${formatQuantity(line.damagedQuantity, line.baseUnit)} damaged`
                  : ''}{line.notes ? ` (${line.notes})` : ''}
              </li>
            {/each}
          </ul>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<details class="max-w-md rounded border p-3">
  <summary class="cursor-pointer font-semibold">Edit order details</summary>
  <form method="POST" action="?/update" use:enhance class="mt-2 space-y-3">
    <OrderFields {order} />
    {@render message('update')}
    <button class="btn">Save order</button>
  </form>
</details>
