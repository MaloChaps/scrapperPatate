/* Service worker de la PWA « Le Mix » :
   pages en réseau d'abord (toujours à jour, version en cache hors ligne),
   polices / styles / icônes en cache d'abord. Les API (Supabase, Spotify) ne sont jamais mises en cache.
   Après une modification des fichiers listés, incrémenter CACHE. */
const CACHE = 'le-mix-v7'
const SHELL = [
  'generateur.html', 'da.css', 'mix.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'fonts/HWAnimoTRIAL/HWAnimoTRIAL-R500.ttf',
  'fonts/HW%20Left%20Trial/HWLeftTRIAL-Regular.ttf', 'fonts/HW%20Left%20Trial/HWLeftTRIAL-Bold.ttf',
  'fonts/Apercu-Mono/ApercuMonoProRegular.woff2', 'fonts/Apercu-Mono/ApercuMonoProMedium.woff2'
]

self.addEventListener('install', e => {
  /* cache: 'reload' : on reprend les fichiers sur le serveur, pas dans le cache HTTP du navigateur */
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

self.addEventListener('fetch', e => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return

  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      if (res.ok && url.pathname.endsWith('/generateur.html')) {
        const copy = res.clone()
        caches.open(CACHE).then(c => c.put('generateur.html', copy))
      }
      return res
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('generateur.html'))))
    return
  }

  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok && /\.(woff2|css|png|svg|webmanifest)$/.test(url.pathname)) {
      const copy = res.clone()
      caches.open(CACHE).then(c => c.put(req, copy))
    }
    return res
  })))
})
