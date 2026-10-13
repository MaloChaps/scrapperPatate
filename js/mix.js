/* Le Mix : génère une playlist à partir de tes playlists Spotify (ou des titres de la radio),
   via la Edge Function build-playlist, puis la crée sur Spotify.
   Réglages et fonctions communes : js/shared.js */

/* Ambiances : tempo et styles gardés / écartés, mêmes valeurs que THEMES dans build-playlist
   (ici pour prévenir quand une ambiance contredit les styles choisis) */
const THEMES = {
  libre:    { label: t('Like my playlists'), desc: t('No mood: the style, tempo and rarity of your playlists') },
  diner:    { label: t('Dinner'),         desc: t('Soul, jazz, Brazil, funk, afro · 80–112 BPM'), bpm: [80, 112],
              like: ['soul', 'jazz', 'bresil', 'funk', 'afro', 'latin', 'rnb', 'chill'], avoid: ['metal', 'hiphop', 'house'] },
  apero:    { label: t('Drinks'),         desc: t('Funk, soul, Brazil, jazz, latin · 92–118 BPM'), bpm: [92, 118],
              like: ['funk', 'soul', 'bresil', 'jazz', 'latin', 'afro', 'disco', 'reggae', 'rnb'], avoid: ['metal', 'classique'] },
  soiree:   { label: t('Party'),          desc: 'Disco, house, funk, hip-hop · 110–128 BPM', bpm: [110, 128],
              like: ['disco', 'house', 'funk', 'hiphop', 'latin', 'afro', 'rnb', 'pop'], avoid: ['classique', 'folk', 'chill', 'metal'] },
  nuit:     { label: t('Late night'),     desc: 'House, chill, jazz, R&B · 85–115 BPM', bpm: [85, 115],
              like: ['house', 'chill', 'jazz', 'rnb', 'soul'], avoid: ['metal', 'rock', 'folk', 'funk', 'disco', 'hiphop'] },
  dimanche: { label: t('Sunday morning'), desc: 'Jazz, folk, soul, chanson · 70–105 BPM', bpm: [70, 105],
              like: ['jazz', 'folk', 'soul', 'bresil', 'chill', 'chanson'], avoid: ['metal', 'house', 'hiphop'] },
  route:    { label: 'Road trip',         desc: 'Rock, pop, funk, soul · 100–135 BPM', bpm: [100, 135],
              like: ['rock', 'pop', 'funk', 'soul', 'hiphop', 'disco'], avoid: ['classique', 'chill'] },
  focus:    { label: t('Focus'),          desc: t('Chill, jazz, electro · 80–120 BPM'), bpm: [80, 120],
              like: ['chill', 'jazz', 'house', 'classique'], avoid: ['hiphop', 'metal', 'chanson'] },
  sport:    { label: t('Workout'),        desc: 'House, hip-hop, disco, rock · 120–150 BPM', bpm: [120, 150],
              like: ['house', 'hiphop', 'disco', 'rock', 'funk'], avoid: ['jazz', 'classique', 'folk', 'chill'] }
}
const STYLES = {
  funk: 'Funk', soul: 'Soul', disco: 'Disco & boogie', jazz: 'Jazz', afro: 'Afro', bresil: t('Brazil'),
  latin: 'Latin', rnb: 'R&B', house: t('House & electro'), hiphop: 'Rap & hip-hop', reggae: 'Reggae & dub',
  rock: 'Rock', pop: 'Pop', folk: 'Folk', chanson: 'Chanson', chill: 'Chill'
}
const NICHE = {
  auto:      { label: t('Like my playlists'),   desc: t('Same rarity as your playlists') },
  connu:     { label: t('Well-known'),          desc: t('Established artists (over 20,000 fans)') },
  equilibre: { label: t('A bit of everything'), desc: t('A mix of classics and hidden gems') },
  pepites:   { label: 'Niche',                  desc: t('Underground artists (under 30,000 fans): deep cuts, rare groove') }
}
/* Source : ?source=radio (bouton de la page radio), sinon les liens Spotify.
   Au retour de la connexion Spotify, l'adresse n'a plus de paramètre : on reprend la source enregistrée */
const startParams = new URLSearchParams(location.search)
const SOURCE = startParams.get('source') === 'radio' ||
  (startParams.get('code') && lsGet('mix_source') === 'radio') ? 'radio' : 'spotify'
document.body.dataset.source = SOURCE
const FORM_KEY = SOURCE === 'radio' ? 'mix_form_radio' : 'mix_form'

if (SOURCE === 'radio') {
  THEMES.libre = { label: t('Like the radio'), desc: t('No mood: the style, tempo and rarity of the radio\'s tracks') }
  NICHE.auto   = { label: t('Like the radio'), desc: t('Same rarity as the radio\'s tracks') }
}

const MODES = SOURCE === 'radio' ? {
  discover: { label: t('Radio + discoveries'), desc: t('Keeps the radio\'s best tracks and adds similar artists') },
  mix:      { label: t('Just the radio'),      desc: t('Nothing added: the radio\'s tracks, filtered and sequenced by tempo') }
} : {
  discover: { label: t('My tracks + discoveries'), desc: t('Keeps your best tracks and adds similar artists') },
  mix:      { label: t('Just my playlists'),       desc: t('Nothing added: your playlists, filtered, shuffled and sequenced by tempo') }
}
const LEN_ALL = 105  // dernier cran du curseur en mode « Juste mes playlists » : tous les titres
const CURVES = { theme: t('Follow the mood'), rise: t('↗ Rising'), fall: t('↘ Falling'), wave: t('∿ Waves'), none: t('Shuffled') }
/* Ajustements d'une playlist générée (build-playlist : adjust) ; chacun crée une nouvelle version.
   match : ce que compte la note « 12 titres français sur 30 » */
