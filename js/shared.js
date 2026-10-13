/* Commun au Mix (index.html, l'accueil) et à la page radio (radio.html) :
   réglages, petites fonctions utilitaires, nettoyage des titres, connexion et appels Spotify. */

/* ── Réglages ───────────────────────────────────────────────── */
const SUPABASE_URL      = 'https://wnbcoczjfqyxggkfyooh.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InduYmNvY3pqZnF5eGdna2Z5b29oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTQ1MDYsImV4cCI6MjA5NjkzMDUwNn0.0mO3O7xqMDwTLGx-5zrVLzW8ed0WoNDKP03eHji2v9o'

const SPOTIFY_CLIENT_ID = '92f0ed53408d48e29b72e5bc027a3a10'
/* Une seule connexion pour les deux pages : lire/créer des playlists (Le Mix), lire/modifier les Titres likés (radio) */
const SP_SCOPES = 'playlist-modify-public playlist-modify-private playlist-read-private playlist-read-collaborative user-library-read user-library-modify'
/* Adresse de retour enregistrée dans l'app Spotify : le dossier du site, c'est-à-dire Le Mix (index.html).
   Il renvoie à la radio les connexions lancées par un cœur (state=like). */
const SP_REDIRECT = location.origin + location.pathname.replace(/[^/]*$/, '')

/* ── Compte (Supabase Auth, sur invitation) ──────────────────── */
/* Un seul client pour les deux pages, session gardée dans le navigateur. Flux « implicit » : le lien de connexion
   revient avec la session dans le # de l'adresse, sans ?code= (réservé au retour de connexion Spotify) */
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { flowType: 'implicit', persistSession: true, detectSessionInUrl: true } })
const session = async () => (await sb.auth.getSession()).data.session
/* Fiche du compte connecté (droits radio / admin), null si déconnecté */
let profilePromise = null
const myProfile = (fresh = false) => {
  if (fresh || !profilePromise) profilePromise = (async () => {
    const s = await session()
    if (!s) return null
    const { data } = await sb.from('profiles').select('id, email, radio, admin').eq('id', s.user.id).maybeSingle()
    return data || { id: s.user.id, email: s.user.email, radio: false, admin: false }
  })()
  return profilePromise
}
sb.auth.onAuthStateChange(() => { profilePromise = null })
/* En-têtes des appels à Supabase (REST, fonctions) : le jeton du compte connecté, sinon la clé publique */
async function sbHeaders() {
  const token = (await session())?.access_token || SUPABASE_ANON_KEY
  return { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + token }
}

/* ── Utilitaires ────────────────────────────────────────────── */
const el    = id => document.getElementById(id)
const esc   = s  => (s || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const sleep = ms => new Promise(r => setTimeout(r, ms))
/* localStorage peut être indisponible (navigation privée, quota) : jamais bloquant */
const lsGet = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback } }
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch {} }

/* ── Flux de la radio (page radio et Le Mix) ────────────────── */
const STREAM_URL = 'https://www.radioking.com/play/radio-jockey'

/* Lecture du flux avec reconnexion automatique après une coupure réseau.
   onStatus(message) : « Reconnexion… » ou '' ; onChange(on, blocked) : lecture voulue ou non,
   blocked = le navigateur a refusé de lancer le son sans clic (lecture automatique). */
function radioStream(audio, { onStatus = () => {}, onChange = () => {} } = {}) {
  let on = false, timer = null
  const connect = () => {
    audio.src = STREAM_URL
    audio.play().then(() => onStatus('')).catch(e => e.name === 'NotAllowedError' ? stop(true) : retry())
  }
  const retry = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { if (on) { onStatus('Reconnexion…'); connect() } }, 3000)
  }
  function stop(blocked = false) {
    on = false
    clearTimeout(timer)
    audio.pause()
    audio.removeAttribute('src')  // coupe le flux (sinon il continue de se télécharger)
    onStatus('')
    onChange(false, blocked)
  }
  for (const ev of ['error', 'stalled', 'ended']) audio.addEventListener(ev, () => on && retry())
  return {
    get on() { return on },
    play() { on = true; clearTimeout(timer); connect(); onChange(true, false) },
    stop: () => stop(),
    toggle() { on ? stop() : this.play() },
  }
}

/* ── Titres et artistes ─────────────────────────────────────── */
const norm  = s => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
/* Pour comparer entre services : minuscules, sans accents ni ponctuation */
const loose = s => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const near  = (a, b) => !!a && !!b && (a.includes(b) || b.includes(a))
/* Titres souvent « sales » : (feat. X), [Radio Edit], - Remastered 2011… */
const cleanTitle = s => (s || '')
  .replace(/\s*[([][^)\]]*(feat|ft\.|with|edit|remaster|version|mix|live)[^)\]]*[)\]]/gi, '')
  .replace(/\s+-\s+.*(remaster|edit|version|mix|live).*$/i, '')
  .replace(/\s+(feat\.?|ft\.?)\s.*$/i, '')
  .trim()
