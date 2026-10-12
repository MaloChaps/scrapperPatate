/* Le Mix : génère une playlist à partir de tes playlists Spotify (ou des titres de la radio),
   via la Edge Function build-playlist, puis la crée sur Spotify.
   Réglages et fonctions communes : js/shared.js */

const THEMES = {
  libre:    { label: 'Comme mes playlists', desc: 'Pas de thème : le style, le tempo et la rareté de tes playlists' },
  diner:    { label: 'Dîner',          desc: 'Soul, jazz, brésil, funk, afro · 80–112 BPM' },
  apero:    { label: 'Apéro',          desc: 'Funk, soul, brésil, jazz, latin · 92–118 BPM' },
  soiree:   { label: 'Soirée',         desc: 'Disco, house, funk, hip-hop · 110–128 BPM' },
  nuit:     { label: 'Fin de nuit',    desc: 'House, chill, jazz, R&B · 85–115 BPM' },
  dimanche: { label: 'Dimanche matin', desc: 'Jazz, folk, soul, chanson · 70–105 BPM' },
  route:    { label: 'Road trip',      desc: 'Rock, pop, funk, soul · 100–135 BPM' },
  focus:    { label: 'Concentration',  desc: 'Chill, jazz, électro · 80–120 BPM' },
  sport:    { label: 'Sport',          desc: 'House, hip-hop, disco, rock · 120–150 BPM' }
}
const STYLES = {
  funk: 'Funk', soul: 'Soul', disco: 'Disco & boogie', jazz: 'Jazz', afro: 'Afro', bresil: 'Brésil',
  latin: 'Latin', rnb: 'R&B', house: 'House & électro', hiphop: 'Hip-hop', reggae: 'Reggae & dub',
  rock: 'Rock', pop: 'Pop', folk: 'Folk', chanson: 'Chanson', chill: 'Chill'
}
const NICHE = {
  auto:      { label: 'Comme mes playlists', desc: 'Même niveau de rareté que tes playlists' },
  connu:     { label: 'Connu',               desc: 'Artistes reconnus (plus de 20 000 fans)' },
  equilibre: { label: 'Un peu de tout',      desc: 'Un mélange de classiques et de pépites' },
  pepites:   { label: 'Niche',               desc: 'Artistes confidentiels (moins de 30 000 fans) : deep cuts, rare groove' }
}
/* Source : ?source=radio (bouton de la page radio), sinon les liens Spotify.
   Au retour de la connexion Spotify, l'adresse n'a plus de paramètre : on reprend la source enregistrée */
const startParams = new URLSearchParams(location.search)
const SOURCE = startParams.get('source') === 'radio' ||
  (startParams.get('code') && lsGet('mix_source') === 'radio') ? 'radio' : 'spotify'
document.body.dataset.source = SOURCE
const FORM_KEY = SOURCE === 'radio' ? 'mix_form_radio' : 'mix_form'

if (SOURCE === 'radio') {
  THEMES.libre = { label: 'Comme la radio', desc: 'Pas de thème : le style, le tempo et la rareté des titres de la radio' }
  NICHE.auto   = { label: 'Comme la radio', desc: 'Même niveau de rareté que les titres de la radio' }
}

const MODES = SOURCE === 'radio' ? {
  discover: { label: 'Radio + découvertes', desc: 'Garde les meilleurs titres de la radio et ajoute des artistes proches' },
  mix:      { label: 'Juste la radio',      desc: 'Aucun titre ajouté : les titres de la radio filtrés et enchaînés par tempo' }
} : {
  discover: { label: 'Mes titres + découvertes', desc: 'Garde tes meilleurs titres et ajoute des artistes proches' },
  mix:      { label: 'Juste mes playlists',      desc: 'Aucun titre ajouté : tes playlists filtrées, mélangées et enchaînées par tempo' }
}
const LEN_ALL = 105  // dernier cran du curseur en mode « Juste mes playlists » : tous les titres
const CURVES = { theme: 'Selon le thème', rise: '↗ Montée', fall: '↘ Descente', wave: '∿ Vagues', none: 'Mélangé' }

/* ── Spotify ─────────────────────────────────────────────────── */
/* Connexion par redirection (et non dans une fenêtre à part comme la radio) : installée sur iPhone,
   l'app ne partage pas son stockage avec la fenêtre que Safari ouvrirait. Le formulaire est enregistré
   avant de partir ; Spotify renvoie sur la page radio, qui renvoie ici (state=mix). */
async function spLogin() {
  saveForm()
  location = await spAuthUrl('mix')
}

const playlistId = s => (s.match(/playlist[/:]([A-Za-z0-9]{22})/) || s.trim().match(/^([A-Za-z0-9]{22})$/))?.[1]

