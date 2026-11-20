// Hand-written service worker: offline app shell, no dependencies.
const CACHE = 'lumina-kit-v1'
// Relative URLs resolve against the worker's own location, so this works at / or /lumina-kit/.
const SHELL = ['./', './index.html', './manifest.webmanifest', './pwa-192.png', './pwa-512.png']

// Precache the shell so the app opens offline; skipWaiting so updates apply at once.
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

// Drop old cache versions and take control of open pages immediately.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return

  // Navigations: network-first so a deploy is seen right away; cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('./index.html')))
    return
  }

  // Assets: stale-while-revalidate. Hashed bundles are immutable, so cache-first is fast
  // and safe; the background refresh keeps unhashed files (icons, manifest) current.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req)
      const network = fetch(req)
        .then((res) => {
          if (res.ok) cache.put(req, res.clone()) // never cache errors
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
