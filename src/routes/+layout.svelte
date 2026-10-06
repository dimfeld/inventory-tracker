<script lang="ts">
  import './layout.css';
  import { page } from '$app/state';
  import favicon from '#lib/assets/favicon.svg';

  let { children } = $props();

  const NAV = [
    { href: '/parts', label: 'Parts' },
    { href: '/projects', label: 'Projects' },
    { href: '/orders', label: 'Orders' },
    { href: '/shopping', label: 'Shopping' },
    { href: '/imports', label: 'Imports' },
    { href: '/locations', label: 'Locations' },
    { href: '/parts/categories', label: 'Categories' },
  ];

  /** The nav entry for the current page: the longest matching prefix. */
  const current = $derived(
    NAV.filter(
      (item) => page.url.pathname === item.href || page.url.pathname.startsWith(`${item.href}/`)
    ).sort((a, b) => b.href.length - a.href.length)[0]?.href
  );

  let search = $state<HTMLInputElement>();

  // "/" focuses the part search, unless the user is typing in a field.
  function onkeydown(event: KeyboardEvent) {
    if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable]')) return;
    event.preventDefault();
    search?.focus();
  }
</script>

<svelte:window {onkeydown} />

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

<a href="#main" class="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
  Skip to content
</a>

<header class="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
  <div class="mx-auto flex max-w-6xl items-center gap-3 px-4 pt-2 md:py-2">
    <a href="/" class="shrink-0 font-semibold">Inventory</a>
    <nav aria-label="Main" class="hidden grow gap-1 md:flex">
      {#each NAV as item (item.href)}
        <a
          href={item.href}
          aria-current={current === item.href ? 'page' : undefined}
          class="rounded-md px-2 py-1 text-sm {current === item.href
            ? 'bg-blue-50 font-medium text-blue-800'
            : 'text-gray-700 hover:bg-gray-100'}">{item.label}</a
        >
      {/each}
    </nav>
    <form method="GET" action="/parts" role="search" class="ml-auto w-full max-w-56 md:max-w-64">
      <input
        bind:this={search}
        name="q"
        type="search"
        placeholder="Search parts"
        aria-label="Search parts"
        title="Search parts (press /)"
        value={page.url.pathname === '/parts' ? (page.url.searchParams.get('q') ?? '') : ''}
        class="input mt-0"
      />
    </form>
  </div>
  <!-- On phones the nav is one row that scrolls sideways, so every page is one tap away. -->
  <nav aria-label="Main" class="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 py-2 md:hidden">
    {#each NAV as item (item.href)}
      <a
        href={item.href}
        aria-current={current === item.href ? 'page' : undefined}
        class={current === item.href ? 'pill-active' : 'pill'}>{item.label}</a
      >
    {/each}
  </nav>
</header>

<main id="main" class="mx-auto max-w-6xl px-4 py-4 sm:py-6">
  {@render children()}
</main>