/* Titres d'une playlist : titre, premier artiste, ISRC (si fourni) et URI Spotify */
async function readPlaylist(id, src) {
  const out = []
  let path = `/playlists/${id}/items?limit=100`
  while (path) {
    const r = await spFetch(path)
    for (const it of r.items || []) {
      const tr = it.item ?? it.track
      if (!tr || tr.type !== 'track' || tr.is_local || !tr.uri) continue
      out.push({ title: tr.name, artist: tr.artists?.[0]?.name || '', isrc: tr.external_ids?.isrc, uri: tr.uri, src })
    }
    path = r.next
  }
  return out
}

/* ── Formulaire ─────────────────────────────────────────────── */
const state = { mode: SOURCE === 'radio' ? 'mix' : 'discover', period: 'tout', theme: 'libre', niche: 'auto', curve: 'theme', styles: new Set() }
const seedInputs = []
const canPaste = !!navigator.clipboard?.readText
el("seeds").innerHTML = [0, 1, 2].map(i => `
  <div class="seed" id="seedRow${i}"${i ? ' hidden' : ''}>
    <div class="seed__input">
      <input class="field" id="seed${i}" placeholder="Lien de playlist Spotify" autocomplete="off" inputmode="url" enterkeyhint="next">
      ${canPaste ? `<button class="pill-button seed__paste" type="button" data-paste="${i}">Coller</button>` : ''}
    </div>
    <span class="seed-state" id="seedState${i}"></span>
  </div>`).join('')
el("seeds").addEventListener('click', async e => {
  const b = e.target.closest('[data-paste]')
  if (!b) return
  try {
    const text = await navigator.clipboard.readText()
    const i = +b.dataset.paste
    seedInputs[i].value = (text.match(/https?:\/\/\S*playlist\S*|spotify:playlist:\w+/) || [text.trim()])[0]
    checkSeed(i)
  } catch {}  // accès refusé : on peut toujours coller à la main
})
/* Vérification en direct : au collage tout de suite, à la frappe après une courte pause */
const seedTimers = [], seedRuns = [0, 0, 0]
for (let i = 0; i < 3; i++) {
  const input = el(`seed${i}`)
  seedInputs.push(input)
  input.addEventListener('paste', () => setTimeout(() => checkSeed(i)))
  input.addEventListener('input', () => {
    clearTimeout(seedTimers[i])
    seedTimers[i] = setTimeout(() => checkSeed(i), 450)
  })
}

function seedState(i, kind, html) {
  el(`seedState${i}`).className = 'seed-state' + (kind ? ' ' + kind : '')
  el(`seedState${i}`).innerHTML = html
  seedInputs[i].classList.toggle('ok', kind === 'ok')
  seedInputs[i].classList.toggle('err', kind === 'err')
}

/* Lien reconnu → nom, image, nombre de titres, et surtout : Spotify laisse-t-il lire son contenu ? */
async function checkSeed(i) {
  syncMine()
  syncRows()
  const run = ++seedRuns[i]
  const v = seedInputs[i].value.trim()
  if (!v) return seedState(i, '', '')
  const id = playlistId(v)
  if (!id) return seedState(i, 'err', '<span class="seed-state__text">Lien non reconnu</span>')
  if (seedInputs.some((x, j) => j < i && playlistId(x.value) === id))
    return seedState(i, 'err', '<span class="seed-state__text">Déjà ajoutée</span>')
  if (!spToken()) {
    seedState(i, '', '<button class="pill-button" type="button">Vérifier</button>')
    el(`seedState${i}`).querySelector('button').onclick = spLogin
    return
  }
  seedState(i, 'wait', '<span class="seed-state__text">Vérification…</span>')
  try {
    const [p, items] = await Promise.all([
      spFetch(`/playlists/${id}`),
      spFetch(`/playlists/${id}/items?limit=1`).catch(e => ({ blocked: e.message }))
    ])
    if (run !== seedRuns[i]) return
    const total = items.total ?? p.items?.total ?? p.tracks?.total
    const cover = p.images?.at(-1)?.url
    const coverHtml = `<span class="seed-state__cover" style="${cover ? `background-image:url(${esc(cover)})` : ''}"></span>`
    if (items.blocked || !total)
      return seedState(i, 'err', `${coverHtml}<span class="seed-state__text"><b>${esc(p.name)}</b> · ${items.blocked ? 'contenu bloqué par Spotify' : 'vide'}</span>`)
    seedState(i, 'ok', `${coverHtml}<span class="seed-state__text"><b>${esc(p.name)}</b> · ${total} titre${total > 1 ? 's' : ''}</span>`)
  } catch (e) {
    if (run !== seedRuns[i]) return
    seedState(i, 'err', `<span class="seed-state__text">${/40[34]/.test(e.message) ? 'Introuvable ou privée' : 'Inaccessible (' + esc(e.message) + ')'}</span>`)
  }
}

