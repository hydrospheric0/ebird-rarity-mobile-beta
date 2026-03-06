const LEGACY_CACHE_PREFIXES = ['rarity-mobile-', 'workbox-', 'vite-']

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
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

    const registrations = await self.registration.unregister().catch(() => [])
    await self.clients.claim()

    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    await Promise.all(clients.map((client) => client.navigate(client.url).catch(() => null)))
    return registrations
  })())
})

self.addEventListener('fetch', () => {
  // No-op: this worker exists only to clean up legacy registrations/caches.
})