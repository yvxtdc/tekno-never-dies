const ADDRESS = {
  street: "5 avenue Georges Clemenceau",
  postalCode: "67630",
  city: "Lauterbourg"
};

const AGENDA_PATH = "yvxtdc.github.io/tekno-never-dies/calendar/events.ics";

export const SITE = {
  name: "Tekno Never Dies",
  shortName: "TND6TEM",
  description: "Association de musique électronique et sound system basée à Lauterbourg, dans le Bas-Rhin.",
  url: "https://yvxtdc.github.io/tekno-never-dies/",
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
};

export function isPlaceholder(value) {
  return typeof value === "string" && value.includes("[");
}
