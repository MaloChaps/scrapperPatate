# La Radio · Le Mix

Deux pages statiques (aucune compilation), hébergées telles quelles, avec Supabase pour les données et Spotify pour les playlists.

- **La Radio** (`index.html`) : titre en cours de La Patate Douce, player, historique de tout ce qui est passé à l'antenne ; cœur pour ajouter un titre à ses Titres likés Spotify, + pour l'ajouter à une de ses playlists.
- **Le Mix** (`generateur.html`, installable comme une app) : génère une playlist à partir de 1 à 3 playlists Spotify, ou des titres de la radio, puis la crée sur Spotify. Bouton **Radio** pour écouter la radio en fond (coupée le temps d'un extrait, reprise ensuite) ; arrivé depuis la page radio pendant l'écoute, Le Mix la relance (`?radio=1`).

## Fichiers

| Fichier | Rôle |
|---|---|
| `js/shared.js` | Commun aux deux pages : réglages (Supabase, Spotify), flux radio (`radioStream`), utilitaires, nettoyage des titres, connexion et appels Spotify |
| `js/radio.js` | La Radio |
| `js/mix.js` | Le Mix |
| `da.css` | Charte : polices, couleurs (`--bg`, `--ink`, `--accent`…) |
| `sw.js`, `mix.webmanifest`, `icons/` | App installable Le Mix (le code est toujours repris sur le réseau, la copie en cache sert hors ligne) |
| `supabase/functions/` | Fonctions serveur (Deno) |
| `supabase/*.sql` | Schéma, droits et tâches planifiées, à coller dans l'éditeur SQL |
| `visuels/` | Visuels de présentation (1080×1920) |

## Côté serveur (Supabase)

Le site ne fait que **lire** la base ; tout ce qui écrit tourne côté serveur avec la clé `service_role`.

- **`poll-radio`** (tâche planifiée `poll-patate-douce`, chaque minute) : note le titre en cours dans `plays` (sans doublon) et cherche sur Deezer la pochette et les genres des nouveaux titres (`track_info`).
- **`fill-tempo`** (tâche `fill-tempo`, chaque minute) : remplit `track_info.bpm` (Deezer, sinon calculé sur l'extrait de 30 s).
- **`build-playlist`** (appelée par Le Mix) : profil des playlists de départ, découvertes (Deezer, styles Last.fm), tri et enchaînement par tempo. Secret `LASTFM_API_KEY`.

Déployer une fonction : `npx supabase functions deploy <nom> --project-ref wnbcoczjfqyxggkfyooh`.

Si l'historique s'arrête : vérifier `select * from net._http_response order by created desc limit 5`.

## Spotify

- Une seule connexion pour les deux pages (jeton dans `localStorage`), avec les autorisations listées dans `SP_SCOPES` (`js/shared.js`). Si on ajoute une autorisation, l'utilisateur doit se reconnecter une fois : `spReady()` le détecte.
- L'**adresse de retour** est le dossier du site (la page radio). Elle doit être enregistrée dans l'app Spotify (developer.spotify.com → Settings → Redirect URIs), en ligne et en local (`http://127.0.0.1:8000/`).
- La Radio se connecte dans une **fenêtre à part**, pour ne jamais couper la radio. Le Mix se connecte par **redirection**, parce qu'une app installée sur iPhone ne partage pas son stockage avec une fenêtre Safari ; la page radio lui renvoie le retour de connexion (`state=mix`).
- API de février 2026 : likes via `GET /me/tracks` et `PUT/DELETE /me/library?uris=…`, playlists via `/me/playlists` et `/playlists/{id}/items`.

## En local

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Puis http://127.0.0.1:8000/ (radio) et http://127.0.0.1:8000/generateur.html (Le Mix).
