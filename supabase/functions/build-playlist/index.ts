/* Génère une sélection à partir des titres de quelques playlists (seeds) et d'un thème :
   profil Deezer (genres, BPM) → titres proches (artistes similaires) → score → sélection → ordre */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

/* ── Thèmes prédéfinis (genres = noms Deezer en français) ───── */
type Curve = 'rise' | 'fall' | 'flat' | 'wave'
type Theme = { bpm: [number, number], like: string[], avoid: string[], curve: Curve }
const THEMES: Record<string, Theme> = {
  apero:    { bpm: [92, 118],  curve: 'rise',
              like: ['Soul & Funk', 'R&B', 'Musique brésilienne', 'Jazz', 'Pop', 'Reggae', 'Latino', 'Musique africaine', 'Electro'],
              avoid: ['Metal', 'Classique', 'Jeunesse', 'Livres audio', 'Films/Jeux vidéo'] },
  soiree:   { bpm: [110, 128], curve: 'rise',
              like: ['Dance', 'Electro', 'Soul & Funk', 'Pop', 'Rap/Hip Hop', 'Latino', 'R&B', 'Musique africaine'],
              avoid: ['Classique', 'Folk', 'Country', 'Jeunesse', 'Livres audio', 'Films/Jeux vidéo'] },
  nuit:     { bpm: [85, 115],  curve: 'fall',
              like: ['Electro', 'Jazz', 'R&B', 'Alternative', 'Soul & Funk', 'Musique brésilienne'],
              avoid: ['Metal', 'Jeunesse', 'Livres audio', 'Country'] },
  dimanche: { bpm: [70, 105],  curve: 'flat',
              like: ['Jazz', 'Folk', 'Soul & Funk', 'Musique brésilienne', 'Alternative', 'Chanson française', 'Pop', 'Blues'],
              avoid: ['Metal', 'Dance', 'Rap/Hip Hop', 'Jeunesse', 'Livres audio'] },
  route:    { bpm: [100, 135], curve: 'wave',
              like: ['Rock', 'Pop', 'Alternative', 'Soul & Funk', 'Rap/Hip Hop', 'Country', 'Blues'],
              avoid: ['Classique', 'Jeunesse', 'Livres audio'] },
  focus:    { bpm: [80, 120],  curve: 'flat',
              like: ['Electro', 'Jazz', 'Classique', 'Alternative', 'Films/Jeux vidéo'],
              avoid: ['Rap/Hip Hop', 'Metal', 'Chanson française', 'Jeunesse', 'Livres audio'] },
  sport:    { bpm: [120, 150], curve: 'rise',
              like: ['Dance', 'Electro', 'Rap/Hip Hop', 'Rock', 'Pop', 'Latino'],
              avoid: ['Jazz', 'Classique', 'Folk', 'Jeunesse', 'Livres audio', 'Blues'] }
}

/* ── Deezer : limiteur partagé (≤ 8 requêtes/s, la limite est 50 / 5 s) ── */
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
let nextSlot = 0
// deno-lint-ignore no-explicit-any
async function deezer(path: string, tries = 3): Promise<any> {
  const now = Date.now()
  const slot = Math.max(now, nextSlot)
  nextSlot = slot + 125
  if (slot > now) await sleep(slot - now)
  const res = await fetch('https://api.deezer.com' + path, { headers: { 'Accept-Language': 'fr' } })
  const d = res.ok ? await res.json() : null
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
  deezerId?: number, bpm: number, genres: string[], cover: string, rank: number,
  seed: boolean, score?: number
}

/* Genres d'album en cache (plusieurs titres partagent souvent le même album) */
const albumCache = new Map<number, Promise<string[]>>()
function albumGenres(id: number) {
  if (!albumCache.has(id)) albumCache.set(id, deezer(`/album/${id}`).then(a =>
    // deno-lint-ignore no-explicit-any
    (a?.genres?.data || []).map((g: any) => g.name).filter((g: string) => g !== 'Tous')))
  return albumCache.get(id)!
}

