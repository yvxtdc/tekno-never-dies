/**
 * Galerie photo, organisée par année puis par événement.
 * Pour ajouter des photos : dépose les fichiers dans assets/img/gallery/,
 * puis ajoute leur chemin dans le tableau "photos" de l'événement concerné.
 * "eventSlug" (facultatif) relie la galerie à sa fiche dans events.js.
 */
export const GALLERY = [
  {
    year: 2025,
    events: [
      {
        title: "Warm-up de printemps",
        eventSlug: "warm-up-printemps-2025",
        photos: [
          // Ajoute ici les chemins des photos, ex : "assets/img/gallery/warmup-2025-01.webp"
        ]
      }
    ]
  }
];
