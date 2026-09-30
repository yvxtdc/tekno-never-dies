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
js/data/*.js                      Contenus : événements, galerie, FAQ, actualités, partenaires, équipe, infos du site
js/stars/                         Étoiles 3D de l'accueil (réglages dans config.js)
assets/                           Images, polices (auto-hébergées), photos de galerie, QR code de l'agenda
calendar/                         Agenda .ics généré (ne pas modifier à la main)
tools/                            Scripts Node (validation, header/footer, photos, agenda)
vendor/three/                     Three.js
```

## Où modifier quoi

| Je veux… | Je vais dans… |
|---|---|
| Ajouter / modifier un événement | `js/data/events.js`, puis `npm run calendar` |
| Ajouter des photos à la galerie | `npm run photos -- import/mon-dossier --titre "…" --date AAAA-MM-JJ` |
| Modifier la FAQ, les actualités, les partenaires | `js/data/faq.js`, `actualites.js`, `partenaires.js` |
| Modifier l'équipe | `js/data/equipe.js` |
| Modifier le header, le menu ou le footer | `partials/header.html` ou `footer.html`, puis `npm run partials` |
| Changer couleurs, tailles, espacements | `css/style.css` (variables en haut, dans `:root`) |
| Régler les étoiles (vitesse, couleurs, on/off) | `js/stars/config.js` |
| Changer l'adresse du siège | `js/data/site.js` (+ `association.html` et `mentions-legales.html`) |

## Header et footer

Le header et le footer sont **écrits directement dans chaque page**, entre les balises
`<!-- partial:header -->…<!-- /partial:header -->` (et `footer`). Ne modifie pas ce contenu dans les pages :
modifie `partials/header.html` ou `partials/footer.html`, puis lance `npm run partials`.
`npm run validate` échoue si une page n'est pas à jour.

## Outils (`npm run …`)

| Commande | Rôle |
|---|---|
| `validate` | Liens et images locaux, HTML bien fermé, meta, `id` uniques, header/footer à jour, sitemap, adresse cohérente. Liste aussi ce qui reste à compléter (`-- --strict` pour en faire une erreur). |
| `partials` | Recopie header et footer dans toutes les pages. |
| `calendar` | Régénère `calendar/events.ics` depuis `js/data/events.js`. |
| `photos` | Convertit un dossier de photos (WebP + JPEG) et met à jour la galerie. |

## Contact (Formspree)

`contact.html` envoie le message à Formspree (GitHub Pages n'exécute pas de code serveur). Le formulaire part en arrière-plan
(`js/pages/contact.js`), sans quitter la page, et contient un champ piège anti-spam (`_gotcha`). Pour changer la boîte de
réception, remplacer l'adresse de l'attribut `action`. Sans JavaScript, le formulaire s'envoie normalement.

## Mise en ligne

Publier le dossier tel quel (GitHub Pages, Netlify, Cloudflare Pages). Avant de publier :

1. **Domaine** : remplacer `www.example.org` dans `js/data/site.js` (`SITE.url`), `sitemap.xml` et `robots.txt`.
   `robots.txt` et `sitemap.xml` ne sont lus que s'ils sont à la racine du domaine (pas dans un sous-dossier `/tekno-never-dies/`).
   Une fois le domaine renseigné, `canonical` et `og:url` sont ajoutés automatiquement.
2. **Agenda** : l'adresse `.ics` est dans `SITE.agenda` (`js/data/site.js`). Si elle change, régénérer le QR code
   `assets/img/agenda-qr.svg` (encodant l'adresse `webcal://…`).
3. **Aperçu sur les réseaux** : ajouter une image `og:image` (adresse absolue, donc après le point 1) dans le `<head>` des pages.
4. **Placeholders** : `npm run validate` liste les champs `[… À REMPLACER]`, les événements `demo` et les partenaires d'exemple.
5. **Page 404** : ses liens sont relatifs ; sur un hébergement en sous-dossier, elle s'affiche sans style si l'adresse erronée est imbriquée.

## Informations publiques vérifiées

Issues de l'API publique de recherche des entreprises, consultée le 23 septembre 2026 :

- Nom : **TEKNO NEVER DIES** — sigle **TND** — association active
- SIREN **939 301 768** — SIRET du siège **939 301 768 00015**
- Siège déclaré : **51 avenue Georges Clemenceau, 67630 Lauterbourg** (à confirmer : une version antérieure indiquait « 5 avenue »)
- Création : 4 décembre 2024 — activité : 90.01Z, arts du spectacle vivant

Ces informations sont une base de travail : elles ne remplacent pas la validation par l'association des mentions légales.

## Licences

Polices Archivo Black et Montserrat : licence OFL (hébergées dans `assets/fonts/`). Three.js : licence MIT.