/* Mes playlists Spotify (une fois connecté) : clic = remplit la première case libre, re-clic = la vide */
let myPlaylists = null
function renderMine() {
  if (SOURCE !== 'spotify') return
  if (!spToken()) {
    el("mine").innerHTML = `<div class="mine__login"><p>Connecte-toi à Spotify pour choisir parmi tes playlists</p>
      <button class="pill-button pill-button--filled" type="button" id="mineLogin">Se connecter</button></div>`
    el("mineLogin").onclick = spLogin
    return
  }
  if (!myPlaylists) {
    el("mine").innerHTML = `<div class="mine__head">Chargement de tes playlists…</div>`
    return
  }
  if (!myPlaylists.length) {
    el("mine").innerHTML = `<div class="mine__head">Aucune playlist sur ton compte Spotify.</div>`
    return
  }
  el("mine").innerHTML = `
    <div class="mine__head">
      <span>Mes playlists · clique pour en choisir 3</span>
      ${myPlaylists.length > 8 ? '<input class="field" id="mineFilter" placeholder="Filtrer" autocomplete="off" enterkeyhint="search">' : ''}
    </div>
    <div class="mine__list" id="mineList">${myPlaylists.map(p => `
      <button class="mine__item" type="button" data-id="${esc(p.id)}" data-q="${esc((p.name + ' ' + p.owner).toLowerCase())}">
        <span class="seed-state__cover" style="${p.cover ? `background-image:url(${esc(p.cover)})` : ''}"></span>
        <span class="mine__text"><b>${esc(p.name)}</b><small>${p.total} titre${p.total > 1 ? 's' : ''}${p.mine ? '' : ' · ' + esc(p.owner)}</small></span>
      </button>`).join('')}
    </div>`
  el("mineFilter")?.addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase()
    el("mineList").querySelectorAll('.mine__item').forEach(b => b.hidden = !!q && !b.dataset.q.includes(q))
  })
  syncMine()
}
function syncMine() {
  const ids = seedInputs.map(x => playlistId(x.value))
  const full = ids.every(Boolean)
  el("mine").querySelectorAll('.mine__item').forEach(b => {
    const on = ids.includes(b.dataset.id)
    b.setAttribute('aria-pressed', on)
    b.disabled = full && !on
  })
}
async function loadMine() {
  if (SOURCE !== 'spotify' || !spToken()) return renderMine()
  renderMine()
  try {
    const me = await spFetch('/me')
    const out = []
    let path = '/me/playlists?limit=50'
    while (path) {
      const r = await spFetch(path)
      for (const p of r.items || []) {
        if (!p) continue
        out.push({ id: p.id, name: p.name, cover: p.images?.at(-1)?.url, total: p.items?.total ?? p.tracks?.total ?? 0,
                   owner: p.owner?.display_name || p.owner?.id || '', mine: p.owner?.id === me.id })
      }
      path = r.next
    }
    myPlaylists = out.filter(p => p.total > 0)
  } catch (e) {
    el("mine").innerHTML = `<div class="mine__head">Impossible de charger tes playlists (${esc(e.message)}).</div>`
    return
  }
  renderMine()
}
el("mine").addEventListener('click', e => {
  const b = e.target.closest('.mine__item')
  if (!b || b.disabled) return
  const id = b.dataset.id
  let i = seedInputs.findIndex(x => playlistId(x.value) === id)
  if (i >= 0) seedInputs[i].value = ''
  else {
    i = seedInputs.findIndex(x => !playlistId(x.value))
    if (i < 0) return
    seedInputs[i].value = `https://open.spotify.com/playlist/${id}`
  }
  checkSeed(i)
  saveForm()
})

/* Une case de lien au départ, « + » pour en ajouter (3 max) ; les cases remplies restent visibles */
let shownRows = 1
function syncRows() {
  const last = seedInputs.reduce((m, x, i) => x.value.trim() ? i : m, -1)
  const n = Math.min(3, Math.max(shownRows, last + 1))
  seedInputs.forEach((_, i) => el(`seedRow${i}`).hidden = i >= n)
  el("addSeed").hidden = n >= 3
}
el("addSeed").onclick = () => {
  shownRows = Math.min(3, seedInputs.filter((_, i) => !el(`seedRow${i}`).hidden).length + 1)
  syncRows()
  seedInputs[shownRows - 1].focus()
}

