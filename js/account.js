/* Le Mix : compte (sur invitation : mot de passe, ou lien par e-mail) et bibliothèque : tes playlists enregistrées
   avec leurs versions, renommer, publier dans la communauté ; profil (nom de DJ), mot de passe, invitations (admins).
   Tables profiles / mixes / mix_versions (supabase/accounts.sql, mix_versions.sql, community.sql) et fonction admin.
   Chargé après js/mix.js, dont il reprend l'écran de résultat (versions, addVersion, renderResult, showScreen…). */

let me = null  // fiche du compte connecté (myProfile + display_name), null si déconnecté

/* ── Écran Bibliothèque ─────────────────────────────────────── */
function openAccount(why = '', tab = 'playlists') {
  el("loginWhy").textContent = why || t('Le Mix is invite-only. Sign in with the email address that got the invite.')
  showTab(tab)
  showScreen('account')
  if (!me) el("loginEmail").focus()
}
el("accountBtn").onclick = () => openAccount('', me ? 'profile' : 'playlists')

/* Onglets : Playlists, Profil, Mot de passe, Invitations */
function showTab(tab) {
  el("tabs").querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tab === tab))
  document.querySelectorAll('#signedIn [data-panel]').forEach(p => p.hidden = p.dataset.panel !== tab)
}
el("tabs").onclick = e => { const tab = e.target.closest('[data-tab]')?.dataset.tab; if (tab) showTab(tab) }

/* Nom affiché sur les playlists publiées : celui choisi, sinon le début de l'adresse e-mail */
const djName = () => me?.display_name || (me?.email || '').split('@')[0]

/* Connecté ou pas, accès radio, admin : tout ce qui en dépend sur la page */
async function syncAccount() {
  me = await myProfile(true)
  if (me) {
    const { data } = await sb.from('profiles').select('display_name').eq('id', me.id).maybeSingle()
    me.display_name = data?.display_name || ''
  }
  document.body.toggleAttribute('data-radio', !!me?.radio)
  el("accountBtn").className = me ? 'avatar' : 'btn btn--dark btn--sm'
  el("accountBtn").textContent = me ? djName().slice(0, 1) : t('Sign in')
  el("accountBtn").title = me ? djName() : ''
  el("loginForm").hidden = !!me
  el("signedIn").hidden = !me
  updateHint()
  /* Mix à partir de la radio : réservé aux comptes qui ont l'accès radio */
  if (SOURCE === 'radio' && !me) openAccount(t('Mixing from the radio is for invited members: sign in.'))
  if (SOURCE === 'radio' && me && !me.radio) return location.replace('./')
  if (!me) return
  const { data: { user } } = await sb.auth.getUser()
  el("meEmail").textContent = el("passUser").value = me.email
  el("displayName").value = me.display_name
  el("meRadio").textContent = me.radio ? t('Access to the radio and to mixes made from its tracks') : t('No access (ask whoever invited you)')
  el("meSince").textContent = user?.created_at ? new Date(user.created_at).toLocaleDateString(LOCALE, { day: 'numeric', month: 'long', year: 'numeric' }) : ''
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
  el("loginMsg").textContent = t('Signing in…')
  const { error } = await sb.auth.signInWithPassword({ email, password })
  el("loginGo").disabled = false
  el("loginMsg").textContent = !error ? ''
    : /invalid/i.test(error.message) ? t('Wrong email or password. No password yet? Get a link, then pick one in Library › Password.')
    : t('Couldn\'t sign in: {e}', { e: error.message })
}
el("loginLink").onclick = () => sendLink()
async function sendLink() {
  const email = el("loginEmail").value.trim()
  if (!el("loginEmail").checkValidity() || !email) return el("loginEmail").reportValidity()
  el("loginMsg").textContent = t('Sending the link…')
  /* shouldCreateUser: false : une adresse sans invitation ne crée pas de compte */
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: SP_REDIRECT } })
  el("loginMsg").textContent = !error ? t('Link sent to {email}: open it soon, on this device.', { email })
    : /signup|not allowed|not found/i.test(error.message) ? t('This address has no invite.')
    : /rate limit/i.test(error.message) ? t('Too many emails sent for now: try again in an hour, or sign in with your password.')
    : t('Couldn\'t send: {e}', { e: error.message })
}
/* Mot de passe (connecté) */
el("passForm").onsubmit = async e => {
  e.preventDefault()
  el("passMsg").textContent = t('Saving…')
  const { error } = await sb.auth.updateUser({ password: el("newPass").value })
  el("passMsg").textContent = error ? t('Couldn\'t save: {e}', { e: error.message }) : t('Password saved: you can now sign in with it.')
  if (!error) el("newPass").value = ''
}
/* Nom de DJ (affiché sur les playlists publiées) */
el("nameForm").onsubmit = async e => {
  e.preventDefault()
  const name = el("displayName").value.trim().slice(0, 40)
  const { error } = await sb.from('profiles').update({ display_name: name || null }).eq('id', me.id)
  el("nameMsg").textContent = error ? t('Couldn\'t save: {e}', { e: error.message }) : t('Saved.')
  if (!error) { me.display_name = name; el("accountBtn").textContent = djName().slice(0, 1) }
}
el("logout").onclick = async () => {
  await sb.auth.signOut()
  await syncAccount()
  showScreen('form')
}

