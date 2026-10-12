/* La Radio : titre en cours, historique des titres passés, player, cœur → Titres likés Spotify.
   Réglages et fonctions communes : js/shared.js.
   Côté serveur (Supabase) : la Edge Function poll-radio note chaque titre dans `plays` toutes les minutes
   et remplit `track_info` (pochettes) ; cette page ne fait que lire. */

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

const RADIO_API  = 'https://api.radioking.io/widget/radio/radio-jockey/track/current'
const STREAM_URL = 'https://www.radioking.com/play/radio-jockey'
const POLL_MS    = 20000
const PAGE_SIZE  = 300   // titres affichés par page (l'historique grossit d'environ 300 titres par jour)

let tracks   = []    // titres chargés, du plus récent au plus ancien : { id, title, artist, at }
let total    = 0     // nombre de titres dans tout l'historique
let nowTrack = null  // titre en cours : { title, artist }
const art    = new Map()  // trackKey → URL de pochette (table track_info)

const trackKey = t => `${norm(t.artist)}|${norm(t.title)}`

function setStatus(msg, isErr) {
  el('status').textContent = msg || ''
  el('status').classList.toggle('err', !!isErr)
}

/* ── Icônes ─────────────────────────────────────────────────── */
const ICON = {
  play:    '<path d="M7 4.5v15l13-7.5z"/>',
  pause:   '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
  volHigh: '<path d="M3 9v6h4l5 4V5L7 9z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  volLow:  '<path d="M3 9v6h4l5 4V5L7 9z"/><path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  volMute: '<path d="M3 9v6h4l5 4V5L7 9z"/><path d="M16 9l6 6M22 9l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  heart:   '<path d="M12 20.5l-1.3-1.2C5.6 14.7 2.5 11.9 2.5 8.4 2.5 5.6 4.7 3.5 7.4 3.5c1.8 0 3.5.9 4.6 2.3 1.1-1.4 2.8-2.3 4.6-2.3 2.7 0 4.9 2.1 4.9 4.9 0 3.5-3.1 6.3-8.2 10.9L12 20.5z"/>'
}
const icon = name => `<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICON[name]}</svg>`

/* Liens de recherche Spotify / YouTube / Deezer, avec logo */
const DEEZER_BARS = [0, 1, 2, 3, 4].flatMap(col =>  // égaliseur : 1 à 5 barres par colonne
  Array.from({ length: col + 1 }, (_, row) => `<rect x="${col * 5}" y="${18 - row * 4}" width="4" height="3"/>`)).join('')
const SERVICES = [
  ['sp', 'Spotify', 'https://open.spotify.com/search/', '<path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.52 17.34c-.24.36-.66.48-1.02.24-2.82-1.74-6.36-2.1-10.56-1.14-.42.12-.78-.18-.9-.54-.12-.42.18-.78.54-.9 4.56-1.02 8.52-.6 11.64 1.32.42.18.48.66.3 1.02zm1.44-3.3c-.3.42-.84.6-1.26.3-3.24-1.98-8.16-2.58-11.94-1.38-.48.12-1.02-.12-1.14-.6-.12-.48.12-1.02.6-1.14C9.6 9.9 15 10.56 18.72 12.84c.36.18.54.78.24 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.3c-.6.18-1.2-.18-1.38-.72-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.62.54.3.72 1.02.42 1.56-.3.42-1.02.6-1.56.3z"/>'],
  ['yt', 'YouTube', 'https://www.youtube.com/results?search_query=', '<path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3.02 3.02 0 0 0 2.12 2.14c1.87.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81zM9.55 15.57V8.43L15.82 12l-6.27 3.57z"/>'],
  ['dz', 'Deezer', 'https://www.deezer.com/search/', DEEZER_BARS]
]
const query = t => encodeURIComponent(`${t.artist || ''} ${t.title || ''}`.trim())
const serviceLinks = t => SERVICES.map(([cls, name, base, path]) =>
  `<a class="svc ${cls}" href="${base}${query(t)}" target="_blank" rel="noopener" title="Chercher sur ${name}" aria-label="Chercher sur ${name}"><svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg><span>${name}</span></a>`).join('')

/* Actions d'un titre : cœur + liens. ref = index dans `tracks`, ou 'now' pour le titre en cours */
const trackActions = (t, ref) => heartButton(t, ref) + serviceLinks(t)

