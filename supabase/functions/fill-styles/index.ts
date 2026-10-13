/* Styles des titres de la radio (track_info.styles), quelques artistes par passage du cron :
   étiquettes Last.fm dominantes de l'artiste, sinon genres d'album Deezer (track_info.genre).
   styles null = pas encore traité ; la page (filtre et pastilles) et Le Mix lisent cette colonne */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { fromDeezer, tagStyles, topTags, type LastfmTag } from '../_shared/styles.ts'

const LASTFM_KEY = Deno.env.get('LASTFM_API_KEY') || ''
const PER_RUN = 60           // titres lus par passage ; les titres d'un même artiste partagent un appel
const TIME_BUDGET_MS = 40_000

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const firstArtist = (s: string) => (s || '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+|\s*;\s*/i)[0].trim()

/* Styles d'un artiste d'après Last.fm ; null si Last.fm ne répond pas (on reprendra au prochain passage) */
async function lastfmStyles(artist: string): Promise<string[] | null> {
  const url = `https://ws.audioscrobbler.com/2.0/?method=artist.gettoptags&autocorrect=1&format=json&api_key=${LASTFM_KEY}&artist=${encodeURIComponent(artist)}`
  const res = await fetch(url).catch(() => null)
  if (!res?.ok && res?.status !== 400 && res?.status !== 404) return null
  const d = await res.json().catch(() => null)
  if (d?.error && d.error !== 6) return null  // 6 = artiste inconnu : pas d'étiquettes, on passe aux genres Deezer
  const { styles, core } = tagStyles(topTags((d?.toptags?.tag || []) as LastfmTag[]))
  return core.length ? core : styles
}

Deno.serve(async () => {
  if (!LASTFM_KEY) return new Response('LASTFM_API_KEY manquant', { status: 500 })
  const t0 = Date.now()
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: rows, error } = await sb.from('track_info').select('key, artist, genre').is('styles', null).limit(PER_RUN)
  if (error) return new Response(error.message, { status: 500 })

  const byArtist = new Map<string, { key: string, genre: string }[]>()
  for (const r of rows || []) {
    const a = firstArtist(r.artist)
    byArtist.set(a, [...(byArtist.get(a) || []), r])
  }
  let done = 0
  for (const [artist, tracks] of byArtist) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break
    const fromLastfm = artist ? await lastfmStyles(artist) : []
    if (fromLastfm === null) break
    for (const t of tracks) {
      const styles = fromLastfm.length ? fromLastfm : fromDeezer(t.genre ? t.genre.split(', ') : [])
      const { error } = await sb.from('track_info').update({ styles }).eq('key', t.key)
      if (!error) done++
    }
    await sleep(250)  // Last.fm : 5 requêtes / s au plus
  }
  return new Response(JSON.stringify({ done }), { headers: { 'Content-Type': 'application/json' } })
})
