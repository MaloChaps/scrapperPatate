/* Comptes : tout membre peut inviter (par e-mail) ; seul un membre qui a l'accès radio peut le donner à son invité.
   Liste des membres et changement de leurs droits : admins seulement (profiles.admin).
   Appelée par le site avec le jeton du compte connecté ; les écritures passent par la clé service_role.
   POST { action: 'invite', email, radio, redirectTo } | admins : { action: 'list' } | { action: 'set', id, radio } */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const URL_ = Deno.env.get('SUPABASE_URL')!
/* Adresses de retour acceptées pour le lien d'invitation : le site en ligne et le site local */
const SITES = [/^https:\/\/music\.malochaperon\.com\//, /^https:\/\/malochaps\.github\.io\/scrapperPatate\//, /^http:\/\/(127\.0\.0\.1|localhost):\d+\//]

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

  /* Qui appelle ? Le jeton du compte connecté, vérifié par Supabase Auth */
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const sb = createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: { user } } = await sb.auth.getUser(token)
  if (!user) return json({ error: 'connexion requise' }, 401)
  const { data: me } = await sb.from('profiles').select('admin, radio').eq('id', user.id).maybeSingle()
  if (!me) return json({ error: 'compte inconnu' }, 403)

  try {
    const body = await req.json()
    if (body.action !== 'invite' && !me.admin) return json({ error: 'réservé aux admins' }, 403)
    if (body.action === 'list') {
      const { data, error } = await sb.from('profiles').select('id, email, radio, admin, created_at').order('created_at')
      if (error) throw error
      /* Invitation acceptée ou pas encore : dernière connexion côté Auth */
      const { data: users } = await sb.auth.admin.listUsers({ perPage: 1000 })
      const seen = new Map((users?.users || []).map(u => [u.id, u.last_sign_in_at]))
      return json({ members: (data || []).map(p => ({ ...p, joined: !!seen.get(p.id) })) })
    }
    if (body.action === 'invite') {
      const email = String(body.email || '').trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'adresse e-mail invalide' }, 400)
      if (body.radio && !me.radio && !me.admin) return json({ error: 'tu ne peux pas donner l\'accès radio : tu ne l\'as pas' }, 403)
      const redirectTo = SITES.some(re => re.test(String(body.redirectTo || ''))) ? String(body.redirectTo) : undefined
      const { data, error } = await sb.auth.admin.inviteUserByEmail(email, { redirectTo })
      if (error) return json({ error: error.message }, 400)
      if (body.radio) await sb.from('profiles').update({ radio: true }).eq('id', data.user.id)
      return json({ ok: true })
    }
    if (body.action === 'set') {
      if (body.id === user.id && body.radio === false) return json({ error: 'garde ton propre accès radio' }, 400)
      const { error } = await sb.from('profiles').update({ radio: !!body.radio }).eq('id', String(body.id))
      if (error) throw error
      return json({ ok: true })
    }
    return json({ error: 'action inconnue' }, 400)
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500)
  }
})