const ADJUSTS = {
  fr:     { label: t('+ French'),  step: t('Looking for French tracks'), match: t('French') },
  hiphop: { label: '+ Rap',        step: t('Looking for rap'),           match: 'rap' },
  house:  { label: t('+ Electro'), step: t('Looking for electro'),       match: t('electro') },
  calm:   { label: t('Calmer'),    step: t('Looking for slower tracks') },
  fast:   { label: t('Faster'),    step: t('Looking for faster tracks') },
  rare:   { label: t('Rarer'),     step: t('Looking for hidden gems') }
}
/* Ajustement quelconque : l'un de ceux-ci, « + un style » (id de STYLES) ou « + comme un artiste » (artist) */
const adjustMeta = (kind, artist = '') => ADJUSTS[kind] || (kind === 'artist'
  ? { label: t('+ Like {artist}', { artist }), step: t('Looking for artists close to {artist}', { artist }), match: t('by {artist} or similar artists', { artist }) }
  : { label: `+ ${STYLES[kind]}`, step: t('Looking for {style} tracks', { style: STYLES[kind] }), match: STYLES[kind] })

/* ── Spotify ─────────────────────────────────────────────────── */
/* Connexion par redirection (et non dans une fenêtre à part comme la radio) : installée sur iPhone,
   l'app ne partage pas son stockage avec la fenêtre que Safari ouvrirait. Le formulaire est enregistré
   avant de partir ; Spotify renvoie sur cette page (adresse de retour : le dossier du site). */
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
      const tk = it.item ?? it.track
      if (!tk || tk.type !== 'track' || tk.is_local || !tk.uri) continue
      out.push({ title: tk.name, artist: tk.artists?.[0]?.name || '', isrc: tk.external_ids?.isrc, uri: tk.uri, src })
    }
    path = r.next
  }
  return out
}

/* ── Formulaire ─────────────────────────────────────────────── */
const state = { mode: SOURCE === 'radio' ? 'mix' : 'discover', period: 'tout', theme: 'libre', niche: 'auto', curve: 'theme', styles: new Set(), without: new Set() }
const seedInputs = []
const canPaste = !!navigator.clipboard?.readText
el("seeds").innerHTML = [0, 1, 2].map(i => `
  <div class="seed" id="seedRow${i}"${i ? ' hidden' : ''}>
    <div class="seed__input">
      <input class="field" id="seed${i}" placeholder="${t('Spotify playlist link')}" autocomplete="off" inputmode="url" enterkeyhint="next">
      ${canPaste ? `<button class="pill-button seed__paste" type="button" data-paste="${i}">${t('Paste')}</button>` : ''}
      <button class="pill-button seed__clear" type="button" data-clear="${i}" aria-label="${t('Remove this link')}" hidden>×</button>
    </div>
    <span class="seed-state" id="seedState${i}"></span>
  </div>`).join('')