/* Groupes de pastilles : un seul choix (thème, niveau, enchaînement) ou plusieurs (styles) */
function renderChoice(id, options, key, onPick) {
  el(id).innerHTML = Object.entries(options).map(([k, o]) =>
    `<button class="chip" data-k="${k}" aria-pressed="${state[key] === k}">${esc(o.label || o)}</button>`).join('')
  el(id).onclick = e => {
    const b = e.target.closest('[data-k]')
    if (!b) return
    state[key] = b.dataset.k
    el(id).querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c === b))
    onPick?.()
  }
}
const syncDescs = () => {
  el("modeDesc").textContent  = MODES[state.mode].desc
  el("themeDesc").textContent = THEMES[state.theme].desc
  el("nicheDesc").textContent = NICHE[state.niche].desc
}
/* Mode « Juste mes playlists » : curseur de longueur jusqu'à « Tous », pas de découvertes */
function syncMode() {
  document.body.dataset.mode = state.mode
  const len = el("len")
  len.max = state.mode === 'mix' ? LEN_ALL : 60
  if (+len.value > +len.max) len.value = len.max
  syncDescs()
  syncSliders()
}
renderChoice('mode', MODES, 'mode', syncMode)

/* ── Source « radio » : titres relevés par le robot (table plays), par période ── */
const PERIODS = { '4h': { label: '4 h', h: 4 }, '12h': { label: '12 h', h: 12 }, '24h': { label: '24 h', h: 24 }, tout: { label: 'Tout', h: Infinity } }
const RADIO_MAX = 160  // au-delà, tirage au hasard (sans ISRC, chaque titre coûte deux recherches Deezer)

/* Genres Deezer (table track_info, déjà calculés pour toute la radio) → styles du générateur */
const GENRE_STYLES = [
  ['funk', /funk/i], ['soul', /soul/i], ['rnb', /r&b|rnb|rhythm/i], ['disco', /disco|boogie/i],
  ['jazz', /jazz|blues/i], ['afro', /afro|africa/i], ['bresil', /brésil|bresil|mpb|samba|bossa/i],
  ['latin', /latin|salsa|bolero|cumbia|reggaeton/i], ['house', /electro|house|techno|dance/i],
  ['hiphop', /hip.?hop|\brap\b/i], ['reggae', /reggae|\bdub\b|\bska\b/i],
  ['rock', /rock|alternative|indé|indie|metal|punk/i], ['pop', /pop/i],
  ['folk', /folk|country|singer/i], ['chanson', /chanson|variété|french/i]
]
const stylesOfGenre = genre => genre ? GENRE_STYLES.filter(([, re]) => re.test(genre)).map(([id]) => id) : []
const radioKey = t => `${norm(t.artist)}|${norm(t.title)}`

