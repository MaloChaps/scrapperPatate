/* Service worker de la PWA « Le Mix » (portée : tout le site).
   Code (pages, JS, CSS) : réseau d'abord, donc toujours à jour ; la copie en cache sert hors ligne.
   Polices et images : cache d'abord (elles ne changent pas).
   Les API (Supabase, Spotify, Deezer) ne passent jamais par le cache.
   Incrémenter CACHE seulement si la liste SHELL change ou si une police / image est remplacée. */
const CACHE = 'le-mix-v15'
const SHELL = [
  './', 'js/shared.js', 'js/mix.js', 'da.css', 'mix.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
  'fonts/HWAnimoTRIAL/HWAnimoTRIAL-R500.ttf',
  'fonts/HW%20Left%20Trial/HWLeftTRIAL-Regular.ttf', 'fonts/HW%20Left%20Trial/HWLeftTRIAL-Bold.ttf',
  'fonts/Apercu-Mono/ApercuMonoProRegular.woff2', 'fonts/Apercu-Mono/ApercuMonoProMedium.woff2'
]
const CODE = /\.(html|js|css|webmanifest)$|\/$/

self.addEventListener('install', e => {
  /* cache: 'reload' : on reprend les fichiers sur le serveur, pas dans le cache HTTP du navigateur */
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()))
})

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()))
})

/* Réseau d'abord ; la réponse fraîche remplace la copie en cache (rangée sans ?paramètres) */
const networkFirst = (req, fallback) => fetch(req).then(res => {
  const url = new URL(req.url)
  if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(url.origin + url.pathname, copy)) }
  return res
}).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || (fallback && caches.match(fallback))))

/* Cache d'abord ; mis en cache au premier chargement */
const cacheFirst = req => caches.match(req).then(hit => hit || fetch(req).then(res => {
  if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)) }
  return res
}))

self.addEventListener('fetch', e => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  if (req.mode === 'navigate') return e.respondWith(networkFirst(req, './'))
  e.respondWith(CODE.test(url.pathname) ? networkFirst(req) : cacheFirst(req))
})
