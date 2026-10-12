/* Tempo des titres de la radio (track_info.bpm), quelques titres par passage du cron :
   BPM Deezer s'il existe, sinon calculé sur l'extrait de 30 s (≈ 90 % d'accord avec Deezer quand il le connaît).
   bpm null = pas encore traité, 0 = introuvable */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { MPEGDecoder } from 'npm:mpg123-decoder@1.0.3'
import { estimateBpm } from './tempo.ts'

const PER_RUN = 4          // ≈ 0,2 s de calcul par extrait
const TIME_BUDGET_MS = 40_000

const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
const cleanTitle = (s: string) => (s || '')
  .replace(/\s*[([][^)\]]*(feat|ft\.|with|edit|remaster|version|mix|live)[^)\]]*[)\]]/gi, '')
  .replace(/\s+-\s+.*(remaster|edit|version|mix|live).*$/i, '')
  .replace(/\s+(feat\.?|ft\.?)\s.*$/i, '')
  .trim()
const firstArtist = (s: string) => (s || '').split(/\s+(?:feat\.?|ft\.?|featuring)\s+/i)[0].trim()
const loose = (s: string) => norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '')
const near = (a: string, b: string) => !!a && !!b && (a.includes(b) || b.includes(a))
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// deno-lint-ignore no-explicit-any
async function deezer(path: string): Promise<any> {
  await sleep(150)
  const res = await fetch('https://api.deezer.com' + path, { headers: { 'Accept-Language': 'fr' } })
  if (!res.ok) throw new Error('Deezer ' + res.status)
  const d = await res.json()
  if (d?.error && d.error.code !== 800) throw new Error('Deezer ' + (d.error.code ?? ''))
  return d?.error ? null : d
}

/* Même correspondance que poll-radio : artiste et titre doivent coller */
async function findTrack(rawArtist: string, rawTitle: string) {
  const artist = firstArtist(rawArtist), title = cleanTitle(rawTitle) || rawTitle
  const la = loose(artist), lt = loose(title)
  const r = await deezer(`/search?q=${encodeURIComponent(`${artist} ${title}`.trim())}&limit=10`)
  // deno-lint-ignore no-explicit-any
  const hit = (r?.data || []).find((x: any) => (!la || near(la, loose(x.artist?.name))) && near(lt, loose(cleanTitle(x.title) || x.title)))
  return hit ? deezer(`/track/${hit.id}`) : null
}

let decoder: MPEGDecoder | null = null
async function bpmOfPreview(url: string) {
  const res = await fetch(url)
  if (!res.ok) return 0
  if (!decoder) { decoder = new MPEGDecoder(); await decoder.ready }
  const { channelData, sampleRate } = decoder.decode(new Uint8Array(await res.arrayBuffer()))
  decoder.reset()
  if (!channelData.length || !channelData[0].length) return 0
  const [l, r] = channelData
  const mono = r ? l.map((v, i) => (v + r[i]) / 2) : l
  return estimateBpm(mono, sampleRate)
}

Deno.serve(async () => {
  const t0 = Date.now()
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: todo, error } = await sb.from('track_info').select('artist, title').is('bpm', null)
    .order('updated_at', { ascending: false }).limit(PER_RUN)
  if (error) return new Response(error.message, { status: 500 })

  const done: { title: string, bpm: number, source: string }[] = []
  for (const { artist, title } of todo || []) {
    if (Date.now() - t0 > TIME_BUDGET_MS) break
    let bpm = 0, source = 'introuvable'
    try {
      const d = await findTrack(artist, title)
      if (d?.bpm > 0) { bpm = Math.round(d.bpm); source = 'deezer' }
      else if (d?.preview) { bpm = await bpmOfPreview(d.preview); source = bpm ? 'extrait' : 'introuvable' }
    } catch {
      break  // Deezer limite : on reprendra au prochain passage
    }
    /* Clé générée par la base : on cible la ligne par artiste + titre exacts */
    await sb.from('track_info').update({ bpm }).eq('artist', artist).eq('title', title)
    done.push({ title, bpm, source })
  }
  return new Response(JSON.stringify({ done, ms: Date.now() - t0 }), { headers: { 'Content-Type': 'application/json' } })
})
