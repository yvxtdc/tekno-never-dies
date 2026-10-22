# Tekno Never Dies — site vitrine

Site de l'association **Tekno Never Dies** (TND6TEM) : pages statiques (HTML + CSS + JavaScript natif), contenus dans `js/data/`, étoiles chromées en 3D (Three.js, copie locale) sur l'accueil.
Aucun build : le dossier est publié tel quel. Node.js n'est nécessaire que pour les petits outils dans `tools/`.

## Administration (CMS)

Les soirées, line-ups, artistes, lieux, images, galerie, FAQ, équipe et traductions se gèrent depuis
une **interface d'administration privée** (`cms/`), qui régénère ensuite le site statique :
voir [docs/cms/README.md](docs/cms/README.md) (installation, utilisation, commandes),
[docs/cms/architecture.md](docs/cms/architecture.md) (choix techniques) et
[docs/cms/exploitation.md](docs/cms/exploitation.md) (mise en production, sécurité, sauvegardes).

```sh
npm install && npm run cms:admin -- import
npm run cms:admin -- create-user --email vous@exemple.fr --name "Votre nom" --role admin
npm run cms        # http://localhost:8787/admin/
```

Une fois le CMS en service, les fichiers qu'il génère (`js/data/events.js`, `artistes.js`,
`artistes-photos.js`, `faq.js`, `equipe.js`, `galerie.js`, `js/i18n/contenus-*.js`) ne se modifient plus
à la main : le tableau ci-dessous indique, pour chaque contenu, l'écran du CMS correspondant.

## Lancer le site en local

1. Ouvrir le dossier dans VS Code, installer l'extension **Live Server** (recommandée), clic droit sur `index.html` → **Open with Live Server**.
   (Ou : `npm start`.) Un double-clic sur `index.html` ne marche pas : le navigateur bloque les modules JavaScript en `file://`.
2. Facultatif : `npm install` (uniquement pour `tools/photos.mjs`, qui utilise `sharp`).

## Structure

```
index.html, evenements.html, …   Une page = un fichier HTML à la racine
evenement-<slug>.html             Fiches des soirées, générées par npm run calendar (ne pas modifier à la main)
de/, en/                          Pages en allemand et en anglais, générées par npm run langues (voir « Langues »)
partials/header.html, footer.html  Header et footer communs (voir « Header et footer »)
css/style.css                     Charte, composants, menu plein écran, accueil
css/pages.css                     Pages intérieures (événements, galerie, formulaire, légal…)
css/components/team.css            Page association (équipe)
js/partials.js                    Menu, page active, en-tête au défilement, JSON-LD (toutes les pages)
js/pages/*.js                     Un script par page (événements, galerie, FAQ, contact…)
js/components/                    Modules partagés par plusieurs pages (artistes, équipe, données structurées des soirées)
js/data/*.js                      Contenus : événements, galerie, FAQ, équipe, infos du site
js/i18n/                          Traduction allemand / anglais (i18n.js + dictionnaires de.js, en.js)
js/stars/                         Étoiles 3D de l'accueil (réglages dans config.js)
assets/                           Images, polices (auto-hébergées), photos de galerie, QR code de l'agenda
calendar/                         Agenda .ics généré (ne pas modifier à la main)
tools/                            Scripts Node (validation, header/footer, photos, agenda)
cms/                              CMS : serveur Node (API, SQLite, mise en ligne), interface d'administration, tests
docs/cms/                         Documentation du CMS
vendor/three/                     Three.js
```

## Où modifier quoi

