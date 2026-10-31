# Architecture technique et points sensibles

Ce document s'adresse au développeur qui reprend le projet. Il décrit le fonctionnement interne du code
et, surtout, les **liens implicites** entre fichiers : ceux qu'aucun import ne montre et qui cassent sans
erreur visible. Il ne répète pas les autres documents :

| Sujet | Document |
|---|---|
| Structure des dossiers, « Où modifier quoi », langues, commandes `npm run …`, mise en ligne du site | [README.md](../README.md) |
| Sources de vérité, fichiers générés, règles de modification | [CLAUDE.md](../CLAUDE.md) § 2 et § 3 |
| CMS : installation, utilisation, commandes, organisation du code | [cms/README.md](cms/README.md) |
| CMS : choix techniques, modèle de données, correspondance base ↔ `js/data` | [cms/architecture.md](cms/architecture.md) |
| Programmations, supervision, statistiques, exploitation, infrastructure | [cms/](cms/) (`programmations.md`, `supervision.md`, `statistiques.md`, `exploitation.md`, `proxmox.md`) |

## 1. Vue d'ensemble

Trois ensembles, reliés par les fichiers du dépôt :

```
 CMS (cms/, serveur Node + SQLite)             Outils (tools/, Node)                 Site public (GitHub Pages)
 ─────────────────────────────────             ─────────────────────                 ──────────────────────────
 saisie → validation → base SQLite
 « Mettre en ligne » : export ───────────────► js/data/*.js, js/i18n/contenus-*.js
                                               event-pages, generate-calendar, ────► evenement-*.html, calendar/,
                                               maps, langues, validate               de/, en/, sitemap.xml, images
 commit + push sur main ──────────────────────────────────────────────────────────► deploy-pages.yml → en ligne
```

Le site n'a ni build ni framework : le navigateur exécute les fichiers du dépôt tels quels (minifiés au
seul déploiement). Les mêmes modules JavaScript servent au navigateur, aux outils et au CMS (§ 3).

## 2. Démarrage d'une page publique

Dans l'ordre du `<head>` puis du `<body>` de chaque page :

1. **Script de langue inline** (début du `<head>`) : avec `?lang=` ou un choix enregistré
   (`localStorage` `tnd-lang`), redirige vers la même page dans `de/` ou `en/` avant l'affichage.
   Script inline = empreinte `sha256` dans la CSP de la page (§ 5).
2. **CSS** : `css/style.css` (toutes les pages), `css/pages.css` (pages intérieures), puis les feuilles de
   `css/components/` propres à la page.
3. **`js/partials.js`** (module, différé) : menu, lien actif, en-tête au défilement, bouton Billetterie,
   prochaine soirée, choix de langue, JSON-LD de l'association, GoatCounter. Il importe
   `js/i18n/i18n.js`, qui charge le dictionnaire de la langue par un `await` de premier niveau : tous les
   modules qui en dépendent attendent ce chargement.
4. **Script de la page** (`js/pages/<page>.js`, en fin de `<body>`) : construit le contenu depuis
   `js/data/` (le plus souvent par `innerHTML`, après échappement par `esc` / `safeUrl`).
5. **Traduction au fil de l'eau** (pages `de/` et `en/` uniquement) : le HTML est déjà traduit par
   `tools/langues.mjs` ; `i18n.js` traduit en plus ce que les scripts ajoutent (`MutationObserver`) et fait
   pointer leurs liens vers les pages de la même langue. Ces pages ont `<base href="../">` : elles
   partagent CSS, images et scripts avec les pages françaises.

Cas particuliers : l'accueil déclare une `importmap` (`"three"` → `vendor/three/`) et charge les étoiles 3D
(`js/stars/`) à la demande ; `404.html` pose une balise `<base>` par script pour fonctionner à toute
profondeur d'adresse ; les fiches `evenement-<slug>.html` sont des copies d'`evenement.html` portant le
slug sur `<body data-slug>`.

## 3. Modules JavaScript et leurs consommateurs