// deno-lint-ignore no-explicit-any
async function trackFromDeezer(d: any, seed: boolean, extra: Partial<Track> = {}): Promise<Track> {
  return {
    title: d.title, artist: d.artist?.name || '', artistId: d.artist?.id, isrc: d.isrc,
    deezerId: d.id, bpm: d.bpm || 0, genres: d.album?.id ? await albumGenres(d.album.id) : [],
    cover: d.album?.cover_small || '', rank: d.rank || 0, seed, ...extra
  }
}

/* Titre d'une playlist → fiche Deezer (par ISRC si possible, sinon recherche vérifiée) */
async function resolveSeed(s: { title: string, artist: string, isrc?: string, uri?: string }): Promise<Track> {
  const fallback: Track = { title: s.title, artist: s.artist, uri: s.uri, isrc: s.isrc, bpm: 0, genres: [], cover: '', rank: 0, seed: true }
  let d = s.isrc ? await deezer(`/track/isrc:${encodeURIComponent(s.isrc)}`) : null
  if (!d) {
    const artist = firstArtist(s.artist), title = cleanTitle(s.title) || s.title
    const r = await deezer(`/search?q=${encodeURIComponent(`${artist} ${title}`)}&limit=5`)
    // deno-lint-ignore no-explicit-any
    const hit = (r?.data || []).find((x: any) => near(loose(artist), loose(x.artist?.name)) && near(loose(title), loose(cleanTitle(x.title) || x.title)))
    if (hit) d = await deezer(`/track/${hit.id}`)
  }
  if (!d) return fallback
  return trackFromDeezer(d, true, { title: s.title, artist: s.artist, uri: s.uri, isrc: d.isrc || s.isrc })
}

/* ── Score ────────────────────────────────────────────────────── */
/* BPM ramené dans la plage du thème en acceptant le demi / double tempo */
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
function genreFit(genres: string[], th: Theme) {
  if (!genres.length) return 0.5
  if (genres.some(g => th.avoid.includes(g))) return 0
  return genres.some(g => th.like.includes(g)) ? 1 : 0.35
}

