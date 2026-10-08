/**
 * Données des événements. Un seul endroit à modifier pour que la liste ET
 * les fiches détaillées se mettent à jour automatiquement.
 *
 * Pour ajouter un événement : copie un objet ci-dessous, change les valeurs.
 * "slug" doit être unique (utilisé dans l'adresse de la fiche, ex :
 * evenement.html?slug=soiree-halloween-2026), sans espaces ni accents.
 * "À venir" / "passé" est calculé automatiquement depuis "date" (rien à changer après la soirée).
 *
 * Visuels :
 *   "flyer"      → affiche de la soirée (portrait), montrée en entier sur la fiche
 *                  et utilisée pour la vignette de la liste.
 *   "cover"      → photo utilisée quand il n'y a pas de flyer.
 * "genres" : styles musicaux affichés sur la fiche (et pris en compte par la recherche).
 */
export const EVENTS = [
  {
    slug: "ice-boiler-v2-2026",
    title: "ICE BOILER v2",
    date: "2026-11-28",
    time: "21h00 – 4h00",
    place: "Salle polyvalente, 81 rue du Rhin, Munchhausen",
    price: "10 à 16 € en prévente, 18 € sur place",
    age: "Dès 16 ans",
    ticketUrl: "https://www.helloasso.com/associations/tekno-never-dies/evenements/ice-boiler-1",
    flyer: "assets/img/events/flyer-ice-boiler-v2-2026.webp",
    cover: "",
    genres: ["Trance", "Groovy", "Bouncy", "Techno"],
    description: "Rendez-vous le samedi 28 novembre 2026 à 21h00 à la salle polyvalente de Munchhausen pour ICE BOILER v2, une soirée trance, groovy, bouncy et techno organisée par Tekno Never Dies.",
    practical: ["Début : 21h00", "Prévente en ligne sur HelloAsso : 10 €, 13 € ou 16 €", "Sur place (caisse du soir) : 18 €", "Dès 16 ans"],
    lineup: [
      { name: "DJ Contest", time: "21h00 – 22h00" },
      { name: "Mogli", time: "22h00 – 23h30" },
      { name: "Dann Octa", time: "23h30 – 1h00" },
      { name: "Leander", time: "1h00 – 2h30" },
      { name: "Rayy3k", time: "2h30 – 4h00" }
    ],
  },
  {
    slug: "center-drop-2026",
    title: "Center Drop",
    date: "2026-04-04",
    time: "21h00 – 4h00",
    place: "1 rue du Stade, Niederroedern",
    ticketUrl: "",
    flyer: "assets/img/events/flyer-center-drop-2026.webp",
    cover: "assets/img/events/soiree2.webp",
    genres: ["Schranz", "Techno", "Trance", "Bounce"],
    description: "Center Drop, soirée techno organisée à Niederroedern le samedi 4 avril 2026 par Tekno Never Dies.",
    practical: ["Dès 16 ans", "250 participant·es"],
    lineup: [
      { name: "Mogli", time: "21h00 – 22h00" },
      { name: "Leander B2B Sven Gerber", time: "22h00 – 23h30" },
      { name: "Dann Octa", time: "23h30 – 1h00" },
      { name: "Meinos", time: "1h00 – 2h30" },
      { name: "KSCMD", time: "2h30 – 4h00" }
    ],
  },
  {
    slug: "fete-musique-wissembourg-2025",
    title: "Fête de la musique",
    date: "2025-06-21",
    time: "16h00 – 00h00",
    place: "Wissembourg",
    ticketUrl: "",
    flyer: "assets/img/events/flyer-fete-musique-2025.webp",
    cover: "",
    genres: ["Techno", "Groove", "Hardtechno"],
    description: "Techno Party de la Fête de la musique à Wissembourg, présentée par RRC & TND le 21 juin 2025.",
    practical: ["150 participant·es"],
    // Pas d'horaires sur l'affiche : l'ordre ci-dessous est celui du line-up.
    lineup: [
      { name: "MEINOS", style: "DJ Contest" },
      { name: "D0MOLLY" },
      { name: "VALK B2B REDFOX" },
      { name: "TNB" },
      { name: "JAKOBEE" },
      { name: "BLACKCHILLS" },
      { name: "VS" }
    ]
  },
  {
    slug: "ice-boiler-v1-2025",
    date: "2025-11-22",
    title: "ICE BOILER v1",
    time: "20h00 – 4h00",
    place: "Salle des fêtes, Munchhausen",
    ticketUrl: "",
    flyer: "assets/img/events/flyer-ice-boiler-v1-2025.webp",
    cover: "assets/img/events/soiree1.webp",
    genres: ["Techno"],
    description: "Première édition d'ICE BOILER, soirée techno organisée à la salle des fêtes de Munchhausen le 22 novembre 2025 par Tekno Never Dies.",
    practical: ["Dès 16 ans", "200 participant·es"],
    lineup: [
      { name: "DANN OCTA", time: "20h00 – 21h00" },
      { name: "VALK b2b REDFOX", time: "21h00 – 22h00" },
      { name: "SVEN GERBER", time: "22h00 – 23h30" },
      { name: "LEANDER", time: "23h30 – 1h00" },
      { name: "TNB", time: "1h00 – 2h30" },
      { name: "BLACKCHILLS", time: "2h30 – 4h00" }
    ],
    gallerySlug: "ice-boiler"
  }
];