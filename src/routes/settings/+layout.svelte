<script lang="ts">
  import { page } from '$app/state';

  let { children } = $props();

  const TABS = [
    { href: '/settings/categories', label: 'Categories' },
    { href: '/settings/attributes', label: 'Attributes' },
    { href: '/settings/locations', label: 'Locations' },
  ];
  const current = $derived(TABS.find((tab) => page.url.pathname.startsWith(tab.href))?.href);
</script>

<h1 class="page-title mb-2">Settings</h1>
<nav aria-label="Settings" class="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200">
  {#each TABS as tab (tab.href)}
    <a
      href={tab.href}
      aria-current={current === tab.href ? 'page' : undefined}
      class="-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap {current === tab.href
        ? 'border-blue-700 font-medium text-blue-800'
        : 'border-transparent text-gray-700 hover:text-gray-900'}">{tab.label}</a
    >
  {/each}
</nav>

{@render children()}
