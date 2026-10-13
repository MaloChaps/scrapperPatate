/* Le Mix : communauté. Les playlists publiées (mixes.published_version) sont lisibles par tous, même sans compte,
   et partageables par lien (?c=…). En ouvrir une la charge dans l'écran de résultat comme un nouveau mix :
   on l'écoute, on la crée sur Spotify, on l'ajuste, et « Save » en fait une copie dans sa bibliothèque. */

const shareUrl = id => `${SP_REDIRECT}?c=${id}`
let communityRows = null

async function loadCommunity() {
  const { data, error } = await sb.from('mixes')
    .select('id, user_id, name, author_name, blurb, published_at, source, version:mix_versions!mixes_published_version_fkey(id, n, tracks)')
    .not('published_version', 'is', null).order('published_at', { ascending: false }).limit(60)
  communityRows = error ? [] : data.filter(m => m.version)
  return error
}

async function openCommunity() {
  showScreen('community')
  if (!communityRows) el("communityList").innerHTML = `<li class="empty">${t('Loading the crew\'s mixes…')}</li>`
  const error = await loadCommunity()
  if (error) return el("communityList").innerHTML = `<li class="empty">${t('Couldn\'t load the mixes ({e}).', { e: esc(error.message) })}</li>`
  el("communityList").innerHTML = communityRows.length ? communityRows.map(m => `
    <li class="pcard glass" data-c="${m.id}">
      <a class="fan" href="./?c=${m.id}" aria-label="${esc(m.name)}">${fanHTML(m.version.tracks, 4)}</a>
      <div>
        <h3 class="pcard__name"><a href="./?c=${m.id}">${esc(m.name)}</a></h3>
        <p class="pcard__meta">${t('by {who}', { who: esc(m.author_name || 'DJ') })} · ${tn(m.version.tracks.length, '{n} track', '{n} tracks')} · ${mixDate(m.published_at)}</p>
      </div>
      ${m.blurb ? `<p class="pcard__blurb">${esc(m.blurb)}</p>` : ''}
      <div class="pcard__actions">
        <a class="btn btn--dark btn--sm" href="./?c=${m.id}">${t('Listen')}</a>
        <button class="btn btn--sm btn--ghost" type="button" data-share="${m.id}">${t('Copy link')}</button>
      </div>
    </li>`).join('')
    : `<li class="empty">${t('Nothing published yet. Build a mix, save it, then hit Publish: it shows up here for the whole crew.')}</li>`
}
/* Ouvrir sans recharger la page ; copier le lien de partage */
el("communityList").addEventListener('click', async e => {
  const share = e.target.closest('[data-share]')
  if (share) {
    e.preventDefault()
    try { await navigator.clipboard.writeText(shareUrl(share.dataset.share)); share.textContent = t('Link copied ✓') }
    catch { share.textContent = shareUrl(share.dataset.share) }
    return
  }
  const a = e.target.closest('a[href^="./?c="]')
  if (!a) return
  e.preventDefault()
  openShared(a.closest('[data-c]').dataset.c)
})

/* Playlist publiée → écran de résultat. La sienne : on l'ouvre dans sa bibliothèque, avec toutes ses versions */
async function openShared(id) {
  history.replaceState({}, '', location.pathname)
  const m = communityRows?.find(x => x.id === id) || (await sb.from('mixes')
    .select('id, user_id, name, author_name, source, version:mix_versions!mixes_published_version_fkey(*)').eq('id', id).maybeSingle()).data
  if (!m?.version) return showError(t('This mix isn\'t published anymore.'))
  if (me && m.user_id === me.id) return openMix(m.id)
  const full = m.version.settings ? m.version : (await sb.from('mix_versions').select('*').eq('id', m.version.id).maybeSingle()).data
  if (!full) return showError(t('This mix isn\'t published anymore.'))
  const v = versionFromRow(full)
  delete v.savedId; delete v.n
  v.from = m.author_name || 'DJ'
  v.label = t('Original')
  versions = [v]
  savedMixId = null
  lastSeeds = v.body.seeds || []
  el("plName").value = m.name
  showVersion(0)
  showScreen('result')
}

/* Accueil sans mixes à toi : la carte « In the crate… » montre les pochettes des derniers mixes de la communauté */
loadCommunity().then(() => {
  if (crateItems.length) return  // déjà rempli avec tes mixes
  const crate = (communityRows || []).flatMap(m => distinctCovers(m.version.tracks, 2))
  if (crate.length) { renderStack(crate); setAmbient(crate.map(c => c.cover)) }
})
