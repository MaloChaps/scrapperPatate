/* Le Mix : éléments visuels communs aux écrans : pochettes (taille, mosaïque des playlists), bouton de langue. */

/* Pochettes Deezer : l'adresse donne la taille (…/56x56-000000-80-0-0.jpg) ; on prend une version plus grande */
const bigCover = (url, size = 500) => (url || '').replace(/\/\d+x\d+-(\d+-\d+-\d+-\d+\.jpg)$/, `/${size}x${size}-$1`)

/* Une pochette par album (les titres d'un même album ne la répètent pas), n au plus, à la taille size */
function distinctCovers(tracks, n, size = 500) {
  const seen = new Set(), out = []
  for (const t of tracks || []) {
    const c = bigCover(t.cover, size)
    if (!c || seen.has(c)) continue
    seen.add(c)
    out.push({ cover: c, title: t.title, artist: t.artist })
    if (out.length >= n) break
  }
  return out
}

/* Pochette d'une playlist : mosaïque carrée des pochettes de ses albums, jusqu'à 8 × 8,
   la plus grande grille possible sans répéter d'album (titre de l'album au survol) */
function mosaicHTML(tracks) {
  const all = distinctCovers(tracks, 64, 250)
  const k = Math.min(8, Math.floor(Math.sqrt(all.length)))
  if (!k) return '<span class="mosaic mosaic--blank"></span>'
  return `<span class="mosaic" style="--k:${k}">${all.slice(0, k * k).map(it =>
    `<span class="mosaic__tile" style="background-image:url(${esc(it.cover)})" title="${esc(firstArtist(it.artist))} · ${esc(it.title)}"></span>`).join('')}</span>`
}

/* Langue : bouton EN / FR (la page se recharge dans l'autre langue, le formulaire est gardé) */
el("langBtn").textContent = LANG === 'fr' ? 'EN' : 'FR'
el("langBtn").setAttribute('aria-label', LANG === 'fr' ? 'English' : 'Français')
el("langBtn").onclick = () => {
  if (typeof saveForm === 'function') saveForm()
  setLang(LANG === 'fr' ? 'en' : 'fr')
}
