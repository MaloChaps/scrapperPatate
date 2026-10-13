/* Le Mix : compte (connexion par lien e-mail, sur invitation), mixes enregistrés, invitations (admins).
   Tables profiles / mixes (supabase/accounts.sql) et fonction serveur admin. Chargé après js/mix.js,
   dont il reprend l'écran de résultat (addVersion, renderResult, showScreen…). */

let me = null  // fiche du compte connecté (myProfile), null si déconnecté

/* ── Écran Compte ───────────────────────────────────────────── */
function openAccount(why = '') {
  el("loginWhy").textContent = why || 'Le Mix est sur invitation. Entre l\'adresse e-mail qui a reçu l\'invitation : on t\'envoie un lien pour te connecter.'
  showScreen('account')
  if (!me) el("loginEmail").focus()
}
el("accountBtn").onclick = () => openAccount()
el("fromAccount").onclick = () => showScreen(result ? 'result' : 'form')

/* Connecté ou pas, accès radio, admin : tout ce qui en dépend sur la page */
async function syncAccount() {
  me = await myProfile(true)
  document.body.toggleAttribute('data-radio', !!me?.radio)
  el("accountBtn").textContent = me ? 'Compte' : 'Se connecter'
  el("loginForm").hidden = !!me
  el("signedIn").hidden = !me
  el("toRadio").hidden = !me?.radio
  updateHint()
  el("sourceSwitch").href = SOURCE === 'radio' ? './' : './?source=radio'
  el("sourceSwitch").textContent = SOURCE === 'radio' ? '← Ou à partir de tes playlists' : 'Ou à partir des titres de la radio →'
  /* Mix à partir de la radio : réservé aux comptes qui ont l'accès radio */
  if (SOURCE === 'radio' && !me) openAccount('Le Mix à partir de la radio est réservé aux comptes invités : connecte-toi.')
  if (SOURCE === 'radio' && me && !me.radio) return location.replace('./')
  if (!me) return
  el("meEmail").textContent = me.email
  el("meRadio").hidden = !me.radio
  el("adminBox").hidden = !me.admin
  loadMixes()
  if (me.admin) loadMembers()
}

el("loginForm").onsubmit = async e => {
  e.preventDefault()
  const email = el("loginEmail").value.trim()
  el("loginGo").disabled = true
  el("loginMsg").textContent = 'Envoi du lien…'
  /* shouldCreateUser: false : une adresse sans invitation ne crée pas de compte */
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: SP_REDIRECT } })
  el("loginGo").disabled = false
  el("loginMsg").textContent = error
    ? (/signup|not allowed|not found/i.test(error.message) ? 'Cette adresse n\'a pas d\'invitation.' : 'Envoi impossible : ' + error.message)
    : `Lien envoyé à ${email} : ouvre-le sur cet appareil pour te connecter.`
}
el("logout").onclick = async () => {
  await sb.auth.signOut()
  await syncAccount()
  showScreen('form')
}

/* ── Mes mixes ──────────────────────────────────────────────── */
const mixDate = iso => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
async function loadMixes() {
  const { data, error } = await sb.from('mixes').select('id, name, source, created_at, spotify_url, tracks').order('created_at', { ascending: false }).limit(100)
  if (error) return el("mixList").innerHTML = `<li class="empty">Mixes illisibles (${esc(error.message)}).</li>`
  el("mixList").innerHTML = data.length ? data.map(m => `
    <li>
      <a class="mix__name" href="./?${m.source === 'radio' ? 'source=radio&' : ''}mix=${m.id}">${esc(m.name)}</a>
      <span class="mix__meta">${mixDate(m.created_at)} · ${plural(m.tracks.length, 'titre')}${m.source === 'radio' ? ' · radio' : ''}</span>
      ${m.spotify_url ? `<a class="pill-button" href="${esc(m.spotify_url)}" target="_blank" rel="noopener">Spotify ↗</a>` : ''}
      <button class="pill-button" type="button" data-del="${m.id}">Supprimer</button>
    </li>`).join('')
    : '<li class="empty">Aucun mix enregistré : génère un mix puis « Enregistrer » (ou crée-le sur Spotify, il est enregistré tout seul).</li>'
}
/* Supprimer : deuxième touche pour confirmer (pas de fenêtre de confirmation) */
el("mixList").addEventListener('click', async e => {
  const b = e.target.closest('[data-del]')
  if (!b) return
  if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Confirmer ?'; return }
  b.disabled = true
  const { error } = await sb.from('mixes').delete().eq('id', b.dataset.del)
  if (error) { b.disabled = false; b.textContent = 'Erreur'; return }
  versions.forEach(v => { if (v.savedId === b.dataset.del) delete v.savedId })
  loadMixes()
})

