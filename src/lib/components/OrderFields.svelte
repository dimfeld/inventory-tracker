<script lang="ts">
  /** Order header inputs. The parent supplies the form element and submit button. */
  let {
    order = null,
  }: {
    order?: {
      supplier: string;
      reference: string | null;
      expectedOn: string | null;
      trackingUrl: string | null;
      notes: string | null;
    } | null;
  } = $props();
</script>

<label class="block">
  <span class="text-sm">Supplier</span>
  <input name="supplier" required value={order?.supplier ?? ''} class="input" />
</label>
<label class="block">
  <span class="text-sm">Supplier order reference</span>
  <input name="reference" value={order?.reference ?? ''} class="input" />
</label>
<label class="block">
  <span class="text-sm">Expected arrival</span>
  <input name="expected_on" type="date" value={order?.expectedOn ?? ''} class="input" />
</label>
<label class="block">
  <span class="text-sm">Tracking link</span>
  <input name="tracking_url" type="url" value={order?.trackingUrl ?? ''} class="input" />
</label>
<label class="block">
  <span class="text-sm">Notes</span>
  <textarea name="notes" rows="2" class="input">{order?.notes ?? ''}</textarea>
</label>