async function fetchAll(table, select) {
  const all = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}&offset=${from}&limit=1000`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } })
    const page = res.ok ? await res.json() : []
    all.push(...page)
    if (page.length < 1000) return all
  }
}
let radioPlays = null
async function loadRadio() {
  const [plays, info] = await Promise.all([
    fetchAll('plays', 'title,artist,played_at&order=played_at.desc'),
    fetchAll('track_info', 'artist,title,genre,bpm')  // genre et tempo calculés par le serveur
  ])
  const byKey = new Map(info.map(r => [radioKey(r), r]))
  radioPlays = plays.map(r => {
    const i = byKey.get(radioKey(r))
    return { title: r.title, artist: r.artist, at: Date.parse(r.played_at), styles: stylesOfGenre(i?.genre), bpm: i?.bpm || 0 }
  })
  syncRadio()
}
/* Titres uniques passés sur la période (le passage le plus récent compte) */
function radioTitles(period = state.period) {
  const since = Date.now() - PERIODS[period].h * 3600000
  const seen = new Map()
  for (const t of radioPlays || []) {
    if (t.at < since) break
    if (!seen.has(radioKey(t))) seen.set(radioKey(t), t)
  }
  return [...seen.values()]
}
/* Le filtre Styles s'applique ici, sur toute la radio, avant tout tirage au hasard */
const inStyles = (t, styles = state.styles) => !styles.size || t.styles.some(x => styles.has(x))
const radioPool = (period = state.period) => radioTitles(period).filter(t => inStyles(t))

/* Compteurs : titres par période (styles choisis compris) et par style (période choisie) */
function syncRadio() {
  if (SOURCE !== 'radio' || !radioPlays) return
  el("period").querySelectorAll('[data-k]').forEach(c =>
    c.innerHTML = `${PERIODS[c.dataset.k].label}<small class="count">${radioPool(c.dataset.k).length}</small>`)
  const titles = radioTitles()
  el("styles").querySelectorAll('[data-k]').forEach(c => {
    const n = titles.filter(t => t.styles.includes(c.dataset.k)).length
    c.innerHTML = `${esc(STYLES[c.dataset.k])}<small class="count">${n}</small><span class="chip__close" aria-hidden="true">×</span>`
    c.disabled = n === 0 && c.getAttribute('aria-pressed') !== 'true'
  })
  const n = radioPool().length
  el("radioNote").textContent = `${n} titre${n > 1 ? 's' : ''} de la radio sur cette période${state.styles.size ? ' dans ces styles' : ''}` +
    (n > RADIO_MAX ? ` (${RADIO_MAX} tirés au hasard pour le calcul)` : '')
}
renderChoice('period', PERIODS, 'period', syncRadio)
if (SOURCE === 'radio') {
  el("stylesNote").textContent = 'Aucun choisi : tous les styles de la radio.'
  el("intro").textContent = 'Les titres passés à la radio, filtrés par thème et styles et enchaînés par tempo. Écoute les extraits avant de créer la playlist Spotify.'
  loadRadio()
}
renderChoice('themes', THEMES, 'theme', syncDescs)
renderChoice('niche', NICHE, 'niche', syncDescs)
renderChoice('curve', CURVES, 'curve')
syncDescs()

el("styles").innerHTML = Object.entries(STYLES).map(([k, label]) =>
  `<button class="chip chip--multi" data-k="${k}" aria-pressed="false">${esc(label)}<span class="chip__close" aria-hidden="true">×</span></button>`).join('')
el("styles").onclick = e => {
  const b = e.target.closest('[data-k]')
  if (!b) return
  const on = !state.styles.has(b.dataset.k)
  on ? state.styles.add(b.dataset.k) : state.styles.delete(b.dataset.k)
  b.setAttribute('aria-pressed', on)
  syncRadio()
}

const syncSliders = () => {
  el("lenVal").textContent  = state.mode === 'mix' && +el("len").value >= LEN_ALL ? 'Tous' : `${el("len").value} titres`
  el("discVal").textContent = `${el("disc").value} %`
}
el("len").oninput = el("disc").oninput = syncSliders
syncMode()

/* Nom de la playlist : celui des réglages, sinon thème · date */
let autoName = 'Le Mix'
const playlistName = () => el("plName").value.trim() || autoName

/* Le formulaire survit à l'aller-retour de connexion Spotify */
function saveForm() {
  lsSet('mix_source', SOURCE)
  lsSet(FORM_KEY, {
    seeds: seedInputs.map(x => x.value), mode: state.mode, period: state.period, theme: state.theme, niche: state.niche, curve: state.curve,
    styles: [...state.styles], len: el("len").value, disc: el("disc").value, name: el("plName").value
  })
}
function restoreForm() {
  try {
    const f = lsGet(FORM_KEY, null)
    if (!f) return
    f.seeds.forEach((v, i) => seedInputs[i].value = v)
    for (const [key, id] of [['mode', 'mode'], ['period', 'period'], ['theme', 'themes'], ['niche', 'niche'], ['curve', 'curve']])
      el(id).querySelector(`[data-k="${f[key]}"]`)?.click()
    for (const s of f.styles || []) el("styles").querySelector(`[data-k="${s}"]`)?.click()
    el("len").value = f.len; el("disc").value = f.disc
    el("plName").value = f.name || ''
    syncSliders()
  } catch {}
}

function updateHint() {
  el("goHint").textContent = spToken() ? '' : 'Connexion Spotify demandée au premier clic'
}

/* ── Écrans ─────────────────────────────────────────────────── */
function showScreen(name) {
  document.body.dataset.screen = name
  el("toResult").hidden = !result
  window.scrollTo(0, 0)
}
el("toForm").onclick = () => showScreen('form')
el("toResult").onclick = () => showScreen('result')

function setLoading(on) {
  el("loading").classList.toggle('on', on)
  document.body.classList.toggle('locked', on)
}

/* ── Génération ─────────────────────────────────────────────── */
let lastSeeds = null, result = null, resultTheme = null, aborter = null

function showError(msg) {
  el("error").textContent = msg
  el("error").classList.add('on')
  el("error").scrollIntoView({ behavior: 'smooth', block: 'center' })
}
el("cancel").onclick = () => aborter?.abort()

/* Étapes affichées pendant le calcul serveur (pas de suivi en direct) */
function startSteps(mode) {
  const steps = mode === 'mix'
    ? [[0, 'Lecture des tempos de tes titres'], [25, 'Filtrage par thème et styles'], [38, 'Enchaînement des tempos']]
    : [[0, 'Analyse des styles et des tempos'], [15, 'Recherche d\'artistes proches'],
       [35, 'Écoute des titres candidats'], [55, 'Sélection et mise en ordre']]
  const total = mode === 'mix' ? 45 : 70
  const t0 = Date.now()
  const tick = () => {
    const s = (Date.now() - t0) / 1000
    el("step").textContent = steps.filter(([at]) => s >= at).pop()[1] + '…'
    el("bar").style.width = Math.min(95, 10 + s / total * 85) + '%'
  }
  tick()
  return setInterval(tick, 1000)
}

/* extra.keep + extra.relax : on garde la sélection affichée et on complète avec des filtres élargis */
let lastBody = null
async function generate(seeds, extra = {}) {
  const body = extra.keep ? { ...lastBody, ...extra } : {
    seeds, mode: state.mode, theme: state.theme, niche: state.niche, curve: state.curve, styles: [...state.styles],
    length: state.mode === 'mix' && +el("len").value >= LEN_ALL ? 0 : +el("len").value, discovery: el("disc").value / 100,
    ...extra
  }
  if (!extra.keep) lastBody = body
  el("error").classList.remove('on')
  setLoading(true)
  el("go").disabled = el("regen").disabled = true
  const timer = startSteps(body.mode)
  aborter = new AbortController()
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/build-playlist`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: aborter.signal
    })
    const d = await res.json().catch(() => ({ error: 'réponse illisible (' + res.status + ')' }))
    if (!res.ok || d.error) throw new Error(d.error || 'Erreur ' + res.status)
    result = d
    resultTheme = body.theme
    renderResult()
    showScreen('result')
  } catch (e) {
    if (e.name !== 'AbortError') showError('La génération a échoué : ' + e.message)
  } finally {
    clearInterval(timer)
    setLoading(false)
    aborter = null
    el("go").disabled = el("regen").disabled = false
  }
}

