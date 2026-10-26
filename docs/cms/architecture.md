# CMS Tekno Never Dies — audit et architecture

Ce document explique **pourquoi** le CMS est construit ainsi. Pour l'installer et l'utiliser :
[README du CMS](README.md). Pour l'exploitation (sauvegardes, déploiement) : [exploitation.md](exploitation.md).

## 1. Audit de l'existant (octobre 2026)

| Sujet | Constat |
|---|---|
| Technologies | Site 100 % statique : HTML, CSS et JavaScript natif (modules ES), aucun framework ni build. Three.js en copie locale pour l'accueil. |
| Hébergement | GitHub Pages (domaine `teknoneverdies.fr`), déployé par `.github/workflows/deploy-pages.yml` à chaque push sur `main` : validation, copie des fichiers publics, minification. **Aucun code serveur possible.** |
| Contenus | Modules JavaScript dans `js/data/` : `events.js` (soirées), `artistes.js` (liens Instagram, styles), `artistes-photos.js`, `faq.js`, `equipe.js`, `galerie.js`, `site.js`. Les pages les importent et construisent le contenu dans le navigateur. |
| Génération | Scripts Node dans `tools/` : fiches `evenement-<slug>.html` (titre, aperçus sociaux, JSON-LD écrits en dur pour les robots), agenda `calendar/events.ics`, images d'aperçu 1200×630, plans OpenStreetMap, pages `de/` et `en/` traduites, `sitemap.xml`, validation complète (`npm run validate`). |
| Langues | Pages françaises + copies `de/` et `en/` générées depuis des dictionnaires `js/i18n/de.js` et `en.js` dont la clé est le **texte français exact**. Les textes des données sont traduits dans le navigateur avec les mêmes dictionnaires. |
| Line-up | Chaque passage est un texte libre (`"Leander B2B Sven Gerber"`, horaire `"22h00 – 23h30"`). Les liens Instagram, styles et photos sont retrouvés par une clé normalisée du nom (`"dannocta"`). |
| Lieux | Texte libre `place` + coordonnées `venue` (plans). |
| Médias | Images WebP dans `assets/img/`, converties par `npm run photos` / `npm run artistes` (sharp). |
| Sécurité du site | CSP stricte dans chaque page, liens externes filtrés (`safeUrl`), contenu échappé avant `innerHTML` (sauf réponses de FAQ, HTML écrit à la main). |

Conséquence : le site est rapide, robuste et bien référencé, mais **chaque mise à jour demande de
modifier du code et de lancer des scripts**. GitHub Pages ne peut ni authentifier ni enregistrer quoi
que ce soit : un CMS a donc besoin de son propre serveur.

## 2. Architecture retenue : CMS « headless » à publication statique

```
┌────────────────────────── Serveur du CMS (Node.js 24) ──────────────────────────┐
│  /admin        interface d'administration (HTML/CSS/JS natifs, comme le site)  │
│  /api/*        API JSON authentifiée (sessions, rôles, CSRF, validation)        │
│  /preview/*    le vrai site servi avec les données de la base (brouillons)      │
│                                                                                  │
│  SQLite (node:sqlite)   ← source de vérité des contenus, comptes, historique    │
│  CMS_DATA_DIR/media     ← originaux des images importées (hors Git)             │
│                                                                                  │
│  « Mettre en ligne » : base → js/data/*.js (format inchangé) + images optimisées │
│       → outils existants (fiches, agenda, plans, langues, sitemap, validation)   │
│       → selon CMS_PUBLISH_MODE : fichiers écrits / commit / commit + push        │
└──────────────────────────────────────┬───────────────────────────────────────────┘
                                       │ git push (clé de déploiement)
                                       ▼
                     GitHub → Actions → GitHub Pages (site public inchangé)
```

### Pourquoi ce choix

