# SvelteKit Guidance

- Note this project is using SvelteKit 3, which is similar to 2 in most respects. Biggest difference is that real subpath imports are
  used (e.g. #lib instead of $lib).
- Prefer async Svelte and remote functions for queries and forms instead of +server API routes. API can still be built separate for
  external clients, when needed.