el("seeds").addEventListener('click', async e => {
  const clear = e.target.closest('[data-clear]')
  if (clear) {
    const i = +clear.dataset.clear
    seedInputs[i].value = ''
    checkSeed(i)
    saveForm()
    return seedInputs[i].focus()
  }
  const b = e.target.closest('[data-paste]')
  if (!b) return
  try {
    const text = await navigator.clipboard.readText()
    const i = +b.dataset.paste
    seedInputs[i].value = (text.match(/https?:\/\/\S*playlist\S*|spotify:playlist:\w+/) || [text.trim()])[0]
    checkSeed(i)
  } catch {}  // accès refusé : on peut toujours coller à la main
})
/* Case remplie : « × » pour la vider à la place de « Coller » */
function syncClear(i) {
  const filled = !!seedInputs[i].value
  el(`seedRow${i}`).querySelector('[data-clear]').hidden = !filled
  const paste = el(`seedRow${i}`).querySelector('[data-paste]')
  if (paste) paste.hidden = filled
}
/* Vérification en direct : au collage tout de suite, à la frappe après une courte pause */
const seedTimers = [], seedRuns = [0, 0, 0]
for (let i = 0; i < 3; i++) {
  const input = el(`seed${i}`)
  seedInputs.push(input)
  input.addEventListener('paste', () => setTimeout(() => checkSeed(i)))
  input.addEventListener('input', () => {
    syncClear(i)
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
  syncClear(i)
  const run = ++seedRuns[i]
  const v = seedInputs[i].value.trim()
  if (!v) return seedState(i, '', '')
  const id = playlistId(v)
  if (!id) return seedState(i, 'err', `<span class="seed-state__text">${t('Link not recognised')}</span>`)
  if (seedInputs.some((x, j) => j < i && playlistId(x.value) === id))
    return seedState(i, 'err', `<span class="seed-state__text">${t('Already added')}</span>`)
  if (!spToken()) {
    seedState(i, '', `<button class="pill-button" type="button">${t('Check')}</button>`)
    el(`seedState${i}`).querySelector('button').onclick = spLogin
    return
  }
  seedState(i, 'wait', `<span class="seed-state__text">${t('Checking…')}</span>`)
  try {
    const [p, items] = await Promise.all([
      spFetch(`/playlists/${id}`),
      spFetch(`/playlists/${id}/items?limit=1`).catch(e => ({ blocked: e.message }))
    ])
    if (run !== seedRuns[i]) return
    const total = items.total ?? p.items?.total ?? p.tracks?.total
    const cover = p.images?.[0]?.url
    const coverHtml = `<span class="seed-state__cover" style="${cover ? `background-image:url(${esc(cover)})` : ''}"></span>`
    if (items.blocked || !total)
      return seedState(i, 'err', `${coverHtml}<span class="seed-state__text"><b>${esc(p.name)}</b> · ${items.blocked ? t('content blocked by Spotify') : t('empty')}</span>`)
    seedState(i, 'ok', `${coverHtml}<span class="seed-state__text"><b>${esc(p.name)}</b> · ${tn(total, '{n} track', '{n} tracks')}</span>`)
  } catch (e) {
    if (run !== seedRuns[i]) return
    seedState(i, 'err', `<span class="seed-state__text">${/40[34]/.test(e.message) ? t('Not found or private') : t('Unreachable ({e})', { e: esc(e.message) })}</span>`)
  }
}

/* Mes playlists Spotify (une fois connecté) : clic = remplit la première case libre, re-clic = la vide */
let myPlaylists = null
function renderMine() {
  if (SOURCE !== 'spotify') return
  if (!spToken()) {
    el("mine").innerHTML = `<div class="mine__login"><p>${t('Connect Spotify to pick from your playlists')}</p>
      <button class="pill-button pill-button--filled" type="button" id="mineLogin">${t('Connect Spotify')}</button></div>`
    el("mineLogin").onclick = spLogin
    return
  }
  if (!myPlaylists) {
    el("mine").innerHTML = `<div class="mine__head">${t('Loading your playlists…')}</div>`
    return
  }
  if (!myPlaylists.length) {
    el("mine").innerHTML = `<div class="mine__head">${t('No playlists on your Spotify account.')}</div>`
    return
  }
  el("mine").innerHTML = `
    <div class="mine__head">
      <span>${t('My playlists · click to pick up to 3')}</span>
      ${myPlaylists.length > 8 ? `<input class="field" id="mineFilter" placeholder="${t('Filter')}" autocomplete="off" enterkeyhint="search">` : ''}
    </div>
    <div class="mine__list" id="mineList">${myPlaylists.map(p => `
      <button class="mine__item" type="button" data-id="${esc(p.id)}" data-q="${esc((p.name + ' ' + p.owner).toLowerCase())}">
        <span class="seed-state__cover" style="${p.cover ? `background-image:url(${esc(p.cover)})` : ''}"></span>
        <span class="mine__text"><b>${esc(p.name)}</b><small>${tn(p.total, '{n} track', '{n} tracks')}${p.mine ? '' : ' · ' + esc(p.owner)}</small></span>
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
        out.push({ id: p.id, name: p.name, cover: p.images?.[0]?.url, total: p.items?.total ?? p.tracks?.total ?? 0,
                   owner: p.owner?.display_name || p.owner?.id || '', mine: p.owner?.id === me.id })
      }
      path = r.next
    }
    myPlaylists = out.filter(p => p.total > 0)
  } catch (e) {
    el("mine").innerHTML = `<div class="mine__head">${t('Couldn\'t load your playlists ({e}).', { e: esc(e.message) })}</div>`
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
  syncThemeNote()
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
const PERIODS = { '4h': { label: '4 h', h: 4 }, '12h': { label: '12 h', h: 12 }, '24h': { label: '24 h', h: 24 }, tout: { label: t('All'), h: Infinity } }
const RADIO_MAX = 160  // au-delà, tirage au hasard (sans ISRC, chaque titre coûte deux recherches Deezer)

const radioKey = t => `${norm(t.artist)}|${norm(t.title)}`

async function fetchAll(table, select) {
  const all = []
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=${select}&offset=${from}&limit=1000`,
      { headers: await sbHeaders() })
    const page = res.ok ? await res.json() : []
    all.push(...page)
    if (page.length < 1000) return all
  }
}
let radioPlays = null
async function loadRadio() {
  const [plays, info] = await Promise.all([
    fetchAll('plays', 'title,artist,played_at&order=played_at.desc'),
    fetchAll('track_info', 'artist,title,genre,styles,bpm')  // styles et tempo calculés par le serveur
  ])
  const byKey = new Map(info.map(r => [radioKey(r), r]))
  radioPlays = plays.map(r => {
    const i = byKey.get(radioKey(r))
    return { title: r.title, artist: r.artist, at: Date.parse(r.played_at), styles: stylesOfInfo(i), bpm: i?.bpm || 0 }
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
const inStyles = t => (!state.styles.size || t.styles.some(x => state.styles.has(x))) && !t.styles.some(x => state.without.has(x))
const radioPool = (period = state.period) => radioTitles(period).filter(t => inStyles(t))

/* Compteurs : titres par période (styles choisis compris) et par style (période choisie) */
function syncRadio() {
  if (SOURCE !== 'radio' || !radioPlays) return
  el("period").querySelectorAll('[data-k]').forEach(c =>
    c.innerHTML = `${PERIODS[c.dataset.k].label}<small class="count">${radioPool(c.dataset.k).length}</small>`)
  const titles = radioTitles()
  el("styles").querySelectorAll('[data-k]').forEach(c => {
    const k = c.dataset.k, n = titles.filter(t => t.styles.includes(k)).length
    c.querySelector('.count').textContent = n
    c.disabled = n === 0 && !state.styles.has(k) && !state.without.has(k)
  })
  syncStylesNote()
  syncLive()
}
renderChoice('period', PERIODS, 'period', syncRadio)
if (SOURCE === 'radio') {
  if (el("intro")) el("intro").textContent = t('Tracks played on the radio, filtered by style and mood and sequenced by tempo. Listen to the previews before creating the Spotify playlist.')
  loadRadio()
}
renderChoice('themes', THEMES, 'theme', syncDescs)
renderChoice('niche', NICHE, 'niche', syncDescs)
renderChoice('curve', CURVES, 'curve')
syncDescs()

/* Styles : une touche choisit, une deuxième exclut (« sans »), une troisième remet à zéro */
el("styles").innerHTML = Object.entries(STYLES).map(([k, label]) =>
  `<button class="chip chip--style" data-k="${k}" aria-pressed="false"><span class="chip__sans">${t('without')} </span>${esc(label)}<small class="count"></small></button>`).join('')
el("styles").onclick = e => {
  const k = e.target.closest('[data-k]')?.dataset.k
  if (!k) return
  if (state.styles.has(k)) { state.styles.delete(k); state.without.add(k) }
  else if (state.without.has(k)) state.without.delete(k)
  else state.styles.add(k)
  el("styles").querySelectorAll('[data-k]').forEach(c => {
    c.setAttribute('aria-pressed', state.styles.has(c.dataset.k))
    c.toggleAttribute('data-out', state.without.has(c.dataset.k))
  })
  SOURCE === 'radio' ? syncRadio() : syncStylesNote()
}

/* Ambiance : même règle que themeOk dans build-playlist (style écarté → non ; sinon un style gardé
   et/ou un tempo dans la plage). Approximation côté page : avertissements, résumé, choix des titres de la radio envoyés */
const effBpm = (bpm, [lo, hi]) => [bpm, bpm * 2, bpm / 2].reduce((a, b) => Math.abs(b - (lo + hi) / 2) < Math.abs(a - (lo + hi) / 2) ? b : a)
function bpmFit(bpm, range) {
  if (!bpm) return 0.5
  const b = effBpm(bpm, range), [lo, hi] = range
  return Math.max(0, 1 - (b < lo ? lo - b : b > hi ? b - hi : 0) / 20)
}
function themeOk(t, th = THEMES[state.theme]) {
  if (!th.bpm) return true
  if (t.styles.some(s => th.avoid.includes(s))) return false
  const liked = t.styles.some(s => th.like.includes(s))
  if (t.styles.length && !liked) return false
  return t.bpm ? bpmFit(t.bpm, th.bpm) >= 0.75 : liked
}

/* Sous l'ambiance : sa description, puis ce qu'elle retire des styles choisis (et, radio, combien de titres restent) */
function syncThemeNote() {
  const th = THEMES[state.theme], chosen = [...state.styles]
  const warns = [], avoided = chosen.filter(k => th.avoid?.includes(k)), others = chosen.filter(k => th.like && !th.like.includes(k) && !th.avoid.includes(k))
  if (avoided.length) warns.push(t('{mood} leaves out {styles}', { mood: th.label, styles: listAnd(avoided.map(k => STYLES[k])) }))
  if (others.length) warns.push(t('{mood} only keeps {styles} when mixed with {liked}…', { mood: th.label, styles: listAnd(others.map(k => STYLES[k])), liked: listAnd(th.like.slice(0, 3).map(k => STYLES[k])) }))
  let count = ''
  if (th.bpm && SOURCE === 'radio' && radioPlays) {
    const pool = radioPool(), k = pool.filter(t => themeOk(t)).length
    count = k ? tn(k, '≈ {n} of {total} tracks fits {mood} (styles and tempo)', '≈ {n} of {total} tracks fit {mood} (styles and tempo)', { total: pool.length, mood: th.label })
      : t('No track out of {total} fits {mood} (styles and tempo)', { total: pool.length, mood: th.label })
    if (k < pool.length / 3) warns.push(count), count = ''
  }
  el("themeDesc").innerHTML = esc(th.desc) +
    (warns.length ? `<span class="warn">⚠ ${esc(warns.join(' · '))}</span>` : '') + (count ? `<span class="peek">${esc(count)}</span>` : '')
}

/* Tout ce qui dépend de plusieurs réglages à la fois */
function syncLive() {
  syncThemeNote()
  syncSummary()
}

/* « Rock et Pop, sans House & électro » */
const stylesPhrase = () => [listAnd([...state.styles].map(k => STYLES[k])),
  state.without.size ? t('without {styles}', { styles: listAnd([...state.without].map(k => STYLES[k])) }) : ''].filter(Boolean).join(', ')

/* Sous les styles : le mode d'emploi, puis (radio) les artistes les plus joués de la sélection,
   pour voir ce qu'il y a derrière un style avant de générer */
function syncStylesNote() {
  const how = state.styles.size || state.without.size
    ? t('Tap again to exclude or clear a style.')
    : SOURCE === 'radio' ? t('None picked: all the radio\'s styles. Tap once to pick, twice to exclude.')
    : t('None picked: all your playlists\' styles. Tap once to pick, twice to exclude.')
  let peek = ''
  if (SOURCE === 'radio' && radioPlays) {
    const byArtist = new Map()  // loose(artiste) → { name, n } : « Mac DeMarco » et « Mac Demarco » ensemble
    for (const t of radioPool()) {
      const name = firstArtist(t.artist), k = loose(name)
      byArtist.set(k, { name: byArtist.get(k)?.name || name, n: (byArtist.get(k)?.n || 0) + 1 })
    }
    const top = [...byArtist.values()].sort((a, b) => b.n - a.n).slice(0, 6).map(a => a.name)
    if (top.length) peek = `<span class="peek">${t('Most played: {list}', { list: esc(top.join(', ')) + (byArtist.size > top.length ? '…' : '') })}</span>`
  }
  el("stylesNote").innerHTML = esc(how) + peek
}

/* Résumé au-dessus du bouton : ce que le mix va prendre et ce qu'il va donner */
function syncSummary() {
  const len = state.mode === 'mix' && +el("len").value >= LEN_ALL ? 0 : +el("len").value
  const parts = []
  if (SOURCE === 'radio') {
    if (!radioPlays) return el("summary").textContent = t('Loading the radio\'s tracks…')
    const n = radioPool().length
    if (!n) return el("summary").textContent = t('No radio tracks with these styles in this period')
    parts.push(tn(n, '{n} track', '{n} tracks') + (n > RADIO_MAX ? ' ' + t('({max} drawn at random)', { max: RADIO_MAX }) : ''))
  } else {
    const k = seedInputs.filter(x => playlistId(x.value)).length
    if (!k) return el("summary").textContent = t('Pick at least one playlist')
    parts.push(`${k} playlist${k > 1 ? 's' : ''}`)
  }
  if (stylesPhrase()) parts.push(stylesPhrase())
  if (SOURCE === 'radio') parts.push(state.period === 'tout' ? t('whole period') : t('last {p}', { p: PERIODS[state.period].label }))
  if (state.theme !== 'libre') parts.push(SOURCE === 'radio' ? `${THEMES[state.theme].label} (≈ ${radioPool().filter(t => themeOk(t)).length})` : THEMES[state.theme].label)
  const out = state.mode === 'mix' ? (len ? t('mix of up to {n} tracks', { n: len }) : t('all tracks')) : t('mix of {n} tracks with discoveries', { n: len })
  el("summary").textContent = `${parts.join(' · ')} → ${out}`
}
/* Écouté sur le conteneur : passe après les gestionnaires des pastilles et des champs */
document.querySelector('.filters').addEventListener('click', syncLive)
document.querySelector('.filters').addEventListener('input', syncLive)
syncStylesNote()

const syncSliders = () => {
  el("lenVal").textContent  = state.mode === 'mix' && +el("len").value >= LEN_ALL ? t('All') : t('{n} tracks', { n: el("len").value })
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
    styles: [...state.styles], without: [...state.without], len: el("len").value, disc: el("disc").value, name: el("plName").value
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
    for (const s of f.without || []) { const c = el("styles").querySelector(`[data-k="${s}"]`); c?.click(); c?.click() }
    el("len").value = f.len; el("disc").value = f.disc
    el("plName").value = f.name || ''
    syncSliders()
  } catch {}
}

function updateHint() {
  const signedIn = typeof me !== 'undefined' && me  // compte : js/account.js, chargé après cette page
  el("goHint").textContent = !signedIn ? t('You\'ll be asked to sign in on first click') : spToken() ? '' : t('Spotify sign-in on first click')
}

/* La barre du bas (résumé, bouton) change de hauteur : le bas de la page lui laisse toujours la place */
new ResizeObserver(([e]) => document.documentElement.style.setProperty('--bar-h', e.borderBoxSize[0].blockSize + 'px'))
  .observe(document.querySelector('.actionbar'))

/* ── Écrans ─────────────────────────────────────────────────── */
function showScreen(name) {
  document.body.dataset.screen = name
  /* Onglet du haut allumé : Créer pour les réglages et le résultat */
  const tab = name === 'result' ? 'form' : name
  document.querySelectorAll('[data-go]').forEach(b => b.setAttribute('aria-current', b.dataset.go === tab ? 'page' : 'false'))
  window.scrollTo(0, 0)
}
el("toForm").onclick = () => showScreen('form')
/* Onglets : Créer (le mix en cours s'il y en a un), Communauté, Bibliothèque (js/community.js, js/account.js) */
document.querySelector('.nav').addEventListener('click', e => {
  const go = e.target.closest('[data-go]')?.dataset.go
  /* Créer : depuis la bibliothèque ou la communauté, retour au mix en cours s'il y en a un ; sinon les réglages */
  const from = document.body.dataset.screen
  if (go === 'form') showScreen(result && (from === 'account' || from === 'community') ? 'result' : 'form')
  if (go === 'account') openAccount()
  if (go === 'community') openCommunity()
})

function setLoading(on) {
  el("loading").classList.toggle('on', on)
  document.body.classList.toggle('locked', on)
  if (!on && radio.on) radio.stop()  // la radio s'écoute « en attendant » le calcul seulement
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
function startSteps(mode, adjustStep) {
  const steps = adjustStep
    ? [[0, t('Analysing your playlist')], [mode === 'mix' ? 15 : 12, adjustStep], [mode === 'mix' ? 35 : 50, t('Replacing and reordering')]]
    : mode === 'mix'
    ? [[0, t('Reading your tracks\' tempos')], [25, t('Filtering by style and mood')], [38, t('Sequencing tempos')]]
    : [[0, t('Analysing styles and tempos')], [15, t('Looking for similar artists')],
       [35, t('Listening to candidate tracks')], [55, t('Picking and ordering')]]
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

/* extra.keep + extra.relax : on garde la sélection affichée et on complète avec des filtres élargis ;
   extra.adjust + extra.current : on ajuste la version affichée. label : nom de la version créée */
let lastBody = null  // réglages de la version affichée
const setBusy = on => {
  el("go").disabled = el("regen").disabled = on
  document.querySelectorAll('[data-adjust], #adjustArtist button, [data-like]').forEach(b => b.disabled = on)
}
const ORIGINAL = t('Original')
async function generate(seeds, extra = {}, label = ORIGINAL) {
  const fromShown = !!(extra.keep || extra.adjust)
  const body = fromShown ? { ...lastBody, ...extra } : {
    seeds, mode: state.mode, theme: state.theme, niche: state.niche, curve: state.curve, styles: [...state.styles], without: [...state.without],
    length: state.mode === 'mix' && +el("len").value >= LEN_ALL ? 0 : +el("len").value, discovery: el("disc").value / 100,
    ...extra
  }
  el("error").classList.remove('on')
  setLoading(true)
  setBusy(true)
  const timer = startSteps(body.mode, extra.adjust && adjustMeta(extra.adjust, extra.artist?.name).step)
  aborter = new AbortController()
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/build-playlist`, {
      method: 'POST',
      headers: { ...await sbHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: aborter.signal
    })
    const d = await res.json().catch(() => ({ error: t('unreadable response ({s})', { s: res.status }) }))
    if (!res.ok || d.error) throw new Error(d.error || t('Error {s}', { s: res.status }))
    if (extra.adjust && !d.adjust) throw new Error(t('the server can\'t adjust yet (redeploy build-playlist)'))
    if (d.adjust && !d.adjust.added) return showError(t('{label}: nothing found in that direction, the playlist hasn\'t changed.', { label: adjustMeta(d.adjust.kind, d.adjust.artist).label }))
    addVersion(d, body.theme, fromShown ? lastBody : body, label, fromShown)
    showScreen('result')
  } catch (e) {
    if (e.name !== 'AbortError') showError(t('Generation failed: {e}', { e: e.message }))
  } finally {
    clearInterval(timer)
    setLoading(false)
    aborter = null
    setBusy(false)
  }
}

