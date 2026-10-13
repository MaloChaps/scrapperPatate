/* Styles communs à build-playlist et fill-styles : étiquettes Last.fm (précises) ou genres d'album Deezer (secours).
   Les règles Deezer sont les mêmes que GENRE_STYLES dans js/shared.js */

export const STYLES: Record<string, { tags: string[] }> = {
  funk:      { tags: ['funk', 'p-funk', 'deep funk', 'funk rock', 'jazz funk', 'jazz-funk', 'afro-funk', 'afro funk', 'latin funk', 'rare groove', 'boogie'] },
  soul:      { tags: ['soul', 'northern soul', 'southern soul', 'deep soul', 'modern soul', 'neo-soul', 'psychedelic soul', 'philly soul', 'motown', 'rare groove'] },
  disco:     { tags: ['disco', 'boogie', 'post-disco', 'italo disco', 'nu disco', 'nu-disco', 'cosmic disco'] },
  jazz:      { tags: ['jazz', 'jazz funk', 'jazz-funk', 'soul jazz', 'jazz fusion', 'fusion', 'spiritual jazz', 'latin jazz', 'acid jazz', 'ethio-jazz'] },
  afro:      { tags: ['afrobeat', 'afro-funk', 'afro funk', 'highlife', 'african', 'afro', 'ethio-jazz', 'afro-beat', 'semba'] },
  bresil:    { tags: ['mpb', 'bossa nova', 'samba', 'brazilian', 'brazil', 'tropicalia', 'samba soul', 'brasil'] },
  latin:     { tags: ['latin', 'salsa', 'latin jazz', 'boogaloo', 'cumbia', 'latin funk', 'afro-cuban', 'latin soul'] },
  rnb:       { tags: ['rnb', 'r&b', 'rhythm and blues', 'contemporary r&b', 'new jack swing'] },
  house:     { tags: ['house', 'deep house', 'electronic', 'electronica', 'techno', 'dance', 'french house'] },
  hiphop:    { tags: ['hip-hop', 'hip hop', 'rap', 'jazz rap', 'boom bap'] },
  reggae:    { tags: ['reggae', 'dub', 'roots reggae', 'rocksteady', 'ska', 'lovers rock'] },
  rock:      { tags: ['rock', 'classic rock', 'psychedelic rock', 'indie rock', 'garage rock', 'psychedelic', 'alternative rock', 'post-punk', 'britpop', 'grunge', 'blues rock', 'hard rock', 'punk'] },
  pop:       { tags: ['pop', 'synthpop', 'indie pop', 'dream pop', 'city pop'] },
  folk:      { tags: ['folk', 'singer-songwriter', 'acoustic', 'country'] },
  chanson:   { tags: ['chanson', 'french', 'chanson francaise', 'variete francaise', 'french pop'] },
  chill:     { tags: ['chillout', 'downtempo', 'chill', 'ambient', 'trip-hop', 'lounge', 'balearic'] },
  classique: { tags: ['classical', 'soundtrack', 'score'] },
  metal:     { tags: ['metal', 'heavy metal', 'hard rock', 'punk'] }
}
export const TAG_TO_STYLES = new Map<string, string[]>()
for (const [id, s] of Object.entries(STYLES)) for (const t of s.tags) TAG_TO_STYLES.set(t, [...(TAG_TO_STYLES.get(t) || []), id])
/* Genres d'album Deezer → styles (mêmes règles que la page : « Rock indé », « Pop indé/Folk »… compris) */
export const DEEZER_RULES: [string, RegExp][] = [
  ['funk', /funk/i], ['soul', /soul/i], ['rnb', /r&b|rnb|rhythm/i], ['disco', /disco|boogie/i],
  ['jazz', /jazz|blues/i], ['afro', /afro|africa/i], ['bresil', /brésil|bresil|mpb|samba|bossa/i],
  ['latin', /latin|salsa|bolero|cumbia|reggaeton/i], ['house', /electro|house|techno|dance/i],
  ['hiphop', /hip.?hop|\brap\b/i], ['reggae', /reggae|\bdub\b|\bska\b/i],
  ['rock', /rock|alternative|indé|indie|punk|metal/i], ['pop', /pop/i], ['folk', /folk|country|singer/i],
  ['chanson', /chanson|variété|french/i], ['classique', /classi|film|soundtrack/i], ['metal', /metal/i]
]
export const fromDeezer = (genres: string[]) => DEEZER_RULES.filter(([, re]) => genres.some(g => re.test(g))).map(([id]) => id)

/* Étiquettes Last.fm d'un artiste (artist.gettoptags, poids sur 100) → styles.
   core : styles des étiquettes dominantes, pour filtrer par style choisi
   sans retenir un artiste électro qui a aussi une petite étiquette « rock » */
export const CORE_TAG = 40
export type LastfmTag = { name: string, count: number }
export const topTags = (tags: LastfmTag[]) => tags.filter(t => t.count >= 15).slice(0, 10)
export function tagStyles(tags: LastfmTag[]) {
  const toStyles = (l: LastfmTag[]) => [...new Set(l.flatMap(t => TAG_TO_STYLES.get(t.name.toLowerCase()) || []))]
  return { styles: toStyles(tags), core: toStyles(tags.filter(t => t.count >= CORE_TAG)) }
}