/* ── Titre en cours (API RadioKing) ─────────────────────────── */
let isPolling = false
async function poll() {
  if (isPolling) return
  isPolling = true
  try {
    const res = await fetch(RADIO_API, { cache: 'no-store' })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const d = await res.json()
    const title  = String(d.title  || d.song    || '').trim()
    const artist = String(d.artist || d.artists || '').trim()
    if (!title) return setStatus("Pas de titre lisible pour l'instant…")

    nowTrack = { title, artist }
    el('nowTitle').textContent  = title
    el('nowArtist').textContent = artist
    el('nowLinks').innerHTML    = trackActions(nowTrack, 'now')
    el('nowLinks').hidden = false

    const cover = String(d.cover || d.cover_url || '').trim()
    if (cover) el('nowCover').src = cover
    el('vinyl').classList.toggle('has-cover', !!cover)
  } catch (e) {
    setStatus(`Titre en cours indisponible (${e.message}). Nouvel essai dans 20 s.`, true)
  } finally {
    isPolling = false
  }
}

/* ── Historique (Supabase) ──────────────────────────────────── */
const rowToTrack = r => ({ id: r.id, title: r.title, artist: r.artist, at: new Date(r.played_at).getTime() })

/* Supabase renvoie au plus 1000 lignes par requête : on pagine */
async function fetchAll(table, columns, order) {
  const PAGE = 1000, rows = []
  for (let from = 0; ; from += PAGE) {
    let req = sb.from(table).select(columns)
    for (const col of order) req = req.order(col, { ascending: false })
    const { data, error } = await req.range(from, from + PAGE - 1)
    if (error) throw error
    rows.push(...data)
    if (data.length < PAGE) return rows
  }
}

async function loadArt() {
  try {
    for (const r of await fetchAll('track_info', 'artist, title, art', ['key'])) if (r.art) art.set(trackKey(r), r.art)
  } catch {}  // sans pochettes, la liste reste utilisable
}

/* Les PAGE_SIZE titres suivants (more) ou les plus récents */
async function loadTracks(more = false) {
  const from = more ? tracks.length : 0
  const { data, count, error } = await sb.from('plays')
    .select('id, title, artist, played_at', { count: 'exact' })
    .order('played_at', { ascending: false }).order('id', { ascending: false })
    .range(from, from + PAGE_SIZE - 1)
  if (error) return setStatus("Impossible de charger l'historique.", true)
  tracks = more ? tracks.concat(data.map(rowToTrack)) : data.map(rowToTrack)
  total = count ?? tracks.length
  render()
}

/* Tout l'historique, du plus ancien au plus récent (copie, .csv) */
const allTracks = async () => (await fetchAll('plays', 'id, title, artist, played_at', ['played_at', 'id'])).map(rowToTrack).reverse()

/* Pochette d'un titre qui vient de passer : le serveur la cherche juste après l'avoir noté */
async function fetchArt(t, retries = 2) {
  await sleep(15000)
  const { data } = await sb.from('track_info').select('art').eq('artist', t.artist).eq('title', t.title).maybeSingle()
  if (data?.art) { art.set(trackKey(t), data.art); render() }
  else if (retries) fetchArt(t, retries - 1)
}

/* Nouveaux titres en direct */
sb.channel('plays-live')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'plays' }, ({ new: r }) => {
    if (tracks.some(t => t.id === r.id)) return
    const t = rowToTrack(r)
    tracks.unshift(t)
    total++
    render()
    if (!art.has(trackKey(t))) fetchArt(t)
  })
  .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'plays' }, ({ old: r }) => {
    total--
    tracks = tracks.filter(t => t.id !== r.id)
    render()
  })
  .subscribe()

