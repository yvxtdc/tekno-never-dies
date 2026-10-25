/**
 * Pictogrammes des missions de l'équipe (bandeau « L'équipe » et fiche d'un membre).
 *
 * Les missions sont saisies en texte dans le CMS (Équipe → Missions). Chacune reçoit automatiquement un
 * pictogramme d'après ses mots (MISSION_RULES, dans l'ordre : la première règle qui correspond gagne).
 * Le texte reste la source : il est lu par les lecteurs d'écran, affiché au survol et dans la fiche.
 * Une mission sans mot connu reçoit le pictogramme par défaut (éclair) ; npm run validate la signale,
 * il suffit alors d'ajouter un mot-clé ici (ou un pictogramme dans MISSION_ICONS).
 *
 * Dessins maison au trait (grille 24 × 24, trait arrondi), pas des emojis : même rendu sur tous les
 * appareils, couleur héritée (currentColor). Aucune dépendance au DOM : utilisable aussi sous Node.
 */

/* Tracés des pictogrammes (contenu d'un <svg viewBox="0 0 24 24">) */
export const MISSION_ICONS = {
  // Planchette avec cases cochées : organisation
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9.5 2.8h5v2.6h-5zM8.5 10.5l1.3 1.3 2.2-2.4M8.5 15.8l1.3 1.3 2.2-2.4M14 11h1.8M14 16.3h1.8"/>',
  // Œil : supervision
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r=".6" fill="currentColor"/>',
  // Réseau de points reliés : coordination, gestion
  network: '<circle cx="12" cy="5" r="2.3"/><circle cx="5" cy="18.5" r="2.3"/><circle cx="19" cy="18.5" r="2.3"/><path d="M12 7.3v4.4M12 11.7l-5.4 5M12 11.7l5.4 5"/>',
  // Enceinte : son, installation technique
  speaker: '<rect x="5.5" y="2.5" width="13" height="19" rx="2.2"/><circle cx="12" cy="14.6" r="3.8"/><circle cx="12" cy="14.6" r="1" fill="currentColor"/><circle cx="12" cy="6.8" r="1.5"/>',
  // Faders de table de mixage : réglages, tests
  sliders: '<path d="M6 3v18M12 3v18M18 3v18"/><rect x="3.8" y="13" width="4.4" height="3.2" rx="1" fill="currentColor"/><rect x="9.8" y="6" width="4.4" height="3.2" rx="1" fill="currentColor"/><rect x="15.8" y="10" width="4.4" height="3.2" rx="1" fill="currentColor"/>',
  // Clé plate : entretien du matériel
  wrench: '<path d="M15.6 3.4a4.6 4.6 0 0 0-4.3 6.2L3.9 17a2.1 2.1 0 0 0 3 3l7.4-7.4a4.6 4.6 0 0 0 6.2-4.3l-2.7 2.7-2.9-.8-.8-2.9Z"/>',
  // Marteau : montage, démontage
  hammer: '<path d="M11.5 9.5 19.6 17.6a1.8 1.8 0 0 1-2.5 2.5L9 12"/><path d="M4 9.6 9.3 4.3l3.6 1.2 1.6 1.6-6 6-1.6-1.6Z"/>',
  // Pièce de puzzle : polyvalent
  puzzle: '<path d="M10 4.6a2 2 0 0 1 4 0V6h4v4h-1.4a2 2 0 0 0 0 4H18v4h-4v-1.4a2 2 0 0 0-4 0V18H6v-4h1.4a2 2 0 0 0 0-4H6V6h4Z"/>',
  // Caisse : stocks
  crate: '<path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5Z"/><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9M7.8 5.3l8.4 4.5"/>',
  // Verre à cocktail : bar
  cocktail: '<path d="M4.5 4.5h15L12 12.5Z"/><path d="M12 12.5v7.5M8.2 20h7.6M7 7.2h10"/><circle cx="18" cy="4.2" r="2"/>',
  // Téléphone avec cœur : réseaux sociaux
  phone: '<rect x="6.8" y="2.5" width="10.4" height="19" rx="2.3"/><path d="M10.8 18.6h2.4"/><path d="M12 13.6 9.9 11.6a1.3 1.3 0 0 1 2.1-1.6 1.3 1.3 0 0 1 2.1 1.6Z" fill="currentColor"/>',
  // Appareil photo : création de contenus
  camera: '<path d="M3.5 8h3.4L8.5 5.5h7L17.1 8h3.4v11.5h-17Z"/><circle cx="12" cy="13.5" r="3.6"/>',
  // Cible : stratégie, image
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
  // Étiquette : bons commerciaux, partenaires
  tag: '<path d="M3.5 12.4V4.5h7.9l9 9-7.9 7.9Z"/><circle cx="8" cy="9" r="1.6"/>',
  // Billet : entrée, billetterie
  ticket: '<path d="M3 6.5h18v3.6a2 2 0 0 0 0 3.8v3.6H3v-3.6a2 2 0 0 0 0-3.8Z"/><path d="M15 6.5v2M15 10.9v2.2M15 15.5v2"/>',
  // Bombe de peinture : graffitis
  spray: '<rect x="6.5" y="8.5" width="9" height="12.5" rx="2"/><path d="M8.5 8.5V6h5v2.5M10 6V3.8h2V6M6.5 13h9"/><path d="M18 4.5h.01M20.5 3.2h.01M20.5 6h.01M19 7.6h.01" stroke-width="2.4"/>',
  // Palette : créations visuelles
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.3 0 1.9-.9 1.6-1.9-.4-1.4.5-2.6 2-2.6H18a3 3 0 0 0 3-3A9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="11.2" r="1.3" fill="currentColor"/><circle cx="10.2" cy="7" r="1.3" fill="currentColor"/><circle cx="15.2" cy="7.6" r="1.3" fill="currentColor"/>',
  // Calendrier étoilé : événementiel
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="m12 11.6 1 2 2.2.3-1.6 1.6.4 2.2-2-1.1-2 1.1.4-2.2-1.6-1.6 2.2-.3Z" fill="currentColor"/>',
  // Éclair (par défaut)
  bolt: '<path d="M13.2 2.5 5 13.5h6.2l-1.4 8 8.2-11.2h-6.2Z"/>'
};

