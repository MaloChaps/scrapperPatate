import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const API = 'https://api.radioking.io/widget/radio/radio-jockey/track/current'
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

/* ── Genres + miniature Deezer (même logique que le client) ──── */
const INFO_PER_RUN = 15  // ≤ 4 requêtes par titre, espacées : sous la limite Deezer (50 / 5 s)
const VAGUE_GENRES = new Set(['music', 'musique', 'tous'])
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const cleanTitle = (s: string) => (s || '')
  .replace(/\s*[([][^)\]]*(feat|ft\.|with|edit|remaster|version|mix|live)[^)\]]*[)\]]/gi, '')
  .replace(/\s+-\s+.*(remaster|edit|version|mix|live).*$/i, '')
  .replace(/\s+(feat\.?|ft\.?)\s.*$/i, '')
  .trim()
const firstArtist = (s: string) => (s || '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0].trim()
const loose = (s: string) => norm(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const near = (a: string, b: string) => !!a && !!b && (a.includes(b) || b.includes(a))

// deno-lint-ignore no-explicit-any
async function deezer(path: string): Promise<any> {
  await sleep(150)
  const res = await fetch('https://api.deezer.com' + path, { headers: { 'Accept-Language': 'fr' } })
  if (!res.ok) throw new Error('Deezer ' + res.status)
  const d = await res.json()
  if (d?.error) throw new Error('Deezer ' + (d.error.code ?? ''))
  return d
}

/* Genres de l'album, seulement si l'artiste du titre ET de l'album correspond
   (on écarte compilations / BO dont les genres ne disent rien du morceau) */
async function deezerLookup(rawArtist: string, rawTitle: string) {
  const artist = firstArtist(rawArtist)
  const title  = cleanTitle(rawTitle) || rawTitle
  const la = loose(artist), lt = loose(title)
  const r = await deezer(`/search?q=${encodeURIComponent(`${artist} ${title}`.trim())}&limit=10`)
  // deno-lint-ignore no-explicit-any
  const hits = (r.data || []).filter((x: any) =>
    (!la || near(la, loose(x.artist?.name))) && near(lt, loose(cleanTitle(x.title) || x.title)))
  for (const h of hits.slice(0, 3)) {
    const al = await deezer(`/album/${h.album.id}`)
    if (la && !near(la, loose(al.artist?.name))) continue
    // deno-lint-ignore no-explicit-any
    const genres = (al.genres?.data || []).map((g: any) => g.name).filter((g: string) => !VAGUE_GENRES.has(g.toLowerCase()))
    return { art: h.album.cover_small || '', genre: genres.join(', ') }
  }
  return { art: (hits[0] || r.data?.[0])?.album?.cover_small || '', genre: '' }
}

async function fillTrackInfo(sb: SupabaseClient) {
  const { data: missing, error } = await sb.rpc('tracks_missing_info', { n: INFO_PER_RUN })
  if (error || !missing?.length) return 0
  let done = 0
  for (const { artist, title } of missing as { artist: string, title: string }[]) {
    try {
      const info = await deezerLookup(artist, title)
      await sb.from('track_info').upsert({ artist, title, ...info }, { onConflict: 'key' })
      done++
    } catch {
      break  // Deezer limite : on reprendra au prochain passage du cron
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