el("go").onclick = async () => {
  if (!spToken()) return spLogin()
  saveForm()  // l'app se souvient des derniers réglages
  el("error").classList.remove('on')
  if (SOURCE === 'radio') {
    if (!radioPlays) return showError('Les titres de la radio sont encore en chargement, réessaie dans un instant.')
    const pool = radioPool()
    if (!pool.length) return showError(state.styles.size ? 'Aucun titre de ces styles sur cette période : choisis une période plus longue ou d\'autres styles.' : 'Aucun titre passé à la radio sur cette période.')
    lastSeeds = (pool.length > RADIO_MAX ? [...pool].sort(() => Math.random() - 0.5).slice(0, RADIO_MAX) : pool)
      .map(({ title, artist, bpm }) => ({ title, artist, ...(bpm ? { bpm } : {}) }))
    /* Styles déjà appliqués ici sur toute la radio : le serveur ne refiltre pas ces titres,
       mais filtre les découvertes (mode « Radio + découvertes ») */
    return generate(lastSeeds, state.mode === 'mix' ? { styles: [] } : { seedsFiltered: true })
  }
  const ids = [...new Set(seedInputs.map(x => playlistId(x.value)).filter(Boolean))]
  if (!ids.length) return showError('Colle au moins un lien de playlist Spotify.')

  setLoading(true)
  el("step").textContent = 'Lecture des playlists…'
  el("bar").style.width = '5%'
  el("go").disabled = true
  const seeds = [], failed = []
  for (const [src, id] of ids.entries()) {
    try { seeds.push(...await readPlaylist(id, src)) } catch (e) { failed.push(e.message) }
  }
  el("go").disabled = false
  if (!seeds.length) {
    setLoading(false)
    return showError(`Impossible de lire ces playlists (${failed.join(', ') || 'vides'}). Spotify bloque les playlists éditoriales et parfois celles des autres : essaie avec les tiennes.`)
  }
  lastSeeds = seeds
  await generate(seeds)
  if (failed.length) showError(`${failed.length} playlist(s) illisible(s), le mix a été fait avec les autres.`)
}
el("regen").onclick = () => lastSeeds && generate(lastSeeds, SOURCE !== 'radio' ? {} : state.mode === 'mix' ? { styles: [] } : { seedsFiltered: true })
el("complete").onclick = () => {
  if (!lastBody || !result) return
  generate(lastBody.seeds, { keep: pickedTracks(), relax: true })
}

const fansLabel = n => n == null ? '' : n < 1000 ? `${n} fans` : n < 1e6 ? `${Math.round(n / 1000)} k fans` : `${(n / 1e6).toFixed(1)} M fans`

