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
    demo: true,
    title: "Soirée d'ouverture de saison",
    date: "2026-11-14",
    time: "22h00 – 5h00",
    place: "Lieu communiqué prochainement, Lauterbourg",
    ticketUrl: "",
    cover: "assets/img/decor/star-pair.webp",
    description: "Une première nuit TND6TEM avec le sound system complet, des sets tekno et une équipe réunie autour du dancefloor.",
    practical: ["Entrée à partir de 22h00", "Vestiaire sur place", "Lieu et billetterie à confirmer"],
    gallerySlug: "ouverture-2026"
  },
  {
    slug: "session-plein-air-2026",
    status: "a-venir",
    demo: true,
    title: "Session plein air",
    date: "2026-12-20",
    time: "16h00 – 23h00",
    place: "Lieu communiqué prochainement, environs de Lauterbourg",
    ticketUrl: "",
    cover: "assets/img/decor/sparkles-lavender.webp",
    description: "Un format extérieur plus court pour faire vibrer le système avant la pause hivernale.",
    practical: ["Prévoir des vêtements chauds", "Événement soumis à la météo", "Lieu à confirmer"],
    gallerySlug: "session-plein-air-2026"
  },
  {
    slug: "atelier-son-2027",
    status: "a-venir",
    demo: true,
    title: "Atelier son : du branchement au dancefloor",
    date: "2027-01-30",
    time: "14h00 – 19h00",
    place: "Lauterbourg, lieu associatif à confirmer",
    ticketUrl: "",
    cover: "assets/img/decor/chain.webp",
    description: "Un après-midi de transmission autour du câblage, du réglage et de la préparation d'une petite configuration son.",
    practical: ["Places limitées", "Aucun prérequis technique", "Inscription à ouvrir"],
    gallerySlug: "atelier-son-2027"
  },
  {
    slug: "warm-up-printemps-2025",
    status: "passe",
    demo: true,
    title: "Warm-up de printemps",
    date: "2025-04-12",
    time: "21h00 – 4h00",
    place: "Strasbourg",
    ticketUrl: "",
    cover: "assets/img/decor/burst.webp",
    description: "La première soirée de démonstration du sound system : une nuit pour tester le matériel grandeur nature.",
    practical: ["Première sortie publique du collectif", "Montage assuré par l'équipe"],
    gallerySlug: "warm-up-printemps-2025"
  },
  {
    slug: "premiere-chaine-2025",
    status: "passe",
    demo: true,
    title: "Première chaîne : rencontre technique",
    date: "2025-09-27",
    time: "18h00 – 1h00",
    place: "Lauterbourg",
    ticketUrl: "",
    cover: "assets/img/decor/star-outline.webp",
    description: "Une rencontre de rentrée dédiée aux idées, aux branchements et aux premières collaborations de la saison.",
    practical: ["Format associatif", "Programmation locale et invités"],
    gallerySlug: "premiere-chaine-2025"
  }
];
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
