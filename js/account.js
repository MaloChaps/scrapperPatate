/* Le Mix : compte (sur invitation : mot de passe, ou lien par e-mail), tes playlists enregistrées avec leurs versions,
   invitations (admins). Tables profiles / mixes / mix_versions (supabase/accounts.sql, mix_versions.sql) et fonction admin.
   Chargé après js/mix.js, dont il reprend l'écran de résultat (versions, addVersion, renderResult, showScreen…). */

let me = null  // fiche du compte connecté (myProfile), null si déconnecté

/* ── Écran Mon compte ───────────────────────────────────────── */
function openAccount(why = '', tab = 'playlists') {
  el("loginWhy").textContent = why || 'Le Mix est sur invitation. Connecte-toi avec l\'adresse e-mail qui a reçu l\'invitation.'
  showTab(tab)
  showScreen('account')
  if (!me) el("loginEmail").focus()
}
el("accountBtn").onclick = () => openAccount()
el("fromAccount").onclick = () => showScreen(result ? 'result' : 'form')

/* Onglets : Tes playlists, Infos, Mot de passe, Invitations */
function showTab(tab) {
  el("tabs").querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === tab))
  document.querySelectorAll('#signedIn [data-panel]').forEach(p => p.hidden = p.dataset.panel !== tab)
}
el("tabs").onclick = e => { const t = e.target.closest('[data-tab]')?.dataset.tab; if (t) showTab(t) }

/* Connecté ou pas, accès radio, admin : tout ce qui en dépend sur la page */
async function syncAccount() {
  me = await myProfile(true)
  document.body.toggleAttribute('data-radio', !!me?.radio)
  el("accountBtn").textContent = me ? 'Mon compte' : 'Se connecter'
  el("loginForm").hidden = !!me
  el("signedIn").hidden = !me
  updateHint()
  /* Mix à partir de la radio : réservé aux comptes qui ont l'accès radio */
  if (SOURCE === 'radio' && !me) openAccount('Le Mix à partir de la radio est réservé aux comptes invités : connecte-toi.')
  if (SOURCE === 'radio' && me && !me.radio) return location.replace('./')
  if (!me) return
  const { data: { user } } = await sb.auth.getUser()
  el("meEmail").textContent = el("passUser").value = me.email
  el("meRadio").textContent = me.radio ? 'Accès à la radio et aux mixes faits avec ses titres' : 'Pas d\'accès (demande-le à la personne qui t\'a invité·e)'
  el("meSince").textContent = user?.created_at ? new Date(user.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : ''
  el("invitesTab").hidden = !me.admin
  loadMixes()
  if (me.admin) loadMembers()
}

/* E-mail + mot de passe ; sans mot de passe (première fois, oubli) : un lien de connexion par e-mail */
el("loginForm").onsubmit = async e => {
  e.preventDefault()
  const email = el("loginEmail").value.trim(), password = el("loginPass").value
  if (!password) return sendLink()
  el("loginGo").disabled = true
  el("loginMsg").textContent = 'Connexion…'
  const { error } = await sb.auth.signInWithPassword({ email, password })
  el("loginGo").disabled = false
  el("loginMsg").textContent = !error ? ''
    : /invalid/i.test(error.message) ? 'E-mail ou mot de passe incorrect. Pas encore de mot de passe ? Reçois un lien, puis choisis-en un dans Mon compte.'
    : 'Connexion impossible : ' + error.message
}
el("loginLink").onclick = () => sendLink()
async function sendLink() {
  const email = el("loginEmail").value.trim()
  if (!el("loginEmail").checkValidity() || !email) return el("loginEmail").reportValidity()
  el("loginMsg").textContent = 'Envoi du lien…'
  /* shouldCreateUser: false : une adresse sans invitation ne crée pas de compte */
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: SP_REDIRECT } })
  el("loginMsg").textContent = !error ? `Lien envoyé à ${email} : ouvre-le vite, sur cet appareil.`
    : /signup|not allowed|not found/i.test(error.message) ? 'Cette adresse n\'a pas d\'invitation.'
    : /rate limit/i.test(error.message) ? 'Trop d\'e-mails envoyés pour l\'instant : réessaie dans une heure, ou connecte-toi avec ton mot de passe.'
    : 'Envoi impossible : ' + error.message
}
/* Choisir ou changer son mot de passe (connecté) */
el("passForm").onsubmit = async e => {
  e.preventDefault()
  el("passMsg").textContent = 'Enregistrement…'
  const { error } = await sb.auth.updateUser({ password: el("newPass").value })
  el("passMsg").textContent = error ? 'Impossible : ' + error.message : 'Mot de passe enregistré : tu peux maintenant te connecter avec.'
  if (!error) el("newPass").value = ''
}
el("logout").onclick = async () => {
  await sb.auth.signOut()
  await syncAccount()
  showScreen('form')
}