/* ── Versions : la génération, puis une par régénération, complétion ou ajustement ── */
let versions = [], shown = -1  // { result, theme, body, label, off: indices décochés, fresh: titres nouveaux, savedId : version enregistrée }
let savedMixId = null  // playlist enregistrée (Tes playlists) dont ces versions font partie (js/account.js)
const songId = t => `${norm(t.artist)}|${norm(t.title)}`
function addVersion(res, theme, body, label, fromShown) {
  const before = fromShown && versions[shown] ? new Set(versions[shown].result.tracks.map(songId)) : null
  if (!fromShown && label === ORIGINAL) { versions = []; savedMixId = null }  // nouveau mix : nouvelle playlist
  versions.push({ result: res, theme, body, label, off: new Set(), fresh: new Set(before ? res.tracks.map(songId).filter(k => !before.has(k)) : []) })
  showVersion(versions.length - 1)
}
function showVersion(i) {
  shown = i
  ;({ result, theme: resultTheme, body: lastBody } = versions[i])
  renderResult()
}
el("versions").addEventListener('click', e => {
  const b = e.target.closest('[data-v]')
  if (b && +b.dataset.v !== shown) showVersion(+b.dataset.v)
})

/* Ajuster : à partir des titres cochés de la version affichée (les décochés sont remplacés en priorité) */
el("adjust").insertAdjacentHTML('beforeend', Object.entries(ADJUSTS).map(([k, a]) =>
  `<button class="chip" type="button" data-adjust="${k}">${esc(a.label)}</button>`).join(''))
