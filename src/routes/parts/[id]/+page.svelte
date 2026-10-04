<script lang="ts">
  import { enhance } from '$app/forms';
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const MOVEMENT_LABELS: Record<string, string> = {
    opening: 'Opening stock',
    transfer: 'Transfer',
    loss: 'Loss',
    supplier_return: 'Supplier return',
    count_correction: 'Count correction',
  };

  const part = $derived(data.part);
  const total = $derived(data.balances.reduce((sum, b) => sum + b.quantity, 0));
  const balanceOf = (locationId: number) =>
    data.balances.find((b) => b.locationId === locationId)?.quantity ?? 0;
  const locationLabel = (location: { id: number; name: string }) =>
    `${location.name} (${formatQuantity(balanceOf(location.id), part.baseUnit)})`;

  function feedback(action: string) {
    if (form?.action !== action) return null;
    if ('success' in form) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  }

  const stockForms = [
    { action: 'opening', title: 'Opening stock', locationLabel: 'Into location', amountLabel: 'Quantity', reason: 'optional' },
    { action: 'transfer', title: 'Transfer', locationLabel: 'From', amountLabel: 'Quantity', reason: 'optional' },
    { action: 'loss', title: 'Loss', locationLabel: 'From', amountLabel: 'Quantity', reason: 'required' },
    { action: 'supplier_return', title: 'Return to supplier', locationLabel: 'From', amountLabel: 'Quantity', reason: 'required' },
    { action: 'count', title: 'Stock count', locationLabel: 'Location', amountLabel: 'Counted quantity', reason: 'required' },
  ] as const;
</script>

<svelte:head>
  <title>{part.name}</title>
</svelte:head>

<p class="mb-2 text-sm"><a href="/parts" class="text-blue-700 hover:underline">← Parts</a></p>

