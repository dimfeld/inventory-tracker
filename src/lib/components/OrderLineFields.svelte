<script lang="ts">
  import { describePackConversion } from '#lib/orders.ts';

  /** Order line inputs with a live pack conversion. The parent supplies the form element. */
  let {
    parts,
    line = null,
  }: {
    parts: { id: number; name: string; baseUnit: string }[];
    line?: {
      partId: number;
      supplierSku: string | null;
      purchaseQuantity: number;
      purchaseUnit: string;
      packQuantity: number;
      unitPrice: string | null;
      currency: string | null;
      notes: string | null;
    } | null;
  } = $props();

  // The form owns these after the initial values.
  // svelte-ignore state_referenced_locally
  let partId = $state(String(line?.partId ?? ''));
  // svelte-ignore state_referenced_locally
  let purchaseQuantity = $state(String(line?.purchaseQuantity ?? '1'));
  // svelte-ignore state_referenced_locally
  let purchaseUnit = $state(line?.purchaseUnit ?? '');
  // svelte-ignore state_referenced_locally
  let packQuantity = $state(String(line?.packQuantity ?? ''));

  const baseUnit = $derived(parts.find((p) => String(p.id) === partId)?.baseUnit);
  const conversion = $derived.by(() => {
    const purchase = Number(purchaseQuantity);
    const pack = Number(packQuantity);
    if (!baseUnit || !purchaseUnit || !Number.isInteger(purchase) || !Number.isInteger(pack)) return null;
    if (purchase <= 0 || pack <= 0) return null;
    return describePackConversion({ purchaseQuantity: purchase, purchaseUnit, packQuantity: pack, baseUnit });
  });
</script>

<div class="grid gap-2 sm:grid-cols-2">
  <label class="block sm:col-span-2">
    <span class="text-sm">Part</span>
    <select name="part_id" required bind:value={partId} class="input">
      <option value="">Choose a part</option>
      {#each parts as part (part.id)}
        <option value={String(part.id)}>{part.name} ({part.baseUnit})</option>
      {/each}
    </select>
  </label>
  <label class="block">
    <span class="text-sm">Quantity ordered</span>
    <input name="purchase_quantity" required inputmode="numeric" bind:value={purchaseQuantity} class="input" />
  </label>
  <label class="block">
    <span class="text-sm">Purchase unit (pack, each, reel…)</span>
    <input name="purchase_unit" required bind:value={purchaseUnit} class="input" />
  </label>
  <label class="block">
    <span class="text-sm">{baseUnit ?? 'Base units'} per purchase unit</span>
    <input name="pack_quantity" required inputmode="numeric" bind:value={packQuantity} class="input" />
  </label>
  <label class="block">
    <span class="text-sm">Supplier SKU</span>
    <input name="supplier_sku" value={line?.supplierSku ?? ''} class="input" />
  </label>
  <label class="block">
    <span class="text-sm">Price per purchase unit (optional)</span>
    <input name="unit_price" inputmode="decimal" value={line?.unitPrice ?? ''} class="input" />
  </label>
  <label class="block">
    <span class="text-sm">Currency</span>
    <input name="currency" value={line?.currency ?? ''} placeholder="USD" class="input" />
  </label>
  <label class="block sm:col-span-2">
    <span class="text-sm">Notes</span>
    <input name="notes" value={line?.notes ?? ''} class="input" />
  </label>
</div>
<p class="text-sm {conversion ? 'text-gray-800' : 'text-gray-500'}">
  {conversion ? `Supplies ${conversion}` : 'Enter the part, quantity, purchase unit, and pack size to see the conversion.'}
</p>