/* ── Tes playlists (mixes) et leurs versions (mix_versions) ──── */
const mixDate = iso => new Date(iso).toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' })
const mixHref = (m, n) => `./?${m.source === 'radio' ? 'source=radio&' : ''}mix=${m.id}${n ? `&v=${n}` : ''}`
const isOriginal = label => !label || label === 'Original' || label === 'Originale'
async function loadMixes() {
  const { data, error } = await sb.from('mixes')
    .select('id, name, source, updated_at, published_version, mix_versions!mix_versions_mix_id_fkey(id, n, label, spotify_url, tracks)')
    .eq('user_id', me.id)
    .order('updated_at', { ascending: false }).order('n', { referencedTable: 'mix_versions' }).limit(100)
  if (error) return el("mixList").innerHTML = `<li class="empty">${t('Couldn\'t load your playlists ({e}).', { e: esc(error.message) })}</li>`
  /* Accueil, « In the crate… » : pochettes d'albums de tes mixes */
  const crate = data.flatMap(m => distinctCovers(m.mix_versions?.at(-1)?.tracks || [], 4)).sort(() => Math.random() - 0.5)
  if (crate.length) { renderStack(crate); setAmbient(crate.map(c => c.cover)) }
  el("mixList").innerHTML = data.length ? data.map(m => {
    const vs = m.mix_versions || [], last = vs.at(-1), pub = vs.find(v => v.id === m.published_version)
    return `
    <li class="pcard glass" data-mix="${m.id}">
      <a class="fan" href="${mixHref(m, last?.n)}" aria-label="${esc(m.name)}">${fanHTML(last?.tracks)}</a>
      <div>
        ${pub ? `<span class="badge">${t('Live in Community · V{n}', { n: pub.n })}</span>` : ''}
        <h3 class="pcard__name"><a href="${mixHref(m, last?.n)}">${esc(m.name)}</a></h3>
        <p class="pcard__meta">${mixDate(m.updated_at)} · ${tn(vs.length, '{n} version', '{n} versions')}${last ? ' · ' + tn(last.tracks.length, '{n} track', '{n} tracks') : ''}${m.source === 'radio' ? ' · radio' : ''}</p>
      </div>
      <div class="pcard__versions">${vs.map(v => `
        <a class="tag" href="${mixHref(m, v.n)}" title="${t('Open this version')}">V${v.n}${isOriginal(v.label) ? '' : ` · ${esc(v.label)}`}</a>${v.spotify_url
          ? `<a class="tag tag--fill" href="${esc(v.spotify_url)}" target="_blank" rel="noopener" title="${t('Open V{n} in Spotify', { n: v.n })}">Spotify ↗</a>` : ''}`).join('')}
      </div>
      <div class="pcard__actions">
        <a class="btn btn--dark btn--sm" href="${mixHref(m, last?.n)}">${t('Open')}</a>
        <button class="btn btn--sm" type="button" data-publish="${pub ? '' : last?.id || ''}">${pub ? t('Unpublish') : t('Publish V{n}', { n: last?.n || 1 })}</button>
        <button class="btn btn--sm btn--ghost" type="button" data-rename>${t('Rename')}</button>
        <button class="btn btn--sm btn--ghost" type="button" data-del>${t('Delete')}</button>
      </div>
    </li>`
  }).join('')
    : `<li class="empty">${t('No playlists yet. Build a mix, then hit Save (or create it on Spotify, it\'s saved automatically). Every tweak you save becomes a new version.')}</li>`
}