/* Enregistre la version affichée (titres cochés) ; une deuxième fois, elle est mise à jour.
   spotifyUrl : appelée après la création sur Spotify */
async function saveCurrentMix(spotifyUrl) {
  if (!me) return openAccount('Connecte-toi pour enregistrer tes mixes.')
  const v = versions[shown], tracks = pickedTracks()
  if (!v || !tracks.length) return
  const { current, keep, adjust, artist, relax, size, ...settings } = lastBody || {}
  const row = {
    name: playlistName().slice(0, 100), source: SOURCE, tracks,
    settings: { ...settings, theme: resultTheme, curve: result.curve, profile: result.profile || [], mode: result.mode || settings.mode },
    ...(spotifyUrl ? { spotify_url: spotifyUrl } : {})
  }
  el("saveMix").disabled = true
  const { data, error } = v.savedId
    ? await sb.from('mixes').update(row).eq('id', v.savedId).select('id').single()
    : await sb.from('mixes').insert(row).select('id').single()
  el("saveMix").disabled = false
  if (error) return el("createStep").textContent = 'Enregistrement impossible : ' + error.message
  v.savedId = data.id
  el("saveMix").textContent = 'Enregistré ✓'
  if (!spotifyUrl) el("createStep").textContent = 'Enregistré dans Mes mixes (Compte)'
  loadMixes()
}
el("saveMix").onclick = () => saveCurrentMix()

/* Rouvre un mix enregistré (?mix=…) dans l'écran de résultat : on peut l'écouter, l'ajuster, le créer sur Spotify */
async function openMix(id) {
  history.replaceState({}, '', location.pathname + (SOURCE === 'radio' ? '?source=radio' : ''))
  const { data } = await sb.from('mixes').select('*').eq('id', id).maybeSingle()
  if (!data) return showError('Mix introuvable.')
  const st = data.settings || {}
  lastSeeds = st.seeds || []
  versions = []
  addVersion({ mode: st.mode || 'discover', tracks: data.tracks, curve: st.curve || 'none', profile: st.profile || [], short: 0, available: data.tracks.length },
    THEMES[st.theme] ? st.theme : 'libre', st, 'Enregistrée', false)
  versions[0].savedId = data.id
  el("plName").value = data.name
  renderResult()
  showScreen('result')
}

/* ── Invitations (admins) ───────────────────────────────────── */
async function admin(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin`, {
    method: 'POST', headers: { ...await sbHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  const d = await res.json().catch(() => ({ error: 'réponse illisible (' + res.status + ')' }))
  if (!res.ok || d.error) throw new Error(d.error || 'Erreur ' + res.status)
  return d
}
async function loadMembers() {
  try {
    const { members } = await admin({ action: 'list' })
    el("members").innerHTML = members.map(m => `
      <li>
        <span class="member__email">${esc(m.email)}</span>
        <span class="tag">${m.joined ? 'connecté·e' : 'invitation envoyée'}</span>
        ${m.admin ? '<span class="tag">admin</span>' : ''}
        <label class="check"><input type="checkbox" data-member="${m.id}" ${m.radio ? 'checked' : ''}> accès radio</label>
      </li>`).join('')
  } catch (e) {
    el("members").innerHTML = `<li class="empty">Liste illisible (${esc(e.message)}).</li>`
  }
}
el("members").addEventListener('change', async e => {
  const c = e.target.closest('[data-member]')
  if (!c) return
  c.disabled = true
  try { await admin({ action: 'set', id: c.dataset.member, radio: c.checked }) }
  catch (err) { c.checked = !c.checked; el("inviteMsg").textContent = err.message }
  c.disabled = false
})
el("inviteForm").onsubmit = async e => {
  e.preventDefault()
  const email = el("inviteEmail").value.trim()
  el("inviteMsg").textContent = 'Envoi de l\'invitation…'
  try {
    await admin({ action: 'invite', email, radio: el("inviteRadio").checked, redirectTo: SP_REDIRECT })
    el("inviteMsg").textContent = `Invitation envoyée à ${email}.`
    el("inviteEmail").value = ''
    el("inviteRadio").checked = false
    loadMembers()
  } catch (err) {
    el("inviteMsg").textContent = 'Invitation impossible : ' + err.message
  }
}

/* ── Démarrage ──────────────────────────────────────────────── */
sb.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') syncAccount() })
;(async () => {
  await syncAccount()
  const mixId = new URLSearchParams(location.search).get('mix')
  if (mixId && me) openMix(mixId)
  else if (location.hash === '#compte') openAccount()
})()
