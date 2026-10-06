/**
 * Offline support for the installed app. The app's build and static files are cached when the
 * service worker installs and are served from the cache. Other GET requests, such as pages and
 * their data, go to the network first; the last copy is used only when the network fails, so
 * stock numbers are only out of date when there is no network. Other methods are never cached.
 */
import { version } from "$app/env";
import { assets, immutable } from "$app/manifest";
import { self } from "$app/service-worker";

const CACHE = `cache-${version}`;
// Manifest paths are relative to the base path, which is the scope of this service worker.
const ASSETS = [...immutable, ...assets].map(
  (asset) => new URL(asset.path, self.registration.scope).pathname
);

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (ASSETS.includes(url.pathname)) {
        const cached = await cache.match(url.pathname);
        if (cached) return cached;
      }
      try {
        const response = await fetch(event.request);
        if (
          response.status === 200 &&
          !response.headers.get("cache-control")?.includes("no-store")
        ) {
          void cache.put(event.request, response.clone());
        }
        return response;
      } catch (error) {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        throw error;
      }
    })()
  );
});
