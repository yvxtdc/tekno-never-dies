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
    // TODO à vérifier avec l'autre dev : la version tekno-never-dies_2 indique
    // "5 avenue Georges Clemenceau" (au lieu de "51"). Adresse laissée telle
    // quelle (valeur déjà utilisée aussi dans js/partials.js et association.html).
    headquarters: "51 avenue Georges Clemenceau, 67630 Lauterbourg",
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