/* ── Tes playlists (mixes) et leurs versions (mix_versions) ──── */
const mixDate = iso => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
const mixHref = (m, n) => `./?${m.source === 'radio' ? 'source=radio&' : ''}mix=${m.id}${n ? `&v=${n}` : ''}`
async function loadMixes() {
  const { data, error } = await sb.from('mixes')
    .select('id, name, source, updated_at, mix_versions(id, n, label, spotify_url, tracks)')
    .order('updated_at', { ascending: false }).order('n', { referencedTable: 'mix_versions' }).limit(100)
  if (error) return el("mixList").innerHTML = `<li class="empty">Playlists illisibles (${esc(error.message)}).</li>`
  el("mixList").innerHTML = data.length ? data.map(m => {
    const vs = m.mix_versions || [], last = vs.at(-1)
    return `
    <li data-mix="${m.id}">
      <div class="mix__head">
        <a class="mix__name" href="${mixHref(m, last?.n)}">${esc(m.name)}</a>
        <span class="mix__meta">${mixDate(m.updated_at)} · ${vs.length} version${vs.length > 1 ? 's' : ''}${last ? ` · ${plural(last.tracks.length, 'titre')}` : ''}${m.source === 'radio' ? ' · radio' : ''}</span>
      </div>
      <div class="mix__versions">${vs.map(v => `
        <a class="tag" href="${mixHref(m, v.n)}" title="Ouvrir cette version">V${v.n}${v.label && v.label !== 'Originale' ? ` · ${esc(v.label)}` : ''}</a>${v.spotify_url
          ? `<a class="tag tag--fill" href="${esc(v.spotify_url)}" target="_blank" rel="noopener" title="Ouvrir la V${v.n} dans Spotify">Spotify ↗</a>` : ''}`).join('')}
      </div>
      <div class="mix__actions">
        <a class="pill-button" href="${mixHref(m, last?.n)}">Ouvrir</a>
        <button class="pill-button" type="button" data-rename>Renommer</button>
        <button class="pill-button" type="button" data-del>Supprimer</button>
      </div>
    </li>`
  }).join('')
    : '<li class="empty">Aucune playlist enregistrée : génère un mix puis « Enregistrer » (ou crée-le sur Spotify, il est enregistré tout seul). Chaque ajustement enregistré devient une nouvelle version.</li>'
}

/* Renommer (champ à la place du nom, Entrée ou sortie du champ pour valider, Échap pour annuler) ;
   Supprimer : deuxième touche pour confirmer (pas de fenêtre de confirmation) */
el("mixList").addEventListener('click', async e => {
  const li = e.target.closest('[data-mix]')
  if (!li) return
  if (e.target.closest('[data-rename]')) {
    const a = li.querySelector('.mix__name')
    if (!a) return
    const input = Object.assign(document.createElement('input'), { className: 'field mix__rename', value: a.textContent, maxLength: 100 })
    a.replaceWith(input)
    input.focus(); input.select()
    let done = false
    const finish = async save => {
      if (done) return
      done = true
      const name = input.value.trim()
      if (save && name && name !== a.textContent) await renameMix(li.dataset.mix, name)
      loadMixes()
    }
    input.onkeydown = ev => { if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false) }
    input.onblur = () => finish(true)
    return
  }
  const b = e.target.closest('[data-del]')
  if (!b) return
  if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Confirmer la suppression ?'; return }
  b.disabled = true
  const { error } = await sb.from('mixes').delete().eq('id', li.dataset.mix)
  if (error) { b.disabled = false; b.textContent = 'Erreur'; return }
  if (savedMixId === li.dataset.mix) { savedMixId = null; versions.forEach(v => { delete v.savedId; delete v.n }) }
  loadMixes()
})
async function renameMix(id, name) {
  const { error } = await sb.from('mixes').update({ name, updated_at: new Date().toISOString() }).eq('id', id)
  if (!error && savedMixId === id) { el("plName").value = name; if (result) renderTitle() }
}

