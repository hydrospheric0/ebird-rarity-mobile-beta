// SW_VERSION is stamped by pushit-beta.sh on every deploy so the browser
// detects a change and re-installs, triggering the activate handler which
// clears all caches and reloads every open tab to the latest build.
const SW_VERSION = '0.7.0-beta.19'
const LEGACY_CACHE_PREFIXES = ['rarity-mobile-', 'workbox-', 'vite-']

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Clear every cache that belongs to this app.
    try {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
          .map((key) => caches.delete(key))
      )
    } catch (_) {
      // ignore cache cleanup failures
    }

    await self.clients.claim()

    // Force all open tabs to reload so they pick up the new assets.
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    await Promise.all(clients.map((client) => client.navigate(client.url).catch(() => null)))
  })())
})

self.addEventListener('fetch', () => {
  // No-op: this worker exists only to invalidate caches on each new deploy.
  // All fetches pass through to the network unchanged.
})