/* ── Ordre : courbe de tempo du thème, jamais deux fois le même artiste d'affilée ── */
function order(list: Track[], th: Theme) {
  const known = list.filter(t => t.bpm), unknown = list.filter(t => !t.bpm)
  const asc = [...known].sort((a, b) => effBpm(a.bpm, th.bpm) - effBpm(b.bpm, th.bpm))
  let out: Track[]
  if (th.curve === 'rise') out = asc
  else if (th.curve === 'fall') out = asc.reverse()
  else if (th.curve === 'wave') {
    const up = asc.filter((_, i) => i % 2 === 0), down = asc.filter((_, i) => i % 2 === 1).reverse()
    out = [...up, ...down]
  } else out = [...known].sort((a, b) => (b.score || 0) - (a.score || 0))
  /* Titres sans BPM répartis régulièrement */
  unknown.forEach((t, i) => out.splice(Math.round((i + 1) * out.length / (unknown.length + 1)), 0, t))
  for (let i = 1; i < out.length; i++) {
    if (loose(out[i].artist) !== loose(out[i - 1].artist)) continue
    const j = out.findIndex((t, k) => k > i && loose(t.artist) !== loose(out[i - 1].artist))
    if (j > 0) [out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

  try {
    const { seeds = [], theme = 'apero', length = 30, discovery = 0.5 } = await req.json()
    const th = THEMES[theme]
    if (!th) return json({ error: 'thème inconnu' }, 400)
    if (!Array.isArray(seeds) || !seeds.length) return json({ error: 'aucun titre de départ' }, 400)
    const N = Math.min(Math.max(+length || 30, 10), 80)
    const r = Math.min(Math.max(+discovery, 0), 1)

    /* 1. Profil : un échantillon des playlists (jusqu'à 80 titres) */
    const uniqSeeds = [...new Map(seeds.map((s: { artist: string, title: string }) => [songKey(s.artist, s.title), s])).values()]
    const sample = uniqSeeds.sort(() => Math.random() - 0.5).slice(0, 80)
    const seedTracks = await pool(sample, 6, resolveSeed)

    const genreShare = new Map<string, number>()
    for (const t of seedTracks) for (const g of t.genres) genreShare.set(g, (genreShare.get(g) || 0) + 1 / seedTracks.length)
    const artistCount = new Map<number, number>()
    for (const t of seedTracks) if (t.artistId) artistCount.set(t.artistId, (artistCount.get(t.artistId) || 0) + 1)
    const topArtists = [...artistCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => id)

    /* 2. Titres proches : artistes similaires aux artistes phares + autres titres de ces artistes */
    const related = new Map<number, number>()  // artiste → nombre d'artistes phares qui le citent
    await pool(topArtists, 4, async id => {
      const rel = await deezer(`/artist/${id}/related?limit=10`)
      for (const a of rel?.data || []) if (!artistCount.has(a.id)) related.set(a.id, (related.get(a.id) || 0) + 1)
    })
    const relArtists = [...related.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
    const maxRel = relArtists[0]?.[1] || 1

    const seen = new Set(seedTracks.map(t => songKey(t.artist, t.title)))
    const candIds: { id: number, affinity: number }[] = []
    await pool([...relArtists.map(([id, n]) => ({ id, n, close: false })), ...topArtists.map(id => ({ id, n: 0, close: true }))], 4, async a => {
      const top = await deezer(`/artist/${a.id}/top?limit=${a.close ? 4 : 3}`)
      for (const t of top?.data || []) {
        const k = songKey(t.artist?.name, t.title)
        if (seen.has(k)) continue
        seen.add(k)
        candIds.push({ id: t.id, affinity: a.close ? 0.9 : 0.4 + 0.5 * a.n / maxRel })
      }
    })
    const candidates = (await pool(candIds, 6, async c => {
      const d = await deezer(`/track/${c.id}`)
      return d ? { t: await trackFromDeezer(d, false), affinity: c.affinity } : null
    })).filter(Boolean) as { t: Track, affinity: number }[]

    /* 3. Score : thème (BPM + genres) et proximité avec les playlists */
    const profileFit = (g: string[]) => g.length ? Math.min(1, g.reduce((s, x) => s + (genreShare.get(x) || 0), 0) * 1.5) : 0.4
    const maxRank = Math.max(1, ...candidates.map(c => c.t.rank))
    for (const t of seedTracks) {
      t.score = 0.65 * (0.6 * bpmFit(t.bpm, th.bpm) + 0.4 * genreFit(t.genres, th)) + 0.35
    }
    for (const { t, affinity } of candidates) {
      const themeFit = 0.6 * bpmFit(t.bpm, th.bpm) + 0.4 * genreFit(t.genres, th)
      const pop = Math.log1p(t.rank) / Math.log1p(maxRank)
      t.score = 0.5 * themeFit + 0.3 * affinity + 0.15 * profileFit(t.genres) + 0.05 * pop
      if (genreFit(t.genres, th) === 0) t.score *= 0.3
    }

    /* 4. Sélection : part de découvertes demandée, 2 titres max par artiste */
    const perArtist = new Map<string, number>()
    const pick = (list: Track[], n: number) => {
      const out: Track[] = []
      for (const t of [...list].sort((a, b) => (b.score || 0) - (a.score || 0))) {
        if (out.length >= n) break
        const a = loose(firstArtist(t.artist))
        if ((perArtist.get(a) || 0) >= 2) continue
        perArtist.set(a, (perArtist.get(a) || 0) + 1)
        out.push(t)
      }
      return out
    }
    const nNew = Math.round(N * r)
    const fresh = pick(candidates.map(c => c.t), nNew)
    const fromSeeds = pick(seedTracks, N - fresh.length)
    const extra = fresh.length + fromSeeds.length < N ? pick(candidates.map(c => c.t).filter(t => !fresh.includes(t)), N - fresh.length - fromSeeds.length) : []

    const tracks = order([...fromSeeds, ...fresh, ...extra], th).map(t => ({
      title: t.title, artist: t.artist, isrc: t.isrc || null, uri: t.uri || null,
      deezerId: t.deezerId || null, bpm: Math.round(effBpm(t.bpm, th.bpm)) || null, genres: t.genres,
      cover: t.cover, seed: t.seed, score: Math.round((t.score || 0) * 100) / 100
    }))
    const profile = [...genreShare.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([g, s]) => ({ genre: g, share: Math.round(s * 100) }))
    return json({ tracks, profile, analysed: seedTracks.length, candidates: candidates.length })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
