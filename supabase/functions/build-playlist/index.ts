/* Génère une sélection à partir des titres de quelques playlists (seeds) :
   profil (styles, tempo, niveau de rareté) → titres d'artistes proches → filtres → score → ordre.
   Sources : Deezer (titres, BPM, artistes similaires, fans), Last.fm si LASTFM_API_KEY (styles fins) */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const LASTFM_KEY = Deno.env.get('LASTFM_API_KEY') || ''
const TIME_BUDGET_MS = 110_000  // la fonction est coupée à 150 s

/* ── Styles : étiquettes Last.fm (précises) ou genres d'album Deezer (secours) ── */
const STYLES: Record<string, { tags: string[], deezer: string[] }> = {
  funk:      { tags: ['funk', 'p-funk', 'deep funk', 'funk rock', 'jazz funk', 'jazz-funk', 'afro-funk', 'afro funk', 'latin funk', 'rare groove', 'boogie'], deezer: ['Soul & Funk'] },
  soul:      { tags: ['soul', 'northern soul', 'southern soul', 'deep soul', 'modern soul', 'neo-soul', 'psychedelic soul', 'philly soul', 'motown', 'rare groove'], deezer: ['Soul & Funk', 'Soul'] },
  disco:     { tags: ['disco', 'boogie', 'post-disco', 'italo disco', 'nu disco', 'nu-disco', 'cosmic disco'], deezer: ['Disco'] },
  jazz:      { tags: ['jazz', 'jazz funk', 'jazz-funk', 'soul jazz', 'jazz fusion', 'fusion', 'spiritual jazz', 'latin jazz', 'acid jazz', 'ethio-jazz'], deezer: ['Jazz'] },
  afro:      { tags: ['afrobeat', 'afro-funk', 'afro funk', 'highlife', 'african', 'afro', 'ethio-jazz', 'afro-beat', 'semba'], deezer: ['Musique africaine'] },
  bresil:    { tags: ['mpb', 'bossa nova', 'samba', 'brazilian', 'brazil', 'tropicalia', 'samba soul', 'brasil'], deezer: ['Musique brésilienne'] },
  latin:     { tags: ['latin', 'salsa', 'latin jazz', 'boogaloo', 'cumbia', 'latin funk', 'afro-cuban', 'latin soul'], deezer: ['Latino', 'Salsa'] },
  rnb:       { tags: ['rnb', 'r&b', 'rhythm and blues', 'contemporary r&b', 'new jack swing'], deezer: ['R&B'] },
  house:     { tags: ['house', 'deep house', 'electronic', 'electronica', 'techno', 'dance', 'french house'], deezer: ['Electro', 'Techno/House', 'Dance'] },
  hiphop:    { tags: ['hip-hop', 'hip hop', 'rap', 'jazz rap', 'boom bap'], deezer: ['Rap/Hip Hop'] },
  reggae:    { tags: ['reggae', 'dub', 'roots reggae', 'rocksteady', 'ska', 'lovers rock'], deezer: ['Reggae'] },
  rock:      { tags: ['rock', 'classic rock', 'psychedelic rock', 'indie rock', 'garage rock', 'psychedelic'], deezer: ['Rock'] },
  pop:       { tags: ['pop', 'synthpop', 'indie pop', 'dream pop', 'city pop'], deezer: ['Pop', 'Pop Indé', 'Pop internationale'] },
  folk:      { tags: ['folk', 'singer-songwriter', 'acoustic', 'country'], deezer: ['Folk', 'Country'] },
  chanson:   { tags: ['chanson', 'french', 'chanson francaise', 'variete francaise', 'french pop'], deezer: ['Chanson française'] },
  chill:     { tags: ['chillout', 'downtempo', 'chill', 'ambient', 'trip-hop', 'lounge', 'balearic'], deezer: [] },
  classique: { tags: ['classical', 'soundtrack', 'score'], deezer: ['Classique', 'Films/Jeux vidéo'] },
  metal:     { tags: ['metal', 'heavy metal', 'hard rock', 'punk'], deezer: ['Metal'] }
}
const TAG_TO_STYLES = new Map<string, string[]>()
for (const [id, s] of Object.entries(STYLES)) for (const t of s.tags) TAG_TO_STYLES.set(t, [...(TAG_TO_STYLES.get(t) || []), id])
/* Styles voisins : les genres d'album Deezer sont grossiers (beaucoup de funk classé « R&B »),
   donc un style déduit de Deezer compte aussi pour ses voisins */
