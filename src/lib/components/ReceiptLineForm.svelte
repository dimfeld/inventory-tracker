<script lang="ts">
  import { enhance } from '$app/forms';
  import { describePackConversion } from '#lib/orders.ts';
  import { formatQuantity } from '#lib/units.ts';

  /** Review of one order line: usable and damaged amounts, destination, and a live preview. */
  let {
    line,
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
    };
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

  const whole = (value: string) => (/^\d+$/.test(value.trim()) ? Number(value) : null);
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
    const remainder = line.outstanding - usable - bad;
    const parts = [
      usable > 0
        ? `Adds ${formatQuantity(usable, line.baseUnit)} to ${location!.name}`
        : 'Adds no usable stock',
    ];
    if (bad > 0) parts.push(`${formatQuantity(bad, line.baseUnit)} damaged, not added`);
    if (remainder > 0) {
      parts.push(
        `${formatQuantity(remainder, line.baseUnit)} ${cancelRemainder ? 'cancelled' : 'still outstanding'}`
      );
    }
    return { ok: true, text: `${parts.join('; ')}.` };
  });
</script>

<form method="POST" action="?/receiveLine" use:enhance class="space-y-2 rounded border p-3 text-sm">
  <input type="hidden" name="operation_id" value={operationId} />
  <input type="hidden" name="received_on" value={today} />
  <input type="hidden" name="order_line_id" value={line.id} />
  <h3 class="font-semibold">{line.partName}</h3>
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
  <label class="block">
    <span>Review notes</span>
    <input name="notes" class="input" />
  </label>
  <label class="flex items-center gap-2">
    <input type="checkbox" name="cancel_remainder" bind:checked={cancelRemainder} />
    Cancel whatever is still outstanding on this line after this receipt
  </label>
  <p class={preview.ok ? 'text-gray-800' : 'text-red-700'}>{preview.text}</p>
  <button class="btn" disabled={!preview.ok}>Add to inventory</button>
</form>
