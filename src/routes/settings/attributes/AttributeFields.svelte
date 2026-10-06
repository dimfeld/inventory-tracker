<script lang="ts">
  import { NORMALIZATION_RULES, type NormalizationRule } from '#lib/attributes.ts';
  import type { createAttribute, updateAttribute } from '../taxonomy.remote';

  interface Props {
    fields: typeof createAttribute.fields | typeof updateAttribute.fields;
    initial?: {
      label: string;
      valueType: 'text' | 'number' | 'boolean';
      normalization: NormalizationRule | null;
      canonicalUnit: string | null;
    };
  }

  let { fields, initial }: Props = $props();
</script>

<label class="block">
  <span class="text-sm">Label</span>
  <input {...fields.label.as('text', initial?.label ?? '')} required class="input" />
</label>
<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
  <label class="block">
    <span class="text-sm">Value type</span>
    <select {...fields.valueType.as('select', initial?.valueType ?? 'text')} class="input">
      <option value="text">Text</option>
      <option value="number">Number</option>
      <option value="boolean">Yes / no</option>
    </select>
  </label>
  <label class="block">
    <span class="text-sm">Normalization rule</span>
    <select {...fields.normalization.as('select', initial?.normalization ?? '')} class="input">
      <option value="">(none: store as typed)</option>
      {#each NORMALIZATION_RULES as rule (rule)}
        <option value={rule}>{rule}</option>
      {/each}
    </select>
  </label>
  <label class="block">
    <span class="text-sm">Unit</span>
    <input {...fields.canonicalUnit.as('text', initial?.canonicalUnit ?? '')} placeholder="mm, V, ohm…" class="input" />
  </label>
</div>
<p class="hint">
  A rule reads values such as <code>4.7k</code> or <code>1/8"</code> into a typed value for filters and
  matching: <code>keyword</code> ignores case, <code>code</code> upper-cases, and the measurement rules
  read numbers with units.
</p>