const NEIGHBORS: Record<string, string[]> = {
  funk: ['soul', 'rnb', 'disco'], soul: ['funk', 'rnb'], rnb: ['soul', 'funk'], disco: ['funk', 'house', 'soul'],
  house: ['disco'], bresil: ['latin', 'jazz'], latin: ['bresil', 'afro'], hiphop: ['rnb'], chill: ['jazz', 'house'], jazz: ['chill', 'funk'],
  afro: ['funk', 'jazz', 'latin'], reggae: ['afro'], folk: ['chanson'], chanson: ['folk', 'pop'], rock: ['pop'], pop: ['rnb']
}
const fromDeezer = (genres: string[]) => [...new Set(genres.flatMap(g => Object.entries(STYLES).filter(([, s]) => s.deezer.includes(g)).map(([id]) => id)))]

/* ── Thèmes prédéfinis ───────────────────────────────────────── */
type Curve = 'rise' | 'fall' | 'wave' | 'none'
type Theme = { bpm: [number, number] | null, like: string[], avoid: string[], curve: Curve }
const THEMES: Record<string, Theme> = {
  libre:    { bpm: null,       curve: 'none', like: [], avoid: [] },
  diner:    { bpm: [80, 112],  curve: 'none', like: ['soul', 'jazz', 'bresil', 'funk', 'afro', 'latin', 'rnb', 'chill'], avoid: ['metal', 'hiphop', 'house'] },
  apero:    { bpm: [92, 118],  curve: 'rise', like: ['funk', 'soul', 'bresil', 'jazz', 'latin', 'afro', 'disco', 'reggae', 'rnb'], avoid: ['metal', 'classique'] },
  soiree:   { bpm: [110, 128], curve: 'rise', like: ['disco', 'house', 'funk', 'hiphop', 'latin', 'afro', 'rnb', 'pop'], avoid: ['classique', 'folk', 'chill', 'metal'] },
  nuit:     { bpm: [85, 115],  curve: 'fall', like: ['house', 'chill', 'jazz', 'rnb', 'soul'], avoid: ['metal', 'rock', 'folk'] },
  dimanche: { bpm: [70, 105],  curve: 'none', like: ['jazz', 'folk', 'soul', 'bresil', 'chill', 'chanson'], avoid: ['metal', 'house', 'hiphop'] },
  route:    { bpm: [100, 135], curve: 'wave', like: ['rock', 'pop', 'funk', 'soul', 'hiphop', 'disco'], avoid: ['classique', 'chill'] },
  focus:    { bpm: [80, 120],  curve: 'none', like: ['chill', 'jazz', 'house', 'classique'], avoid: ['hiphop', 'metal', 'chanson'] },
  sport:    { bpm: [120, 150], curve: 'rise', like: ['house', 'hiphop', 'disco', 'rock', 'funk'], avoid: ['jazz', 'classique', 'folk', 'chill'] }
}
/* Rareté visée (nombre de fans Deezer de l'artiste) et bornes strictes */
const NICHE: Record<string, { target: number, min: number, max: number }> = {
  connu:     { target: 500_000, min: 20_000, max: Infinity },
  equilibre: { target: 30_000,  min: 0,      max: 600_000 },
  pepites:   { target: 1_000,   min: 0,      max: 30_000 }
}

/* ── Limiteurs : Deezer ≤ 8 req/s (limite 50 / 5 s), Last.fm ≤ 4 req/s ── */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function limiter(gapMs: number) {
  let next = 0
  return async () => {
    const now = Date.now(), slot = Math.max(now, next)
    next = slot + gapMs
    if (slot > now) await sleep(slot - now)
  }
}
const deezerSlot = limiter(125), lastfmSlot = limiter(250)

// deno-lint-ignore no-explicit-any
async function deezer(path: string, tries = 3): Promise<any> {
  await deezerSlot()
  const res = await fetch('https://api.deezer.com' + path, { headers: { 'Accept-Language': 'fr' } }).catch(() => null)
  const d = res?.ok ? await res.json() : null
  if (d && !d.error) return d
  if (d?.error?.code === 800) return null  // introuvable
  if (tries > 0) { await sleep(1500); return deezer(path, tries - 1) }
  return null
}

async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

/* ── Normalisation (même logique que la page) ─────────────────── */
const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
const cleanTitle = (s: string) => (s || '')
  .replace(/\s*[([][^)\]]*(feat|ft\.|with|edit|remaster|version|mix|live)[^)\]]*[)\]]/gi, '')
  .replace(/\s+-\s+.*(remaster|edit|version|mix|live).*$/i, '')
  .replace(/\s+(feat\.?|ft\.?)\s.*$/i, '')
  .trim()
