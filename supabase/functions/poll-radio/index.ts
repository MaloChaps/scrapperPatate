import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const API = 'https://api.radioking.io/widget/radio/radio-jockey/track/current'
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/* ── Genre + miniature iTunes (même logique que le client) ───── */
const INFO_PER_RUN = 8  // ≤ 16 requêtes/min : sous la limite iTunes (~20/min)
const VAGUE_GENRES = new Set(['music', 'musique'])

const cleanTitle = (s: string) => (s || '')
  .replace(/\s*[([][^)\]]*(feat|ft\.|with|edit|remaster|version|mix|live)[^)\]]*[)\]]/gi, '')
  .replace(/\s+-\s+.*(remaster|edit|version|mix|live).*$/i, '')
  .replace(/\s+(feat\.?|ft\.?)\s.*$/i, '')
  .trim()
const firstArtist = (s: string) => (s || '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0].trim()
const loose = (s: string) => norm(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')

type ItunesResult = { artistName: string, trackName: string, primaryGenreName?: string, artworkUrl100?: string }

async function itunesSearch(term: string): Promise<ItunesResult[]> {
  const res = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(term)}&media=music&entity=song&limit=5`)
  if (!res.ok) throw new Error('iTunes ' + res.status)
  return (await res.json()).results || []
}

function itunesMatch(results: ItunesResult[], artist: string, title: string) {
  const la = loose(firstArtist(artist))
  const lt = loose(cleanTitle(title) || title)
  const near = (a: string, b: string) => !!a && !!b && (a.includes(b) || b.includes(a))
  return results.find(r => {
    const ra = loose(r.artistName), rt = loose(cleanTitle(r.trackName) || r.trackName)
    return la ? near(la, ra) && (!lt || near(lt, rt)) : lt === rt
  })
}

async function fillTrackInfo(sb: SupabaseClient) {
  const { data: missing, error } = await sb.rpc('tracks_missing_info', { n: INFO_PER_RUN })
  if (error || !missing?.length) return 0
  let done = 0
  for (const { artist, title } of missing as { artist: string, title: string }[]) {
    try {
      const t = cleanTitle(title) || title
      let results = await itunesSearch(`${firstArtist(artist)} ${t}`)
      let hit = itunesMatch(results, artist, title)
      if (!hit && t) { results = await itunesSearch(t); hit = itunesMatch(results, artist, title) }
      const art   = ((hit || results[0])?.artworkUrl100 || '').replace('100x100bb', '60x60bb')
      const genre = hit?.primaryGenreName || ''
      await sb.from('track_info').upsert(
        { artist, title, art, genre: VAGUE_GENRES.has(genre.toLowerCase()) ? '' : genre },
        { onConflict: 'key' })
      done++
    } catch {
      break  // iTunes limite : on reprendra au prochain passage du cron
    }
  }
  return done
}

/* ── Relevé du titre en cours ───────────────────────────────── */
async function pollRadio(sb: SupabaseClient): Promise<Response> {
  let title: string, artist: string
  try {
    const res = await fetch(API)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const d = await res.json()
    title = String(d.title || d.song || '').trim()
    artist = String(d.artist || d.artists || '').trim()
  } catch (e) {
    return new Response(String(e), { status: 502 })
  }

  if (!title) return new Response('no track', { status: 200 })

  const { data: last } = await sb
    .from('plays')
    .select('title, artist')
    .order('played_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (last && norm(last.title) === norm(title) && norm(last.artist) === norm(artist)) {
    return new Response('duplicate', { status: 200 })
  }

  const { error } = await sb.from('plays').insert({ title, artist })
  if (error) return new Response(error.message, { status: 500 })

  return new Response(JSON.stringify({ title, artist }), {
    headers: { 'Content-Type': 'application/json' }
  })
}

Deno.serve(async () => {
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const res = await pollRadio(sb)
  const filled = await fillTrackInfo(sb).catch(() => 0)
  res.headers.set('X-Track-Info-Filled', String(filled))
  return res
})
