# Tekno Never Dies — site vitrine

Site de l'association **Tekno Never Dies** (TND6TEM) : pages statiques (HTML + CSS + JavaScript natif), contenus dans `js/data/`, étoiles chromées en 3D (Three.js, copie locale) sur l'accueil.
Aucun build : le dossier est publié tel quel. Node.js n'est nécessaire que pour les petits outils dans `tools/`.

## Lancer le site en local

1. Ouvrir le dossier dans VS Code, installer l'extension **Live Server** (recommandée), clic droit sur `index.html` → **Open with Live Server**.
   (Ou : `npm start`.) Un double-clic sur `index.html` ne marche pas : le navigateur bloque les modules JavaScript en `file://`.
2. Facultatif : `npm install` (uniquement pour `tools/photos.mjs`, qui utilise `sharp`).

## Structure

```
index.html, evenements.html, …   Une page = un fichier HTML à la racine
partials/header.html, footer.html  Header et footer communs (voir « Header et footer »)
css/style.css                     Charte, composants, menu plein écran, accueil
css/pages.css                     Pages intérieures (événements, galerie, formulaire, légal…)
css/components/team.css            Page association (équipe)
js/partials.js                    Menu, page active, en-tête au défilement, JSON-LD (toutes les pages)
js/pages/*.js                     Un script par page (événements, galerie, FAQ, contact…)
js/data/*.js                      Contenus : événements, galerie, FAQ, équipe, infos du site
js/i18n/                          Traduction allemand / anglais (i18n.js + dictionnaires de.js, en.js)
js/stars/                         Étoiles 3D de l'accueil (réglages dans config.js)
assets/                           Images, polices (auto-hébergées), photos de galerie, QR code de l'agenda
calendar/                         Agenda .ics généré (ne pas modifier à la main)
tools/                            Scripts Node (validation, header/footer, photos, agenda)
vendor/three/                     Three.js
```

## Où modifier quoi

| Je veux… | Je vais dans… |
|---|---|
| Ajouter / modifier un événement | `js/data/events.js`, puis `npm run calendar` (« à venir » / « passé » est calculé depuis la date) |
| Ajouter des photos à la galerie | `npm run photos -- import/mon-dossier --titre "…" --date AAAA-MM-JJ` |
| Lien Instagram d'un artiste du line-up | `js/data/artistes.js` |
| Photo de profil d'un artiste (cercle du line-up) | déposer `Nom de l'artiste.jpg` dans `import/artistes/`, puis `npm run artistes` |
| Modifier la FAQ | `js/data/faq.js` |
| Modifier l'équipe | `js/data/equipe.js` |
| Traduire un texte (allemand, anglais) | `js/i18n/de.js` et `en.js` : `"texte français": "traduction"` (voir « Langues ») |
| Modifier le header, le menu ou le footer | `partials/header.html` ou `footer.html`, puis `npm run partials` |
| Changer couleurs, tailles, espacements | `css/style.css` (variables en haut, dans `:root`) |
| Régler les étoiles (vitesse, couleurs, on/off) | `js/stars/config.js` |
| Changer l'adresse du siège | `js/data/site.js` (+ `association.html` et `mentions-legales.html`) |
| Statistiques de visite (GoatCounter) | tableau de bord : https://teknoneverdies.goatcounter.com — réglage : `SITE.goatcounter` dans `js/data/site.js` (vide = désactivé ; si l'adresse change, la mettre aussi dans la CSP de chaque page) |

## Header et footer

Le header et le footer sont **écrits directement dans chaque page**, entre les balises
`<!-- partial:header -->…<!-- /partial:header -->` (et `footer`). Ne modifie pas ce contenu dans les pages :
modifie `partials/header.html` ou `partials/footer.html`, puis lance `npm run partials`.
`npm run validate` échoue si une page n'est pas à jour.

## Langues (FR / DE / EN)

Le site est écrit en français ; le bouton FR / DE / EN en bas du menu traduit chaque page dans le navigateur.
`js/i18n/i18n.js` remplace les textes français par leur traduction trouvée dans `js/i18n/de.js` et `en.js`
(clé = texte français exact, paragraphe avec liens = son HTML). Un texte sans traduction reste en français.
Le choix est mémorisé dans le navigateur ; à la première visite, la langue du navigateur est utilisée.
`?lang=de` dans une adresse force une langue (lien à partager à un public germanophone, par exemple).

Après avoir ajouté un événement, une question de FAQ ou un membre : `npm run validate` liste les textes de
`js/data` encore sans traduction. Les pages légales traduites affichent que seule la version française fait foi.

## Outils (`npm run …`)

| Commande | Rôle |
|---|---|
| `validate` | Liens et images locaux, HTML bien fermé, meta, `id` uniques, header/footer à jour, agenda `.ics` à jour, `og:image`, images citées dans `js/data`, sitemap, adresse cohérente. Liste aussi ce qui reste à compléter (`-- --strict` pour en faire une erreur). |
| `partials` | Recopie header et footer dans toutes les pages. |
| `calendar` | Régénère `calendar/events.ics` depuis `js/data/events.js`. |
| `photos` | Convertit un dossier de photos (WebP + JPEG) et met à jour la galerie. |
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
   Si l'adresse change, mettre à jour `js/data/site.js`, `CNAME`, `sitemap.xml`, `robots.txt` et le `<head>` de chaque page (`og:url`, `og:image`, `canonical`).
2. **Agenda** : l'adresse `.ics` est dans `SITE.agenda` (`js/data/site.js`). Si elle change, régénérer le QR code
   `assets/img/agenda-qr.svg` (encodant l'adresse `webcal://…`).
3. **Aperçu sur les réseaux** : `assets/img/og-image.jpg` (1200×630) est déclarée dans le `<head>` de chaque page, avec `og:url` et `canonical` en adresse absolue. Si l'adresse du site change, les remplacer dans toutes les pages. Les fiches événement utilisent leur flyer.
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

## Informations à finaliser avant publication

- Ajouter le numéro RNA dans `mentions-legales.html` (emplacement signalé par un commentaire).
- Appliquer la suppression des demandes au plus tard trois ans après le dernier échange, y compris dans la boîte mail et Formspree ; vérifier les conditions de sous-traitance et les garanties de transfert international du compte.
- ICE BOILER v2 : ajouter le lien de billetterie (`ticketUrl`) et le line-up dans `js/data/events.js`.
- Désactiver GitHub Pages sur l’ancienne copie `yannismetzinger06-ship-it/tekno-never-dies` (contenu en double).
- Vérifier les autorisations de publication des photos et informations de l’équipe et des personnes photographiées.
- Confirmer l’exactitude du QR code d’agenda après changement de l’URL d’hébergement.

## Licences

Polices Archivo Black et Montserrat : licence OFL (hébergées dans `assets/fonts/`). Three.js : licence MIT.
