<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { matchesSearch } from '#lib/search.ts';

  interface Props {
    /** Accessible name of the search box. */
    label: string;
    items: T[];
    /** A unique key of an item. */
    key: (item: T) => string | number;
    /** The text that the search matches, in any case. */
    text: (item: T) => string;
    /** How an item shows in the list. */
    option: Snippet<[T]>;
    onselect: (item: T) => void;
    placeholder?: string;
    disabled?: boolean;
  }

  let { label, items, key, text, option, onselect, placeholder, disabled = false }: Props = $props();

  const id = $props.id();
  let query = $state('');
  let open = $state(false);
  let active = $state(0);

  const shown = $derived(items.filter((item) => matchesSearch(text(item), query)));

  function choose(item: T) {
    open = false;
    query = '';
    onselect(item);
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        open = true;
        active = 0;
        return;
      }
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + shown.length) % Math.max(shown.length, 1);
    } else if (event.key === 'Enter') {
      // Enter in the search box chooses an item; it never submits the surrounding form.
      event.preventDefault();
      if (open && shown[active]) choose(shown[active]);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      open = false;
    }
  }
</script>

<div class="relative">
  <input
    type="text"
    role="combobox"
    aria-label={label}
    aria-expanded={open}
    aria-controls="{id}-list"
    aria-autocomplete="list"
    aria-activedescendant={open && shown[active] ? `${id}-${key(shown[active])}` : undefined}
    autocomplete="off"
    class="input"
    {placeholder}
    {disabled}
    bind:value={query}
    oninput={() => {
      open = true;
      active = 0;
    }}
    onfocus={() => (open = true)}
    onblur={() => (open = false)}
    {onkeydown}
  />
  {#if open}
    <ul
      id="{id}-list"
      role="listbox"
      aria-label={label}
      class="absolute z-10 mt-1 max-h-72 w-full overflow-y-auto rounded border border-gray-300 bg-white shadow"
    >
      {#each shown as item, index (key(item))}
        <!-- The search box keeps focus and handles the keyboard; the list only takes clicks. -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <li
          id="{id}-{key(item)}"
          role="option"
          aria-selected={index === active}
          class="cursor-pointer px-2 py-1 {index === active ? 'bg-blue-50' : ''}"
          onmousedown={(event) => event.preventDefault()}
          onmouseenter={() => (active = index)}
          onclick={() => choose(item)}
        >
          {@render option(item)}
        </li>
      {:else}
        <li role="option" aria-selected="false" aria-disabled="true" class="px-2 py-1 text-gray-500">No matches</li>
      {/each}
    </ul>
  {/if}
</div>
