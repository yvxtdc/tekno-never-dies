// Adresse déclarée du siège : une seule source pour le JSON-LD (js/partials.js).
// TODO à vérifier avec l'autre dev : la version tekno-never-dies_2 indique « 5 avenue Georges
// Clemenceau » (au lieu de « 51 »). Adresse laissée telle quelle ; si elle change, il faut aussi
// la corriger dans association.html et mentions-legales.html (tools/validate.mjs le vérifie).
const ADDRESS = {
  street: "51 avenue Georges Clemenceau",
  postalCode: "67630",
  city: "Lauterbourg"
};

const AGENDA_PATH = "yvxtdc.github.io/tekno-never-dies/calendar/events.ics";

export const SITE = {
  name: "Tekno Never Dies",
  shortName: "TND6TEM",
  description: "Association et sound system tekno : événements et technique.",
  url: "https://www.example.org",
  // Agenda .ics à jour (généré par tools/generate-calendar.mjs). Si l'adresse du site change,
  // mettre à jour AGENDA_PATH puis régénérer assets/img/agenda-qr.svg (voir README).
  agenda: {
    https: `https://${AGENDA_PATH}`,
    webcal: `webcal://${AGENDA_PATH}`
  },
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
  placeholders: {
    contact: "[COORDONNEES A REMPLACER]",
    social: "[RESEAU SOCIAL A REMPLACER]",
    copy: "[CONTENU A REMPLACER PAR UNE INFORMATION VALIDEE]",
    image: "[PHOTO A REMPLACER]"
  }
};

export function isPlaceholder(value) {
  return typeof value === "string" && value.includes("[");
}