/* + n'importe quel style, + comme un artiste (tapé, ou bouton sur un titre) */
el("adjustMore").insertAdjacentHTML('beforeend', Object.entries(STYLES).filter(([k]) => !ADJUSTS[k]).map(([k, label]) =>
  `<button class="chip" type="button" data-adjust="${k}">${esc(label)}</button>`).join(''))
function runAdjust(kind, artist, styles) {
  if (!lastBody || !result) return
  const current = pickedTracks()
  if (!current.length) return showError(t('Tick at least one track to keep.'))
  const seeds = radioSeedsFor(kind, artist, styles)
  generate(lastBody.seeds, { adjust: kind, current, size: result.tracks.length, ...(artist ? { artist } : {}), ...(seeds ? { seeds } : {}) },
    adjustMeta(kind, artist?.name).label)
}
/* « Juste la radio » : le serveur ne choisit que parmi les titres envoyés. Pour « + un style » ou « + comme un artiste »,
   on lui envoie les titres de la radio (période choisie) qui vont dans ce sens plutôt que le tirage du départ :
   ceux de l'artiste d'abord, puis ceux qui ont ses styles (ceux du titre touché, sinon ceux de ses titres à la radio) */
function radioSeedsFor(kind, artist, styles) {
  if (SOURCE !== 'radio' || lastBody.mode !== 'mix' || !radioPlays || !(kind === 'artist' || STYLES[kind])) return null
  const all = radioTitles(), la = artist && loose(artist.name)
  const own = la ? all.filter(t => loose(firstArtist(t.artist)) === la) : []
  const near = kind === 'artist' ? (styles?.length ? styles : [...new Set(own.flatMap(t => t.styles))]) : [kind]
  const rest = all.filter(t => !own.includes(t) && t.styles.some(s => near.includes(s))).sort(() => Math.random() - 0.5)
  const seeds = [...own, ...rest].slice(0, RADIO_MAX)
  return seeds.length ? seeds.map(({ title, artist, bpm }) => ({ title, artist, ...(bpm ? { bpm } : {}) })) : null
}
for (const id of ['adjust', 'adjustMore']) el(id).addEventListener('click', e => {
  const k = e.target.closest('[data-adjust]')?.dataset.adjust
  if (k) runAdjust(k)
})
el("adjustArtist").onsubmit = e => {
  e.preventDefault()
  const name = el("likeName").value.trim()
  if (!name) return el("likeName").focus()
  el("likeName").value = ''
  runAdjust('artist', { name })
}