/* Mots-clés -> pictogramme, du plus précis au plus général (texte en minuscules, sans accents) */
export const MISSION_RULES = [
  [/graff|tag mural|fresque/, "spray"],
  [/visuel|graphis|dessin|deco|creati(on|ve)s? visu/, "palette"],
  [/reseau|social|instagram|communication/, "phone"],
  [/contenu|photo|video/, "camera"],
  [/strateg|image|marque/, "target"],
  [/billet|entree|accueil|ticket/, "ticket"],
  [/\bbons?\b|partenai|sponsor|commerc/, "tag"],
  [/stock|inventaire|appro/, "crate"],
  [/\bbar\b|boisson|cocktail/, "cocktail"],
  [/montage|demontage|monter/, "hammer"],
  [/entretien|materiel|repar/, "wrench"],
  [/reglage|test|mix/, "sliders"],
  [/son|sono|lumiere|install/, "speaker"],
  [/supervis|surveill/, "eye"],
  [/coordin|gestion/, "network"],
  [/organis|planning/, "clipboard"],
  [/polyvalen|renfort|aide/, "puzzle"],
  [/evenement|soiree|fete/, "calendar"]
];

export const DEFAULT_MISSION_ICON = "bolt";

const plain = (text) => String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Nom du pictogramme d'une mission (texte français du CMS). */
export function missionIcon(mission) {
  const text = plain(mission);
  return MISSION_RULES.find(([pattern]) => pattern.test(text))?.[1] || DEFAULT_MISSION_ICON;
}

/** Balisage <svg> du pictogramme d'une mission (décoratif : le texte est porté par l'élément parent). */
export function missionIconSvg(mission) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${MISSION_ICONS[missionIcon(mission)]}</svg>`;
}