/* Enregistre la version affichée (titres cochés) dans la playlist de ce mix : la première fois la playlist est créée,
   chaque autre version (ajustement, régénération) devient V2, V3… ; une version déjà enregistrée est mise à jour.
   spotifyUrl : appelée après la création sur Spotify */
async function saveCurrentMix(spotifyUrl) {
  if (!me) return openAccount('Connecte-toi pour enregistrer tes playlists.')
  const v = versions[shown], tracks = pickedTracks()
  if (!v || !tracks.length) return
  const fail = err => { el("saveMix").disabled = false; el("createStep").textContent = 'Enregistrement impossible : ' + err.message }
  el("saveMix").disabled = true
  const name = playlistName().slice(0, 100), now = new Date().toISOString()
  if (!savedMixId) {
    const { data, error } = await sb.from('mixes').insert({ name, source: SOURCE }).select('id').single()
    if (error) return fail(error)
    savedMixId = data.id
  } else {
    const { error } = await sb.from('mixes').update({ name, updated_at: now }).eq('id', savedMixId)
    if (error) return fail(error)
  }
  const { current, keep, adjust, artist, relax, size, ...settings } = v.body || {}
  const row = {
    tracks, label: v.label,
    settings: { ...settings, theme: v.theme, curve: v.result.curve, profile: v.result.profile || [], mode: v.result.mode || settings.mode },
    ...(spotifyUrl ? { spotify_url: spotifyUrl } : {})
  }
  if (v.savedId) {
    const { error } = await sb.from('mix_versions').update(row).eq('id', v.savedId)
    if (error) return fail(error)
  } else {
    const { data: lastV } = await sb.from('mix_versions').select('n').eq('mix_id', savedMixId).order('n', { ascending: false }).limit(1).maybeSingle()
    const { data, error } = await sb.from('mix_versions').insert({ ...row, mix_id: savedMixId, n: (lastV?.n || 0) + 1 }).select('id, n').single()
    if (error) return fail(error)
    v.savedId = data.id
    v.n = data.n
  }
  el("saveMix").disabled = false
  el("saveMix").textContent = `V${v.n} enregistrée ✓`
  if (!spotifyUrl) el("createStep").textContent = `V${v.n} enregistrée dans Tes playlists (Mon compte)`
  loadMixes()
}
el("saveMix").onclick = () => saveCurrentMix()

/* Rouvre une playlist enregistrée (?mix=…&v=…) avec toutes ses versions : on peut l'écouter, l'ajuster
   (le nouvel ajustement sera la version suivante), la créer sur Spotify */
async function openMix(id, n) {
  history.replaceState({}, '', location.pathname + (SOURCE === 'radio' ? '?source=radio' : ''))
  const { data } = await sb.from('mixes').select('id, name, mix_versions(*)').eq('id', id).order('n', { referencedTable: 'mix_versions' }).maybeSingle()
  if (!data?.mix_versions?.length) return showError('Playlist introuvable.')
  versions = data.mix_versions.map(row => {
    const st = row.settings || {}
    return {
      result: { mode: st.mode || 'discover', tracks: row.tracks, curve: st.curve || 'none', profile: st.profile || [], short: 0, available: row.tracks.length },
      theme: THEMES[st.theme] ? st.theme : 'libre', body: st, label: row.label || 'Enregistrée', off: new Set(), fresh: new Set(), savedId: row.id, n: row.n
    }
  })
  savedMixId = data.id
  lastSeeds = versions.at(-1).body.seeds || []
  el("plName").value = data.name
  const i = versions.findIndex(v => v.n === +n)
  showVersion(i < 0 ? versions.length - 1 : i)
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
  const params = new URLSearchParams(location.search)
  if (params.get('mix') && me) openMix(params.get('mix'), params.get('v'))
  else if (location.hash === '#compte') openAccount()
})()
