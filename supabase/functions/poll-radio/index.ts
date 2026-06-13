import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const API = 'https://api.radioking.io/widget/radio/radio-jockey/track/current'
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()

Deno.serve(async () => {
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

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
})