| Je veux… | Je vais dans… |
|---|---|
| Ajouter / modifier un événement | CMS → **Soirées**, puis **Mise en ligne** (agenda `.ics`, fiche `evenement-<slug>.html`, image d'aperçu, pages traduites et sitemap régénérés ; « à venir » / « passé » est calculé depuis la date). Sans CMS : `js/data/events.js`, puis `npm run calendar`. |
| Ajouter des photos à la galerie | CMS → **Galerie photo** (sans CMS : `npm run photos -- import/mon-dossier --titre "…" --date AAAA-MM-JJ`) |
| Lien Instagram, style ou photo d'un artiste | CMS → **Artistes** (sans CMS : `js/data/artistes.js`, photos dans `import/artistes/` puis `npm run artistes`) |
| Adresse, plan d'un lieu | CMS → **Lieux** |
| Modifier la FAQ | CMS → **FAQ** (sans CMS : `js/data/faq.js`) |
| Modifier l'équipe | CMS → **Équipe** (sans CMS : `js/data/equipe.js`) |
| Traduire les textes des soirées, FAQ, équipe | CMS → **Traductions** (exportées dans `js/i18n/contenus-de.js` et `contenus-en.js`) |
| Traduire un texte (allemand, anglais) | `js/i18n/de.js` et `en.js` : `"texte français": "traduction"`, puis `npm run langues` (voir « Langues ») |
| Modifier le header, le menu ou le footer | `partials/header.html` ou `footer.html`, puis `npm run partials` |
| Changer couleurs, tailles, espacements | `css/style.css` (variables en haut, dans `:root`) |
| Régler les étoiles (vitesse, couleurs, on/off) | `js/stars/config.js` |
| Changer l'adresse du siège | `js/data/site.js` (+ `association.html` et `mentions-legales.html`) |
| Statistiques de visite (GoatCounter) | tableau de bord : https://teknoneverdies.goatcounter.com — réglage : `SITE.goatcounter` dans `js/data/site.js` (vide = désactivé ; si l'adresse change, la mettre aussi dans la CSP de chaque page) |

## Header et footer

Le header et le footer sont **écrits directement dans chaque page**, entre les balises
`<!-- partial:header -->…<!-- /partial:header -->` (et `footer`). Ne modifie pas ce contenu dans les pages :
modifie `partials/header.html` ou `partials/footer.html`, puis lance `npm run partials`.
`npm run validate` échoue si une page n'est pas à jour. `npm run partials` met aussi à jour les pages `de/` et `en/`.

## Langues (FR / DE / EN)

Le site est écrit en français. Chaque page existe aussi en allemand et en anglais : `de/faq.html`, `en/faq.html`…
Ces pages sont **générées** par `npm run langues` (aussi lancé par `npm run partials` et `npm run calendar`) à partir
des pages françaises et des dictionnaires `js/i18n/de.js` et `en.js` (clé = texte français exact, paragraphe avec
liens = son HTML). Un texte sans traduction reste en français. Ne modifie jamais `de/`, `en/` ni `sitemap.xml` à la
main : modifie la page française ou le dictionnaire, puis lance `npm run langues` (`npm run validate` échoue sinon).

- Les moteurs de recherche et les aperçus WhatsApp / Instagram lisent une vraie page dans la langue, avec sa propre
  adresse ; `sitemap.xml` relie les trois versions de chaque page (`hreflang`).
- Une page traduite contient `<base href="../">` : elle utilise les mêmes styles, images et scripts que la page
  française. Ce que les scripts ajoutent (événements, galerie, FAQ…) est traduit dans le navigateur par
  `js/i18n/i18n.js`, qui fait aussi pointer leurs liens vers les pages de la même langue.
- Les boutons FR / DE / EN ouvrent la même page dans l'autre langue ; le choix est mémorisé dans le navigateur.
  À la première visite d'un navigateur réglé en allemand ou en anglais, un bandeau propose la traduction (pas de
  redirection automatique : Google doit pouvoir lire les pages françaises).
- `?lang=de` dans une adresse (anciens liens partagés) mène à la page allemande.

Après avoir ajouté un événement, une question de FAQ ou un membre : `npm run validate` liste les textes de
`js/data` encore sans traduction. Après avoir modifié un texte d'une page HTML (même une faute corrigée), sa clé
change : `npm run traductions` liste, page par page, les textes à (re)traduire. Un texte identique dans toutes les
langues (nom, adresse) s'ajoute aussi au dictionnaire, sous la forme `"FAQ": "FAQ"`. Les pages légales traduites affichent que seule la version française fait foi.

## Outils (`npm run …`)