- **Le site public ne change pas de nature.** Il reste statique, rapide, sans base de données exposée
  ni surface d'attaque côté visiteurs. Les fiches, l'agenda, les aperçus sociaux, le JSON-LD, les
  traductions et le sitemap continuent d'être produits par les outils existants, déjà validés.
- **Aucune deuxième version du contenu.** Le CMS exporte exactement le format des modules `js/data`.
  L'import initial suivi d'un export est vérifié **identique** aux données actuelles (test
  automatisé `import-roundtrip`) : la première mise en ligne ne change rien de visible.
- **Prévisualisation fidèle.** L'aperçu sert les vraies pages du site, avec les mêmes scripts : seuls
  les modules de données sont générés à la volée depuis la base.
- **Évolution incrémentale.** Pas de migration de framework, pas de bundler. Le serveur n'a qu'une
  dépendance d'exécution : `sharp`, déjà utilisée par les outils pour les images.

### Alternatives écartées

| Option | Pourquoi non |
|---|---|
| CMS Git « sans serveur » (Decap, TinaCMS…) | Les contenus resteraient des fichiers JS libres, sans relations (artistes ↔ line-ups ↔ lieux), sans validation serveur ni rôles fins ; l'authentification dépend de GitHub (comptes GitHub pour chaque bénévole). |
| CMS hébergé (Strapi, Directus, Sanity…) | Lourd à héberger et à maintenir pour une association, modèle de données générique, coût ou dépendance à un service externe, et il faudrait quand même réécrire la génération statique. |
| Rendre le site dynamique (SSR) | Refonte complète, perte de GitHub Pages, risques SEO et de performance, injustifiée pour quelques mises à jour par mois. |

## 3. Choix techniques

| Besoin | Choix | Raison |
|---|---|---|
| Serveur HTTP | `node:http` + petit routeur maison (`cms/server/http/`) | Peu de routes, pas de dépendance à mettre à jour ; en-têtes de sécurité maîtrisés. |
| Base de données | SQLite via `node:sqlite` (Node ≥ 22.13, module intégré) | Un seul fichier, transactions, clés étrangères, sauvegarde à chaud ; aucun service à administrer. Accès isolé dans `cms/server/db/index.mjs` (remplaçable par better-sqlite3 si besoin). |
| Migrations | Fichiers SQL numérotés (`cms/server/db/migrations/`), table `schema_migrations` | Simples, relus en revue de code, appliqués au démarrage dans une transaction. |
| Mots de passe | scrypt (`node:crypto`), sel aléatoire, comparaison en temps constant | Algorithme éprouvé, intégré à Node, résistant aux GPU. |
| Sessions | Jeton aléatoire en cookie `HttpOnly; SameSite=Strict; Secure` (`__Host-`), empreinte SHA-256 en base | Révocables (déconnexion, changement de mot de passe, désactivation), expiration d'inactivité et durée maximale. |
| CSRF | Jeton par session dans l'en-tête `X-CSRF-Token` + contrôle de l'en-tête `Origin` + `SameSite=Strict` | Défense en profondeur. |
| Images | sharp : détection du type réel, réencodage WebP/JPEG, variantes par usage | Pas de fichiers servis tels quels, métadonnées EXIF (GPS) retirées. |
| Texte enrichi | Syntaxe minimale (`**gras**`, `*italique*`, `[lien](adresse)`) convertie en HTML sûr | Impossible d'injecter du HTML ; garde la mise en forme du site ; reproduit à l'identique les réponses de FAQ existantes. |
| Interface | Application monopage en modules ES natifs, CSS propre, polices du site | Cohérente avec le site (pas de build), aucune bibliothèque UI. |
| Tests | `node:test` (intégré) | Pas de dépendance de test ; tests d'intégration HTTP réels sur une base temporaire. |

## 4. Modèle de données

