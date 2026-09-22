/**
 * Données des événements. Un seul endroit à modifier pour que la liste ET
 * les fiches détaillées se mettent à jour automatiquement.
 *
 * Pour ajouter un événement : copie un objet ci-dessous, change les valeurs.
 * "slug" doit être unique (utilisé dans l'adresse de la fiche, ex :
 * evenement.html?slug=soiree-halloween-2026), sans espaces ni accents.
 * "status" : "a-venir" ou "passe".
 */
export const EVENTS = [
  {
    slug: "soiree-ouverture-2026",
    status: "a-venir",
    title: "Soirée d'ouverture de saison",
    date: "2026-11-14",
    time: "22h00 – 5h00",
    place: "Lieu communiqué prochainement, Strasbourg",
    ticketUrl: "",              // laisse vide si pas de billetterie
    cover: null,                // ex: "assets/img/events/ouverture-2026.webp"
    description:
      "Premier rendez-vous de la saison : plusieurs heures de sets tekno, notre sound system complet et l'équipe au complet pour l'occasion.",
    practical: [
      "Entrée à partir de 22h00",
      "Vestiaire sur place",
      "Accès en transport en commun conseillé"
    ]
  },
  {
    slug: "session-plein-air-2026",
    status: "a-venir",
    title: "Session plein air",
    date: "2026-12-20",
    time: "16h00 – 23h00",
    place: "Lieu communiqué prochainement, environs de Strasbourg",
    ticketUrl: "",
    cover: null,
    description:
      "Une session en extérieur, format plus court, pour clôturer l'année avant les fêtes.",
    practical: ["Prévoir des vêtements chauds", "Événement en extérieur, sous réserve de météo"]
  },
  {
    slug: "warm-up-printemps-2025",
    status: "passe",
    title: "Warm-up de printemps",
    date: "2025-04-12",
    place: "Strasbourg",
    cover: null,
    description:
      "Notre première soirée de l'association, une bonne occasion de tester le matériel grandeur nature.",
    gallerySlug: "warm-up-printemps-2025"   // relie vers js/data/galerie.js
  }
];
