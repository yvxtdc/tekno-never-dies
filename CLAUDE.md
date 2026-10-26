# CLAUDE.md — Tekno Never Dies

Site de l'association Tekno Never Dies (TND6TEM), publié sur `https://teknoneverdies.fr/` (GitHub Pages),
et son CMS maison (`cms/`). Commentaires, docs, messages d'interface et commits sont **en français** : garder
cette langue et ce ton. Les identifiants suivent les conventions déjà présentes dans chaque fichier (souvent
anglaises : `EVENTS`, `eventPath`…) ; les noms d'API, commandes, bibliothèques et protocoles restent tels quels.
Ne jamais renommer du code pour des raisons purement linguistiques.

Documentation de référence, à lire avant de toucher au domaine concerné (ne pas la recopier ici) :
`README.md` (structure, « Où modifier quoi », langues, outils), `docs/cms/README.md` (utilisation, commandes,
« Mettre en ligne »), `docs/cms/architecture.md` (modèle de données, correspondance base ↔ `js/data`),
`docs/cms/exploitation.md` (production, sécurité, sauvegardes), `docs/cms/programmations.md` (modifications
programmées : représentation, conflits, dépendances, états). Le code prime sur une doc qui le contredit.
`A-COMPLETER.md` est une liste de travail interne : ne pas la traiter comme des tâches à faire spontanément.

## 1. Stack et architecture

- **Site public** : HTML + CSS + JavaScript natif (modules ES), **sans framework ni build local** : les fichiers du
  dépôt sont ceux que le navigateur exécute (servis par `npm start` ou Live Server). Au déploiement seulement,
  `deploy-pages.yml` copie les fichiers publics dans `_site/` (sans `tools/`, `cms/`, `docs/`…) et y minifie
  JS/CSS (esbuild) ; les sources ne sont jamais modifiées. Ne pas ajouter d'étape de build.
  Three.js en copie locale (`vendor/three/`), étoiles 3D de l'accueil (`js/stars/`).
- **Pages** : un fichier HTML par page à la racine, chacune avec sa CSP (`<meta http-equiv>`) qui autorise les
  scripts inline par empreinte `sha256` (modifier un script inline = mettre à jour l'empreinte ; `validate` le
  signale). `js/partials.js` (menu, en-tête, JSON-LD) est chargé partout ; `js/pages/<page>.js` = un script par page.