| Commande | Rôle |
|---|---|
| `validate` | Liens et images locaux, HTML bien fermé, meta, `id` uniques, header/footer à jour, agenda `.ics`, fiches événement et pages `de/` / `en/` à jour, `og:image`, images citées dans `js/data`, sitemap, adresse cohérente. Liste aussi ce qui reste à compléter (dont les images que rien n'utilise) (`-- --strict` pour en faire une erreur). |
| `partials` | Recopie header et footer dans toutes les pages (puis `langues`). |
| `calendar` | Régénère `calendar/events.ics`, les fiches `evenement-<slug>.html` (titre, flyer et données structurées en dur, pour les aperçus WhatsApp / Instagram et Google), leur image d'aperçu `assets/img/events/og/<slug>.jpg` (il faut `npm install`) depuis `js/data/events.js`, puis les pages `de/`, `en/` et `sitemap.xml` (`langues`). |
| `photos` | Convertit un dossier de photos (WebP + JPEG) et met à jour la galerie. |
| `langues` | Génère les pages `de/` et `en/` et `sitemap.xml` (avec les liens entre les langues). À relancer après toute modification d'une page française ou d'un dictionnaire. |
| `traductions` | Liste les textes des pages HTML sans traduction allemande ou anglaise (le nombre apparaît aussi dans `validate`). |
| `artistes` | Convertit les photos de `import/artistes/` (carrés WebP) et met à jour `js/data/artistes-photos.js`. |

## Contact (Formspree)

`contact.html` envoie le message à Formspree (GitHub Pages n'exécute pas de code serveur). Le formulaire part en arrière-plan
(`js/pages/contact.js`), sans quitter la page, et contient un champ piège anti-spam (`_gotcha`). Pour changer la boîte de
réception, remplacer l'adresse de l'attribut `action`. Sans JavaScript, le formulaire s'envoie normalement.

## Mise en ligne

Le workflow `.github/workflows/deploy-pages.yml` vérifie puis déploie le site statique sur GitHub Pages. Pour l’activer dans ce dépôt, ouvrir **Settings → Pages** et choisir **GitHub Actions** comme source de publication. Le déploiement par branche actuel est géré par GitHub et ne permet pas de définir les permissions OIDC depuis les fichiers du dépôt.

Avant de publier :

1. **Adresse du site** : `https://teknoneverdies.fr/` (domaine acheté chez Gandi, publié par GitHub Pages ; le fichier `CNAME` contient le domaine).
   L'ancienne adresse `https://yvxtdc.github.io/tekno-never-dies/` redirige automatiquement vers le domaine.
   Si l'adresse change, mettre à jour `js/data/site.js`, `CNAME`, `robots.txt` et le `<head>` de chaque page (puis `npm run langues` pour `de/`, `en/` et `sitemap.xml`) (`og:url`, `og:image`, `canonical`).
2. **Agenda** : l'adresse `.ics` est dans `SITE.agenda` (`js/data/site.js`). Le QR code `assets/img/agenda-qr.svg`
   encode `SITE.agenda.page` (`https://teknoneverdies.fr/evenements.html#agenda`) et pas le lien `webcal://` :
   Android ne sait pas ouvrir `webcal://` (iPhone oui). La page propose ensuite le bon bouton (Calendrier sur iPhone,
   Google Agenda sur Android, fichier `.ics` sinon). Si l'adresse du site change, régénérer le QR code avec cette adresse.
3. **Aperçu sur les réseaux** : `assets/img/og-image.jpg` (1200×630) est déclarée dans le `<head>` de chaque page, avec `og:url` et `canonical` en adresse absolue. Si l'adresse du site change, les remplacer dans toutes les pages. Les fiches événement utilisent leur flyer, recadré en 1200×630 (`assets/img/events/og/`). Les anciens liens `evenement.html?slug=…` redirigent vers la fiche.
4. **À compléter** : `npm run validate` liste les champs `[… À REMPLACER]`, les réponses FAQ `needsValidation` et la billetterie ou le line-up manquants des prochaines soirées.
5. **Page 404** : une balise `<base>` (ajoutée par un petit script) garde styles et liens corrects, même sur une adresse imbriquée. Elle fonctionne à la racine du domaine comme sous l'ancienne adresse `/tekno-never-dies/`.

## Informations publiques vérifiées

Issues de l'API publique de recherche des entreprises, consultée le 23 septembre 2026 :

- Nom : **TEKNO NEVER DIES** — sigle **TND** — association active
- SIREN **939 301 768** — SIRET du siège **939 301 768 00015**
- Siège : **5 avenue Georges Clemenceau, 67630 Lauterbourg** (confirmation de l’association, 1er octobre 2026)
- Responsable de publication : **Yannis Metzinger**, président
- Création : 4 décembre 2024 — activité : 90.01Z, arts du spectacle vivant

Ces informations sont une base de travail : elles ne remplacent pas la validation par l'association des mentions légales.

## Informations à compléter

La liste des informations manquantes (adresses, fréquentation, photos de soirées, légal…) est tenue dans
`A-COMPLETER.md` : fichier interne, non publié sur le site.

## Licences

Polices Archivo Black et Montserrat : licence OFL (hébergées dans `assets/fonts/`). Three.js : licence MIT.
