/*
 * AlRmh service worker: the app shell offline.
 *
 * Pages are fetched fresh whenever the network answers within a few seconds,
 * so a deploy reaches every phone on its next launch; the kept copy is only
 * what opens when the network does not answer. Hashed bundles, fonts and icons
 * never change under their names, so they are served from here once fetched.
 * Nothing from the API is kept: it is another origin.
 */

const SHELL = 'alrmh-shell-v1'
const STATIC = 'alrmh-static-v1'
const OFFLINE_PAGE = '/offline.html'
const STATIC_MAX = 120
const PAGE_WAIT_MS = 4000

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => Promise.all([cache.add(new Request('/', { cache: 'reload' })), cache.add(new Request(OFFLINE_PAGE, { cache: 'reload' }))]))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('alrmh-') && k !== SHELL && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function isStatic(url) {
  return url.pathname.startsWith('/_expo/static/') || url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || /\.(ttf|woff2?|png|jpg|svg|ico)$/.test(url.pathname)
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName)
  const keys = await cache.keys()
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key)
}

async function page(request) {
  const cache = await caches.open(SHELL)
  const network = fetch(request).then((res) => {
    if (res.ok) cache.put('/', res.clone())
    return res
  })
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), PAGE_WAIT_MS))
  try {
    const res = await Promise.race([network, timeout])
    if (res) return res
  } catch {}
  return (await cache.match('/')) || (await cache.match(OFFLINE_PAGE)) || network
}

async function asset(request) {
  const cache = await caches.open(STATIC)
  const hit = await cache.match(request)
  if (hit) return hit
  const res = await fetch(request)
  if (res.ok) {
    cache.put(request, res.clone())
    trim(STATIC, STATIC_MAX)
  }
  return res
}

self.addEventListener('push', (event) => {
  let d = {}
  try {
    d = event.data ? event.data.json() : {}
  } catch {}
  event.waitUntil(
    self.registration.showNotification(d.title || 'AlRmh', {
      body: d.body || '',
      tag: d.tag,
      lang: d.lang,
      dir: d.dir || 'auto',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { link: d.link || '/' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // Only screens of this app are opened.
  let url = new URL('/', self.location.origin)
  try {
    const target = new URL((event.notification.data && event.notification.data.link) || '/', self.location.origin)
    if (target.origin === self.location.origin) url = target
  } catch {}
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.location.origin))
      if (open) return open.focus().then((c) => (c && 'navigate' in c ? c.navigate(url.href) : c))
      return self.clients.openWindow(url.href)
    }),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (request.mode === 'navigate') return event.respondWith(page(request))
  if (isStatic(url)) return event.respondWith(asset(request))
})
