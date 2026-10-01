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
    slug: "ice-boiler-v2-2026",
    status: "a-venir",
    title: "ICE BOILER v2",
    date: "2026-11-28",
    time: "",
    place: "Munchhausen",
    price: "15 €",
    age: "Dès 16 ans",
    ticketUrl: "",
    cover: "",
    description: "Rendez-vous le samedi 28 novembre 2026 à Munchhausen pour ICE BOILER v2, une soirée organisée par Tekno Never Dies.",
    practical: ["Entrée : 15 €", "Dès 16 ans", "Horaires, adresse précise et billetterie : à compléter"],
  },
  {
    slug: "center-drop-2026",
    status: "passe",
    title: "Center Drop",
    date: "2026-04-04",
    time: "",
    place: "Niederroedern",
    ticketUrl: "",
    cover: "assets/img/events/soiree2.webp",
    description: "Center Drop, soirée organisée à Niederroedern le samedi 4 avril 2026 par Tekno Never Dies.",
    practical: ["Dès 16 ans", "Informations détaillées : à compléter"],
  },
  {
    slug: "ice-boiler-v1-2025",
    status: "passe",
    date: "2025-11-22",
    title: "Ice Boiler v1",
    time: "",
    place: "Munchhausen",
    ticketUrl: "",
    cover: "assets/img/events/soiree1.webp",
    description: "Première édition d'Ice Boiler, organisée à Munchhausen en novembre 2025 par Tekno Never Dies.",
    practical: ["Dès 16 ans", "Informations détaillées : à compléter"],
    gallerySlug: "ice-boiler"
  }
];
