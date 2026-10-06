<script lang="ts">
  import SearchSelect from '#lib/components/SearchSelect.svelte';

  /** A searchable part choice for a posted form. The chosen ID posts as a hidden `part_id` field. */
  type Part = { id: number; name: string; baseUnit: string; partNumber?: string | null };

  let {
    parts,
    value = $bindable(''),
    label = 'Search for a part',
  }: {
    parts: Part[];
    /** The chosen part ID as text, or '' for no part. */
    value?: string;
    label?: string;
  } = $props();

  const chosen = $derived(parts.find((part) => String(part.id) === value));
</script>

{#snippet partLabel(part: Part)}
  {part.name}{part.partNumber ? ` (${part.partNumber})` : ''} — {part.baseUnit}
{/snippet}

<input type="hidden" name="part_id" {value} />
<p class="text-sm">
  {#if chosen}
    {@render partLabel(chosen)}
  {:else}
    <span class="text-gray-600">No part chosen</span>
  {/if}
</p>
<SearchSelect
  {label}
  placeholder="Search {parts.length} part(s)"
  items={parts}
  key={(part) => part.id}
  text={(part) => `${part.name} ${part.partNumber ?? ''}`}
  onselect={(part) => (value = String(part.id))}
>
  {#snippet option(part)}{@render partLabel(part)}{/snippet}
</SearchSelect>
