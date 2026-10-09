/**
 * Liens Instagram des artistes : sur une fiche événement, le nom de l'artiste dans le
 * line-up devient un lien vers son compte.
 *
 * La clé est le nom tel qu'écrit dans js/data/events.js, peu importe les majuscules,
 * les espaces ou la ponctuation ("DANN OCTA" = "Dann Octa"). Pour un B2B
 * ("Leander B2B Sven Gerber"), chaque artiste reçoit son propre lien.
 * Un artiste absent de cette liste s'affiche simplement sans lien.
 */
export const ARTISTS = {
  "Mogli": "https://www.instagram.com/moe.ru_/",
  "Leander": "https://www.instagram.com/leand76er/",
  "Sven Gerber": "https://www.instagram.com/_svengerber_/",
  "Dann Octa": "https://www.instagram.com/dann_octa.watt/",
  "Meinos": "https://www.instagram.com/meinos_music/",
  "KSCMD": "https://www.instagram.com/kscmd_techno/",
  "Valk": "https://www.instagram.com/val_vtr7/",
  "Redfox": "https://www.instagram.com/noedrion/",
  "TNB": "https://www.instagram.com/tnb_musik/",
  "Blackchills": "https://www.instagram.com/blackchills.music/",
  "D0molly": "https://www.instagram.com/d0.m0lly/",
  "Jakobee": "https://www.instagram.com/jakobee_music/",
  "VS": "https://www.instagram.com/vs__techno/",
  "Rayy3k": "https://www.instagram.com/rayy_dj_/",
  "T.B.R": "https://www.instagram.com/tom_brstn/"
};

/**
 * Style joué par chaque artiste : affiché sous son nom sur la page Artistes
 * et dans le line-up des soirées (un "style" écrit dans events.js reste prioritaire).
 * Même règle pour les noms que ci-dessus. Un artiste absent s'affiche sans style.
 */
export const ARTIST_STYLES = {
  "Mogli": "Trance",
  "Leander": "Hard Trance",
  "Sven Gerber": "Bouncy / Trancy",
  "Dann Octa": "Trancy / Bouncy / Groovy",
  "Meinos": "Hard Techno",
  "KSCMD": "Schranz",
  "Valk": "Bouncy",
  "Redfox": "Bouncy",
  "TNB": "Trance / Groovy / Techno",
  "Blackchills": "Hard Techno",
  "D0molly": "Trance / Acid",
  "Jakobee": "Hard Techno",
  "VS": "Hard Techno",
  "Rayy3k": "Trance"
};
