<script lang="ts">
  import { enhance } from '$app/forms';
  import { describeConstraint } from '#lib/projects.ts';
  import { formatQuantity } from '#lib/units.ts';
  import type { PageProps } from './$types';

  let { data, form }: PageProps = $props();

  const line = $derived(data.line);
  const STATUS_STYLES = {
    match: 'bg-green-100 text-green-800',
    unresolved: 'bg-amber-100 text-amber-800',
    conflict: 'bg-red-100 text-red-800',
  } as const;
  const STATUS_LABELS = { match: 'match', unresolved: 'needs review', conflict: 'conflict' } as const;

  const feedback = $derived.by(() => {
    if (form?.action !== 'approve') return null;
    if ('success' in form) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  });

  const STOCK_ACTIONS = ['reserve', 'release', 'pick', 'use', 'return'];
  const stockFeedback = $derived.by(() => {
    if (!form || !STOCK_ACTIONS.includes(form.action)) return null;
    if ('success' in form) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  });

  const incomingFeedback = $derived.by(() => {
    if (form?.action !== 'incoming') return null;
    if ('success' in form) return { ok: true, text: form.success };
    if ('message' in form) return { ok: false, text: form.message };
    if ('errors' in form) return { ok: false, text: Object.values(form.errors ?? {}).join('. ') };
    return null;
  });

  const coverage = $derived(data.stock.coverage);
  const lineCommitments = $derived(coverage.parts.flatMap((p) => p.commitments));
  const allocationOf = (partId: number) => coverage.parts.find((p) => p.partId === partId);
  const reservedHere = (partId: number, locationId: number) =>
    allocationOf(partId)?.reservations.find((r) => r.locationId === locationId)?.quantity ?? 0;
</script>

<svelte:head>
  <title>{line.description} · {data.project.name}</title>
</svelte:head>