```
users ─┬─ sessions                         settings (empreintes d'export, import)
       └─ (auteurs de) events, revisions, audit_log, publications

venues ──< events >── media (affiche, fond)
              │  ├──< event_photos >── media
              │  ├──< lineup_slots ──< lineup_slot_artists >── artists ── media (photo)
              │  ├──< event_redirects (anciennes adresses)
              │  └──  gallery_albums ──< gallery_photos >── media
faq_items     team_members ── media      translations (texte français → de / en)
revisions (historique de chaque fiche)   audit_log (journal)   preview_tokens
scheduled_changes ──< scheduled_change_log   (programmations ciblées, voir programmations.md)
```

- **Identifiants stables** : clé entière par table ; `slug` unique pour les adresses ; `uid` aléatoire
  pour les fichiers de médias.
- **Verrou optimiste** : colonne `version` ; une sauvegarde sur une version périmée est fusionnée champ
  par champ avec la version de départ du formulaire (historique), ou refusée (409) si un même champ a
  été modifié des deux côtés : jamais d'écrasement silencieux.
- **Programmations** : modifications ciblées par clé (champ, passage `lineup_slots.uid`, statut),
  appliquées à une date sur l'état le plus récent ; conflits, dépendances et ordre décrits dans
  [programmations.md](programmations.md).
- **Intégrité** : clés étrangères `ON DELETE RESTRICT` sur les médias, lieux et artistes utilisés
  (suppression refusée avec la liste des usages), `CASCADE` pour les éléments dépendants (passages,
  photos d'une soirée), `CHECK` sur les statuts et rôles.
- **Line-up** : un passage (`lineup_slots`) a une position, des horaires, un style et un nom
  spécifiques facultatifs, et un ou plusieurs artistes (`lineup_slot_artists`, B2B). Renommer un artiste
  met à jour toutes ses soirées, sauf un passage dont le nom affiché a été saisi exprès (ex. « VALK B2B
  REDFOX » écrit comme sur l'affiche).
- **Horaires** : `HH:MM` à l'heure de Paris (fuseau unique du site, colonne `timezone` prévue). Une
  heure inférieure au début de la soirée est le lendemain (04:00 après 21:00).

## 5. Correspondance avec le site public

| Base | Export (`js/data/events.js`) |
|---|---|
| `status` published / cancelled | soirée exportée ; `cancelled: true` si annulée (badge, JSON-LD `EventCancelled`, `.ics` `STATUS:CANCELLED`) |
| `status` draft / scheduled / archived | absente du site (jamais exportée ni indexée) |
| `start_time`, `end_time` | `time: "21h00 – 4h00"` |
| `doors_time` | `doors: "20h30"` (ligne « Ouverture des portes » sous les horaires) |
| lieu | `place` (libellé public ou « nom, adresse, ville ») + `venue` (plans) |
| passages | `lineup: [{ name, style?, time? }]` |
| `seo_title`, `seo_description` | `seo` : remplace le titre et la description des aperçus |
| `links` | liens ajoutés à la section « Infos pratiques » |
| `event_redirects` | `EVENT_REDIRECTS` : page `evenement-<ancien>.html` non indexée qui redirige |
| traductions | `js/i18n/contenus-de.js` / `contenus-en.js`, fusionnés par `de.js` / `en.js` |

## 6. Ce qui reste dans le code (volontairement)

Les pages institutionnelles (accueil, association, mentions légales, conditions…) et les textes de
l'interface restent dans le HTML : ils sont traduits par des dictionnaires dont la clé est le texte
exact, et une modification sans retraduction ferait réapparaître le français sur les pages allemandes
et anglaises. Les coordonnées (adresse, e-mail) sont aussi écrites dans la CSP, le pied de page et les
mentions légales, et contrôlées par `npm run validate`. Les rendre administrables demanderait de
générer ces pages depuis des gabarits : l'architecture le permet (même principe que les fiches
soirées), mais ce n'était pas justifié pour des textes qui changent une fois par an.

Le site n'a pas de rubrique d'actualités : en créer une serait une évolution graphique et éditoriale
à décider par l'association. Le modèle (table, service, export, page générée) se calquerait sur les
soirées.