el("go").onclick = async () => {
  if (!me) return openAccount(t('Sign in to generate your mix (Le Mix is invite-only).'))  // js/account.js
  if (!spToken()) return spLogin()
  saveForm()  // l'app se souvient des derniers réglages
  el("error").classList.remove('on')
  if (SOURCE === 'radio') {
    if (!radioPlays) return showError(t('The radio\'s tracks are still loading, try again in a moment.'))
    const pool = radioPool()
    if (!pool.length) return showError(state.styles.size || state.without.size ? t('No tracks with these styles in this period: pick a longer period or other styles.') : t('No tracks played on the radio in this period.'))
    /* Trop de titres pour tout envoyer : tirage au hasard, ceux qui vont avec l'ambiance d'abord */
    const shuffled = [...pool].sort(() => Math.random() - 0.5)
    lastSeeds = (pool.length > RADIO_MAX ? [...shuffled.filter(t => themeOk(t)), ...shuffled.filter(t => !themeOk(t))].slice(0, RADIO_MAX) : pool)
      .map(({ title, artist, bpm }) => ({ title, artist, ...(bpm ? { bpm } : {}) }))
    /* Styles déjà appliqués ici (track_info.styles : Last.fm, sinon Deezer) : le serveur ne refiltre
       que si Last.fm en dit plus, et filtre les découvertes */
    return generate(lastSeeds, { seedsFiltered: true })
  }
  const ids = [...new Set(seedInputs.map(x => playlistId(x.value)).filter(Boolean))]
  if (!ids.length) return showError(t('Paste at least one Spotify playlist link.'))

  setLoading(true)
  el("step").textContent = t('Reading playlists…')
  el("bar").style.width = '5%'
  el("go").disabled = true
  const seeds = [], failed = []
  for (const [src, id] of ids.entries()) {
    try { seeds.push(...await readPlaylist(id, src)) } catch (e) { failed.push(e.message) }
  }
  el("go").disabled = false
  if (!seeds.length) {
    setLoading(false)
    return showError(t('Couldn\'t read these playlists ({e}). Spotify blocks editorial playlists and sometimes other people\'s: try with your own.', { e: failed.join(', ') || t('empty') }))
  }
  lastSeeds = seeds
  await generate(seeds)
  if (failed.length) showError(t('{n} playlist(s) couldn\'t be read, the mix was made with the others.', { n: failed.length }))
}
el("regen").onclick = () => lastSeeds && generate(lastSeeds, SOURCE === 'radio' ? { seedsFiltered: true } : {}, t('Regenerated'))
el("complete").onclick = () => {
  if (!lastBody || !result) return
  generate(lastBody.seeds, { keep: pickedTracks(), relax: true }, t('Completed'))
}

/* Titre du résultat = nom de la playlist qui sera créée (champ « Titre », sinon thème · date) */
function renderTitle() {
  if (result) el("resTitle").innerHTML = `${esc(playlistName())} <small>(${result.tracks.length})</small>`
}
el("plName").addEventListener('input', renderTitle)

const fansLabel = n => n == null ? '' : n < 1000 ? `${n} fans` : n < 1e6 ? `${Math.round(n / 1000)} k fans` : `${(n / 1e6).toFixed(1)} M fans`