const hourKey = at => { const d = new Date(at); return `${d.toDateString()} ${d.getHours()}` }
function hourLabel(at) {
  const d = new Date(at)
  const day = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${day} · ${String(d.getHours()).padStart(2, '0')}h`
}

function render() {
  el('countNum').textContent = total
  if (!tracks.length) {
    el('list').innerHTML = '<div class="empty"><b>Rien encore.</b><br>Les titres apparaissent ici dès qu\'ils passent à l\'antenne.</div>'
    return
  }
  let lastHour = null, html = ''
  tracks.forEach((t, i) => {
    if (hourKey(t.at) !== lastHour) {
      lastHour = hourKey(t.at)
      html += `<div class="hour-sep"><span class="hour-label">${hourLabel(t.at)}</span><span class="hour-line"></span></div>`
    }
    const cover = art.get(trackKey(t))
    html += `<div class="row">
      ${cover ? `<img class="thumb" src="${esc(cover)}" alt="" loading="lazy">` : '<div class="thumb"></div>'}
      <div class="idx">${total - i}</div>
      <div class="info">
        <div class="t">${esc(t.title)}</div>
        <div class="a">${esc(t.artist) || '&nbsp;'}</div>
      </div>
      <div class="time">${new Date(t.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
      <div class="links">${trackActions(t, i)}</div>
    </div>`
  })
  if (tracks.length < total) html += `<button class="btn-ghost more" type="button" id="moreBtn">Voir plus · ${total - tracks.length} titres plus anciens</button>`
  el('list').innerHTML = html
}

/* ── Player ─────────────────────────────────────────────────── */
const audio = el('radioAudio')
let playing = false       // lecture voulue par l'utilisateur (sinon une coupure réseau relance la lecture)
let reconnectTimer = null
let prevVol = 1

function scheduleReconnect() {
  clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => {
    if (!playing) return
    setStatus('Reconnexion…')
    audio.src = STREAM_URL
    audio.play().then(() => setStatus('')).catch(scheduleReconnect)
  }, 3000)
}
audio.addEventListener('play',    () => el('vinyl').classList.add('spinning'))
audio.addEventListener('pause',   () => el('vinyl').classList.remove('spinning'))
for (const ev of ['error', 'stalled', 'ended']) audio.addEventListener(ev, () => playing && scheduleReconnect())

el('radioPlayBtn').onclick = () => {
  playing = !playing
  clearTimeout(reconnectTimer)
  if (playing) {
    audio.src = STREAM_URL
    audio.play().catch(scheduleReconnect)
  } else {
    audio.pause()
    audio.removeAttribute('src')  // coupe le flux (sinon il continue de se télécharger)
    setStatus('')
  }
  el('radioPlayBtn').innerHTML = playing ? `${icon('pause')} Pause` : `${icon('play')} Écouter`
  el('radioPlayBtn').classList.toggle('live', playing)
}

function setVol(v) {
  audio.volume = v
  el('volSlider').value = v
  el('volSlider').style.setProperty('--vol', `${v * 100}%`)
  el('volIcon').innerHTML = icon(v === 0 ? 'volMute' : v < 0.4 ? 'volLow' : 'volHigh')
}
el('volSlider').oninput = e => { const v = +e.target.value; if (v) prevVol = v; setVol(v) }
el('volIcon').onclick = () => {
  if (audio.volume > 0) { prevVol = audio.volume; setVol(0) }
  else setVol(prevVol)
}

/* ── Spotify : cœur → Titres likés ──────────────────────────── */
/* Connexion dans une fenêtre à part : la page reste ouverte et la radio continue de jouer.
   Le jeton est partagé avec Le Mix (localStorage). */

/* Clé tolérante (premier artiste, titre sans « feat. » ni « Remastered ») pour rapprocher radio et Spotify */
const likeKey = t => `${loose(firstArtist(t.artist))}|${loose(cleanTitle(t.title) || t.title)}`
let liked = new Map(Object.entries(lsGet('sp_liked_v2', {})))  // likeKey → URI : tes Titres likés
const foundUris = lsGet('sp_uri_v2', {})                       // likeKey → URI trouvée, '' = introuvable
let pendingLike = null  // titre cliqué avant d'être connecté : liké dès la connexion

const heartButton = (t, ref) => {
  const key = likeKey(t)
  return `<button class="heart${foundUris[key] === '' ? ' none' : ''}" type="button" data-like="${ref}" data-key="${esc(key)}" aria-pressed="${liked.has(key)}" title="Titres likés Spotify" aria-label="Titres likés Spotify">${icon('heart')}</button>`
}
/* Met tous les cœurs à jour ; key + state pour un seul titre ('wait' pendant l'appel, 'none' si introuvable) */
function syncHearts(key, state) {
  for (const b of document.querySelectorAll('.heart')) {
    if (key && b.dataset.key !== key) continue
    if (key) {
      b.classList.toggle('wait', state === 'wait')
      b.classList.toggle('none', state === 'none')
    }
    b.setAttribute('aria-pressed', liked.has(b.dataset.key))
  }
}

/* La fenêtre doit s'ouvrir pendant le clic (sinon bloquée) ; son adresse arrive après le calcul PKCE.
   Fenêtre bloquée : connexion dans la page (la radio s'arrête), le titre est liké au retour. */
async function spLogin(pending) {
  pendingLike = pending || null
  const popup = window.open('', 'spotify-login', 'width=480,height=720')
  const url = await spAuthUrl('like')
  if (popup) return void (popup.location = url)
  if (pending) lsSet('sp_like_pending', { title: pending.title, artist: pending.artist })
  location = url
}
/* La fenêtre de connexion écrit le jeton dans localStorage : cette page le voit passer */
window.addEventListener('storage', e => {
  if (e.key !== 'sp_scope' || !spReady()) return
  setStatus('Connecté à Spotify ✓')
  if (pendingLike) toggleLike(pendingLike)
  pendingLike = null
  loadLiked()
})

/* Tes Titres likés : tous au chargement, puis seulement les plus récents (toutes les 2 min et au retour sur l'onglet) */
async function loadLiked(full = true) {
  if (!spReady()) return
  try {
    const first = await spFetch('/me/tracks?limit=50')
    const pages = [first]
    if (full) {
      const offsets = []
      for (let o = 50; o < first.total; o += 50) offsets.push(o)
      for (let i = 0; i < offsets.length; i += 5)  // 5 pages à la fois
        pages.push(...await Promise.all(offsets.slice(i, i + 5).map(o => spFetch(`/me/tracks?limit=50&offset=${o}`))))
    }
    const map = full ? new Map() : liked
    for (const page of pages) for (const it of page.items || []) {
      const tr = it.track ?? it.item
      if (!tr?.uri) continue
      for (const a of tr.artists || []) map.set(likeKey({ artist: a.name, title: tr.name }), tr.uri)
    }
    liked = map
    lsSet('sp_liked_v2', Object.fromEntries(liked))
    syncHearts()
  } catch {}  // hors ligne ou jeton expiré : on garde les cœurs connus
}
const refreshLiked = () => document.visibilityState === 'visible' && loadLiked(false)
setInterval(refreshLiked, 2 * 60 * 1000)
document.addEventListener('visibilitychange', refreshLiked)

async function toggleLike(t) {
  if (!t?.title) return
  if (!spReady()) return spLogin(t)
  const key = likeKey(t)
  syncHearts(key, 'wait')
  try {
    let uri = liked.get(key) || foundUris[key]
    if (!uri) {
      uri = foundUris[key] = (await spFindUri(t)) || ''
      lsSet('sp_uri_v2', foundUris)
    }
    if (!uri) {
      syncHearts(key, 'none')
      return setStatus(`Pas trouvé sur Spotify : ${t.artist} – ${t.title}`, true)
    }
    const wasLiked = liked.has(key)
    await spFetch(`/me/library?uris=${encodeURIComponent(uri)}`, { method: wasLiked ? 'DELETE' : 'PUT' })
    if (wasLiked) { for (const [k, u] of liked) if (u === uri) liked.delete(k) }
    else liked.set(key, uri)
    lsSet('sp_liked_v2', Object.fromEntries(liked))
    syncHearts(key)
    setStatus(wasLiked ? 'Retiré de tes Titres likés' : 'Ajouté à tes Titres likés ♥')
  } catch (e) {
    syncHearts(key)
    if (!spToken()) return spLogin(t)  // jeton expiré ou révoqué
    setStatus(`Spotify refuse (${e.message}).`, true)
  }
}

const trackFromRef = ref => ref === 'now' ? nowTrack : tracks[+ref]
document.addEventListener('click', e => {
  const heart = e.target.closest('.heart')
  if (heart) toggleLike(trackFromRef(heart.dataset.like))
  if (e.target.closest('#moreBtn')) loadTracks(true)
})

/* ── Export ─────────────────────────────────────────────────── */
el('refreshBtn').onclick = () => poll()

el('copyBtn').onclick = async () => {
  setStatus('Chargement de tout l\'historique…')
  try {
    const text = (await allTracks()).map(t => `${t.artist} - ${t.title}`).join('\n')
    await navigator.clipboard.writeText(text)
    setStatus('Liste copiée ✓')
  } catch { setStatus('Copie impossible ici : utilise le .csv.', true) }
}

el('csvBtn').onclick = async () => {
  setStatus('Chargement de tout l\'historique…')
  let all
  try { all = await allTracks() } catch { return setStatus("Impossible de charger l'historique.", true) }
  setStatus('')
  const rows = [['#', 'Artiste', 'Titre', 'Heure'],
    ...all.map((t, i) => [i + 1, t.artist, t.title, new Date(t.at).toLocaleString('fr-FR')])]
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = 'mes-pepites-patate-douce.csv'; a.click()
  URL.revokeObjectURL(url)
}

/* ── Démarrage ──────────────────────────────────────────────── */
;(async () => {
  const params = new URLSearchParams(location.search)
  /* Cette page est l'adresse de retour Spotify : une connexion lancée depuis Le Mix lui est renvoyée */
  if (params.get('state') === 'mix') return location.replace('generateur.html' + location.search)
  /* Retour d'une connexion lancée par un cœur. Dans la fenêtre à part : on enregistre le jeton
     (la page d'origine le voit passer) et on ferme. Fenêtre bloquée : on like le titre en attente. */
  if (params.get('state') === 'like') {
    history.replaceState({}, '', location.pathname)
    try { if (params.get('code')) await spExchange(params.get('code')) }
    catch (e) { setStatus(`Connexion Spotify impossible (${e.message}).`, true) }
    if (window.opener && window.name === 'spotify-login') return window.close()
    const pending = lsGet('sp_like_pending', null)
    localStorage.removeItem('sp_like_pending')
    if (pending && spReady()) toggleLike(pending)
  }

  setVol(1)
  poll()
  setInterval(poll, POLL_MS)
  loadLiked()
  await loadArt()  // avant la liste, pour l'afficher directement avec ses pochettes
  await loadTracks()
})()