- **Modules partagés** : `js/components/` et `js/pages/helpers.js` sont importés **à la fois par le navigateur,
  par les outils Node (`tools/`) et par le CMS** (`event-schema`, `event-preview`, `event-ics`, `helpers`…).
  Ils doivent rester exécutables sous Node (pas d'accès au DOM au chargement du module).
- **CSS** : `css/style.css` (charte, variables dans `:root`, composants, accueil), `css/pages.css` (pages
  intérieures), `css/components/*.css` (chargés seulement par certaines pages : vérifier les `<link>`).
- **Outils** : `tools/*.mjs` (génération, validation), `tools/lib/` (`event-page.mjs` rend une fiche soirée,
  partagé par `tools/event-pages.mjs` et l'aperçu du CMS ; `html.mjs`, `i18n-rules.mjs`).
- **CMS** (`cms/`, Node ≥ 22.13, CI en Node 24) : `node:http` + routeur maison, SQLite via `node:sqlite`, seule
  dépendance `sharp`. `server/` : `api/` (routes), `services/` (règles métier et validation), `auth/`
  (sessions, permissions, limitation), `db/` (accès + `migrations/NNN_nom.sql`), `export/` (import initial,
  `site-data.mjs`, `modules.mjs`), `publish/` (mise en ligne, planificateur), `preview/`. `admin/` : SPA en modules
  natifs (`js/views/`, `js/lib/`). `bin/cms.mjs` : CLI d'exploitation. `deploy/` : fichiers du serveur de prod.
- **Cycle de publication** (`cms/server/publish/publisher.mjs`) : saisie admin → validation serveur et stockage
  SQLite (brouillons jamais exportés) → export `js/data/*.js` + `js/i18n/contenus-*.js` + images `assets/img/cms/`
  → `event-pages` → `generate-calendar` → `maps` (si `CMS_RUN_MAPS`) → `langues` → `validate` → selon
  `CMS_PUBLISH_MODE` : fichiers seuls (`files`, défaut local), `commit`, ou commit + push sur `main` (prod) →
  `.github/workflows/deploy-pages.yml` (validate + `generate-calendar --check`) → GitHub Pages.
  Si la validation échoue, les fichiers sont restaurés et rien n'est commité.
- **Programmations** (`services/schedule.mjs`, `schedule-targets.mjs`, `publish/scheduler.mjs`) : modifications
  ciblées par clé (champ, passage du line-up par `lineup_slots.uid`, statut), jamais une copie de fiche ; appliquées
  à l'échéance sur l'état le plus récent de la base (conflit si l'élément visé a changé), puis mise en ligne
  automatique. Un nouveau champ affiché doit être ajouté à la liste fermée de `schedule-targets.mjs` (sinon il
  n'est ni programmable ni comparé dans l'historique). Un enregistrement d'un formulaire doit rester un
  aller-retour sans perte (test « lecture puis réenregistrement » de `schedule.test.mjs`).

## 2. Sources de vérité (priorité absolue)

Avant de modifier un fichier, déterminer s'il est **source**, **exporté par le CMS** ou **généré**.

| Contenu | Source de vérité | Fichiers produits (ne jamais éditer à la main) |
|---|---|---|
| Soirées, line-ups, lieux, billets, artistes, photos d'artistes, FAQ, équipe, galerie | Base SQLite du CMS (production) | `js/data/events.js`, `artistes.js`, `artistes-photos.js`, `faq.js`, `equipe.js`, `galerie.js` |
| Traductions des contenus | CMS → **Traductions** | `js/i18n/contenus-de.js`, `contenus-en.js` (fusionnés par `de.js` / `en.js`) |
| Fiches soirées | modèle `evenement.html` + `tools/lib/event-page.mjs` + `events.js` | `evenement-<slug>.html`, `assets/img/events/og/` |
| Agenda | `events.js` + `js/components/event-ics.js` | `calendar/events.ics` (CRLF imposé par `.gitattributes`) |
| Plans des lieux | `venue` des soirées + `tools/maps.mjs` | `assets/img/maps/` |
| Pages DE / EN, sitemap | pages FR + `js/i18n/de.js`, `en.js` + `tools/langues.mjs` | `de/`, `en/`, `sitemap.xml` |
| Header / footer | `partials/header.html`, `footer.html` | blocs `<!-- partial:… -->` de chaque page |
| Infos du site (URL, agenda, contacts, stats) | `js/data/site.js` (code) | — (adresse aussi dans CSP, footer, mentions : `validate` contrôle) |
| Pages institutionnelles, textes d'interface, CSS, JS | le code (HTML/CSS/JS) | — |

Liste exacte des chemins gérés par la mise en ligne : `MANAGED_PATHS` (`publisher.mjs`) et `MANAGED_MODULES`
(`cms/server/export/modules.mjs`). Règles :
- Un fichier géré par le CMS modifié à la main **bloque la prochaine mise en ligne** (ou est écrasé si un admin
  force). Une donnée métier se corrige dans le CMS, pas dans l'export. Si une donnée manque dans le CMS,
  le signaler ou faire évoluer le CMS (§ 4), jamais contourner par l'export.
- Un défaut d'affichage se corrige dans le code responsable (page, composant, CSS, modèle, outil), puis on
  **régénère** ; jamais en retouchant `de/`, `en/`, `evenement-*.html`, `sitemap.xml` ou `calendar/`.
- Les dictionnaires `de.js` / `en.js` ont pour clé le **texte français exact** (HTML pour un paragraphe avec
  liens). Modifier un texte FR (même une coquille) casse sa traduction : mettre à jour la clé dans les deux
  dictionnaires, puis `npm run langues`. `npm run traductions` liste les textes sans traduction.
- Liens internes générés par les scripts : passer par les helpers existants (`eventPath`, `pageInLang`…) pour
  rester dans la bonne langue (les pages traduites utilisent `<base href="../">`).
- Ne jamais lire ni copier `cms/.env`, `.cms-data/`, `*.sqlite`, `import/`, les sauvegardes ou les clés.

## 3. Analyse d'impact obligatoire avant toute modification

Proportionnée à la tâche, mais jamais omise parce que le changement « semble simple » :
1. Identifier le rôle exact du fichier et son statut (§ 2). Lire le code et les conventions voisines.
2. Rechercher (`grep`) tous les consommateurs : imports, appels, classes CSS, `id`, clés de traduction, champs
   de données, routes API, noms de fichiers. Ne pas se limiter au fichier cité dans la demande.
3. Parcourir les couches concernées : page publique ↔ composants partagés ↔ outils `tools/` ↔ export CMS
   (`site-data.mjs`) ↔ services et validation ↔ routes API ↔ vues admin ↔ migrations ↔ tests ↔ workflows.
   Exemple : un champ de soirée touche migration, `services/events.mjs`, `api/content.mjs`,
   `admin/js/views/event-edit.js`, `export/site-data.mjs` et `import-repo.mjs`, `js/pages/evenement.js`,
   `tools/lib/event-page.mjs`, `event-schema`/`event-ics`, traductions, tests.
4. Corriger la cause dans le composant partagé plutôt que masquer le symptôme sur une page ; mais ne pas
   généraliser à toutes les pages sans avoir vérifié que le comportement est réellement commun.
5. Adapter **tous** les composants dépendants réellement impactés, et seulement eux. Une tâche n'est pas
   terminée tant qu'un consommateur identifié reste incompatible. Savoir expliquer pourquoi un composant
   examiné n'a pas eu besoin de changer.
6. Pas de refonte, de reformatage global (Prettier n'est pas appliqué au dépôt) ni de correction hors sujet :
   signaler les autres problèmes découverts au lieu de les corriger.

## 4. Le CMS : à examiner à chaque tâche pertinente

Pour toute tâche (même « site public », CSS, fiche soirée ou outil), se demander explicitement si le CMS est
concerné : champs et formats, formulaire admin, validation client **et** serveur, routes, stockage, export,
aperçu (`/preview/` réutilise les vraies pages et `event-page.mjs`), publication, tests. Ne le modifier que si
l'analyse le justifie.
- Le format exporté dans `js/data` doit rester celui que lisent les pages et les outils : le contrôle de référence
  est `npm test` (`cms/test/export.test.mjs` : import → export identique, sur une base temporaire et une copie du
  site). `npm run cms:admin -- verify` fait la même comparaison mais sur la base configurée (voir ci-dessous).
- **Environnements de données** : les contenus publiés ont pour source la base du CMS **de production** (serveur,
  `CMS_DATA_DIR` de son `cms/.env`), reflétée dans `main` par ses commits. Une base locale (`.cms-data/` par défaut)
  n'est qu'une copie de travail ; les tests (`cms/test/helpers.mjs`) ignorent `cms/.env` et utilisent des
  dossiers temporaires. La base ciblée par `npm run cms` / `cms:admin` dépend de `CMS_DATA_DIR` (environnement,
  puis `cms/.env`) : aucun garde-fou n'empêche de viser une base de production.
- **Toute** commande `cms:admin` qui ouvre la base (y compris `status`, `verify`, `list-users`) crée le dossier et
  le fichier SQLite s'ils manquent et **applique les migrations en attente** ; `npm run cms` aussi, au démarrage.
  Ce ne sont donc pas des vérifications sans effet : ne pas les lancer d'office, jamais contre la production pour
  un simple contrôle, et n'appliquer une migration que si elle est justifiée et autorisée.
- Nouvelle donnée affichée sur le site : vérifier que le CMS sait la saisir, valider, stocker, exporter et
  traduire. Ajout d'un type de contenu : suivre l'ordre de `docs/cms/README.md` § 8.
- Migrations : **nouveau** fichier `NNN_nom.sql`, jamais modifier une migration existante ; préserver les données
  existantes et leur compatibilité ; ne jamais réinitialiser ni supprimer une base pour simplifier.
- Horaires : `HH:MM` à l'heure de Paris ; une heure inférieure au début = lendemain (soirées nocturnes).

## 5. Mobile, desktop et identité visuelle

Toute modification pouvant toucher l'interface (HTML, CSS, JS d'affichage, données affichées) impose une
vérification mobile **et** desktop, même si la demande ne dit pas « mobile ».
- Contrôler : breakpoints existants (surtout `max-width` 420/520/640/760/900/1023 px), largeurs de référence
  320/375/390/430 px, débordement horizontal, retours à la ligne et textes longs (noms de DJ, traductions DE
  plus longues), images et cartes, menu plein écran, cibles tactiles, focus et navigation clavier,
  `prefers-reduced-motion`, `hover` (le tactile n'a pas de survol), erreurs console.
- Fiches soirées : préserver la hiérarchie (nom, date/horaires, line-up, billets, infos pratiques, accès,
  médias) et l'ordre chronologique des passages quand les horaires existent.
- Agenda, QR code, partage, téléchargements, liens externes : raisonner iOS **et** Android séparément (ex. :
  Android n'ouvre pas `webcal://`, Google Agenda n'importe pas un `.ics` téléchargé ; voir README « Agenda »).
- Identité : univers électronique, chromes, étoiles 3D, palette et polices de `:root` (`--violet`, `--lav`,
  `--pink`, `--pink-text` pour le texte rose lisible, `--display` / `--text`…). Réutiliser variables et classes
  existantes ; pas de nouvelle charte, de styles dupliqués ni d'exceptions CSS en cascade. L'admin
  (`cms/admin/css/admin.css`) reste cohérente avec le site.
- Accessibilité : HTML sémantique, labels et `alt` conservés, contraste suffisant, pas de texte tronqué.
- Le dépôt n'a **aucun outil de test visuel** (pas de Playwright/Puppeteer ; `npm test` et `validate` ne
  contrôlent pas le rendu). Vérifier avec un navigateur si un outil est disponible dans la session ; sinon, le
  dire et se limiter à une revue statique des CSS/media queries, qui ne prouve pas le rendu réel. Ne jamais
  prétendre avoir fait un contrôle visuel, une capture ou un essai sur appareil réel qui n'a pas eu lieu.

## 6. Invariants métier

- Ne jamais inventer ni modifier arbitrairement dates, horaires, lieux, line-ups, prix, liens de billetterie.
- Cohérence obligatoire entre données, fiche publique, JSON-LD (`event-schema.js`), aperçus sociaux
  (`event-preview.js`, images og), `.ics` (`event-ics.js` partagé par l'agenda et « Ajouter à l'agenda »),
  traductions et sitemap. Soirée annulée : badge, `EventCancelled`, `STATUS:CANCELLED`, pas de billetterie.
- « À venir » / « passée » est calculé depuis la date (jusqu'à la fin de la soirée), pas stocké.
- SEO / langues : `canonical`, `og:url`, `og:image` absolus ; liens `hreflang` du sitemap ; ne vérifier que les
  éléments réellement touchés par le changement.

## 7. Sécurité et données

Préserver : permissions vérifiées côté serveur sur chaque route (`cms/server/auth/permissions.mjs`), sessions,
CSRF (`X-CSRF-Token` + `Origin`), requêtes préparées, absence d'`innerHTML` sur des données dans l'admin, CSP
stricte (admin et site), échappement (`esc`, `safeUrl`) côté public, contrôle des fichiers importés (sharp),
verrou optimiste (`version`, 409), séparation brouillon / publié, sauvegardes et restauration.
Ne jamais désactiver un contrôle pour « faire passer » un changement. Tout changement touchant auth, permissions,
base, upload ou publication exige une analyse de risque et des tests dédiés dans `cms/test/`.
Aucun secret, mot de passe, jeton ni identifiant dans le code, les docs ou ce fichier.

## 8. Commandes (`package.json`)

Vérification sans écriture dans le dépôt ni dans une base (usage courant) :
- `npm run validate` — contrôle complet du site (liens, HTML, CSP, partials, `.ics`, fiches, `de/`/`en/`, sitemap,
  images, traductions manquantes) ; lance les outils en mode `--check`. `-- --strict` : avertissements bloquants.
- `npm test` — tests du CMS (`node:test`, `cms/test/*.test.mjs`) sur bases et copies du site temporaires (dans le
  dossier temporaire du système, pas dans le dépôt).
- `npm run traductions` — liste les textes HTML sans traduction.
- `node tools/<outil>.mjs --check` (`sync-partials`, `generate-calendar`, `event-pages`, `langues`).

Serveur local de développement : `npm start` = `npx --yes serve .` (sert le site public en lecture ; télécharge
le paquet `serve` depuis npm s'il est absent, donc accès réseau possible).

Génèrent ou réécrivent des fichiers du dépôt (à lancer seulement si la tâche l'exige, puis relire le diff) :
- `npm run partials` (pages + `langues`), `npm run langues` (`de/`, `en/`, `sitemap.xml`),
  `npm run calendar` (`.ics`, fiches, images og, puis `langues` ; il faut `sharp`).
- `npm run plans` (appelle l'API OpenStreetMap), `npm run photos`, `npm run artistes` (remplacés par le CMS ;
  ils réécrivent des fichiers gérés par le CMS : ne pas les utiliser sans demande explicite).

Agissent sur une base du CMS (jamais sans demande explicite, après avoir vérifié la base ciblée, § 4) :
- `npm run cms` (serveur ; migrations au démarrage, sauvegardes automatiques, planificateur qui applique les
  programmations arrivées à échéance et peut mettre en ligne) et `npm run cms:admin -- <commande>` (`migrate`, `import`, `create-user`,
  `reset-password`, `backup`, `restore`, et même `status`, `verify`, `list-users`).

Peuvent publier : `npm run cms:admin -- publish` et la mise en ligne depuis l'interface. Selon
`CMS_PUBLISH_MODE`, elles écrivent les fichiers, commitent, ou commitent **et poussent sur `main`** (production).

CI : `.github/workflows/tests.yml` (PR : `npm ci`, `validate`, `npm test`) ; `deploy-pages.yml` (push sur `main` :
`validate`, `generate-calendar --check`, déploiement). Il n'existe pas de script `build`.

Stratégie : choisir les contrôles selon les impacts (au minimum `npm run validate` pour le site, `npm test` pour le
CMS ou tout module partagé qu'il importe), vérifier les fichiers régénérés et les traductions si la chaîne de
génération est concernée, relire le diff complet, et **lister les vérifications non faites**. Ne jamais
annoncer un succès (test, rendu mobile, publication) non constaté.

## 9. Git et publication

- Avant : `git status`, branche courante, changements préexistants à préserver. Pour une fonctionnalité ou
  correction : branche dédiée au nom explicite, fusionnée par PR vers `main`.
- **Pousser sur `main` déploie le site en production**, et le CMS de production commite lui-même sur `main`
  (récupération en fast-forward uniquement) : éviter tout conflit sur les chemins gérés.
- Jamais sans demande explicite : commit, push, force-push, reset destructif, suppression de branche,
  écrasement de fichiers, mise en ligne CMS, opération sur une base ou un serveur.
- Dépendances : analyser celles que touche le changement (imports, modules partagés navigateur/Node, `sharp`,
  `vendor/three/`, Node ≥ 22.13 de `engines` et Node 24 de la CI) et adapter tout consommateur devenu
  incompatible. Une dépendance externe ne s'ajoute ou ne se met à jour que pour un besoin concret (préférer
  `node:` et le code existant ; pas de mise à jour groupée lors d'une correction isolée) ; dans ce cas, vérifier
  la compatibilité, modifier `package.json` et `package-lock.json` ensemble (via npm, pas à la main) et lancer
  les tests concernés.
- Compte rendu final : fichiers modifiés et pourquoi, composants examinés sans changement, commandes exécutées
  et leur résultat réel, vérifications non effectuées, risques restants.
- Après toute modification du code, des dépendances, des migrations ou de la configuration du CMS susceptible de nécessiter une mise à jour en production, vérifier la procédure documentée et m'indiquer explicitement si la commande `update-cms` doit être exécutée, pourquoi et à quel moment ; ne jamais l'exécuter sans mon autorisation explicite.