function renderResult() {
  stopPreview()
  const mix = result.mode === 'mix'
  const fresh = result.tracks.filter(t => !t.seed).length
  const theme = mix && resultTheme === 'libre' ? (SOURCE === 'radio' ? t('The radio') : t('My playlists')) : THEMES[resultTheme].label
  const date = new Date().toLocaleDateString(LOCALE, { day: 'numeric', month: 'long' })
  autoName = `${THEMES[resultTheme].label} · ${date}`
  renderTitle()
  const v = versions[shown]
  if (el("resFan")) el("resFan").innerHTML = fanHTML(result.tracks, 6)
  setAmbient(distinctCovers(result.tracks, 3).map(c => c.cover))
  el("resEyebrow").textContent = v.from ? t('From the community · by {who}', { who: v.from }) : savedMixId ? t('In your library') : t('Fresh mix')
  el("versions").hidden = versions.length < 2
  el("versions").innerHTML = versions.map((x, i) =>
    `<button class="chip" type="button" data-v="${i}" aria-pressed="${i === shown}">V${x.n || i + 1} · ${esc(x.label)}${x.savedId ? ' ✓' : ''}</button>`).join('')
  const a = result.adjust, adj = a && adjustMeta(a.kind, a.artist)
  el("adjustNote").textContent = a
    ? `${adj.label}${t(':')} ${tn(a.added, '{n} track added', '{n} tracks added')}${a.removed ? ', ' + tn(a.removed, '{n} track removed', '{n} tracks removed') : ''}` +
      (adj.match ? ' · ' + t('{k} {what} of {n}', { k: a.matching, what: adj.match, n: result.tracks.length }) : '')
    : ''
  el("profile").innerHTML =
    `<span class="tag">${esc(theme)}</span>` +
    (mix ? `<span class="tag tag--fill">★ ${t('{n} of {m} tracks pass the filters', { n: result.tracks.length, m: result.available })}</span>`
         : `<span class="tag tag--fill">★ ${t('{n} from your playlists', { n: result.tracks.length - fresh })}</span><span class="tag tag--fill">✦ ${t('{n} discoveries', { n: fresh })}</span>`) +
    `<span class="tag">${esc(CURVES[result.curve] || CURVES.none)}</span>` +
    result.profile.map(p => `<span class="tag">${esc(STYLES[p.style] || p.style)} ${p.share} %</span>`).join('')
  /* Pas assez de titres : on dit pourquoi et on propose de compléter */
  const s = result.short
  el("short").classList.toggle('on', s > 0)
  if (s > 0) {
    const byStyle = lastBody?.styles?.length && result.rejected?.style >= result.rejected?.niche
    el("shortText").textContent = mix
      ? (SOURCE === 'radio' ? t('Only {n} radio tracks pass these filters: pick other styles, another mood or a longer period.', { n: result.tracks.length })
                            : t('Only {n} tracks from your playlists pass these filters: pick other styles or another mood.', { n: result.tracks.length })) :
      (byStyle ? tn(s, '{n} track missing: the chosen styles rule out too many tracks from these playlists.', '{n} tracks missing: the chosen styles rule out too many tracks from these playlists.')
               : tn(s, '{n} track missing: the rarity level rules out too many tracks from these playlists.', '{n} tracks missing: the rarity level rules out too many tracks from these playlists.')) +
      (result.relaxed ? ' ' + t('Even relaxed, there are no more: try another starting playlist or another style.') : '') +
      (!result.lastfm && byStyle ? ' ' + t('(Styles inferred from Deezer, approximate.)') : '')
    el("complete").style.display = result.relaxed || mix ? 'none' : ''
  }
  el("list").innerHTML = result.tracks.map((t, i) => `
    <li><label class="track">
      <input type="checkbox" data-i="${i}" checked>
      <span class="track__index">${String(i + 1).padStart(2, '0')}</span>
      <button class="track__cover" type="button" data-play="${i}" ${t.preview ? `aria-label="${tr('Play preview')}"` : `disabled aria-label="${tr('No preview')}"`}
        style="${t.cover ? `background-image:url(${esc(bigCover(t.cover, 250))})` : ''}"></button>
      <span class="track__info">
        <span class="track__name">${esc(t.title)}</span>
        <span class="track__artist">${esc(t.artist)}</span>
      </span>
      <span class="track__tags">
        <button class="track__like" type="button" data-like="${i}">${tr('+ more like this')}</button>
        ${t.styles.slice(0, 2).map(s => `<span class="tag">${esc(STYLES[s] || s)}</span>`).join('')}
        <span class="tag">${t.bpm ? `${t.bpm} bpm` : 'bpm ?'}</span>
        ${t.fans != null ? `<span class="tag">${fansLabel(t.fans)}</span>` : ''}
        ${t.fr ? '<span class="tag">FR</span>' : ''}
        ${mix ? '' : `<span class="tag" title="${t.seed ? tr('From your playlists') : tr('Discovery')}">${t.seed ? '★' : '✦'}</span>`}
        ${v.fresh.has(songId(t)) ? `<span class="tag tag--new">${tr('New')}</span>` : ''}
      </span>
      <span class="track__check" aria-hidden="true"></span>
    </label></li>`).join('')
  for (const i of v.off) {
    const c = el("list").querySelector(`input[data-i="${i}"]`)
    c.checked = false
    c.closest('.track').classList.add('off')
  }
  el("done").classList.remove('on')
  el("createStep").textContent = ''
  el("saveMix").textContent = v.savedId ? t('V{n} saved ✓', { n: v.n }) : savedMixId ? t('Save this version') : t('Save')
  updateCreateCount()
}
/* Icônes SVG (couleur du texte) à la place des emojis */
const ICON = {
  play:  '<path d="M7 4.5v15l13-7.5z"/>',
  pause: '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>',
  stop:  '<path d="M6 6h12v12H6z"/>',
}
const icon = name => `<svg class="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICON[name]}</svg>`

