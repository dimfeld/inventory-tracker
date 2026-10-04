<script lang="ts">
  import './layout.css';
  import favicon from '#lib/assets/favicon.svg';

  let { children } = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

<header class="border-b border-gray-200 bg-gray-50">
  <nav class="mx-auto flex max-w-5xl gap-6 px-4 py-3">
    <a href="/" class="font-semibold">Inventory</a>
    <a href="/parts" class="text-blue-700 hover:underline">Parts</a>
    <a href="/parts/categories" class="text-blue-700 hover:underline">Categories</a>
    <a href="/locations" class="text-blue-700 hover:underline">Locations</a>
  </nav>
</header>

<main class="mx-auto max-w-5xl px-4 py-6">
  {@render children()}
</main>
