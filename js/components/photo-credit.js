// Crédit des photos de la soirée ICE BOILER 2025 (photographe externe), reconnu au dossier de l'image.
// Affiché sous les photos par la galerie et la fiche soirée. Le texte est aussi une clé de traduction
// de js/i18n/de.js et en.js : le modifier oblige à mettre à jour les deux dictionnaires.
const ICE_BOILER_PHOTO_PREFIX = "assets/img/gallery/2025/ice-boiler/";
const ICE_BOILER_PHOTO_CREDIT = "Crédit photo : Jennifer Samtmann (Nebula Studio)";

export function photoCreditFor(src) {
  return src?.startsWith(ICE_BOILER_PHOTO_PREFIX) ? ICE_BOILER_PHOTO_CREDIT : "";
}