/* Renommer (champ à la place du nom ; Entrée ou sortie du champ pour valider, Échap pour annuler),
   publier / retirer, supprimer (deuxième touche pour confirmer, pas de fenêtre de confirmation) */
el("mixList").addEventListener('click', async e => {
  const li = e.target.closest('[data-mix]')
  if (!li) return
  const id = li.dataset.mix
  if (e.target.closest('[data-rename]')) {
    const h = li.querySelector('.pcard__name'), old = h.textContent.trim()
    const input = Object.assign(document.createElement('input'), { className: 'field pcard__rename', value: old, maxLength: 100 })
    h.replaceWith(input)
    input.focus(); input.select()
    let done = false
    const finish = async save => {
      if (done) return
      done = true
      const name = input.value.trim()
      if (save && name && name !== old) await renameMix(id, name)
      loadMixes()
    }
    input.onkeydown = ev => { if (ev.key === 'Enter') finish(true); if (ev.key === 'Escape') finish(false) }
    input.onblur = () => finish(true)
    return
  }
  const pubBtn = e.target.closest('[data-publish]')
  if (pubBtn) {
    pubBtn.disabled = true
    await setPublished(id, pubBtn.dataset.publish || null)
    return loadMixes()
  }
  const b = e.target.closest('[data-del]')
  if (!b) return
  if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = t('Sure? Tap again'); return }
  b.disabled = true
  const { error } = await sb.from('mixes').delete().eq('id', id)
  if (error) { b.disabled = false; b.textContent = t('Error'); return }
  if (savedMixId === id) { savedMixId = null; versions.forEach(v => { delete v.savedId; delete v.n }) }
  loadMixes()
})
async function renameMix(id, name) {
  const { error } = await sb.from('mixes').update({ name, updated_at: new Date().toISOString() }).eq('id', id)
  if (!error && savedMixId === id) { el("plName").value = name; if (result) renderTitle() }
}
/* Publier une version dans la communauté (versionId), ou retirer (null) ; le nom de DJ est copié à la publication */
async function setPublished(mixId, versionId) {
  const { error } = await sb.from('mixes').update(versionId
    ? { published_version: versionId, published_at: new Date().toISOString(), author_name: djName() }
    : { published_version: null, published_at: null }).eq('id', mixId)
  return error
}

/* Enregistre la version affichée (titres cochés) dans la playlist de ce mix : la première fois la playlist est créée,
   chaque autre version (ajustement, régénération) devient V2, V3… ; une version déjà enregistrée est mise à jour.
   spotifyUrl : appelée après la création sur Spotify */
async function saveCurrentMix(spotifyUrl) {
  if (!me) return openAccount(t('Sign in to save your playlists.'))
  const v = versions[shown], tracks = pickedTracks()
  if (!v || !tracks.length) return
  const fail = err => { el("saveMix").disabled = false; el("createStep").textContent = t('Couldn\'t save: {e}', { e: err.message }) }
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
    delete v.from  // copie d'un mix de la communauté : c'est maintenant le tien
  }
  el("saveMix").disabled = false
  renderResult()
  el("createStep").textContent = spotifyUrl ? '' : t('V{n} saved in your Library', { n: v.n })
  loadMixes()
}
el("saveMix").onclick = () => saveCurrentMix()