const firstArtist = (s: string) => (s || '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+|,\s*/i)[0].trim()
const loose = (s: string) => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const near = (a: string, b: string) => !!a && !!b && (a.includes(b) || b.includes(a))
const songKey = (artist: string, title: string) => loose(firstArtist(artist)) + '|' + loose(cleanTitle(title) || title)

type Track = {
  title: string, artist: string, artistId?: number, isrc?: string, uri?: string,
  deezerId?: number, bpm: number, styles: string[], precise?: boolean, fans: number | null,
  cover: string, seed: boolean, score?: number
}

/* Caches de la requête : genres d'album, fans et étiquettes par artiste */
const albumCache = new Map<number, Promise<string[]>>()
function albumGenres(id: number) {
  if (!albumCache.has(id)) albumCache.set(id, deezer(`/album/${id}`).then(a =>
    // deno-lint-ignore no-explicit-any
    (a?.genres?.data || []).map((g: any) => g.name).filter((g: string) => g !== 'Tous')))
  return albumCache.get(id)!
}
const fansCache = new Map<number, Promise<number | null>>()
function artistFans(id?: number) {
  if (!id) return Promise.resolve(null)
  if (!fansCache.has(id)) fansCache.set(id, deezer(`/artist/${id}`).then(a => a?.nb_fan ?? null))
  return fansCache.get(id)!
}
const tagCache = new Map<string, Promise<string[]>>()
function artistStyles(name: string): Promise<string[]> {
  if (!LASTFM_KEY || !name) return Promise.resolve([])
  const k = loose(name)
  if (!tagCache.has(k)) tagCache.set(k, (async () => {
    await lastfmSlot()
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptags&autocorrect=1&format=json&api_key=${LASTFM_KEY}&artist=${encodeURIComponent(name)}`
    const d = await fetch(url).then(r => r.ok ? r.json() : null).catch(() => null)
    // deno-lint-ignore no-explicit-any
    const tags: { name: string, count: number }[] = (d?.toptags?.tag || []).filter((t: any) => t.count >= 15).slice(0, 10)
    return [...new Set(tags.flatMap(t => TAG_TO_STYLES.get(t.name.toLowerCase()) || []))]
  })())
  return tagCache.get(k)!
}

// deno-lint-ignore no-explicit-any
async function trackFromDeezer(d: any, seed: boolean, extra: Partial<Track> = {}): Promise<Track> {
  const artist = extra.artist || d.artist?.name || ''
  const [genres, tagStyles, fans] = await Promise.all([
    d.album?.id ? albumGenres(d.album.id) : Promise.resolve([] as string[]),
    artistStyles(firstArtist(artist)),
    extra.fans !== undefined ? Promise.resolve(extra.fans) : artistFans(d.artist?.id)
  ])
  return {
    title: d.title, artist, artistId: d.artist?.id, isrc: d.isrc, deezerId: d.id,
    bpm: d.bpm || 0, styles: tagStyles.length ? tagStyles : fromDeezer(genres), precise: tagStyles.length > 0, fans,
    cover: d.album?.cover_small || '', seed, ...extra
  }
}

/* Titre d'une playlist → fiche Deezer (par ISRC si possible, sinon recherche vérifiée) */
async function resolveSeed(s: { title: string, artist: string, isrc?: string, uri?: string }): Promise<Track> {
  let d = s.isrc ? await deezer(`/track/isrc:${encodeURIComponent(s.isrc)}`) : null
  if (!d) {
    const artist = firstArtist(s.artist), title = cleanTitle(s.title) || s.title
    const r = await deezer(`/search?q=${encodeURIComponent(`${artist} ${title}`)}&limit=5`)
    // deno-lint-ignore no-explicit-any
    const hit = (r?.data || []).find((x: any) => near(loose(artist), loose(x.artist?.name)) && near(loose(title), loose(cleanTitle(x.title) || x.title)))
    if (hit) d = await deezer(`/track/${hit.id}`)
  }
  if (!d) {
    const styles = await artistStyles(firstArtist(s.artist))
    return { title: s.title, artist: s.artist, uri: s.uri, isrc: s.isrc, bpm: 0, styles, precise: true, fans: null, cover: '', seed: true }
  }
  return trackFromDeezer(d, true, { title: s.title, artist: s.artist, uri: s.uri, isrc: d.isrc || s.isrc })
}

/* ── Tempo ────────────────────────────────────────────────────── */
/* BPM ramené dans la plage visée en acceptant le demi / double tempo */
function effBpm(bpm: number, [lo, hi]: [number, number]) {
  if (!bpm) return 0
  const mid = (lo + hi) / 2
  return [bpm, bpm * 2, bpm / 2].reduce((a, b) => Math.abs(b - mid) < Math.abs(a - mid) ? b : a)
}
function bpmFit(bpm: number, range: [number, number]) {
  const b = effBpm(bpm, range)
  if (!b) return 0.5  // inconnu : neutre
  const [lo, hi] = range
  const d = b < lo ? lo - b : b > hi ? b - hi : 0
  return Math.max(0, 1 - d / 20)
}

/* ── Ordre : courbe de tempo choisie, jamais deux fois le même artiste d'affilée ── */
function order(list: Track[], curve: Curve, range: [number, number]) {
  let out: Track[]
  if (curve === 'none') out = [...list].sort(() => Math.random() - 0.5)
  else {
    const known = list.filter(t => t.bpm), unknown = list.filter(t => !t.bpm)
    const asc = [...known].sort((a, b) => effBpm(a.bpm, range) - effBpm(b.bpm, range))
    if (curve === 'rise') out = asc
    else if (curve === 'fall') out = asc.reverse()
    else out = [...asc.filter((_, i) => i % 2 === 0), ...asc.filter((_, i) => i % 2 === 1).reverse()]
    /* Titres sans BPM répartis régulièrement */
    unknown.forEach((t, i) => out.splice(Math.round((i + 1) * out.length / (unknown.length + 1)), 0, t))
  }
  for (let i = 1; i < out.length; i++) {
    if (loose(out[i].artist) !== loose(out[i - 1].artist)) continue
    const j = out.findIndex((t, k) => k > i && loose(t.artist) !== loose(out[i - 1].artist))
    if (j > 0) [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const median = (xs: number[]) => {
  const s = xs.filter(x => x > 0).sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
  const t0 = Date.now()
  const late = () => Date.now() - t0 > TIME_BUDGET_MS

  try {
    const { seeds = [], theme = 'libre', length = 30, discovery = 0.5,
            niche = 'auto', styles: wanted = [], curve: curveIn = 'theme', relax = false, keep: keepIn = [] } = await req.json()
    const th = THEMES[theme]
    if (!th) return json({ error: 'thème inconnu' }, 400)
    if (!Array.isArray(seeds) || !seeds.length) return json({ error: 'aucun titre de départ' }, 400)
    const N = Math.min(Math.max(+length || 30, 10), 80)
    const r = Math.min(Math.max(+discovery, 0), 1)
    const wantedStyles = (Array.isArray(wanted) ? wanted : []).filter((s: string) => STYLES[s])
    const curve: Curve = ['rise', 'fall', 'wave', 'none'].includes(curveIn) ? curveIn : th.curve
    /* Titres déjà retenus (complétion) : gardés tels quels, on ne fait que compléter */
    const keep: Track[] = (Array.isArray(keepIn) ? keepIn : []).slice(0, N).map((t: Track) => ({
      ...t, bpm: t.bpm || 0, styles: t.styles || [], fans: t.fans ?? null,
      cover: t.cover || '', seed: !!t.seed, score: 1
    }))

    /* 1. Profil : un échantillon des playlists (jusqu'à 70 titres) */
    const uniqSeeds = [...new Map(seeds.map((s: { artist: string, title: string }) => [songKey(s.artist, s.title), s])).values()]
    const sample = uniqSeeds.sort(() => Math.random() - 0.5).slice(0, 70)
    const seedTracks = await pool(sample, 6, resolveSeed)

    const styleShare = new Map<string, number>()
    for (const t of seedTracks) for (const s of t.styles) styleShare.set(s, (styleShare.get(s) || 0) + 1 / seedTracks.length)
    const seedBpm = median(seedTracks.map(t => t.bpm))
    const range: [number, number] = th.bpm || (seedBpm ? [seedBpm - 12, seedBpm + 12] : [90, 120])
    const seedFans = median(seedTracks.map(t => t.fans || 0)) || 10_000
    const nicheRule = { ...(NICHE[niche] || { target: seedFans, min: 0, max: Math.max(50_000, seedFans * 30) }) }

    const artistCount = new Map<number, number>()
    for (const t of seedTracks) if (t.artistId) artistCount.set(t.artistId, (artistCount.get(t.artistId) || 0) + 1)
    const topArtists = [...artistCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([id]) => id)

    /* Assouplissement (bouton « Compléter ») : rareté élargie, styles voisins acceptés, un tour de recherche de plus */
    if (relax) { nicheRule.min = nicheRule.min / 4; nicheRule.max = nicheRule.max * 4 }
    const fitsNiche = (fans: number | null) => fans === null || (fans >= nicheRule.min && fans <= nicheRule.max)

    /* 2. Artistes proches, dans la bonne rareté */
    const related = new Map<number, { n: number, fans: number }>()
    const expanded = new Set<number>()
    const addRelated = async (id: number, weight: number) => {
      if (expanded.has(id)) return
      expanded.add(id)
      const rel = await deezer(`/artist/${id}/related?limit=12`)
      for (const a of rel?.data || []) {
        if (artistCount.has(a.id)) continue
        const cur = related.get(a.id)
        related.set(a.id, { n: (cur?.n || 0) + weight, fans: a.nb_fan ?? 0 })
      }
    }
    await pool(topArtists, 4, id => addRelated(id, 1))
    /* 2e niveau pour aller chercher plus rare */
    if (!late() && nicheRule.target < 50_000) {
      const rareOnes = [...related.entries()].filter(([, a]) => a.fans < 60_000).sort((a, b) => b[1].n - a[1].n).slice(0, 10)
      await pool(rareOnes.map(([id]) => id), 4, id => addRelated(id, 0.5))
    }

    /* Titres phares d'une liste d'artistes → candidats notés (sans doublon) */
    const seen = new Set([...seedTracks, ...keep].map(t => songKey(t.artist, t.title)))
    const harvested = new Set<number>()
    const candidates: { t: Track, affinity: number }[] = []
    let nicheRejected = 0
    async function harvest(list: { id: number, affinity: number, fans: number | null, top: number }[]) {
      const ids: { id: number, affinity: number, fans: number | null }[] = []
      await pool(list.filter(a => !harvested.has(a.id)), 4, async a => {
        harvested.add(a.id)
        if (late()) return
        const top = await deezer(`/artist/${a.id}/top?limit=${a.top}`)
        for (const t of top?.data || []) {
          const k = songKey(t.artist?.name, t.title)
          if (seen.has(k)) continue
          seen.add(k)
          ids.push({ id: t.id, affinity: a.affinity, fans: t.artist?.id === a.id ? a.fans : null })
        }
      })
      const found = (await pool(ids, 6, async c => {
        if (late()) return null
        const d = await deezer(`/track/${c.id}`)
        return d ? { t: await trackFromDeezer(d, false, c.fans !== null ? { fans: c.fans } : {}), affinity: c.affinity } : null
      })).filter(Boolean) as { t: Track, affinity: number }[]
      for (const c of found) scoreCandidate(c)
      candidates.push(...found)
      return found.map(c => c.t)
    }
    const relatedSources = (limit: number) => {
      const all = [...related.entries()].filter(([id]) => !harvested.has(id))
      const ok = all.filter(([, a]) => fitsNiche(a.fans))
      nicheRejected += all.length - ok.length
      const maxRel = Math.max(1, ...ok.map(([, a]) => a.n))
      return ok.sort((a, b) => b[1].n - a[1].n).slice(0, limit)
        .map(([id, a]) => ({ id, affinity: 0.4 + 0.5 * a.n / maxRel, fans: a.fans as number | null, top: 3 }))
    }

    /* 3. Score : thème (tempo + styles), proximité avec les playlists, rareté */
    const styleFit = (st: string[]) => {
      if (!th.like.length && !th.avoid.length) return 0.5
      if (!st.length) return 0.5
      const liked = st.some(s => th.like.includes(s)), avoided = st.some(s => th.avoid.includes(s))
      return liked ? 1 : avoided ? 0 : 0.35
    }
    const profileFit = (st: string[]) => st.length ? Math.min(1, st.reduce((s, x) => s + (styleShare.get(x) || 0), 0) * 1.2) : 0.4
    const themeFit = (t: Track) => th.bpm
      ? 0.55 * bpmFit(t.bpm, range) + 0.45 * styleFit(t.styles)
      : 0.4 * bpmFit(t.bpm, range) + 0.6 * profileFit(t.styles)
    const nicheFit = (fans: number | null) => fans ? Math.max(0, 1 - Math.abs(Math.log10(fans) - Math.log10(nicheRule.target)) / 2.5) : 0.5
    function scoreCandidate({ t, affinity }: { t: Track, affinity: number }) {
      t.score = 0.35 * themeFit(t) + 0.25 * affinity + 0.2 * profileFit(t.styles) + 0.2 * nicheFit(t.fans)
      if (th.bpm && styleFit(t.styles) === 0) t.score *= relax ? 0.7 : 0.3
    }
    for (const t of seedTracks) t.score = 0.6 * themeFit(t) + 0.4

    await harvest([
      ...relatedSources(32),
      ...topArtists.map(id => ({ id, affinity: 0.9, fans: null as number | null, top: 4 }))
    ])

    /* 4. Styles choisis : seuls les titres qui en font partie (jamais ceux au style inconnu) */
    const exactStyle = (t: Track) => t.styles.some(s => wantedStyles.includes(s))
    const nearStyle = (t: Track) => (relax || !t.precise) && t.styles.some(s => wantedStyles.some(w => NEIGHBORS[w]?.includes(s)))
    const styleOk = (t: Track) => (t.seed || fitsNiche(t.fans)) && (!wantedStyles.length || exactStyle(t) || nearStyle(t))
    /* Style certain d'abord : un titre retenu seulement par voisinage passe après */
    const rank = (t: Track) => (t.score || 0) + (wantedStyles.length && exactStyle(t) ? 0.15 : 0)

    /* 5. Sélection : part de découvertes demandée, 2 titres max par artiste */
    const perArtist = new Map<string, number>()
    for (const t of keep) { const a = loose(firstArtist(t.artist)); perArtist.set(a, (perArtist.get(a) || 0) + 1) }
    const pick = (list: Track[], n: number) => {
      const out: Track[] = []
      for (const t of [...list].sort((a, b) => rank(b) - rank(a))) {
        if (out.length >= n) break
        const a = loose(firstArtist(t.artist))
        if ((perArtist.get(a) || 0) >= 2) continue
        perArtist.set(a, (perArtist.get(a) || 0) + 1)
        out.push(t)
      }
      return out
    }
    const chosen: Track[] = [...keep]
    const need = () => N - chosen.length
    const nNew = Math.max(0, Math.round(N * r) - keep.filter(t => !t.seed).length)
    chosen.push(...pick(candidates.map(c => c.t).filter(styleOk), Math.min(nNew, need())))
    const keepKeys = new Set(keep.map(t => songKey(t.artist, t.title)))
    chosen.push(...pick(seedTracks.filter(t => styleOk(t) && !chosen.includes(t) && !keepKeys.has(songKey(t.artist, t.title))), need()))
    if (need() > 0) chosen.push(...pick(candidates.map(c => c.t).filter(t => styleOk(t) && !chosen.includes(t)), need()))

    /* 6. Il en manque : on creuse autour des artistes qui passent les filtres (2 tours, 3 en assouplissant) */
    let rounds = 0
    while (need() > 0 && rounds < (relax ? 3 : 2) && !late()) {
      rounds++
      const anchors = [...new Set([...chosen, ...candidates.map(c => c.t)].filter(styleOk).map(t => t.artistId).filter(Boolean) as number[])]
        .filter(id => !expanded.has(id)).slice(0, 12)
      if (!anchors.length) break
      await pool(anchors, 4, id => addRelated(id, 0.7))
      const fresh = await harvest(relatedSources(24))
      chosen.push(...pick(fresh.filter(styleOk), need()))
    }

    const styleRejected = candidates.filter(c => !styleOk(c.t)).length + seedTracks.filter(t => !styleOk(t)).length
    const tracks = order(chosen, curve, range).map(t => ({
      title: t.title, artist: t.artist, artistId: t.artistId || null, isrc: t.isrc || null, uri: t.uri || null,
      deezerId: t.deezerId || null, bpm: Math.round(effBpm(t.bpm, range)) || null,
      styles: t.styles, fans: t.fans, cover: t.cover, seed: t.seed
    }))
    const profile = [...styleShare.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([style, s]) => ({ style, share: Math.round(s * 100) }))
    return json({
      tracks, profile, curve, bpm: seedBpm ? Math.round(seedBpm) : null, fans: seedFans,
      analysed: seedTracks.length, candidates: candidates.length, lastfm: !!LASTFM_KEY, relaxed: !!relax, rounds,
      short: Math.max(0, N - tracks.length), rejected: { style: styleRejected, niche: nicheRejected }, ms: Date.now() - t0
    })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
