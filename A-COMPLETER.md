# À compléter — liste interne

Fichier de travail pour l'équipe du site : **il n'est pas publié** (exclu dans
`.github/workflows/deploy-pages.yml`) et aucune page n'y renvoie.
Cocher `[x]` quand c'est fait, ou supprimer la ligne. `npm run validate` signale aussi
automatiquement une partie de ces manques (traductions, images inutilisées, plans absents).

Dernière mise à jour : 19 octobre 2026.

## Soirées (`js/data/events.js`)

### Adresses exactes (pour le repère et le plan zoomé « Zoom sur la salle »)
- [ ] **ICE BOILER v1** (22/11/2025) — « Salle des fêtes, Munchhausen » : adresse précise ?
- [ ] **Fête de la musique** (21/06/2025) — « Wissembourg » : lieu exact (place, rue, bar…) ?

Une fois l'adresse connue : la mettre dans `place`, remplacer `venue` par les coordonnées GPS
(`{ lat, lon }`, sans `precise: false`), puis `npm run plans` et `npm run calendar`.

### Fréquentation (« ≈ … personnes », chiffres clés et pastilles)
- [ ] **ICE BOILER v2** (28/11/2026) — à ajouter après la soirée : `"… participant·es"` dans `practical`.

### Photos de la soirée (section « La soirée » et galerie)
- [ ] **Center Drop** (04/04/2026) — aucune photo : 2 photos pour « La soirée » (+ galerie si possible).
- [ ] **Fête de la musique** (21/06/2025) — aucune photo.
- [ ] **ICE BOILER v2** — après la soirée : remplacer les photos de la v1 (légendées « édition
      précédente ») par celles de la v2, et créer sa galerie (`npm run photos`).

Format : `about.photos: [{ src: "assets/img/…webp", caption: "Légende" }]` (2 photos), légendes à
traduire dans `js/i18n/de.js` et `en.js`.

### Autres infos de soirée
- [ ] **Fête de la musique** — horaires des sets (le line-up n'a pas d'horaires : pas de barre
      timetable sur la fiche).
- [ ] **Fête de la musique** — âge minimum / conditions d'entrée (gratuit ?).
- [ ] **Center Drop**, **ICE BOILER v1**, **Fête de la musique** — prix d'entrée (facultatif pour
      une soirée passée).
- [ ] Relire les textes « La soirée » (`about`) des 4 soirées : rédigés à partir des données du
      site, à ajuster selon l'esprit réel de chaque soirée.

## Artistes (`js/data/artistes.js`)
- [ ] **T.B.R** — style musical (`ARTIST_STYLES`) : affiché pour l'instant « DJ Contest ».

## Images
- [ ] `assets/img/equipe/presentation.webp` — photo d'équipe utilisée nulle part : l'intégrer
      (page association ?) ou la supprimer.

## Administratif et légal
- [ ] Numéro **RNA** (W…) dans `mentions-legales.html` (emplacement marqué par un commentaire).
- [ ] Suppression des demandes de contact au plus tard trois ans après le dernier échange (boîte
      mail et Formspree) ; vérifier sous-traitance et transferts internationaux du compte Formspree.
- [ ] Autorisations de publication des photos et informations de l'équipe et des personnes
      photographiées.
- [ ] Désactiver GitHub Pages sur l'ancienne copie `yannismetzinger06-ship-it/tekno-never-dies`
      (contenu en double).
- [ ] Confirmer le QR code d'agenda (`assets/img/agenda-qr.svg`) si l'adresse du site change.
