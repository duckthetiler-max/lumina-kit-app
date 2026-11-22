// Hand-written service worker: offline app shell, no dependencies.
const CACHE = 'lumina-kit-v2'
// Relative URLs resolve against the worker's own location, so this works at / or /lumina-kit/.
const SHELL = ['./', './index.html', './manifest.webmanifest', './pwa-192.png', './pwa-512.png']

// Precache the shell AND the script and stylesheet the page names. Those have
// hashed names this file cannot know, so read them out of the page. Without
// them, a first visit left only the HTML cached: the page loaded its script
// before this worker was in control, and the next offline open was blank.
async function precache() {
  const cache = await caches.open(CACHE)
  // ONE fetch of the page, stored under both of its addresses and parsed for
  // its assets: two fetches could straddle a deploy and pair an old page with
  // a new bundle.
  const res = await fetch('./index.html', { cache: 'no-store' })
  if (!res.ok) throw new Error('page fetch failed')
  const page = await res.clone().text()
  await cache.put('./index.html', res.clone())
  await cache.put('./', res)
  const assets = [...page.matchAll(/(?:src|href)="([^"]*assets\/[^"]+)"/g)].map((m) => m[1])
  await cache.addAll([...SHELL.filter((u) => u !== './' && u !== './index.html'), ...assets])
}

self.addEventListener('install', (e) => {
  e.waitUntil(precache().then(() => self.skipWaiting()))
})

// Drop this app's old cache versions and take control of open pages at once.
// Only names starting lumina-kit-: caches belong to the whole origin, and other
// apps (the old Lumina) are hosted on the same one.
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lumina-kit-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return

  // Navigations: network-first so a deploy is seen right away; cached shell when offline.
  // Each good page is also saved, so offline opens the build last seen online
  // and not the one from the day the app was installed. (This file's bytes do
  // not change between deploys, so install does not run again to refresh it.)
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            e.waitUntil(caches.open(CACHE).then((c) => c.put('./index.html', copy)))
          }
          return res
        })
        .catch(() => caches.match('./index.html')),
    )
    return
  }

  // Assets: stale-while-revalidate. Hashed bundles are immutable, so cache-first is fast
  // and safe; the background refresh keeps unhashed files (icons, manifest) current.
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(req)
      const network = fetch(req)
        .then((res) => {
          // Never cache errors. waitUntil keeps the worker alive for the write.
          if (res.ok) e.waitUntil(cache.put(req, res.clone()))
          return res
        })
        .catch(() => cached)
      return cached || network
    }),
  )
})