/* ── Radio en attendant : bouton de l'écran de calcul (comptes avec l'accès radio) ── */
/* Coupée le temps d'écouter un extrait, et à la fin du calcul */
let radioPaused = false
const radio = radioStream(el("radioAudio"), { onChange: () => renderRadio() })
function renderRadio() {
  const on = radio.on
  el("radioBtnWait").innerHTML = `${icon(on ? 'pause' : 'play')}${on ? t('Stop the radio') : t('Listen to the radio while you wait')}`
  el("radioBtnWait").setAttribute('aria-pressed', on)
}
el("radioBtnWait").onclick = () => {
  if (radio.on) return radio.stop()
  if (playingIdx >= 0) stopPreview()  // reprend la radio si elle avait été coupée pour l'extrait
  if (!radio.on) radio.play()
}

/* ── Écoute : extraits Deezer de 30 s, un titre ou tout le mix à la suite ── */
const audio = new Audio()
let playingIdx = -1, autoplay = false, stallTimer = null
function markPlaying() {
  el("list").querySelectorAll('.track').forEach((r, i) => r.classList.toggle('playing', i === playingIdx))
  el("listenAll").innerHTML = autoplay ? `${icon('stop')}${t('Stop listening')}` : `${icon('play')}${t('Play the mix')}`
  /* Lecteur : pochette, vinyle qui tourne, artiste et titre de l'extrait en cours */
  const tr_ = result?.tracks[playingIdx]
  el("player").classList.toggle('on', !!tr_)
  if (!tr_) return
  el("playerCover").style.backgroundImage = tr_.cover ? `url(${bigCover(tr_.cover)})` : ''
  el("playerArtist").textContent = tr_.artist
  el("playerTitle").textContent = tr_.title
}
el("playerStop").onclick = () => stopPreview()
el("playerNext").onclick = () => playNext(playingIdx)
el("playerPrev").onclick = () => {
  const boxes = [...el("list").querySelectorAll('input')]
  const prev = boxes.map((c, i) => i).filter(i => i < playingIdx && boxes[i].checked && result.tracks[i].preview).pop()
  if (prev != null) playPreview(prev)
}
function stopPreview() {
  clearTimeout(stallTimer)
  audio.pause()
  playingIdx = -1; autoplay = false
  markPlaying()
  if (radioPaused) { radioPaused = false; radio.play() }
}
function playPreview(i) {
  const t = result?.tracks[i]
  if (!t?.preview) return autoplay ? playNext(i) : stopPreview()
  if (radio.on) { radioPaused = true; radio.stop() }
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
const clock = sec => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
audio.ontimeupdate = () => { el("playerTime").textContent = `${clock(audio.currentTime || 0)} / ${clock(audio.duration || 30)}` }
el("list").addEventListener('click', e => {
  const like = e.target.closest('[data-like]')
  if (like) {
    e.preventDefault()  // dans le label du titre : ne pas le décocher
    const t = result.tracks[+like.dataset.like]
    return runAdjust('artist', { name: firstArtist(t.artist), id: t.artistId || undefined }, t.styles)
  }
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
  el("create").textContent = tn(n, 'Create on Spotify · {n} track', 'Create on Spotify · {n} tracks')
  el("create").disabled = n === 0
}
el("list").addEventListener('change', e => {
  e.target.closest('.track')?.classList.toggle('off', !e.target.checked)
  const off = versions[shown]?.off
  if (off) e.target.checked ? off.delete(+e.target.dataset.i) : off.add(+e.target.dataset.i)
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
        step.textContent = t('Searching Spotify · {d} / {n}', { d: ++done, n: picked.length })
      }
    }))
    const found = [...new Set(uris.filter(Boolean))]
    step.textContent = t('Creating the playlist…')
    const pl = await spFetch('/me/playlists', {
      method: 'POST',
      body: JSON.stringify({ name: playlistName(), description: t('Made with Le Mix · {desc}', { desc: THEMES[resultTheme].desc }), public: false })
    })
    for (let i = 0; i < found.length; i += 100) {
      await spFetch(`/playlists/${pl.id}/items`, { method: 'POST', body: JSON.stringify({ uris: found.slice(i, i + 100) }) })
    }
    const missed = picked.length - found.length
    step.textContent = ''
    const url = pl.external_urls.spotify
    saveCurrentMix(url)  // dans Mes mixes, avec le lien Spotify (js/account.js)
    el("done").innerHTML = `✓ ${tn(found.length, '{n} track added', '{n} tracks added')}${missed ? ' · ' + tn(missed, '{n} not found on Spotify', '{n} not found on Spotify ') : ''}
      <div class="done__actions">
        <a class="pill-button pill-button--filled" href="${esc(url)}" target="_blank" rel="noopener">${t('Open in Spotify ↗')}</a>
        ${navigator.share ? `<button class="pill-button" id="share">${t('Share')}</button>` : ''}
      </div>`
    el("done").classList.add('on')
    el("done").scrollIntoView({ behavior: 'smooth', block: 'center' })
    navigator.vibrate?.(40)
    el("share")?.addEventListener('click', () => navigator.share({ title: playlistName(), url }).catch(() => {}))
  } catch (e) {
    step.textContent = t('Spotify error: {e}', { e: e.message })
  } finally {
    el("create").disabled = false
  }
}

/* ── Démarrage : app installable, retour de connexion Spotify ── */
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {})

showScreen('form')
renderRadio()
/* Lien venu de la page radio pendant l'écoute (radio=1) : plus de radio en fond ici, on nettoie l'adresse */
if (startParams.has('radio')) {
  const u = new URL(location.href)
  u.searchParams.delete('radio')
  history.replaceState({}, '', u)
}
;(async () => {
  restoreForm()
  syncLive()
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
  /* Connexion lancée par un cœur de la radio : dans la fenêtre à part on enregistre le jeton et on ferme
     (la radio le voit passer), sinon on retourne à la radio qui like le titre en attente */
  if (params.get('state') === 'like') {
    try { if (code) await spExchange(code) } catch {}
    if (window.opener && window.name === 'spotify-login') return window.close()
    return location.replace('radio.html?liked')
  }
  if (code) {
    history.replaceState({}, '', location.pathname)
    try { await spExchange(code) } catch (e) { showError(t('Spotify sign-in failed ({e}).', { e: e.message })) }
  }
  updateHint()
  if (SOURCE === 'spotify') seedInputs.forEach((x, i) => x.value && checkSeed(i))
  syncRows()
  loadMine()
})()