function renderResult() {
  stopPreview()
  const mix = result.mode === 'mix'
  const fresh = result.tracks.filter(t => !t.seed).length
  const title = mix && resultTheme === 'libre' ? (SOURCE === 'radio' ? 'La radio' : 'Mes playlists') : THEMES[resultTheme].label
  el("resTitle").innerHTML = `${esc(title)} <small>(${result.tracks.length})</small>`
  el("profile").innerHTML =
    (mix ? `<span class="tag tag--fill">★ ${result.tracks.length} titres sur ${result.available} qui passent les filtres</span>`
         : `<span class="tag tag--fill">★ ${result.tracks.length - fresh} de tes playlists</span><span class="tag tag--fill">✦ ${fresh} découvertes</span>`) +
    `<span class="tag">${esc(CURVES[result.curve] || CURVES.none)}</span>` +
    result.profile.map(p => `<span class="tag">${esc(STYLES[p.style] || p.style)} ${p.share} %</span>`).join('')
  /* Pas assez de titres : on dit pourquoi et on propose de compléter */
  const s = result.short
  el("short").classList.toggle('on', s > 0)
  if (s > 0) {
    const why = lastBody?.styles?.length && result.rejected?.style >= result.rejected?.niche ? 'les styles choisis' : 'le niveau de rareté'
    el("shortText").textContent = mix
      ? `Seulement ${result.tracks.length} titres ${SOURCE === 'radio' ? 'de la radio' : 'de tes playlists'} passent ces filtres : choisis d'autres styles, un autre thème${SOURCE === 'radio' ? ' ou une période plus longue' : ''}.` :
      `Il manque ${s} titre${s > 1 ? 's' : ''} : ${why} ${why.startsWith('les') ? 'écartent' : 'écarte'} trop de titres de ces playlists.` +
      (result.relaxed ? ' Même en assouplissant, il n\'y en a pas plus : essaie une autre playlist de départ ou un autre style.' : '') +
      (!result.lastfm && why.startsWith('les') ? ' (Styles déduits de Deezer, approximatifs.)' : '')
    el("complete").style.display = result.relaxed || mix ? 'none' : ''
  }
  el("list").innerHTML = result.tracks.map((t, i) => `
    <li><label class="track">
      <input type="checkbox" data-i="${i}" checked>
      <span class="track__index">${String(i + 1).padStart(2, '0')}</span>
      <button class="track__cover track__play" type="button" data-play="${i}" ${t.preview ? 'aria-label="Écouter l\'extrait"' : 'disabled aria-label="Pas d\'extrait"'}
        style="${t.cover ? `background-image:url(${esc(t.cover)})` : ''}"></button>
      <span class="track__info">
        <span class="track__name">${esc(t.title)}</span>
        <span class="track__artist">${esc(t.artist)}</span>
      </span>
      <span class="track__tags">
        ${t.styles.slice(0, 2).map(s => `<span class="tag">${esc(STYLES[s] || s)}</span>`).join('')}
        <span class="tag">${t.bpm ? `${t.bpm} bpm` : 'tempo ?'}</span>
        ${t.fans != null ? `<span class="tag">${fansLabel(t.fans)}</span>` : ''}
        ${mix ? '' : `<span class="tag">${t.seed ? '★' : '✦'}</span>`}
      </span>
      <span class="track__check" aria-hidden="true"></span>
    </label></li>`).join('')
  const date = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
  autoName = `${THEMES[resultTheme].label} · ${date}`
  el("done").classList.remove('on')
  el("createStep").textContent = ''
  updateCreateCount()
}
/* Icônes SVG (couleur du texte) à la place des emojis */
const ICON = {
  play:  '<path d="M7 4.5v15l13-7.5z"/>',
  pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
  stop:  '<path d="M6 6h12v12H6z"/>',
}
const icon = name => `<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICON[name]}</svg>`

/* ── Écoute : extraits Deezer de 30 s, un titre ou tout le mix à la suite ── */
const audio = new Audio()
let playingIdx = -1, autoplay = false, stallTimer = null
function markPlaying() {
  el("list").querySelectorAll('.track').forEach((r, i) => r.classList.toggle('playing', i === playingIdx))
  el("listenAll").innerHTML = autoplay ? `${icon('stop')}Arrêter l'écoute` : `${icon('play')}Écouter le mix`
}
function stopPreview() {
  clearTimeout(stallTimer)
  audio.pause()
  playingIdx = -1; autoplay = false
  markPlaying()
}
function playPreview(i) {
  const t = result?.tracks[i]
  if (!t?.preview) return autoplay ? playNext(i) : stopPreview()
  playingIdx = i
  audio.src = t.preview
  audio.play().catch(() => autoplay ? playNext(i) : stopPreview())
  /* Extrait qui ne démarre pas (lien expiré, réseau) : on passe au suivant */
  clearTimeout(stallTimer)
  stallTimer = setTimeout(() => { if (playingIdx === i && audio.currentTime < 0.5) autoplay ? playNext(i) : stopPreview() }, 6000)
  markPlaying()
  el("list").querySelectorAll('.track')[i]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}
