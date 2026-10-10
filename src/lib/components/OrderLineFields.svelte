<script lang="ts">
  import PartPicker from '#lib/components/PartPicker.svelte';
  import { describePackConversion } from '#lib/orders.ts';
  import { lengthInputValue, type PieceDisplayUnit } from '#lib/pieces.ts';

  /**
   * Order line inputs with a live pack conversion. A part tracked as pieces also gets the size
   * of each ordered piece. The parent supplies the form element.
   */
  let {
    parts,
    pieceParts = [],
    line = null,
  }: {
    parts: { id: number; name: string; baseUnit: string; partNumber: string | null }[];
    /** Display unit and dimensions of each part tracked as pieces. */
    pieceParts?: { id: number; displayUnit: PieceDisplayUnit; twoD: boolean }[];
    line?: {
      partId: number;
      supplierSku: string | null;
      purchaseQuantity: number;
      purchaseUnit: string;
      packQuantity: number;
      unitPrice: string | null;
      currency: string | null;
      notes: string | null;
      pieceLengthMm: number | null;
      pieceWidthMm: number | null;
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
  const pieces = $derived(pieceParts.find((p) => String(p.id) === partId));
  const sizeText = (mm: number | null | undefined) =>
    mm ? lengthInputValue(mm, pieces?.displayUnit ?? 'mm') : '';
  const conversion = $derived.by(() => {
    const purchase = Number(purchaseQuantity);
    const pack = Number(packQuantity);
    if (!baseUnit || !purchaseUnit || !Number.isInteger(purchase) || !Number.isInteger(pack)) return null;
    if (purchase <= 0 || pack <= 0) return null;
    return describePackConversion({ purchaseQuantity: purchase, purchaseUnit, packQuantity: pack, baseUnit });
  });
</script>

<div class="grid gap-2 sm:grid-cols-2">
  <div class="sm:col-span-2">
    <span class="text-sm">Part</span>
    <PartPicker {parts} bind:value={partId} />
  </div>
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
  {#if pieces}
    <input type="hidden" name="piece_unit" value={pieces.displayUnit} />
    <label class="block">
      <span class="text-sm">Piece length ({pieces.displayUnit})</span>
      <input name="piece_length" value={sizeText(line?.pieceLengthMm)} placeholder="SKU stock size" class="input" />
    </label>
    {#if pieces.twoD}
      <label class="block">
        <span class="text-sm">Piece width ({pieces.displayUnit})</span>
        <input name="piece_width" value={sizeText(line?.pieceWidthMm)} placeholder="SKU stock size" class="input" />
      </label>
    {/if}
    <p class="text-xs text-gray-600 sm:col-span-2">
      The size of each ordered piece. Leave it empty to use the stock size of the supplier SKU. For more than one
      size under one SKU, add one line for each size.
    </p>
  {/if}
  <label class="block">
    <span class="text-sm">Price per purchase unit, excl. shipping and tax (optional)</span>
    <input name="unit_price" inputmode="decimal" value={line?.unitPrice ?? ''} class="input" />
  </label>
  <label class="block">
    <span class="text-sm">Currency</span>
    <input name="currency" value={line?.currency ?? ''} placeholder="USD" class="input" />
  </label>
  <label class="block sm:col-span-2">
    <span class="text-sm">Notes</span>
    <textarea name="notes" rows="2" class="input">{line?.notes ?? ''}</textarea>
  </label>
</div>
<p class="text-sm {conversion ? 'text-gray-800' : 'text-gray-500'}">
  {conversion ? `Supplies ${conversion}` : 'Enter the part, quantity, purchase unit, and pack size to see the conversion.'}
</p>
