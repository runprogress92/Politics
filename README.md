# L'Isoloir

Un test d'orientation politique en français. Tu réponds à des affirmations, et le site te dit :

- **ta position sur six axes** : économie, mœurs, autorité, immigration et identité, Europe et monde, écologie ;
- **le parti français qui te correspond le mieux**, présenté sous forme de bulletin de vote, avec le classement complet des 16 partis ;
- **ta place dans l'hémicycle**, de l'extrême gauche à l'extrême droite ;
- **ce que tu voterais aux États-Unis** (avec le duel Démocrates / Républicains), **au Royaume-Uni** et **en Allemagne** ;
- **ta famille d'idées** (social-démocratie, libéralisme, conservatisme, écologie politique…) ;
- une **boussole** qui croise deux axes au choix pour te situer face aux partis de chaque pays ;
- les **logos des partis et les portraits de leurs dirigeants**, sur le bulletin, dans les classements et dans la galerie « Les partis et leurs dirigeants ».

Deux versions : **rapide** (30 questions, environ 5 minutes) et **complète** (74 questions, environ 12 minutes).

## Utilisation

Le site est entièrement statique : HTML, CSS et JavaScript, sans dépendance ni étape de compilation.

- **En local** : ouvre `index.html` dans ton navigateur.
- **En ligne avec GitHub Pages** : dans les réglages du dépôt, va dans *Settings → Pages*, choisis *Deploy from a branch*, puis la branche voulue et le dossier `/ (root)`.

Les réponses en cours sont gardées dans le navigateur (`localStorage`). Rien n'est envoyé à un serveur. Le lien de résultat contient les réponses encodées, ce qui permet de le partager ou de le retrouver plus tard.

## Structure

| Fichier | Rôle |
| --- | --- |
| `index.html` | Structure des trois écrans : accueil, questionnaire, résultats |
| `assets/data.js` | Axes, questions, partis par pays, familles d'idées, sources |
| `assets/media.js` | Chargement des logos et portraits depuis Wikimédia Commons |
| `assets/app.js` | Déroulement du questionnaire, calcul des scores, graphiques |
| `assets/style.css` | Mise en forme, thème clair et sombre, affichage mobile |

## Méthode

Chaque réponse vaut de −2 (pas du tout d'accord) à +2 (tout à fait d'accord). Elle est multipliée par le poids de l'affirmation sur chaque axe (le signe indique le sens) :

```
score(axe) = 100 × Σ (réponse × poids) ÷ Σ (2 × |poids|)
```

Sur chaque axe, la moitié des affirmations vont dans un sens et l'autre moitié dans l'autre, pour qu'une série de « d'accord » ne fausse pas le résultat.

Chaque parti a une position estimée de −100 à +100 sur les six axes. L'affinité se calcule à partir de la distance entre ton profil et le sien :

```
affinité = 100 − 0,7 × √( moyenne des (toi − parti)² )
```

La place dans l'hémicycle est la moyenne des places habituelles des partis français, pondérée par ta proximité avec chacun d'eux.

## Résultats enregistrés

Sous chaque résultat, le formulaire « Garde ce résultat » permet de l'enregistrer avec un prénom ou un pseudo (24 caractères au plus, emojis acceptés). La section « Résultats enregistrés » permet ensuite :

- de revoir chaque résultat, de copier son lien ou de le supprimer (avec confirmation) ;
- d'ajouter le résultat de quelqu'un d'autre en collant son lien ;
- de comparer plusieurs personnes : positions sur les six axes, pourcentage d'accord entre chaque paire, parti et famille d'idées de chacun.

Un même pseudo ne garde que son dernier résultat. Les résultats sont stockés dans le navigateur (`localStorage`), sur l'appareil utilisé : rien n'est envoyé à un serveur. Pour réunir les résultats d'un groupe, chacun envoie son lien, qui contient ses réponses et son pseudo.

## Images

Les logos et les portraits viennent de [Wikimédia Commons](https://commons.wikimedia.org/), qui n'héberge que des fichiers sous licence libre. Le navigateur du visiteur les récupère en trois étapes :

1. le titre de l'article Wikipédia (champ `wp`) donne l'élément Wikidata ;
2. Wikidata donne le logo (propriété P154) ou le portrait (propriété P18) ;
3. Commons donne la miniature, l'auteur et la licence.

L'auteur et la licence de chaque image sont listés dans la section « Crédits des images ». Le résultat est gardé 7 jours dans le navigateur. Si Wikimédia est inaccessible, des pastilles aux couleurs des partis, avec leurs initiales, s'affichent à la place.

## Modifier les questions ou les partis

Tout se trouve dans `assets/data.js` :

- une question : `{ id, s, w, t, c }`. `w` donne les poids par axe (négatif : être d'accord pousse vers le pôle de gauche de l'axe), `s: 1` l'inclut dans la version rapide, `c` est un texte de contexte facultatif ;
- un parti : `{ id, short, name, color, family, wp, people, pos, desc, points }`. `pos` donne ses six coordonnées, et pour la France `lr` donne sa place dans l'hémicycle ;
- `wp` liste des titres d'articles Wikipédia candidats, par ordre de préférence (`"fr:Rassemblement national|en:National Rally"`), et chaque personne de `people` a la même structure : `{ n: "Nom", wp: "fr:Titre", role: "Fonction" }`.

Si tu changes la liste ou l'ordre des questions, augmente `VERSION` : les anciens liens de résultat ne seraient plus lisibles correctement.

## Avertissement

Les positions des partis sont des estimations simplifiées, établies à partir des programmes, des votes au Parlement, des déclarations publiques et des enquêtes d'experts comme le [Chapel Hill Expert Survey](https://www.chesdata.eu/). Données au 4 novembre 2026. Ce test est un outil pédagogique et indépendant : il ne remplace pas la lecture des programmes officiels.