/* Publier la version affichée : enregistrée d'abord si besoin */
el("publishMix").onclick = async () => {
  if (!me) return openAccount(t('Sign in to publish your mixes.'))
  if (!versions[shown]?.savedId) await saveCurrentMix()
  const v = versions[shown]
  if (!v?.savedId) return
  const error = await setPublished(savedMixId, v.savedId)
  el("createStep").textContent = error ? t('Couldn\'t publish: {e}', { e: error.message }) : t('V{n} is live in Community ✓', { n: v.n })
  loadMixes()
}

/* Rouvre une playlist enregistrée (?mix=…&v=…) avec toutes ses versions : on peut l'écouter, l'ajuster
   (le nouvel ajustement sera la version suivante), la créer sur Spotify */
async function openMix(id, n) {
  history.replaceState({}, '', location.pathname + (SOURCE === 'radio' ? '?source=radio' : ''))
  const { data } = await sb.from('mixes').select('id, name, mix_versions!mix_versions_mix_id_fkey(*)').eq('id', id).eq('user_id', me.id).order('n', { referencedTable: 'mix_versions' }).maybeSingle()
  if (!data?.mix_versions?.length) return showError(t('Playlist not found.'))
  versions = data.mix_versions.map(versionFromRow)
  savedMixId = data.id
  lastSeeds = versions.at(-1).body.seeds || []
  el("plName").value = data.name
  const i = versions.findIndex(v => v.n === +n)
  showVersion(i < 0 ? versions.length - 1 : i)
  showScreen('result')
}
/* Ligne mix_versions → version affichable dans l'écran de résultat */
function versionFromRow(row) {
  const st = row.settings || {}
  return {
    result: { mode: st.mode || 'discover', tracks: row.tracks, curve: st.curve || 'none', profile: st.profile || [], short: 0, available: row.tracks.length },
    theme: THEMES[st.theme] ? st.theme : 'libre', body: st, label: row.label || t('Original'), off: new Set(), fresh: new Set(), savedId: row.id, n: row.n
  }
}

/* ── Invitations (admins) ───────────────────────────────────── */
async function admin(body) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/admin`, {
    method: 'POST', headers: { ...await sbHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  })
  const d = await res.json().catch(() => ({ error: t('unreadable response ({s})', { s: res.status }) }))
  if (!res.ok || d.error) throw new Error(d.error || t('Error {s}', { s: res.status }))
  return d
}
async function loadMembers() {
  try {
    const { members } = await admin({ action: 'list' })
    el("members").innerHTML = members.map(m => `
      <li>
        <span class="member__email">${esc(m.email)}</span>
        <span class="tag">${m.joined ? t('signed in') : t('invite sent')}</span>
        ${m.admin ? '<span class="tag">admin</span>' : ''}
        <label class="check"><input type="checkbox" data-member="${m.id}" ${m.radio ? 'checked' : ''}> ${t('radio access')}</label>
      </li>`).join('')
  } catch (e) {
    el("members").innerHTML = `<li class="hint">${t('Couldn\'t load the list ({e}).', { e: esc(e.message) })}</li>`
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
  el("inviteMsg").textContent = t('Sending the invite…')
  try {
    await admin({ action: 'invite', email, radio: el("inviteRadio").checked, redirectTo: SP_REDIRECT })
    el("inviteMsg").textContent = t('Invite sent to {email}.', { email })
    el("inviteEmail").value = ''
    el("inviteRadio").checked = false
    loadMembers()
  } catch (err) {
    el("inviteMsg").textContent = t('Couldn\'t invite: {e}', { e: err.message })
  }
}

/* ── Démarrage ──────────────────────────────────────────────── */
sb.auth.onAuthStateChange(event => { if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') syncAccount() })
;(async () => {
  await syncAccount()
  const params = new URLSearchParams(location.search)
  if (params.get('mix') && me) openMix(params.get('mix'), params.get('v'))
  else if (params.get('c')) openShared(params.get('c'))  // js/community.js
  else if (location.hash === '#library') openAccount()
  else if (location.hash === '#community') openCommunity()
})()
