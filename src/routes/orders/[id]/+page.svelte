<script lang="ts">
  import { enhance } from '$app/forms';
  import OrderFields from '#lib/components/OrderFields.svelte';
  import MoneyTotals from '#lib/components/MoneyTotals.svelte';
  import OrderLineFields from '#lib/components/OrderLineFields.svelte';
  import { formatMoney } from '#lib/money.ts';
  import { DELIVERY_LABELS, ORDER_DELIVERY_LABELS, describePackConversion } from '#lib/orders.ts';
  import { formatSize } from '#lib/pieces.ts';
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const order = $derived(data.order);
  const outstandingLines = $derived(data.lines.filter((l) => l.outstanding > 0));
  const waitingForDelivery = $derived(outstandingLines.some((l) => l.deliveryState === 'not_delivered'));
  const canDeliver = $derived(order.status !== 'draft');

  type Line = (typeof data.lines)[number];

  function deliveryLabel(line: Line): string {
    if (line.cancelledQuantity === line.quantity) return 'Cancelled';
    if (line.deliveryState === 'not_delivered' && line.receivedQuantity + line.damagedQuantity > 0) {
      return 'Partly delivered';
    }
    return DELIVERY_LABELS[line.deliveryState];
  }

  /** Lines that can be selected to mark delivered or to receive. */
  const selectable = (line: Line) => line.outstanding > 0;
  const commitmentsByLine = $derived(Map.groupBy(data.commitments, (c) => c.orderLineId));
  const pieceCommitmentsByLine = $derived(
    Map.groupBy(data.pieceCommitments, (c) => c.orderLineId)
  );

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
  {#if fb}<p class={fb.ok ? 'msg-ok' : 'msg-error'}>{fb.text}</p>{/if}
{/snippet}

{#snippet stateButton(action: string, label: string)}
  <form method="POST" action="?/{action}" use:enhance class="flex items-center gap-1">
    <input type="date" name="date" value={data.today} aria-label="Date" class="input-sm" />
    <button class="btn-secondary">{label}</button>
  </form>
{/snippet}

<a href="/orders" class="back-link">← Orders</a>

<div class="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
  <h1 class="page-title">{order.supplier} {order.reference ?? ''}</h1>
  <span class="badge">{order.status}</span>
  <span class="badge">{ORDER_DELIVERY_LABELS[data.delivery]}</span>
  {#if order.status !== 'draft' && outstandingLines.length > 0}
    <a href="/orders/{order.id}/receive" class="btn sm:ml-auto">Review and receive items</a>
  {/if}
</div>

{#if data.sameReference.length > 0}
  <p class="notice mb-4">
    Other orders from {order.supplier} have the reference {order.reference}:
    {#each data.sameReference as other, i (other.id)}{i > 0 ? ', ' : ''}<a
        href="/orders/{other.id}"
        class="text-blue-700 underline">#{other.id}</a
      >{/each}. If this is a repeat purchase, you can keep both.
  </p>
{/if}

<section class="card mb-6">
  <h2 class="sr-only">Status</h2>
  <dl class="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
    <dt class="text-gray-600">Placed</dt><dd>{order.placedOn ?? '—'}</dd>
    <dt class="text-gray-600">Shipped</dt><dd>{order.shippedOn ?? '—'}</dd>
    <dt class="text-gray-600">Expected</dt><dd>{order.expectedOn ?? '—'}</dd>
    <dt class="text-gray-600">Tracking</dt>
    <dd>
      {#if order.trackingUrl}
        <a href={order.trackingUrl} rel="noreferrer" target="_blank" class="link break-all">{order.trackingUrl}</a>
      {:else}—{/if}
    </dd>
  </dl>
  <div class="flex flex-wrap gap-3">
    {#if order.status === 'draft'}
      {@render stateButton('place', 'Mark placed')}
    {:else if order.status === 'placed'}
      {@render stateButton('ship', 'Mark shipped')}
    {/if}
  </div>
  {#if order.status === 'draft'}
    <p class="mt-2 text-sm text-gray-600">Draft orders are not incoming supply.</p>
  {/if}
  {@render message('state')}
  <details class="mt-3 max-w-md" open={form?.action === 'update'}>
    <summary class="cursor-pointer text-sm font-semibold">Edit expected date, tracking, and other details</summary>
    <form method="POST" action="?/update" use:enhance class="mt-2 space-y-3">
      <OrderFields {order} />
      {@render message('update')}
      <button class="btn">Save order</button>
    </form>
  </details>
</section>

<section class="mb-6">
  <h2 class="section-title">Lines</h2>
  {@render message('line')}
  {#if data.lines.length === 0}
    <p class="text-sm text-gray-600">No lines yet.</p>
  {:else}
    {#if canDeliver}
      <!-- The line checkboxes belong to this form through their form attribute. -->
      <form id="delivery" method="POST" action="?/deliverLines" use:enhance class="card mb-2 flex flex-wrap items-center gap-2 text-sm">
        <input type="hidden" name="operation_id" value={data.operationId} />
        <input type="date" name="date" value={data.today} aria-label="Delivery date" class="input-sm" />
        <button class="btn-secondary">Mark selected delivered</button>
        {#if waitingForDelivery}
          <button class="btn-secondary" formaction="?/deliverOutstanding">Mark all outstanding delivered</button>
        {/if}
        {#if outstandingLines.length > 0 && data.storageLocations.length > 0}
          <span class="flex flex-wrap items-center gap-1 sm:ml-2">
            <select name="location_id" aria-label="Destination" class="input-sm">
              {#each data.storageLocations as location (location.id)}
                <option value={String(location.id)}>{location.name}</option>
              {/each}
            </select>
            <button class="btn-secondary" formaction="?/receiveSelected">Receive selected</button>
          </span>
        {/if}
      </form>
      <p class="hint mb-2">
        Select lines with their checkboxes. Marking lines delivered does not add stock. Receive selected adds the full outstanding quantity of each
        selected line to the destination as usable stock, which also counts as its delivery and review. To record
        damaged items, use Review and receive items.
      </p>
      {@render message('delivery')}
    {/if}
    <table class="data-table stack-table mb-3">
      <thead>
        <tr>
          <th>Part</th>
          <th>Purchase</th>
          <th class="text-right">Received</th>
          <th class="text-right">Damaged</th>
          <th class="text-right">Cancelled</th>
          <th class="text-right">Outstanding</th>
          <th class="pl-3">Delivery</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {#each data.lines as line (line.id)}
          <tr>
            <td>
              <div class="flex items-start gap-2">
                {#if canDeliver && selectable(line)}
                  <input
                    type="checkbox"
                    form="delivery"
                    name="line_id"
                    value={line.id}
                    aria-label="Select {line.partName}"
                    class="mt-1 size-4 shrink-0"
                  />
                {/if}
                <div>
              <a href="/parts/{line.partId}" class="link font-medium sm:font-normal">{line.partName}</a>
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
                  <a href="/projects/{commitment.projectId}/lines/{commitment.bomLineId}" class="link">
                    {commitment.projectName} · {commitment.lineDescription}
                  </a>
                </div>
              {/each}
              {#each pieceCommitmentsByLine.get(line.id) ?? [] as commitment (commitment.id)}
                <div class="text-xs">
                  Piece #{commitment.stickIndex + 1}: {formatSize(commitment, commitment.displayUnit)} committed to
                  <a href="/projects/{commitment.projectId}/lines/{commitment.bomLineId}" class="link">
                    {commitment.projectName} · {commitment.lineDescription}
                  </a>
                </div>
              {/each}
                </div>
              </div>
            </td>
            <td data-label="Purchase">{describePackConversion(line)}</td>
            <td data-label="Received" class="text-right">{formatQuantity(line.receivedQuantity, line.baseUnit)}</td>
            <td data-label="Damaged" class="text-right">{formatQuantity(line.damagedQuantity, line.baseUnit)}</td>
            <td data-label="Cancelled" class="text-right">{formatQuantity(line.cancelledQuantity, line.baseUnit)}</td>
            <td data-label="Outstanding" class="text-right font-medium">{formatQuantity(line.outstanding, line.baseUnit)}</td>
            <td data-label="Delivery"><div>
              <span class={line.deliveryState === 'awaiting_review' ? 'rounded bg-amber-100 px-1' : ''}>
                {deliveryLabel(line)}
              </span>
              {#if line.deliveredOn}
                <div class="text-xs text-gray-600">
                  {line.deliveryState === 'not_delivered' ? 'Last delivery' : 'Delivered'} {line.deliveredOn}
                </div>
              {/if}
            </div></td>
            <td class="space-y-1 pt-2 sm:pt-1.5">
              <details>
                <summary class="link cursor-pointer">Correct</summary>
                <form method="POST" action="?/updateLine" use:enhance class="mt-2 w-full space-y-2 sm:w-80">
                  <input type="hidden" name="line_id" value={line.id} />
                  <OrderLineFields parts={data.parts} {line} />
                  <button class="btn-secondary">Save correction</button>
                </form>
              </details>
              {#if line.outstanding > 0 && order.status !== 'draft'}
                <form
                  method="POST"
                  action="?/cancelRemainder"
                  use:enhance={({ cancel }) => {
                    if (!confirm(`Cancel the outstanding quantity of ${line.partName}?`)) cancel();
                  }}
                >
                  <input type="hidden" name="line_id" value={line.id} />
                  <button class="link-danger">Cancel outstanding</button>
                </form>
              {/if}
              {#if line.receivedQuantity + line.damagedQuantity === 0}
                <form
                  method="POST"
                  action="?/removeLine"
                  use:enhance={({ cancel }) => {
                    if (!confirm(`Remove the line for ${line.partName}?`)) cancel();
                  }}
                >
                  <input type="hidden" name="line_id" value={line.id} />
                  <button class="link-danger">Remove</button>
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

  <details class="card max-w-xl" open={data.lines.length === 0 || form?.action === 'addLine'}>
    <summary class="cursor-pointer font-semibold">Add line</summary>
    <form method="POST" action="?/addLine" use:enhance class="mt-2 space-y-2">
      <OrderLineFields parts={data.parts} />
      {@render message('addLine')}
      <button class="btn">Add line</button>
    </form>
  </details>
</section>

<section class="mb-6">
  <h2 class="section-title">Receipts</h2>
  {#if data.receipts.length === 0}
    <p class="text-sm text-gray-600">Nothing received yet.</p>
  {:else}
    <ul class="space-y-2 text-sm">
      {#each data.receipts as receipt (receipt.id)}
        <li class="card">
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