{#snippet hiddenFields(partId: number)}
  <input type="hidden" name="line_id" value={line.id} />
  <input type="hidden" name="part_id" value={partId} />
  <input type="hidden" name="operation_id" value={data.operationId} />
  <input type="hidden" name="occurred_on" value={data.today} />
{/snippet}

{#snippet amountFields(part: { baseUnit: string; units: string[] }, max?: number)}
  <input
    name="amount"
    required
    inputmode="decimal"
    value={max ?? ''}
    aria-label="Quantity"
    class="w-16 rounded border border-gray-300 px-1"
  />
  <select name="unit" aria-label="Unit" class="rounded border border-gray-300 px-1">
    {#each part.units as unit (unit)}
      <option value={unit} selected={unit === part.baseUnit}>{unit}</option>
    {/each}
  </select>
{/snippet}

{#snippet amountForm(
  action: string,
  label: string,
  part: { partId: number; baseUnit: string; units: string[] },
  locationId: number,
  max?: number
)}
  <form method="POST" action="?/{action}" use:enhance class="flex items-end gap-1">
    {@render hiddenFields(part.partId)}
    <input type="hidden" name="location_id" value={locationId} />
    {@render amountFields(part, max)}
    <button class="btn-secondary">{label}</button>
  </form>
{/snippet}

<p class="mb-2 text-sm">
  <a href="/projects/{data.project.id}" class="text-blue-700 hover:underline">← {data.project.name}</a>
</p>

<div class="mb-4 flex flex-wrap items-center gap-3">
  <h1 class="text-2xl font-semibold">{line.description}</h1>
  <a href="/projects/{data.project.id}/lines/{line.id}/edit" class="btn-secondary ml-auto">Edit row</a>
</div>

<dl class="mb-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
  <dt class="text-gray-600">Quantity</dt><dd>{formatQuantity(line.quantity, line.unit)}</dd>
  <dt class="text-gray-600">Component</dt><dd>{data.component?.name ?? 'Ungrouped'}</dd>
  <dt class="text-gray-600">Reference designators</dt><dd>{line.referenceDesignators ?? '—'}</dd>
  {#if line.partId !== null}
    <dt class="text-gray-600">Exact part</dt>
    <dd><a href="/parts/{line.partId}" class="text-blue-700 hover:underline">{line.partName}</a></dd>
  {:else}
    <dt class="text-gray-600">Category</dt><dd>{line.categoryName ?? '—'}</dd>
    <dt class="text-gray-600">Identifier</dt>
    <dd>{[line.manufacturer, line.partNumber].filter(Boolean).join(' ') || '—'}</dd>
  {/if}
  <dt class="text-gray-600">Constraints</dt>
  <dd>{line.constraints.map(describeConstraint).join('; ') || '—'}</dd>
  {#if line.notes}<dt class="text-gray-600">Notes</dt><dd>{line.notes}</dd>{/if}
</dl>

{#if data.missingRequired.length > 0}
  <p class="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
    This requirement does not specify {data.missingRequired.map((m) => m.label).join(', ')}, which
    {data.missingRequired.length === 1 ? 'is' : 'are'} required for its category. No part can match
    until you <a href="/projects/{data.project.id}/lines/{line.id}/edit" class="text-blue-700 underline">add
    {data.missingRequired.length === 1 ? 'it' : 'them'}</a>.
  </p>
{/if}

{#if feedback}<p class="mb-3 {feedback.ok ? 'text-green-700' : 'text-red-700'}">{feedback.text}</p>{/if}

<section class="mb-6">
  <h2 class="mb-2 font-semibold">Approved parts</h2>
  {#if line.choices.length === 0}
    <p class="text-sm text-gray-600">None yet. Approving a part does not reserve stock.</p>
  {:else}
    <ul class="space-y-1 text-sm">
      {#each line.choices as choice (choice.id)}
        <li class="flex flex-wrap items-center gap-2">
          <a href="/parts/{choice.partId}" class="text-blue-700 hover:underline">{choice.partName}</a>
          {#if choice.substitute}<span class="rounded bg-amber-100 px-1 text-xs">substitute</span>{/if}
          {#if choice.note}<span class="text-gray-600">{choice.note}</span>{/if}
          <form method="POST" action="?/removeChoice" use:enhance>
            <input type="hidden" name="choice_id" value={choice.id} />
            <button class="text-red-700 hover:underline">Remove</button>
          </form>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="mb-6">
  <h2 class="mb-2 font-semibold">Stock for this row</h2>
  <dl class="mb-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
    <dt class="text-gray-600">Required</dt><dd>{formatQuantity(coverage.required, coverage.unit)}</dd>
    <dt class="text-gray-600">Used</dt><dd>{formatQuantity(coverage.used, coverage.unit)}</dd>
    <dt class="text-gray-600">Picked</dt><dd>{formatQuantity(coverage.picked, coverage.unit)}</dd>
    <dt class="text-gray-600">Reserved</dt><dd>{formatQuantity(coverage.reserved, coverage.unit)}</dd>
    <dt class="text-gray-600">Remaining</dt><dd>{formatQuantity(coverage.uncovered, coverage.unit)}</dd>
    <dt class="text-gray-600">Ordered (committed)</dt><dd>{formatQuantity(coverage.ordered, coverage.unit)}</dd>
    <dt class="text-gray-600">Needed, not ordered</dt>
    <dd class={coverage.neededNotOrdered > 0 ? 'font-semibold text-amber-700' : ''}>
      {formatQuantity(coverage.neededNotOrdered, coverage.unit)}
    </dd>
    {#if coverage.excess > 0}
      <dt class="text-red-700">Excess</dt>
      <dd class="text-red-700">
        {formatQuantity(coverage.excess, coverage.unit)} more than required. Return or keep it; it is not deleted.
      </dd>
    {/if}
  </dl>
  {#if stockFeedback}<p class="mb-3 {stockFeedback.ok ? 'text-green-700' : 'text-red-700'}">{stockFeedback.text}</p>{/if}

  {#if data.stock.parts.length === 0}
    <p class="text-sm text-gray-600">Approve a part to reserve stock for this row.</p>
  {/if}
  {#each data.stock.parts as part (part.partId)}
    {@const allocation = allocationOf(part.partId)}
    <article class="mb-3 rounded border p-3 text-sm">
      <h3 class="mb-2 font-semibold">
        <a href="/parts/{part.partId}" class="text-blue-700 hover:underline">{part.partName}</a>
        {#if !part.allowed}<span class="rounded bg-red-100 px-1 text-xs text-red-800">no longer approved</span>{/if}
      </h3>
      {#if part.storage.length === 0}
        <p class="mb-2 text-gray-600">No stock in storage.</p>
      {:else}
        <table class="mb-2 w-full text-left">
          <thead class="border-b text-gray-600">
            <tr>
              <th class="py-1">Location</th>
              <th class="text-right">In storage</th>
              <th class="text-right">Reserved (all)</th>
              <th class="text-right">Available</th>
              <th class="text-right">For this row</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {#each part.storage as stock (stock.locationId)}
              {@const mine = reservedHere(part.partId, stock.locationId)}
              <tr class="border-b border-gray-100 align-top">
                <td class="py-1">{stock.locationName}</td>
                <td class="text-right">{formatQuantity(stock.balance, part.baseUnit)}</td>
                <td class="text-right">{formatQuantity(stock.reserved, part.baseUnit)}</td>
                <td class="text-right">{formatQuantity(stock.available, part.baseUnit)}</td>
                <td class="text-right">{formatQuantity(mine, part.baseUnit)}</td>
                <td class="space-y-1 pl-3">
                  {#if part.allowed && !part.archived && stock.available > 0 && coverage.uncovered > 0}
                    {@render amountForm('reserve', 'Reserve', part, stock.locationId)}
                  {/if}
                  {#if mine > 0}
                    {@render amountForm('pick', 'Pick', part, stock.locationId, mine)}
                    {@render amountForm('release', 'Release', part, stock.locationId, mine)}
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if allocation && (allocation.picked > 0 || allocation.used > 0)}
        <p class="mb-1">
          Picked and held: {formatQuantity(allocation.picked, part.baseUnit)}. Used:
          {formatQuantity(allocation.used, part.baseUnit)}.
        </p>
      {/if}
      {#if allocation && allocation.picked > 0}
        <div class="flex flex-wrap gap-3">
          <form method="POST" action="?/use" use:enhance class="flex flex-wrap items-end gap-1">
            {@render hiddenFields(part.partId)}
            {@render amountFields(part, allocation.picked)}
            <input name="reason" placeholder="Note (optional)" class="rounded border border-gray-300 px-1" />
            <button class="btn-secondary">Record use</button>
          </form>
          <form method="POST" action="?/return" use:enhance class="flex flex-wrap items-end gap-1">
            {@render hiddenFields(part.partId)}
            {@render amountFields(part, allocation.picked)}
            <select name="location_id" required class="rounded border border-gray-300 px-1">
              {#each data.storageLocations as location (location.id)}
                <option value={location.id}>{location.name}</option>
              {/each}
            </select>
            <label class="flex items-center gap-1"><input type="checkbox" name="reserve_again" /> Reserve again</label>
            <button class="btn-secondary">Return</button>
          </form>
        </div>
      {/if}
    </article>
  {/each}
</section>

<section class="mb-6">
  <h2 class="mb-1 font-semibold">Incoming supply</h2>
  <p class="mb-2 text-sm text-gray-600">
    An order covers this row only after you commit part of it here. When the stock arrives, the
    committed quantity becomes a reservation.
  </p>
  {#if incomingFeedback}<p class="mb-2 {incomingFeedback.ok ? 'text-green-700' : 'text-red-700'}">{incomingFeedback.text}</p>{/if}
  {#if lineCommitments.length > 0}
    <table class="mb-3 w-full text-left text-sm">
      <thead class="border-b text-gray-600">
        <tr><th class="py-1">Order</th><th>Part</th><th>Expected</th><th class="text-right">Committed</th><th></th></tr>
      </thead>
      <tbody>
        {#each lineCommitments as commitment (commitment.id)}
          <tr class="border-b border-gray-100">
            <td class="py-1">
              <a href="/orders/{commitment.orderId}" class="text-blue-700 hover:underline">
                {commitment.supplier} {commitment.reference ?? ''}
              </a>
            </td>
            <td>{commitment.partName}</td>
            <td>{commitment.expectedOn ?? '—'}</td>
            <td class="text-right">{formatQuantity(commitment.quantity, commitment.baseUnit)}</td>
            <td class="pl-3">
              <form method="POST" action="?/releaseIncoming" use:enhance class="flex items-end gap-1">
                <input type="hidden" name="commitment_id" value={commitment.id} />
                <input
                  name="quantity"
                  required
                  inputmode="numeric"
                  value={commitment.quantity}
                  aria-label="Quantity ({commitment.baseUnit})"
                  class="w-16 rounded border border-gray-300 px-1"
                />
                <button class="btn-secondary">Release</button>
              </form>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
  {#if data.incoming.length === 0}
    <p class="text-sm text-gray-600">No placed or shipped order has outstanding supply of an approved part.</p>
  {:else}
    <table class="w-full text-left text-sm">
      <thead class="border-b text-gray-600">
        <tr>
          <th class="py-1">Order</th><th>Part</th><th>Expected</th>
          <th class="text-right">Outstanding</th><th class="text-right">Uncommitted</th><th></th>
        </tr>
      </thead>
      <tbody>
        {#each data.incoming as option (option.orderLineId)}
          <tr class="border-b border-gray-100">
            <td class="py-1">
              <a href="/orders/{option.orderId}" class="text-blue-700 hover:underline">
                {option.supplier} {option.reference ?? ''}
              </a>
              <span class="text-gray-500">{option.status}</span>
            </td>
            <td>{option.partName}</td>
            <td>{option.expectedOn ?? '—'}</td>
            <td class="text-right">{formatQuantity(option.outstanding, option.baseUnit)}</td>
            <td class="text-right">{formatQuantity(option.uncommitted, option.baseUnit)}</td>
            <td class="pl-3">
              {#if option.uncommitted > 0 && coverage.neededNotOrdered > 0}
                <form method="POST" action="?/assignIncoming" use:enhance class="flex items-end gap-1">
                  <input type="hidden" name="order_line_id" value={option.orderLineId} />
                  <input
                    name="quantity"
                    required
                    inputmode="numeric"
                    aria-label="Quantity ({option.baseUnit})"
                    class="w-16 rounded border border-gray-300 px-1"
                  />
                  <span class="text-gray-600">{option.baseUnit}</span>
                  <button class="btn-secondary">Commit</button>
                </form>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</section>

<section class="mb-6">
  <h2 class="mb-1 font-semibold">Candidates</h2>
  <p class="mb-2 text-sm text-gray-600">
    Suggestions only. A part that is not a confirmed match can be approved only as a substitute with
    a note.
  </p>
  {#if data.candidates.length === 0}
    <p class="text-sm text-gray-600">
      No candidates. Add a category, an identifier, or constraints, or approve a substitute below.
    </p>
  {/if}
  {#each data.candidates as candidate (candidate.part.id)}
    <article class="mb-3 rounded border p-3 text-sm">
      <div class="mb-1 flex flex-wrap items-center gap-2">
        <a href="/parts/{candidate.part.id}" class="font-semibold text-blue-700 hover:underline">
          {candidate.part.name}
        </a>
        <span class="rounded px-1 text-xs {STATUS_STYLES[candidate.status]}">{STATUS_LABELS[candidate.status]}</span>
        <span class="text-gray-500">found by {candidate.sourceLabel}</span>
        {#if candidate.choice}
          <span class="rounded bg-blue-100 px-1 text-xs">
            approved{candidate.choice.substitute ? ' as substitute' : ''}
          </span>
        {/if}
      </div>
      {#if candidate.choice?.note}<p class="mb-1 text-gray-600">Approval note: {candidate.choice.note}</p>{/if}
      <ul class="mb-2 list-disc pl-5">
        {#each candidate.conflicts as reason (reason)}<li class="text-red-700">{reason}</li>{/each}
        {#each candidate.unresolved as reason (reason)}<li class="text-amber-700">{reason}</li>{/each}
        {#each candidate.evidence as reason (reason)}<li class="text-gray-700">{reason}</li>{/each}
      </ul>
      {#if !candidate.choice}
        <form method="POST" action="?/approve" use:enhance class="flex flex-wrap items-end gap-2">
          <input type="hidden" name="part_id" value={candidate.part.id} />
          {#if candidate.status === 'match'}
            <label class="flex items-center gap-1">
              <input type="checkbox" name="substitute" /> Substitute
            </label>
          {:else}
            <input type="hidden" name="substitute" value="on" />
          {/if}
          <textarea
            name="note"
            rows="2"
            placeholder={candidate.status === 'match' ? 'Note (optional)' : 'Why is this substitute acceptable?'}
            required={candidate.status !== 'match'}
            class="rounded border border-gray-300 px-2 py-1"
          ></textarea>
          <button class="btn-secondary">
            {candidate.status === 'match' ? 'Approve' : 'Approve as substitute'}
          </button>
        </form>
      {/if}
    </article>
  {/each}
</section>

<form method="POST" action="?/approve" use:enhance class="max-w-xl space-y-2 rounded border p-3 text-sm">
  <h2 class="font-semibold">Approve another part as a substitute</h2>
  <input type="hidden" name="substitute" value="on" />
  <select name="part_id" required class="input">
    <option value="">Choose a part</option>
    {#each data.parts as part (part.id)}
      <option value={part.id}>{part.name} — {part.baseUnit}</option>
    {/each}
  </select>
  <textarea name="note" rows="2" required placeholder="Why is this substitute acceptable?" class="input"></textarea>
  <button class="btn-secondary">Approve substitute</button>
</form>
