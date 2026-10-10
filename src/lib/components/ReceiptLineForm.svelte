<script lang="ts">
  import { enhance } from '$app/forms';
  import { page } from '$app/state';
  import { assignInSequence } from '#lib/commitments.ts';
  import { describePackConversion, type DeliveryState } from '#lib/orders.ts';
  import { formatPieceSize } from '#lib/pieces.ts';
  import { formatQuantity } from '#lib/units.ts';

  /**
   * Review of one order line: usable and damaged amounts, destination, assignment of usable
   * stock to the line's project commitments, and a live preview.
   */
  let {
    line,
    commitments,
    pieces = null,
    locations,
    operationId,
    today,
  }: {
    line: {
      id: number;
      partName: string;
      baseUnit: string;
      purchaseQuantity: number;
      purchaseUnit: string;
      packQuantity: number;
      outstanding: number;
      deliveryState?: DeliveryState;
      deliveredOn?: string | null;
    };
    /** The line's commitments in sequence order. */
    commitments: { id: number; projectName: string; lineDescription: string; quantity: number }[];
    /** For a part tracked as pieces: its dimension labels and the default piece size, if any. */
    pieces?: {
      lengthLabel: string;
      widthLabel: string | null;
      stockSize: { lengthMm: number; widthMm: number | null } | null;
      sizeSource?: 'line' | 'sku' | null;
    } | null;
    locations: { id: number; name: string }[];
    operationId: string;
    today: string;
  } = $props();

  // The form owns these after the initial values.
  // svelte-ignore state_referenced_locally
  let accepted = $state(String(line.outstanding));
  let damaged = $state('0');
  // svelte-ignore state_referenced_locally
  let locationId = $state(String(locations[0]?.id ?? ''));
  let cancelRemainder = $state(false);
  let customAssignment = $state(false);
  let pieceLength = $state('');
  let pieceWidth = $state('');
  // Owner-entered quantities by commitment ID, used when the assignment is changed.
  let custom = $state<Record<number, string>>({});

  const whole = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value) : null);
  const committedTotal = $derived(commitments.reduce((sum, c) => sum + c.quantity, 0));
  const sequenceAssignment = $derived(
    new Map(assignInSequence(commitments, whole(accepted) ?? 0).map((a) => [a.commitmentId, a.quantity]))
  );
  const assignedTo = (id: number) =>
    customAssignment ? whole(custom[id] ?? '0') : (sequenceAssignment.get(id) ?? 0);

  function changeAssignment() {
    custom = Object.fromEntries(commitments.map((c) => [c.id, String(sequenceAssignment.get(c.id) ?? 0)]));
  }
  const preview = $derived.by(() => {
    const usable = whole(accepted);
    const bad = whole(damaged || '0');
    if (usable === null || bad === null) return { ok: false, text: 'Enter whole amounts.' };
    if (usable + bad === 0) return { ok: false, text: 'Enter a usable or damaged amount.' };
    if (usable + bad > line.outstanding) {
      return {
        ok: false,
        text: `Only ${formatQuantity(line.outstanding, line.baseUnit)} is outstanding. Correct the order line first if more arrived.`,
      };
    }
    const location = locations.find((l) => String(l.id) === locationId);
    if (usable > 0 && !location) return { ok: false, text: 'Choose a destination.' };
    const needsSize = pieces && !pieces.stockSize && usable > 0;
    if (needsSize && (!pieceLength.trim() || (pieces.widthLabel && !pieceWidth.trim()))) {
      return { ok: false, text: 'Enter the size of the pieces.' };
    }
    let assigned = 0;
    for (const commitment of commitments) {
      const quantity = assignedTo(commitment.id);
      if (quantity === null) return { ok: false, text: 'Enter whole assigned amounts.' };
      if (quantity > commitment.quantity) {
        return {
          ok: false,
          text: `${commitment.projectName} has only ${formatQuantity(commitment.quantity, line.baseUnit)} committed.`,
        };
      }
      assigned += quantity;
    }
    if (assigned > usable) {
      return { ok: false, text: 'You assigned more to projects than is usable.' };
    }
    const remainder = line.outstanding - usable - bad;
    const parts = [
      usable > 0
        ? `Adds ${pieces ? `${usable} piece(s)` : formatQuantity(usable, line.baseUnit)} to ${location!.name}`
        : 'Adds no usable stock',
    ];
    if (assigned > 0) parts.push(`${formatQuantity(assigned, line.baseUnit)} of it reserved for projects`);
    if (bad > 0) parts.push(`${formatQuantity(bad, line.baseUnit)} damaged, not added`);
    if (remainder > 0) {
      parts.push(
        `${formatQuantity(remainder, line.baseUnit)} ${cancelRemainder ? 'cancelled' : 'still outstanding'}`
      );
    }
    return { ok: true, text: `${parts.join('; ')}.` };
  });
</script>