/* Titre suivant parmi ceux qui restent cochés */
function playNext(from) {
  const boxes = [...el("list").querySelectorAll('input')]
  const next = boxes.findIndex((c, i) => i > from && c.checked && result.tracks[i].preview)
  next < 0 ? stopPreview() : playPreview(next)
}
audio.onended = audio.onerror = () => autoplay ? playNext(playingIdx) : stopPreview()
el("list").addEventListener('click', e => {
  const b = e.target.closest('[data-play]')
  if (!b) return
  e.preventDefault()
  const i = +b.dataset.play
  if (i === playingIdx) return stopPreview()
  autoplay = false
  playPreview(i)
})
el("listenAll").onclick = () => {
  if (autoplay) return stopPreview()
  autoplay = true
  playNext(playingIdx >= 0 ? playingIdx - 1 : -1)
}

const pickedTracks = () => [...el("list").querySelectorAll('input:checked')].map(c => result.tracks[+c.dataset.i])
function updateCreateCount() {
  const n = el("list").querySelectorAll('input:checked').length
  el("create").textContent = `Créer sur Spotify · ${n} titre${n > 1 ? 's' : ''}`
  el("create").disabled = n === 0
}
el("list").addEventListener('change', e => {
  e.target.closest('.track')?.classList.toggle('off', !e.target.checked)
  updateCreateCount()
})

/* ── Création sur Spotify ───────────────────────────────────── */
el("create").onclick = async () => {
  if (!spToken()) return spLogin()
  const picked = pickedTracks()
  if (!picked.length) return
  const step = el("createStep")
  el("create").disabled = true
  try {
    const uris = new Array(picked.length)
    let next = 0, done = 0
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < picked.length) {
        const i = next++
        try { uris[i] = await spFindUri(picked[i]) } catch { uris[i] = null }
        step.textContent = `Recherche sur Spotify · ${++done} / ${picked.length}`
      }
    }))
    const found = [...new Set(uris.filter(Boolean))]
    step.textContent = 'Création de la playlist…'
    const pl = await spFetch('/me/playlists', {
      method: 'POST',
      body: JSON.stringify({ name: playlistName(), description: `Généré par Le Mix · ${THEMES[resultTheme].desc}`, public: false })
    })
    for (let i = 0; i < found.length; i += 100) {
      await spFetch(`/playlists/${pl.id}/items`, { method: 'POST', body: JSON.stringify({ uris: found.slice(i, i + 100) }) })
    }
    const missed = picked.length - found.length
    step.textContent = ''
    const url = pl.external_urls.spotify
    el("done").innerHTML = `✓ ${found.length} titre${found.length > 1 ? 's' : ''} ajouté${found.length > 1 ? 's' : ''}${missed ? ` · ${missed} introuvable${missed > 1 ? 's' : ''} sur Spotify` : ''}
      <div class="done__actions">
        <a class="pill-button pill-button--filled" href="${esc(url)}" target="_blank" rel="noopener">Ouvrir dans Spotify ↗</a>
        ${navigator.share ? '<button class="pill-button" id="share">Partager</button>' : ''}
      </div>`
    el("done").classList.add('on')
    el("done").scrollIntoView({ behavior: 'smooth', block: 'center' })
    navigator.vibrate?.(40)
    el("share")?.addEventListener('click', () => navigator.share({ title: playlistName(), url }).catch(() => {}))
  } catch (e) {
    step.textContent = 'Erreur Spotify : ' + e.message
  } finally {
    el("create").disabled = false
  }
}

/* ── Démarrage : app installable, retour de connexion Spotify ── */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})

showScreen('form')
;(async () => {
  restoreForm()
  /* Partage vers l'app (Web Share Target) : « Partager > Le Mix » depuis Spotify */
  const params = new URLSearchParams(location.search)
  const shared = playlistId(`${params.get('url') || ''} ${params.get('text') || ''}`)
  if (shared) {
    history.replaceState({}, '', location.pathname)
    const i = seedInputs.findIndex(x => playlistId(x.value) === shared)
    const free = seedInputs.findIndex(x => !x.value.trim())
    if (i < 0) seedInputs[free < 0 ? 0 : free].value = `https://open.spotify.com/playlist/${shared}`
  }
  const code = params.get('code')
  if (code) {
    history.replaceState({}, '', location.pathname)
    try { await spExchange(code) } catch (e) { showError(`Connexion Spotify impossible (${e.message}).`) }
  }
  updateHint()
  if (SOURCE === 'spotify') seedInputs.forEach((x, i) => x.value && checkSeed(i))
  syncRows()
  loadMine()
})()
