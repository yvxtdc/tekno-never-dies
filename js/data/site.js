export const SITE = {
  name: "Tekno Never Dies",
  shortName: "TND6TEM",
  description: "Association et sound system tekno : événements, technique et location de matériel.",
  url: "https://www.example.org",
  official: {
    legalName: "TEKNO NEVER DIES",
    acronym: "TND",
    siren: "939301768",
    siret: "93930176800015",
    headquarters: "51 avenue Georges Clemenceau, 67630 Lauterbourg",
    createdAt: "2024-12-04",
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