<div class="mb-4 flex flex-wrap items-center gap-3">
  <h1 class="text-2xl font-semibold">{part.name}</h1>
  {#if part.archivedAt}
    <span class="rounded bg-gray-200 px-2 py-0.5 text-xs uppercase">archived</span>
  {/if}
  <a href="/parts/{part.id}/edit" class="btn-secondary ml-auto">Edit</a>
  <form method="POST" action={part.archivedAt ? '?/restore' : '?/archive'} use:enhance>
    <button class="btn-secondary">{part.archivedAt ? 'Restore' : 'Archive'}</button>
  </form>
</div>
{#if feedback('archive') ?? feedback('restore')}
  {@const fb = feedback('archive') ?? feedback('restore')}
  <p class={fb?.ok ? 'mb-3 text-green-700' : 'mb-3 text-red-700'}>{fb?.text}</p>
{/if}

<section class="mb-6 grid gap-4 sm:grid-cols-2">
  <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
    <dt class="text-gray-600">Category</dt><dd>{part.categoryName ?? '—'}</dd>
    <dt class="text-gray-600">Base unit</dt><dd>{part.baseUnit}</dd>
    <dt class="text-gray-600">Manufacturer</dt><dd>{part.manufacturer ?? '—'}</dd>
    <dt class="text-gray-600">Part number</dt><dd>{part.partNumber ?? '—'}</dd>
    <dt class="text-gray-600">Aliases</dt><dd>{data.aliases.join(', ') || '—'}</dd>
    {#each data.attributes as attribute (attribute.key)}
      <dt class="text-gray-600">{attribute.label}</dt><dd>{attribute.rawValue}</dd>
    {/each}
  </dl>
  <div class="text-sm">
    {#if data.supplierParts.length > 0}
      <h2 class="font-semibold">Supplier references</h2>
      <ul class="mb-2">
        {#each data.supplierParts as sp (sp.id)}
          <li>
            {sp.supplier}
            {#if sp.url}<a href={sp.url} class="text-blue-700 hover:underline" rel="noreferrer">{sp.sku}</a>{:else}{sp.sku}{/if}
            {#if sp.purchaseUnit || sp.packQuantity}
              <span class="text-gray-600">
                — {sp.purchaseUnit ?? 'purchase unit'}{#if sp.packQuantity} = {formatQuantity(sp.packQuantity, part.baseUnit)}{/if}
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if part.notes}
      <h2 class="font-semibold">Notes</h2>
      <p class="whitespace-pre-line">{part.notes}</p>
    {/if}
  </div>
</section>

<section class="mb-6">
  <h2 class="mb-2 text-lg font-semibold">Stock by location</h2>
  {#if data.balances.length === 0}
    <p class="text-gray-600">No stock recorded.</p>
  {:else}
    <table class="w-full max-w-md text-left text-sm">
      <tbody>
        {#each data.balances as balance (balance.locationId)}
          <tr class="border-b border-gray-100">
            <td class="py-1">{balance.locationName}</td>
            <td class="text-right">{formatQuantity(balance.quantity, part.baseUnit)}</td>
          </tr>
        {/each}
        <tr class="font-semibold">
          <td class="py-1">Total physical stock</td>
          <td class="text-right">{formatQuantity(total, part.baseUnit)}</td>
        </tr>
      </tbody>
    </table>
  {/if}
</section>

{#if !part.archivedAt}
  <section class="mb-6">
    <h2 class="mb-2 text-lg font-semibold">Change stock</h2>
    {#if data.locations.length === 0}
      <p class="text-gray-600">
        <a href="/locations" class="text-blue-700 hover:underline">Add a storage location</a> first.
      </p>
    {:else}
      <div class="grid gap-4 md:grid-cols-2">
        {#each stockForms as sf (sf.action)}
          {@const fb = feedback(sf.action)}
          <form method="POST" action="?/{sf.action}" use:enhance class="space-y-2 rounded border p-3 text-sm">
            <h3 class="font-semibold">{sf.title}</h3>
            <input type="hidden" name="operation_id" value={data.operationId} />
            <label class="block">
              {sf.locationLabel}
              <select name="location_id" required class="input">
                {#each data.locations as location (location.id)}
                  <option value={location.id}>{locationLabel(location)}</option>
                {/each}
              </select>
            </label>
            {#if sf.action === 'transfer'}
              <label class="block">
                To
                <select name="to_location_id" required class="input">
                  {#each data.locations as location (location.id)}
                    <option value={location.id}>{locationLabel(location)}</option>
                  {/each}
                </select>
              </label>
            {/if}
            <div class="flex gap-2">
              <label class="block grow">
                {sf.amountLabel}
                <input name="amount" required inputmode="decimal" class="input" />
              </label>
              <label class="block">
                Unit
                <select name="unit" class="input">
                  {#each data.units as unit (unit)}
                    <option value={unit} selected={unit === part.baseUnit}>{unit}</option>
                  {/each}
                </select>
              </label>
            </div>
            <label class="block">
              Date
              <input name="occurred_on" type="date" value={data.today} required class="input" />
            </label>
            <label class="block">
              Reason{sf.reason === 'optional' ? ' (optional)' : ''}
              <input name="reason" required={sf.reason === 'required'} class="input" />
            </label>
            {#if fb}<p class={fb.ok ? 'text-green-700' : 'text-red-700'}>{fb.text}</p>{/if}
            <button class="btn">Record</button>
          </form>
        {/each}
      </div>
    {/if}
  </section>
{/if}

<section>
  <h2 class="mb-2 text-lg font-semibold">Movement history</h2>
  {#if data.movements.length === 0}
    <p class="text-gray-600">No movements.</p>
  {:else}
    <table class="w-full text-left text-sm">
      <thead class="border-b text-gray-600">
        <tr><th class="py-1">Date</th><th>Type</th><th>From</th><th>To</th><th class="text-right">Quantity</th><th>Reason</th></tr>
      </thead>
      <tbody>
        {#each data.movements as movement (movement.id)}
          <tr class="border-b border-gray-100">
            <td class="py-1">{movement.occurredOn}</td>
            <td>{MOVEMENT_LABELS[movement.movementType] ?? movement.movementType}</td>
            <td>{movement.fromLocationName ?? 'outside'}</td>
            <td>{movement.toLocationName ?? 'outside'}</td>
            <td class="text-right">{formatQuantity(movement.quantity, part.baseUnit)}</td>
            <td class="text-gray-600">{movement.reason ?? ''}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>