<form
  id="receive-line-{line.id}"
  method="POST"
  action="?/receiveLine"
  use:enhance
  class="card space-y-2 text-sm {line.deliveryState === 'awaiting_review' ? 'border-amber-300 bg-amber-50' : ''} {page.url
    .hash === `#receive-line-${line.id}`
    ? 'ring-2 ring-blue-600'
    : ''}"
>
  <input type="hidden" name="operation_id" value={operationId} />
  <input type="hidden" name="received_on" value={today} />
  <input type="hidden" name="order_line_id" value={line.id} />
  <h3 class="font-semibold">{line.partName}</h3>
  {#if line.deliveryState === 'awaiting_review'}
    <p class="font-medium text-amber-800">Delivered {line.deliveredOn}, awaiting review.</p>
  {/if}
  <p class="text-gray-700">
    Ordered {describePackConversion(line)}. Outstanding: {formatQuantity(line.outstanding, line.baseUnit)}.
  </p>
  <div class="flex flex-wrap items-end gap-3">
    <label class="block">
      <span>Usable ({line.baseUnit})</span>
      <input name="accepted" inputmode="numeric" bind:value={accepted} class="input w-28" />
    </label>
    <label class="block">
      <span>Damaged or rejected ({line.baseUnit})</span>
      <input name="damaged" inputmode="numeric" bind:value={damaged} class="input w-28" />
    </label>
    <label class="block">
      <span>Destination</span>
      <select name="location_id" bind:value={locationId} class="input">
        {#each locations as location (location.id)}
          <option value={String(location.id)}>{location.name}</option>
        {/each}
      </select>
    </label>
  </div>
  {#if pieces}
    <div class="flex flex-wrap items-end gap-3">
      {#if pieces.stockSize}
        <p class="text-gray-700">
          Each usable unit becomes one piece of {formatPieceSize(pieces.stockSize)}, the {pieces.sizeSource === 'line'
            ? 'piece size of the order line'
            : 'stock size of the SKU'}.
          Enter another size to change it.
        </p>
      {:else}
        <p class="w-full text-gray-700">The order line has no piece size and the SKU has no stock size. Enter the size of each piece (mm, or add in).</p>
      {/if}
      <label class="block">
        <span>{pieces.lengthLabel}</span>
        <input name="piece_length" bind:value={pieceLength} placeholder={pieces.stockSize ? String(pieces.stockSize.lengthMm) : ''} class="input w-28" />
      </label>
      {#if pieces.widthLabel}
        <label class="block">
          <span>{pieces.widthLabel}</span>
          <input name="piece_width" bind:value={pieceWidth} placeholder={pieces.stockSize?.widthMm ? String(pieces.stockSize.widthMm) : ''} class="input w-28" />
        </label>
      {/if}
    </div>
  {/if}
  {#if commitments.length > 0}
    <fieldset class="overflow-x-auto rounded border border-gray-200 p-2">
      <legend class="px-1">
        Project commitments ({formatQuantity(committedTotal, line.baseUnit)} of the outstanding supply)
      </legend>
      <p class="mb-1 text-gray-600">
        Usable stock is reserved for these rows in this order. Commitments that are not filled stay on
        the outstanding supply. If supply is lost, the last commitments are reduced first.
      </p>
      <table class="mb-1 text-left">
        <thead class="text-gray-600">
          <tr><th class="pr-4">Project row</th><th class="pr-4 text-right">Committed</th><th class="text-right">Reserve now</th></tr>
        </thead>
        <tbody>
          {#each commitments as commitment (commitment.id)}
            <tr>
              <td class="pr-4">{commitment.projectName} · {commitment.lineDescription}</td>
              <td class="pr-4 text-right">{formatQuantity(commitment.quantity, line.baseUnit)}</td>
              <td class="text-right">
                {#if customAssignment}
                  <input type="hidden" name="assign_commitment" value={commitment.id} />
                  <input
                    name="assign_quantity"
                    inputmode="numeric"
                    aria-label="Reserve for {commitment.projectName}"
                    bind:value={custom[commitment.id]}
                    class="input-sm w-20 text-right"
                  />
                {:else}
                  {formatQuantity(sequenceAssignment.get(commitment.id) ?? 0, line.baseUnit)}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          name="custom_assignment"
          bind:checked={customAssignment}
          onchange={() => customAssignment && changeAssignment()}
        />
        Change the assignment
      </label>
    </fieldset>
  {/if}
  <label class="block">
    <span>Review notes</span>
    <textarea name="notes" rows="2" class="input"></textarea>
  </label>
  <label class="flex items-center gap-2">
    <input type="checkbox" name="cancel_remainder" bind:checked={cancelRemainder} />
    Cancel whatever is still outstanding on this line after this receipt
  </label>
  <p class={preview.ok ? 'text-gray-800' : 'text-red-700'}>{preview.text}</p>
  <button class="btn" disabled={!preview.ok}>Add to inventory</button>
</form>
