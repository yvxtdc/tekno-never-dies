const ADDRESS = {
  street: "5 avenue Georges Clemenceau",
  postalCode: "67630",
  city: "Lauterbourg"
};

const AGENDA_PATH = "teknoneverdies.fr/calendar/events.ics";

export const SITE = {
  name: "Tekno Never Dies",
  shortName: "TND6TEM",
  description: "Association de musique électronique et sound system basée à Lauterbourg, dans le Bas-Rhin.",
  url: "https://teknoneverdies.fr/",
  // Adresse de contact utilisée par les scripts (formulaire, agenda, données structurées).
  // Elle est aussi écrite en clair dans les pages et dans partials/ (header, footer).
  email: "tnd6tem@gmail.com",
  // Agenda .ics à jour (généré par tools/generate-calendar.mjs). Si l'adresse du site change,
  // mettre à jour AGENDA_PATH et `page`, puis régénérer assets/img/agenda-qr.svg (voir README).
  agenda: {
    https: `https://${AGENDA_PATH}`,
    // iPhone, iPad, Mac : l'app Calendrier s'abonne directement. Android ne sait pas ouvrir webcal://.
    webcal: `webcal://${AGENDA_PATH}`,
    // Google Agenda (Android) : abonnement à la même adresse
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(`webcal://${AGENDA_PATH}`)}`,
    // Adresse du QR code (assets/img/agenda-qr.svg) : une page https, lisible par tous les téléphones,
    // qui propose le bon bouton d'abonnement (js/pages/evenements.js).
    page: "https://teknoneverdies.fr/evenements.html#agenda"
  },
  // Statistiques de visite (GoatCounter, sans cookie). Tableau de bord : https://teknoneverdies.goatcounter.com
  // Vide = pas de comptage. Si cette adresse change, la mettre aussi dans la CSP de chaque page.
  goatcounter: "https://teknoneverdies.goatcounter.com/count",
  official: {
    legalName: "TEKNO NEVER DIES",
    acronym: "TND",
    siren: "939301768",
    siret: "93930176800015",
    address: ADDRESS,
    headquarters: `${ADDRESS.street}, ${ADDRESS.postalCode} ${ADDRESS.city}`,
    createdAt: "2024-12-04",
    soundSystemCreatedAt: "2023-06-26",
    activity: "90.01Z - Arts du spectacle vivant"
  },
};

export function isPlaceholder(value) {
  return typeof value === "string" && value.includes("[");
}