const firstArtist = s => (s || '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0].trim()

/* Genres d'album Deezer (table track_info, ex. « Electro, Techno/House ») → styles ; mêmes règles que build-playlist */
const GENRE_STYLES = [
  ['hiphop', /hip.?hop|\brap\b/i], ['house', /electro|house|techno|dance/i],
  ['funk', /funk/i], ['soul', /soul/i], ['rnb', /r&b|rnb|rhythm/i], ['disco', /disco|boogie/i],
  ['jazz', /jazz|blues/i], ['afro', /afro|africa/i], ['bresil', /brésil|bresil|mpb|samba|bossa/i],
  ['latin', /latin|salsa|bolero|cumbia|reggaeton/i], ['reggae', /reggae|\bdub\b|\bska\b/i],
  ['rock', /rock|alternative|indé|indie|metal|punk/i], ['pop', /pop/i],
  ['folk', /folk|country|singer/i], ['chanson', /chanson|variété|french/i], ['classique', /classi|film|soundtrack/i]
]
const stylesOfGenre = genre => genre ? GENRE_STYLES.filter(([, re]) => re.test(genre)).map(([id]) => id) : []
/* Styles d'une ligne track_info : colonne styles (étiquettes Last.fm de l'artiste, remplie par fill-styles),
   sinon genres d'album Deezer tant que le serveur ne l'a pas encore traitée */
const stylesOfInfo = i => i?.styles ?? stylesOfGenre(i?.genre)

/* ── Spotify (PKCE, jeton partagé par les deux pages via localStorage) ── */
const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function spToken() {
  const t = localStorage.getItem('sp_token')
  return t && Date.now() < +localStorage.getItem('sp_exp') ? t : null
}
/* Connecté avec toutes les autorisations actuelles (une ancienne connexion peut en manquer) */
function spReady() {
  const granted = localStorage.getItem('sp_scope') || ''
  return !!spToken() && SP_SCOPES.split(' ').every(s => granted.includes(s))
}

/* Adresse de connexion Spotify ; state dit quelle page reprend la main au retour ('like' radio, 'mix' Le Mix) */
async function spAuthUrl(state) {
  const a = new Uint8Array(32); crypto.getRandomValues(a)
  const verifier = b64url(a)
  localStorage.setItem('sp_v', verifier)
  return 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    client_id: SPOTIFY_CLIENT_ID, response_type: 'code', redirect_uri: SP_REDIRECT, state, scope: SP_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  })
}

/* Code de retour → jeton. L'écriture de sp_scope en dernier sert de signal aux autres onglets (événement storage). */
async function spExchange(code) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, redirect_uri: SP_REDIRECT,
      client_id: SPOTIFY_CLIENT_ID, code_verifier: localStorage.getItem('sp_v')
    })
  })
  const d = await res.json()
  if (!d.access_token) throw new Error(d.error_description || d.error || 'connexion refusée')
  localStorage.setItem('sp_token', d.access_token)
  localStorage.setItem('sp_exp', Date.now() + d.expires_in * 1000)
  localStorage.removeItem('sp_v')
  localStorage.setItem('sp_scope', d.scope || '')
}

/* Appel API : chemin relatif ou adresse complète (pages suivantes) ; réessaie si Spotify limite (429) */
async function spFetch(path, opts = {}, tries = 4) {
  const res = await fetch(path.startsWith('http') ? path : 'https://api.spotify.com/v1' + path, {
    ...opts, headers: { Authorization: 'Bearer ' + spToken(), 'Content-Type': 'application/json' }
  })
  if (res.status === 429 && tries > 0) {
    await sleep((+res.headers.get('Retry-After') || 2) * 1000)
    return spFetch(path, opts, tries - 1)
  }
  if (res.status === 401) localStorage.removeItem('sp_token')  // jeton expiré ou révoqué : reconnexion
  if (!res.ok) throw new Error('Spotify ' + res.status)
  const text = await res.text()  // PUT / DELETE renvoient un corps vide
  return text ? JSON.parse(text) : null
}

/* URI Spotify d'un titre : déjà connue, sinon par ISRC (exact), sinon recherche vérifiée.
   L'artiste doit correspondre : mieux vaut « introuvable » qu'un mauvais morceau. */
async function spFindUri(t) {
  if (t.uri) return t.uri
  if (t.isrc) {
    const r = await spFetch(`/search?q=${encodeURIComponent('isrc:' + t.isrc)}&type=track&limit=1`)
    if (r?.tracks?.items?.[0]) return r.tracks.items[0].uri
  }
  const artist = firstArtist(t.artist), title = cleanTitle(t.title) || t.title
  const la = loose(artist), lt = loose(title)
  const name = it => loose(cleanTitle(it.name) || it.name)
  for (const query of [`track:${title} artist:${artist}`, `${artist} ${title}`]) {
    const r = await spFetch(`/search?q=${encodeURIComponent(query)}&type=track&limit=10`)
    const items = (r?.tracks?.items || []).filter(it => it.artists.some(a => near(la, loose(a.name))))
    const hit = items.find(it => name(it) === lt) || items.find(it => near(lt, name(it)))
    if (hit) return hit.uri
  }
  return null
}