| Dossier | Rôle | Chargé par |
|---|---|---|
| `js/data/` | Données. `site.js` est écrit à la main ; les autres sont **générés par le CMS** (en-tête « FICHIER GÉNÉRÉ »). | pages, outils, CMS |
| `js/i18n/` | `i18n.js` (moteur), `de.js` / `en.js` (dictionnaires écrits à la main, qui fusionnent `contenus-*.js` générés par le CMS) | pages, outils, CMS (import, vérification) |
| `js/pages/` | Un script par page, plus `helpers.js` (formats, échappement, statut à venir / passé, statistiques) et `ics.js` (fichier `.ics` d'une soirée) | pages ; `helpers.js` et `ics.js` aussi par les outils |
| `js/components/` | Code partagé entre pages : soirées (`event-schema`, `event-preview`, `event-ics`, `event-stats`, `tickets`), artistes, équipe, objets chromés | pages, outils, CMS |
| `js/stars/` | Étoiles 3D de l'accueil (Three.js) | accueil seulement |

**Règle des modules partagés.** Les modules importés par Node doivent pouvoir se charger sans navigateur :
aucun accès à `document`, `window` ou `localStorage` au chargement (dans une fonction appelée plus tard,
c'est permis). Sont concernés `js/data/*`, `js/pages/helpers.js`, `js/pages/ics.js`, `js/i18n/i18n.js`
(garde `hasDom`) et, dans `js/components/`, `event-schema`, `event-preview`, `event-ics`, `artists`,
`mission-icons`, `team-composition`, ainsi que `tickets` et `chrome` qu'ils importent. Pour savoir si un
module est concerné : chercher son nom (et celui des modules qui l'importent) dans `tools/` et `cms/`.
`js/components/team.js` fait exception : il agit dès son chargement et n'est importé que par
`association.html`.

## 4. Conventions du CMS

**Serveur** (`cms/server/`).
- Une route se déclare dans `api/*.mjs` avec `router.get|post|put|delete(chemin, handler, options)` ; les
  options (`perm`, `public`, `allowPasswordChange`, `status`) sont décrites sur `Router#add`
  (`http/router.mjs`). Sans `perm`, une route est ouverte à tout compte connecté. Le handler renvoie la
  réponse JSON ; une erreur attendue est une `HttpError` (`http/errors.mjs`), toute autre exception
  devient une erreur 500 sans détail pour le client.
- Un service (`services/*.mjs`) valide avec `Validator` (`services/validation.mjs`), écrit en SQL préparé,
  incrémente `version`, enregistre une révision pour les fiches à historique (`saveRevision` : soirées,
  artistes, lieux, FAQ, équipe) et renvoie l'objet sérialisé (colonnes `snake_case` → propriétés `camelCase`). Une mise à jour reçoit **la fiche complète** : un champ absent
  prend sa valeur par défaut, il n'est pas conservé (voir `updateVenue` et `updateEvent`).
- Modifier un artiste, un lieu, un album ou le texte alternatif d'une image touche `events.updated_at`
  des soirées concernées : c'est ce qui les fait apparaître « à republier » dans Mise en ligne.
- Ajouter un type de contenu : ordre décrit dans [cms/README.md](cms/README.md) § 8.

**Interface** (`cms/admin/`).
- Application monopage sans bibliothèque. `js/app.js` déclare les routes ; une vue est une fonction
  `(ctx, conteneur)` qui peut renvoyer `{ isDirty }` (contrat détaillé sur `route`, `js/lib/router.js`).
- Le DOM se construit avec `h()` (`js/lib/dom.js`), jamais avec `innerHTML` sur des données.
- Les formulaires simples passent par `createEditor` (`js/lib/editor.js`) ; la fiche soirée a sa propre
  logique (`views/event-edit.js`), dont la fonction `payload` doit contenir tous les champs de la fiche.
- Quelques modules du serveur sont servis tels quels à l'interface sous `/admin/shared/`
  (`timeutil`, `slug`, `richtext`, et `mission-icons` du site) : mêmes règles des deux côtés. La liste est
  dans `SHARED` / `SHARED_SITE` (`server/app.mjs`). Les autres fichiers de l'interface sont servis sous
  une adresse versionnée par leur empreinte (`/admin/v/<empreinte>/`) : un redémarrage après mise à jour
  suffit à invalider les caches.

## 5. Couplages implicites (à connaître avant de modifier)

Chacun de ces liens est aussi signalé par un commentaire à l'endroit concerné.

| Si l'on modifie… | …il faut aussi | Sinon |
|---|---|---|
| Un texte français d'une page HTML ou d'un script (même une faute) | changer sa clé dans `js/i18n/de.js` et `en.js`, puis `npm run langues` | le texte réapparaît en français sur les pages traduites |
| Les règles de traduction de `js/i18n/i18n.js` | les reproduire dans `tools/lib/i18n-rules.mjs` | pages `de/` / `en/` générées différemment de la traduction dans le navigateur |
| Un script inline d'une page (langue, `importmap`, `<base>` de la 404) | mettre à jour son empreinte `sha256` dans la CSP de la page | script bloqué par le navigateur (`validate` le signale) |
| Un commentaire HTML dans une page française | relancer `npm run langues` (les commentaires sont recopiés dans `de/` et `en/`) | `validate` signale les pages traduites périmées |
| Le contenu entre `<!-- partial:… -->` et `<!-- /partial:… -->` | modifier plutôt `partials/` puis `npm run partials` | modification écrasée ; ces marqueurs sont lus par `tools/sync-partials.mjs` |
| `artistKey` (`js/components/artists.js`) | faire de même dans `cms/server/services/slug.mjs` | photos des artistes introuvables sur le site |
| `CALENDAR_DOMAIN` (`tools/generate-calendar.mjs`) | ne pas le faire ; même valeur dans `js/pages/ics.js` | chaque soirée vue comme un nouvel événement par les agendas abonnés |
| `calendar/.event-state.json` | ne jamais le supprimer (numéros `SEQUENCE` des soirées) | mises à jour ignorées par certains agendas |
| La propriété `goatcounter` de `js/data/site.js` | garder sa forme (nom puis chaîne entre guillemets doubles) | l'aperçu du CMS, qui la vide par expression régulière, compterait les visites de prévisualisation |
| L'adresse du siège | la changer partout où `validate` la cherche (pages, `js/data/site.js`) | `validate` échoue : il compare le numéro de rue trouvé dans le texte des fichiers HTML et JS du site |
| L'adresse de GoatCounter ou de Formspree | la reporter dans la CSP de chaque page | requêtes bloquées |
| Un fichier de `js/data/` (sauf `site.js`) ou `js/i18n/contenus-*.js` | passer par le CMS | la prochaine mise en ligne est bloquée (fichier modifié hors du CMS) |
| Un champ de soirée | suivre la liste de [CLAUDE.md](../CLAUDE.md) § 3 (migration, service, API, vue, export, import, page, outils, `schedule-targets.mjs`, tests) | champ non saisissable, non exporté ou perdu à l'enregistrement |

## 6. Vérifier une modification

Commandes sans écriture : `npm run validate` (site complet), `npm test` (CMS et modules partagés),
`node tools/<outil>.mjs --check`. Les commandes qui écrivent dans le dépôt ou dans une base, et leurs
précautions, sont listées dans [CLAUDE.md](../CLAUDE.md) § 8. Le dépôt n'a pas d'outil de test visuel :
une modification d'affichage se vérifie dans un navigateur, sur mobile et sur ordinateur.
